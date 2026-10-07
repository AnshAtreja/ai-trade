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

/**
 * Opening-range breakout during the OPENING session (and early REGULAR while OR still relevant).
 * Opening range uses first N minutes of 1m candles after 09:15 IST conceptually via candle count.
 */
export class OpeningMomentumStrategy implements Strategy {
  readonly id = "opening-momentum";
  readonly name = "Opening Momentum";
  readonly version = "1";
  readonly allowedSessions = ["OPENING", "REGULAR"] as const;

  constructor(private readonly config: StrategyConfig) {}

  evaluate(context: StrategyContext): StrategyEvaluation {
    const cfg = this.config.openingMomentum;
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
        `opening momentum only runs in OPENING/REGULAR; session is ${context.marketSession}`
      ]);
    }

    // After first hour of regular session, opening-range edge is no longer this strategy's domain.
    if (context.marketSession === "REGULAR") {
      const mins = context.replayHints?.istMinutes ?? istMinutes(context.currentTime);
      if (mins >= 9 * 60 + 45) {
        return fail("NO_SETUP", [{ name: "opening_window", passed: false }], [
          "outside opening-momentum window (after 09:45 IST)"
        ]);
      }
    }

    if (!tick || !(tick.lastPrice > 0)) {
      return fail("DATA_UNAVAILABLE", [{ name: "valid_market_data", passed: false }], ["last price unavailable"]);
    }

    if (context.stale || (context.dataAgeMs != null && context.dataAgeMs > this.config.maxDataAgeMs)) {
      return fail("SETUP_INVALID", [{ name: "data_fresh", passed: false }], ["market data is stale"]);
    }

    const candles = context.candles1m;
    if (candles.length < cfg.openingRangeMinutes) {
      return fail("DATA_UNAVAILABLE", [
        { name: "opening_range_established", passed: false, detail: `candles=${candles.length}` }
      ], ["opening range not established yet"]);
    }

    const precomputedRange = cfg.openingRangeMinutes === 15 ? context.replayHints?.openingRange15 : null;
    const orCandles = precomputedRange ? null : candles.slice(0, cfg.openingRangeMinutes);
    const orHigh = precomputedRange?.high ?? Math.max(...orCandles!.map((c) => c.high));
    const orLow = precomputedRange?.low ?? Math.min(...orCandles!.map((c) => c.low));
    if (!(orHigh > orLow)) {
      return fail("DATA_UNAVAILABLE", [{ name: "opening_range_established", passed: false }], [
        "opening range high/low not differentiable"
      ]);
    }

    const price = tick.lastPrice;
    const breakUp = price > orHigh * (1 + cfg.breakBufferPercent / 100);
    const breakDown = price < orLow * (1 - cfg.breakBufferPercent / 100);

    const recentPrices = context.replayHints?.positiveRecentPrices ?? context.recentTicks.map((t) => t.lastPrice).filter((p) => p > 0);
    const momentumPct = shortTermMomentumPercent(recentPrices.slice(-4));
    const momUp = momentumPct != null && momentumPct >= cfg.minMomentumPercent;
    const momDown = momentumPct != null && momentumPct <= -cfg.minMomentumPercent;
    const volumeOk = tick.volume == null ? true : tick.volume >= cfg.minVolume;

    const direction = breakUp && momUp ? "BULLISH" : breakDown && momDown ? "BEARISH" : "NEUTRAL";

    const conditions: StrategyCondition[] = [
      { name: "session_allowed", passed: true, detail: context.marketSession },
      { name: "valid_market_data", passed: true },
      { name: "data_fresh", passed: true },
      { name: "opening_range_established", passed: true, detail: `high=${orHigh} low=${orLow}` },
      { name: "opening_range_break", passed: breakUp || breakDown, detail: breakUp ? "above" : breakDown ? "below" : "inside" },
      { name: "directional_momentum", passed: (breakUp && momUp) || (breakDown && momDown), detail: momentumPct == null ? "unavailable" : `${momentumPct.toFixed(3)}%` },
      { name: "volume_activity", passed: volumeOk }
    ];

    if (!breakUp && !breakDown) {
      return fail("NO_SETUP", conditions, ["price still inside opening range"]);
    }

    if (direction === "NEUTRAL") {
      return fail(
        "SETUP_INVALID",
        conditions,
        [momentumPct == null ? "insufficient ticks for momentum" : "opening-range break without confirming momentum"],
        breakUp ? "BULLISH" : "BEARISH"
      );
    }

    if (!volumeOk) {
      return fail("SETUP_INVALID", conditions, ["insufficient market activity"], direction);
    }

    const entryPrice = round4(price);
    let stopLoss: number;
    if (direction === "BULLISH") {
      stopLoss = round4(orLow * (1 - cfg.stopBufferPercent / 100));
      if (!(stopLoss < entryPrice)) {
        return fail("SETUP_INVALID", conditions, ["invalid stop below opening range"], direction);
      }
    } else {
      stopLoss = round4(orHigh * (1 + cfg.stopBufferPercent / 100));
      if (!(stopLoss > entryPrice)) {
        return fail("SETUP_INVALID", conditions, ["invalid stop above opening range"], direction);
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

    const orWidthPct = percentChange(orLow, orHigh) ?? 0;
    const confidenceComponents = {
      rangeBreak: 35,
      momentum: Math.min(40, Math.round(Math.abs(momentumPct ?? 0) * 50)),
      rangeQuality: Math.min(25, Math.round(orWidthPct * 8))
    };
    const confidence = Math.min(
      100,
      confidenceComponents.rangeBreak + confidenceComponents.momentum + confidenceComponents.rangeQuality
    );

    const reasonMap: Record<string, string> = {
      opening_range_break: direction === "BULLISH" ? "price broke above opening range" : "price broke below opening range",
      directional_momentum: "directional momentum confirms opening-range break",
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
      entry: { type: direction === "BULLISH" ? "BREAKOUT_PRICE" : "BREAKDOWN_PRICE", price: entryPrice },
      stopLoss,
      target,
      rewardRisk,
      riskPerUnit: round4(Math.abs(entryPrice - stopLoss)),
      invalidation: {
        stopLoss,
        rules: [
          "price re-enters opening range beyond stop",
          "momentum reverses",
          "market data becomes stale",
          "opening window ends / session closes"
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

function istMinutes(at: Date) {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  return hour * 60 + minute;
}
