import type { CandleInterval } from "../strategies/candle-aggregator";

export const FEATURE_SCHEMA_VERSION = "MARKET_FEATURES_V1";
export const FEATURE_DEFINITIONS_VERSION = "MARKET_FEATURE_DEFINITIONS_V1";

export type FeatureQuality = "AVAILABLE" | "INSUFFICIENT_HISTORY" | "DATA_GAP" | "STALE" | "NOT_APPLICABLE" | "UNSUPPORTED";

export interface FeatureSession {
  tradeDate: string;
  openTime: string;
  closeTime: string;
  calendarVersion: string;
  sessionPolicyVersion: string;
  casEligibilityVersion: string;
}

/** A finalized OHLCV observation. startTime is the candle open, not its availability time. */
export interface FeatureObservation {
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  interval: CandleInterval;
  startTime: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  session: FeatureSession;
  previousSessionClose: number | null;
  /** Canonical dataset ID for replay or an explicit live stream identity. */
  sourceIdentity: string;
}

export interface FeatureValues {
  lastPrice: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  sessionHigh: number | null;
  sessionLow: number | null;
  distanceFromSessionHighPct: number | null;
  distanceFromSessionLowPct: number | null;
  sessionVwap: number | null;
  vwapDistancePct: number | null;
  aboveVwap: boolean | null;
  atr: number | null;
  atrPct: number | null;
  gapPct: number | null;
  cumulativeVolume: number | null;
  minutesSinceMarketOpen: number | null;
  timeOfDayBucket: "OPEN" | "MID" | "CLOSE" | null;
  realizedVolatility: number | null;
  recentRangeExpansion: number | null;
  relativeVolume: number | null;
  volumeAcceleration: number | null;
  openingRangeHigh: number | null;
  openingRangeLow: number | null;
  openingRangePosition: number | null;
  openingRangeBreakState: string | null;
  marketRelativeStrength: number | null;
  sectorRelativeStrength: number | null;
  benchmarkRelativeReturn: number | null;
  marketBreadth: number | null;
  marketTrend: string | null;
  marketVolatilityContext: number | null;
  sectorTrend: string | null;
  sectorBreadth: number | null;
}

export interface FeatureSnapshot {
  id: string;
  schemaVersion: typeof FEATURE_SCHEMA_VERSION;
  definitionsVersion: typeof FEATURE_DEFINITIONS_VERSION;
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  interval: CandleInterval;
  /** Candle close instant: the earliest time at which the full candle is available. */
  timestamp: string;
  observedAt: string;
  sessionDate: string;
  sourceIdentity: string;
  calendarVersion: string;
  sessionPolicyVersion: string;
  casEligibilityVersion: string;
  values: Readonly<FeatureValues>;
  quality: Readonly<Record<keyof FeatureValues, FeatureQuality>>;
}
