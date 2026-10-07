import type { HistoricalCandleIntervalCode } from "../../../db/domain";
import type { NormalizedHistoricalCandle, ValidationIssue } from "../../historical-market-data/types";
import type { MarketTick } from "../../market-data/stream/types";
import type { ScannerCandidate, ScannerRunStats } from "../production-types";
import type { StrategyEvaluation, StrategyStatus } from "../../strategies/engine-types";
import type { ClosingAuctionEligibility } from "../../historical-market-data/session-policy";

export interface HistoricalReplayInstrumentInput {
  instrumentToken: string;
  tradingSymbol?: string;
  exchange?: string;
  casEligibility?: ClosingAuctionEligibility;
  eligibilitySource?: string;
}

export interface HistoricalReplayRequest {
  instruments: HistoricalReplayInstrumentInput[];
  from: Date;
  to: Date;
  interval: HistoricalCandleIntervalCode;
  strategyIds?: string[];
}

export type ReplayEventType = "CANDLE" | "DATA_GAP" | "DUPLICATE_CANDLE";

export interface ReplayCandleEvent {
  type: "CANDLE";
  replayTimestamp: string;
  instrumentToken: string;
  candle: ReplayCandleSnapshot;
  tick: MarketTick;
  marketState: ReplayMarketStateSnapshot;
  scanner: ReplayScannerOutput;
  strategy: ReplayStrategyOutput;
}

export interface ReplayDataGapEvent {
  type: "DATA_GAP";
  replayTimestamp: string;
  instrumentToken: string;
  expectedTimestamp: string;
  reason: string;
}

export interface ReplayDuplicateCandleEvent {
  type: "DUPLICATE_CANDLE";
  replayTimestamp: string;
  instrumentToken: string;
  candle: ReplayCandleSnapshot;
  reason: string;
}

export type ReplayEvent = ReplayCandleEvent | ReplayDataGapEvent | ReplayDuplicateCandleEvent;

export interface ReplayCandleSnapshot {
  timestamp: string;
  interval: HistoricalCandleIntervalCode;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
}

export interface ReplayScannerOutput {
  status: "COMPLETE" | "SKIPPED_MARKET_CLOSED" | "FAILED" | "BUSY";
  stats: ScannerRunStats;
  candidates: ScannerCandidate[];
}

export interface ReplayMarketStateSnapshot {
  recentTickCount: number;
  candles1mCount: number;
  candles5mCount: number;
  latestAvailableTimestamp: string;
}

export interface ReplayStrategyOutput {
  evaluationCount: number;
  setupCount: number;
  statuses: Record<StrategyStatus, number>;
  evaluations: StrategyEvaluation[];
}

export interface ReplaySummary {
  deterministicRunId: string;
  instrumentCount: number;
  candleCountProcessed: number;
  replayStart: string;
  replayEnd: string;
  replayDurationMs: number;
  scannerEvaluations: number;
  strategyEvaluations: number;
  setupsDetected: number;
  invalidSetups: number;
  unavailableEvents: number;
  dataGapEvents: number;
  duplicateCandleEvents: number;
}

export interface ReplayPerformanceProfile {
  totalReplayNs: number;
  marketStateUpdateNs: number;
  scannerNs: number;
  strategyNs: number;
  strategyRegistryNs: number;
  strategyDispatchNs: number;
  strategyRuleNs: number;
  contextAccessNs: number;
  scanner: {
    universeLoadNs: number;
    observationNs: number;
    featureNs: number;
    filterNs: number;
    scoreNs: number;
    rankingNs: number;
    instrumentsConsidered: number;
    featureCalculations: number;
    candidatesConstructed: number;
  };
}

export interface HistoricalReplayResult {
  request: {
    instruments: HistoricalReplayInstrumentInput[];
    from: string;
    to: string;
    interval: HistoricalCandleIntervalCode;
    strategyIds: string[] | null;
  };
  summary: ReplaySummary;
  performance?: ReplayPerformanceProfile;
  validationIssues: ValidationIssue[];
  events: ReplayEvent[];
  limitations: string[];
}

export interface LoadedReplayCandle extends NormalizedHistoricalCandle {
  /** Legacy tie-breaker; optimized replay can borrow canonical candles without adding it. */
  loadIndex?: number;
}
