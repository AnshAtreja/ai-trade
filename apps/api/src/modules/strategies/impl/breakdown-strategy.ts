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

export class BreakdownStrategy implements Strategy {
  readonly id = "breakdown";
  readonly name = "Intraday Breakdown";
  readonly version = "1";
  readonly allowedSessions = ["REGULAR", "CLOSING"] as const;

  constructor(private readonly config: StrategyConfig) {}

  evaluate(context: StrategyContext): StrategyEvaluation {
    const cfg = this.config.breakdown;
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
        `breakdown only runs in ${this.allowedSessions.join("/")}; session is ${context.marketSession}`
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

    const priorTicks = context.recentTicks.slice(0, Math.max(0, context.recentTicks.length - cfg.confirmationTicks));
    const referenceLow = minLow(priorTicks) ?? (tick.low != null && tick.low < tick.lastPrice ? tick.low : null);
    if (referenceLow == null || !(referenceLow > 0)) {
      return fail("DATA_UNAVAILABLE", [
        { name: "day_low_available", passed: false }
      ], ["insufficient history to establish a prior session low for confirmation"]);
    }

    const price = tick.lastPrice;
    const distancePct = percentChange(referenceLow, price);
    const nearLow =
      distancePct != null && distancePct <= cfg.proximityPercent && distancePct > 0;
    const breakingLow = price <= referenceLow && price >= referenceLow * (1 - 0.0005);
    const belowLow = price < referenceLow;

    const recentPrices = context.replayHints?.positiveRecentPrices ?? context.recentTicks.map((t) => t.lastPrice).filter((p) => p > 0);
    const confirmationPrices = recentPrices.slice(-cfg.confirmationTicks);
    const confirmedBreakdown =
      belowLow &&
      confirmationPrices.length >= cfg.confirmationTicks &&
      confirmationPrices.every((p) => p < referenceLow);

    let level: "NONE" | "NEAR_LOW" | "BREAKING_LOW" | "CONFIRMED_BREAKDOWN" = "NONE";
    if (confirmedBreakdown) {
      level = "CONFIRMED_BREAKDOWN";
    } else if (breakingLow || belowLow) {
      level = "BREAKING_LOW";
    } else if (nearLow) {
      level = "NEAR_LOW";
    }

    const momentumPct = shortTermMomentumPercent(recentPrices.slice(-Math.max(cfg.confirmationTicks + 1, 3)));
    const momentumNegative = momentumPct != null && momentumPct <= -cfg.minMomentumPercent;
    const volumeOk = tick.volume == null ? true : tick.volume >= cfg.minVolume;
    const volumeAvailable = tick.volume != null;

    const conditions: StrategyCondition[] = [
      { name: "session_allowed", passed: true, detail: context.marketSession },
      { name: "valid_market_data", passed: true },
      { name: "data_fresh", passed: true },
      { name: "near_day_low", passed: Boolean(nearLow || breakingLow || belowLow), detail: `distancePct=${distancePct?.toFixed(3)}` },
      { name: "breakdown_level", passed: level === "CONFIRMED_BREAKDOWN", detail: level },
      { name: "momentum_negative", passed: Boolean(momentumNegative), detail: momentumPct == null ? "unavailable" : `${momentumPct.toFixed(3)}%` },
      {
        name: "volume_activity",
        passed: volumeOk,
        detail: volumeAvailable ? `volume=${tick.volume}` : "volume_not_in_mode"
      }
    ];

    if (level === "NEAR_LOW" || level === "BREAKING_LOW") {
      return fail(
        "NO_SETUP",
        conditions,
        [
          level === "NEAR_LOW"
            ? "price near day low but breakdown not confirmed"
            : "price at/below day low but confirmation ticks insufficient"
        ],
        "BEARISH"
      );
    }

    if (level !== "CONFIRMED_BREAKDOWN") {
      return fail("NO_SETUP", conditions, ["no breakdown structure"], "NEUTRAL");
    }

    if (!momentumNegative) {
      return fail(
        "SETUP_INVALID",
        conditions,
        [momentumPct == null ? "insufficient tick history for momentum" : "momentum not sufficiently negative"],
        "BEARISH"
      );
    }

    if (!volumeOk) {
      return fail("SETUP_INVALID", conditions, ["insufficient market activity"], "BEARISH");
    }

    const entryPrice = round4(price);
    const stopLoss = round4(referenceLow * (1 + cfg.stopBufferPercent / 100));
    if (!(stopLoss > entryPrice)) {
      return fail("SETUP_INVALID", conditions, ["invalid stop above breakdown structure"], "BEARISH");
    }

    const target = targetFromRiskReward(entryPrice, stopLoss, cfg.targetRewardRisk, "BEARISH");
    if (target == null) {
      return fail("SETUP_INVALID", conditions, ["unable to compute target"], "BEARISH");
    }

    const rewardRisk = computeRewardRisk(entryPrice, stopLoss, target, "BEARISH");
    if (rewardRisk == null || rewardRisk < this.config.minRewardRisk) {
      return fail(
        "SETUP_INVALID",
        [...conditions, { name: "reward_risk_ok", passed: false, detail: String(rewardRisk) }],
        ["reward/risk below minimum"],
        "BEARISH"
      );
    }

    conditions.push({ name: "reward_risk_ok", passed: true, detail: String(rewardRisk) });
    conditions.push({ name: "stop_valid", passed: true, detail: String(stopLoss) });

    const confidenceComponents = {
      breakdownStrength: Math.min(40, Math.round(((referenceLow - price) / referenceLow) * 10000)),
      momentum: Math.min(35, Math.round(Math.abs(momentumPct ?? 0) * 40)),
      volume: volumeAvailable ? Math.min(25, Math.round((tick.volume! / Math.max(cfg.minVolume, 1)) * 8)) : 15
    };
    const confidence = Math.min(
      100,
      confidenceComponents.breakdownStrength + confidenceComponents.momentum + confidenceComponents.volume
    );

    const reasonMap: Record<string, string> = {
      breakdown_level: "price held below session low across confirmation ticks",
      momentum_negative: "negative short-term momentum",
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
      direction: "BEARISH",
      conditions,
      reasons: reasonsFromConditions(conditions, reasonMap),
      confidence,
      confidenceComponents,
      entry: { type: "BREAKDOWN_PRICE", price: entryPrice },
      stopLoss,
      target,
      rewardRisk,
      riskPerUnit: round4(stopLoss - entryPrice),
      invalidation: {
        stopLoss,
        rules: [
          "price rises above breakdown level / stop",
          "short-term momentum reverses positive",
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

function minLow(ticks: { low: number | null; lastPrice: number }[]) {
  let min: number | null = null;
  for (const tick of ticks) {
    const value = tick.low != null && tick.low > 0 ? tick.low : tick.lastPrice;
    if (!(value > 0)) {
      continue;
    }
    min = min == null ? value : Math.min(min, value);
  }
  return min;
}
