import type { MarketSessionState } from "../../common/utils/market-session";

export type ScannerLifecycle = "IDLE" | "RUNNING" | "STOPPING" | "STOPPED" | "FAILED";

export type ScannerDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type MarketRegime =
  | "UNKNOWN"
  | "TRENDING_BULL"
  | "TRENDING_BEAR"
  | "RANGE_BOUND"
  | "HIGH_VOLATILITY"
  | "LOW_VOLATILITY"
  | "EVENT_DRIVEN";

export type TriState = "PASS" | "FAIL" | "UNKNOWN";

export type Availability = "AVAILABLE" | "UNAVAILABLE";

export interface ScannerInstrumentRef {
  id: string;
  tradingSymbol: string;
  exchange: string;
  instrumentToken: string;
  name: string;
}

export interface ScannerMarketObservation {
  instrumentToken: string;
  lastPrice: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  /** Previous close / prior session close when available from quote mode. */
  close: number | null;
  volume: number | null;
  averagePrice: number | null;
  dataTimestamp: string | null;
  receivedAt: string | null;
  dataAgeMs: number | null;
  stale: boolean;
  missing: boolean;
}

export interface ScannerFeatures {
  changeFromOpenPercent: number | null;
  changeFromPreviousClosePercent: number | null;
  intradayRangePercent: number | null;
  distanceFromDayHighPercent: number | null;
  distanceFromDayLowPercent: number | null;
  nearDayHigh: boolean | null;
  nearDayLow: boolean | null;
  breakingDayHigh: boolean | null;
  breakingDayLow: boolean | null;
  volume: number | null;
  /** Absolute-volume activity score input; not a historical RVOL. */
  volumeActivity: Availability;
  /** Requires a historical reference volume — unavailable until Phase 8 history exists. */
  volumeSpike: TriState;
  volumeSpikeRatio: number | null;
  volatilityPercent: number | null;
  momentumBias: "UP" | "DOWN" | "FLAT" | "UNKNOWN";
}

export interface ScannerScoreComponents {
  volumeActivity: number;
  momentum: number;
  rangeExpansion: number;
  dayExtremumProximity: number;
  priceMovement: number;
}

export interface ScannerCandidate {
  instrumentToken: string;
  tradingSymbol: string;
  exchange: string;
  instrumentId: string | null;
  direction: ScannerDirection;
  score: number;
  scoreComponents: ScannerScoreComponents;
  lastPrice: number;
  dataTimestamp: string;
  dataAgeMs: number;
  stale: boolean;
  features: ScannerFeatures;
  reasons: string[];
  marketRegime: MarketRegime;
  source: "SCANNER";
}

export interface ScannerRunStats {
  universeSize: number;
  evaluatedCount: number;
  candidateCount: number;
  skippedMissingData: number;
  skippedStale: number;
  skippedFiltered: number;
  errorCount: number;
}

export interface ScannerRunResult {
  runId: string;
  status: "COMPLETE" | "SKIPPED_MARKET_CLOSED" | "FAILED" | "BUSY";
  startedAt: string;
  completedAt: string;
  marketSession: MarketSessionState;
  tradingDate: string;
  message?: string;
  stats: ScannerRunStats;
  candidates: ScannerCandidate[];
}

export interface ScannerStatus {
  lifecycle: ScannerLifecycle;
  schedulerRunning: boolean;
  lastRun: ScannerRunResult | null;
  busy: boolean;
  config: {
    enabled: boolean;
    intervalMs: number;
    maxCandidates: number;
    minScore: number;
  };
  marketSession: MarketSessionState;
}
