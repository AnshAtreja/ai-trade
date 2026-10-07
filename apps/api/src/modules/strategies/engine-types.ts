import type { MarketSessionState } from "../../common/utils/market-session";
import type { MarketTick } from "../market-data/stream/types";
import type { ScannerCandidate } from "../scanner/production-types";
import type { MarketCandle } from "./candle-aggregator";

export type StrategyStatus = "NO_SETUP" | "SETUP_DETECTED" | "SETUP_INVALID" | "DATA_UNAVAILABLE";

export type StrategyDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type StrategyEntryType = "MARKET" | "BREAKOUT_PRICE" | "BREAKDOWN_PRICE" | "STOP_ENTRY";

export interface StrategyCondition {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface StrategyEntry {
  type: StrategyEntryType;
  price: number;
}

export interface StrategyInvalidation {
  rules: string[];
  stopLoss: number;
}

export interface StrategyConfidenceComponents {
  [key: string]: number;
}

export interface StrategyEvaluation {
  strategyId: string;
  strategyVersion: string;
  setupIdentity: string;
  instrumentToken: string;
  tradingSymbol: string;
  exchange: string;
  instrumentId: string | null;
  status: StrategyStatus;
  direction: StrategyDirection;
  confidence: number | null;
  confidenceComponents: StrategyConfidenceComponents | null;
  conditions: StrategyCondition[];
  reasons: string[];
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
}

export interface StrategyContext {
  instrumentToken: string;
  tradingSymbol: string;
  exchange: string;
  instrumentId: string | null;
  latestTick: MarketTick | null;
  recentTicks: MarketTick[];
  candles1m: MarketCandle[];
  candles5m: MarketCandle[];
  scannerCandidate: ScannerCandidate | null;
  scannerSignalId: string | null;
  marketSession: MarketSessionState;
  currentTime: Date;
  dataAgeMs: number | null;
  stale: boolean;
  /** Optional immutable replay-only values equivalent to existing context derivations. */
  replayHints?: {
    timestamp: string;
    setupBucketIso: string;
    istMinutes: number;
    nonEmptyCandles1m: MarketCandle[];
    openingRange15: { high: number; low: number } | null;
    positiveRecentPrices: number[];
  };
}

export interface StrategyDefinitionMeta {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  allowedSessions: readonly MarketSessionState[];
  description: string;
}

export interface Strategy {
  readonly id: string;
  readonly name: string;
  readonly version: string;
  readonly allowedSessions: readonly MarketSessionState[];
  evaluate(context: StrategyContext): StrategyEvaluation;
}

export interface StrategyEngineStatus {
  lifecycle: "IDLE" | "RUNNING" | "STOPPED";
  schedulerRunning: boolean;
  busy: boolean;
  enabledStrategyIds: string[];
  lastEvaluations: StrategyEvaluation[];
  marketSession: MarketSessionState;
}
