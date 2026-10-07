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

export class BreakoutStrategy implements Strategy {
  readonly id = "breakout";
  readonly name = "Intraday Breakout";
  readonly version = "1";
  readonly allowedSessions = ["REGULAR", "CLOSING"] as const;

  constructor(private readonly config: StrategyConfig) {}

  evaluate(context: StrategyContext): StrategyEvaluation {
    const cfg = this.config.breakout;
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
        `breakout only runs in ${this.allowedSessions.join("/")}; session is ${context.marketSession}`
      ]);
    }

    if (!tick || !(tick.lastPrice > 0)) {
      return fail("DATA_UNAVAILABLE", [
        { name: "valid_market_data", passed: false }
      ], ["last price unavailable"]);
    }

    if (context.stale || (context.dataAgeMs != null && context.dataAgeMs > this.config.maxDataAgeMs)) {
      return fail("SETUP_INVALID", [
        { name: "data_fresh", passed: false, detail: `age=${context.dataAgeMs}ms` }
      ], ["market data is stale"]);
    }

    // Day high on the latest tick already includes lastPrice; use prior ticks for a breakout reference.
    const priorTicks = context.recentTicks.slice(0, Math.max(0, context.recentTicks.length - cfg.confirmationTicks));
    const referenceHigh = maxHigh(priorTicks) ?? (tick.high != null && tick.high > tick.lastPrice ? tick.high : null);
    if (referenceHigh == null || !(referenceHigh > 0)) {
      return fail("DATA_UNAVAILABLE", [
        { name: "day_high_available", passed: false }
      ], ["insufficient history to establish a prior session high for confirmation"]);
    }

    const price = tick.lastPrice;
    const distancePct = percentChange(referenceHigh, price);
    const nearHigh =
      distancePct != null && distancePct >= -cfg.proximityPercent && distancePct < 0;
    const breakingHigh = price >= referenceHigh && price <= referenceHigh * (1 + 0.0005);
    const aboveHigh = price > referenceHigh;

    const recentPrices = context.replayHints?.positiveRecentPrices ?? context.recentTicks.map((t) => t.lastPrice).filter((p) => p > 0);
    const confirmationPrices = recentPrices.slice(-cfg.confirmationTicks);
    const confirmedBreakout =
      aboveHigh &&
      confirmationPrices.length >= cfg.confirmationTicks &&
      confirmationPrices.every((p) => p > referenceHigh);

    let breakoutLevel: "NONE" | "NEAR_HIGH" | "BREAKING_HIGH" | "CONFIRMED_BREAKOUT" = "NONE";
    if (confirmedBreakout) {
      breakoutLevel = "CONFIRMED_BREAKOUT";
    } else if (breakingHigh || aboveHigh) {
      breakoutLevel = "BREAKING_HIGH";
    } else if (nearHigh) {
      breakoutLevel = "NEAR_HIGH";
    }

    const momentumPct = shortTermMomentumPercent(recentPrices.slice(-Math.max(cfg.confirmationTicks + 1, 3)));
    const momentumPositive = momentumPct != null && momentumPct >= cfg.minMomentumPercent;

    const volumeOk =
      tick.volume == null ? true : tick.volume >= cfg.minVolume;
    const volumeAvailable = tick.volume != null;

    const conditions: StrategyCondition[] = [
      { name: "session_allowed", passed: true, detail: context.marketSession },
      { name: "valid_market_data", passed: true },
      { name: "data_fresh", passed: true },
      { name: "near_day_high", passed: Boolean(nearHigh || breakingHigh || aboveHigh), detail: `distancePct=${distancePct?.toFixed(3)}` },
      { name: "breakout_level", passed: breakoutLevel === "CONFIRMED_BREAKOUT", detail: breakoutLevel },
      { name: "momentum_positive", passed: Boolean(momentumPositive), detail: momentumPct == null ? "unavailable" : `${momentumPct.toFixed(3)}%` },
      {
        name: "volume_activity",
        passed: volumeOk,
        detail: volumeAvailable ? `volume=${tick.volume}` : "volume_not_in_mode"
      }
    ];

    if (breakoutLevel === "NEAR_HIGH" || breakoutLevel === "BREAKING_HIGH") {
      return fail(
        "NO_SETUP",
        conditions,
        [
          breakoutLevel === "NEAR_HIGH"
            ? "price near day high but breakout not confirmed"
            : "price at/above day high but confirmation ticks insufficient"
        ],
        "BULLISH"
      );
    }

    if (breakoutLevel !== "CONFIRMED_BREAKOUT") {
      return fail("NO_SETUP", conditions, ["no breakout structure"], "NEUTRAL");
    }

    if (!momentumPositive) {
      return fail(
        "SETUP_INVALID",
        conditions,
        [momentumPct == null ? "insufficient tick history for momentum" : "momentum not sufficiently positive"],
        "BULLISH"
      );
    }

    if (!volumeOk) {
      return fail("SETUP_INVALID", conditions, ["insufficient market activity"], "BULLISH");
    }

    const entryPrice = round4(price);
    const stopLoss = round4(referenceHigh * (1 - cfg.stopBufferPercent / 100));
    if (!(stopLoss < entryPrice)) {
      return fail("SETUP_INVALID", conditions, ["invalid stop below breakout structure"], "BULLISH");
    }

    const target = targetFromRiskReward(entryPrice, stopLoss, cfg.targetRewardRisk, "BULLISH");
    if (target == null) {
      return fail("SETUP_INVALID", conditions, ["unable to compute target"], "BULLISH");
    }

    const rewardRisk = computeRewardRisk(entryPrice, stopLoss, target, "BULLISH");
    if (rewardRisk == null || rewardRisk < this.config.minRewardRisk) {
      return fail(
        "SETUP_INVALID",
        [...conditions, { name: "reward_risk_ok", passed: false, detail: String(rewardRisk) }],
        ["reward/risk below minimum"],
        "BULLISH"
      );
    }

    conditions.push({ name: "reward_risk_ok", passed: true, detail: String(rewardRisk) });
    conditions.push({ name: "stop_valid", passed: true, detail: String(stopLoss) });

    const confidenceComponents = {
      breakoutStrength: Math.min(40, Math.round(((price - referenceHigh) / referenceHigh) * 10000)),
      momentum: Math.min(35, Math.round((momentumPct ?? 0) * 40)),
      volume: volumeAvailable ? Math.min(25, Math.round((tick.volume! / Math.max(cfg.minVolume, 1)) * 8)) : 15
    };
    const confidence = Math.min(
      100,
      confidenceComponents.breakoutStrength + confidenceComponents.momentum + confidenceComponents.volume
    );

    const reasonMap: Record<string, string> = {
      breakout_level: "price held above session high across confirmation ticks",
      momentum_positive: "positive short-term momentum",
      volume_activity: volumeAvailable ? "elevated market activity" : "activity check skipped (volume not in stream mode)",
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
      direction: "BULLISH",
      conditions,
      reasons: reasonsFromConditions(conditions, reasonMap),
      confidence,
      confidenceComponents,
      entry: { type: "BREAKOUT_PRICE", price: entryPrice },
      stopLoss,
      target,
      rewardRisk,
      riskPerUnit: round4(entryPrice - stopLoss),
      invalidation: {
        stopLoss,
        rules: [
          "price falls below breakout level / stop",
          "short-term momentum reverses negative",
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

function maxHigh(ticks: { high: number | null; lastPrice: number }[]) {
  let max: number | null = null;
  for (const tick of ticks) {
    const value = tick.high != null && tick.high > 0 ? tick.high : tick.lastPrice;
    if (!(value > 0)) {
      continue;
    }
    max = max == null ? value : Math.max(max, value);
  }
  return max;
}
