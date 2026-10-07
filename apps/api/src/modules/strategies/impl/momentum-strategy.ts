import type { StrategyConfig } from "../config";
import type { Strategy, StrategyCondition, StrategyContext, StrategyEvaluation } from "../engine-types";
import {
  baseEvaluation,
  computeRewardRisk,
  minuteBucketIso,
  percentChange,
  reasonsFromConditions,
  round4,
  sessionAllowed,
  shortTermMomentumPercent,
  targetFromRiskReward
} from "../helpers";

export class MomentumStrategy implements Strategy {
  readonly id = "momentum";
  readonly name = "Momentum Continuation";
  readonly version = "1";
  readonly allowedSessions = ["REGULAR", "CLOSING"] as const;

  constructor(private readonly config: StrategyConfig) {}

  evaluate(context: StrategyContext): StrategyEvaluation {
    const cfg = this.config.momentum;
    const stamp = context.replayHints?.timestamp ?? context.currentTime.toISOString();
    const bucket = context.replayHints?.setupBucketIso ?? minuteBucketIso(context.currentTime);
    const tick = context.latestTick;

    const fail = (
      status: StrategyEvaluation["status"],
      conditions: StrategyCondition[],
      reasons: string[],
      direction: StrategyEvaluation["direction"] = "NEUTRAL"
    ) =>
      baseEvaluation({
        strategyId: this.id,
        strategyVersion: this.version,
        instrumentToken: context.instrumentToken,
        tradingSymbol: context.tradingSymbol,
        exchange: context.exchange,
        instrumentId: context.instrumentId,
        status,
        direction,
        conditions,
        reasons,
        confidence: null,
        confidenceComponents: null,
        entry: null,
        stopLoss: null,
        target: null,
        rewardRisk: null,
        riskPerUnit: null,
        invalidation: null,
        scannerSignalId: context.scannerSignalId,
        marketDataTimestamp: tick?.exchangeTimestamp ?? tick?.receivedAt ?? null,
        marketSession: context.marketSession,
        timestamp: stamp,
        setupBucketIso: bucket
      });

    if (!sessionAllowed([...this.allowedSessions], context.marketSession)) {
      return fail("NO_SETUP", [{ name: "session_allowed", passed: false, detail: context.marketSession }], [
        `momentum only runs in ${this.allowedSessions.join("/")}; session is ${context.marketSession}`
      ]);
    }

    if (!tick || !(tick.lastPrice > 0)) {
      return fail("DATA_UNAVAILABLE", [{ name: "valid_market_data", passed: false }], ["last price unavailable"]);
    }

    if (context.stale || (context.dataAgeMs != null && context.dataAgeMs > this.config.maxDataAgeMs)) {
      return fail("SETUP_INVALID", [{ name: "data_fresh", passed: false }], ["market data is stale"]);
    }

    const candles = context.replayHints?.nonEmptyCandles1m ?? context.candles1m.filter((c) => c.tickCount > 0);
    if (candles.length < cfg.minSustainedCandles + 1) {
      return fail("DATA_UNAVAILABLE", [
        { name: "candle_history", passed: false, detail: `have=${candles.length}` }
      ], ["insufficient 1m candle history for momentum continuation"]);
    }

    const recent = candles.slice(-(cfg.minSustainedCandles + 1));
    const closes = recent.map((c) => c.close);
    const movePct = shortTermMomentumPercent(closes);
    if (movePct == null) {
      return fail("DATA_UNAVAILABLE", [{ name: "momentum_measurable", passed: false }], ["unable to measure momentum"]);
    }

    const bullish = movePct >= cfg.minMovePercent;
    const bearish = movePct <= -cfg.minMovePercent;
    const sustainedBull =
      bullish && recent.slice(1).every((c, i) => c.close >= recent[i]!.close);
    const sustainedBear =
      bearish && recent.slice(1).every((c, i) => c.close <= recent[i]!.close);

    const openRef = tick.open ?? recent[0]!.open;
    const extensionPct = percentChange(openRef, tick.lastPrice);
    const notExtended =
      extensionPct == null ? true : Math.abs(extensionPct) <= cfg.maxExtensionPercent;

    const volumeOk = tick.volume == null ? true : tick.volume >= cfg.minVolume;

    const direction = sustainedBull ? "BULLISH" : sustainedBear ? "BEARISH" : "NEUTRAL";

    const conditions: StrategyCondition[] = [
      { name: "session_allowed", passed: true },
      { name: "valid_market_data", passed: true },
      { name: "data_fresh", passed: true },
      { name: "candle_history", passed: true, detail: `candles=${candles.length}` },
      { name: "directional_move", passed: bullish || bearish, detail: `${movePct.toFixed(3)}%` },
      { name: "sustained_direction", passed: sustainedBull || sustainedBear },
      { name: "not_excessively_extended", passed: notExtended, detail: extensionPct == null ? "open_unavailable" : `${extensionPct.toFixed(3)}%` },
      { name: "volume_activity", passed: volumeOk }
    ];

    if (!sustainedBull && !sustainedBear) {
      return fail(
        "NO_SETUP",
        conditions,
        [bullish || bearish ? "move present but not sustained" : "short-term move below threshold"],
        direction === "NEUTRAL" ? "NEUTRAL" : direction
      );
    }

    if (!notExtended) {
      return fail("SETUP_INVALID", conditions, ["price excessively extended from open"], direction);
    }

    if (!volumeOk) {
      return fail("SETUP_INVALID", conditions, ["insufficient market activity"], direction);
    }

    const entryPrice = round4(tick.lastPrice);
    const structureLow = Math.min(...recent.map((c) => c.low));
    const structureHigh = Math.max(...recent.map((c) => c.high));

    let stopLoss: number;
    if (direction === "BULLISH") {
      stopLoss = round4(structureLow * (1 - cfg.stopBufferPercent / 100));
      if (!(stopLoss < entryPrice)) {
        return fail("SETUP_INVALID", conditions, ["invalid stop below recent structure"], direction);
      }
    } else {
      stopLoss = round4(structureHigh * (1 + cfg.stopBufferPercent / 100));
      if (!(stopLoss > entryPrice)) {
        return fail("SETUP_INVALID", conditions, ["invalid stop above recent structure"], direction);
      }
    }

    const target = targetFromRiskReward(entryPrice, stopLoss, cfg.targetRewardRisk, direction);
    if (target == null) {
      return fail("SETUP_INVALID", conditions, ["unable to compute target"], direction);
    }

    const rewardRisk = computeRewardRisk(entryPrice, stopLoss, target, direction);
    if (rewardRisk == null || rewardRisk < this.config.minRewardRisk) {
      return fail(
        "SETUP_INVALID",
        [...conditions, { name: "reward_risk_ok", passed: false }],
        ["reward/risk below minimum"],
        direction
      );
    }

    conditions.push({ name: "reward_risk_ok", passed: true, detail: String(rewardRisk) });
    conditions.push({ name: "stop_valid", passed: true });

    const confidenceComponents = {
      momentum: Math.min(45, Math.round(Math.abs(movePct) * 30)),
      sustained: 30,
      volume: tick.volume != null ? Math.min(25, 15) : 15
    };
    const confidence = Math.min(100, confidenceComponents.momentum + confidenceComponents.sustained + confidenceComponents.volume);

    const reasonMap: Record<string, string> = {
      directional_move: `${direction === "BULLISH" ? "positive" : "negative"} short-term movement`,
      sustained_direction: "sustained directional 1m closes",
      not_excessively_extended: "not excessively extended from open",
      volume_activity: "sufficient market activity",
      reward_risk_ok: `reward/risk ${rewardRisk}`
    };

    return baseEvaluation({
      strategyId: this.id,
      strategyVersion: this.version,
      instrumentToken: context.instrumentToken,
      tradingSymbol: context.tradingSymbol,
      exchange: context.exchange,
      instrumentId: context.instrumentId,
      status: "SETUP_DETECTED",
      direction,
      conditions,
      reasons: reasonsFromConditions(conditions, reasonMap),
      confidence,
      confidenceComponents,
      entry: { type: "MARKET", price: entryPrice },
      stopLoss,
      target,
      rewardRisk,
      riskPerUnit: round4(Math.abs(entryPrice - stopLoss)),
      invalidation: {
        stopLoss,
        rules: [
          direction === "BULLISH" ? "price falls below recent structure stop" : "price rises above recent structure stop",
          "momentum reverses against setup",
          "market data becomes stale",
          "session closes"
        ]
      },
      scannerSignalId: context.scannerSignalId,
      marketDataTimestamp: tick.exchangeTimestamp ?? tick.receivedAt,
      marketSession: context.marketSession,
      timestamp: stamp,
      setupBucketIso: bucket
    });
  }
}
