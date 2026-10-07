import { createHash } from "node:crypto";
import type { MarketSessionState } from "../../common/utils/market-session";
import type {
  StrategyCondition,
  StrategyDirection,
  StrategyEntry,
  StrategyEvaluation,
  StrategyInvalidation,
  StrategyStatus
} from "./engine-types";

export function buildSetupIdentity(input: {
  strategyId: string;
  strategyVersion: string;
  instrumentToken: string;
  direction: StrategyDirection;
  /** Bucketed timestamp for identity stability within the same minute. */
  setupBucketIso: string;
}) {
  const material = [
    input.strategyId,
    input.strategyVersion,
    input.instrumentToken,
    input.direction,
    input.setupBucketIso
  ].join("|");
  const hash = createHash("sha256").update(material).digest("hex").slice(0, 16);
  return `${input.strategyId}:v${input.strategyVersion}:${input.instrumentToken}:${hash}`;
}

export function minuteBucketIso(at: Date) {
  const d = new Date(at);
  d.setUTCSeconds(0, 0);
  return d.toISOString();
}

export function reasonsFromConditions(conditions: StrategyCondition[], messages: Record<string, string>) {
  return conditions.filter((c) => c.passed && messages[c.name]).map((c) => messages[c.name]!);
}

export function computeRewardRisk(entry: number, stop: number, target: number, direction: StrategyDirection) {
  const risk = Math.abs(entry - stop);
  const reward = Math.abs(target - entry);
  if (!(risk > 0) || !(reward > 0)) {
    return null;
  }
  if (direction === "BULLISH" && !(stop < entry && target > entry)) {
    return null;
  }
  if (direction === "BEARISH" && !(stop > entry && target < entry)) {
    return null;
  }
  return round4(reward / risk);
}

export function targetFromRiskReward(entry: number, stop: number, rewardRisk: number, direction: StrategyDirection) {
  const risk = Math.abs(entry - stop);
  if (!(risk > 0)) {
    return null;
  }
  if (direction === "BULLISH") {
    return round4(entry + risk * rewardRisk);
  }
  if (direction === "BEARISH") {
    return round4(entry - risk * rewardRisk);
  }
  return null;
}

export function round4(value: number) {
  return Math.round(value * 10000) / 10000;
}

export function percentChange(from: number, to: number) {
  if (!(from > 0)) {
    return null;
  }
  return ((to - from) / from) * 100;
}

export function shortTermMomentumPercent(prices: number[]) {
  if (prices.length < 2) {
    return null;
  }
  const first = prices[0]!;
  const last = prices[prices.length - 1]!;
  return percentChange(first, last);
}

export function baseEvaluation(input: {
  strategyId: string;
  strategyVersion: string;
  instrumentToken: string;
  tradingSymbol: string;
  exchange: string;
  instrumentId: string | null;
  status: StrategyStatus;
  direction: StrategyDirection;
  conditions: StrategyCondition[];
  reasons: string[];
  confidence: number | null;
  confidenceComponents: Record<string, number> | null;
  entry: StrategyEntry | null;
  stopLoss: number | null;
  target: number | null;
  rewardRisk: number | null;
  riskPerUnit: number | null;
  invalidation: StrategyInvalidation | null;
  scannerSignalId: string | null;
  marketDataTimestamp: string | null;
  marketSession: MarketSessionState;
  timestamp: string;
  setupBucketIso: string;
}): StrategyEvaluation {
  return {
    strategyId: input.strategyId,
    strategyVersion: input.strategyVersion,
    setupIdentity: buildSetupIdentity({
      strategyId: input.strategyId,
      strategyVersion: input.strategyVersion,
      instrumentToken: input.instrumentToken,
      direction: input.direction,
      setupBucketIso: input.setupBucketIso
    }),
    instrumentToken: input.instrumentToken,
    tradingSymbol: input.tradingSymbol,
    exchange: input.exchange,
    instrumentId: input.instrumentId,
    status: input.status,
    direction: input.direction,
    confidence: input.confidence,
    confidenceComponents: input.confidenceComponents,
    conditions: input.conditions,
    reasons: input.reasons,
    entry: input.entry,
    stopLoss: input.stopLoss,
    target: input.target,
    rewardRisk: input.rewardRisk,
    riskPerUnit: input.riskPerUnit,
    invalidation: input.invalidation,
    scannerSignalId: input.scannerSignalId,
    marketDataTimestamp: input.marketDataTimestamp,
    marketSession: input.marketSession,
    timestamp: input.timestamp
  };
}

export function sessionAllowed(
  allowed: MarketSessionState[],
  current: MarketSessionState
): boolean {
  return allowed.includes(current);
}
