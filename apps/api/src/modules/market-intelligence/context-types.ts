import type { FeatureQuality, FeatureSnapshot } from "./feature-types";
import type { SectorId } from "./context-universe";

export const CONTEXT_SCHEMA_VERSION = "MARKET_CONTEXT_V1";
export const CONTEXT_DEFINITIONS_VERSION = "MARKET_CONTEXT_DEFINITIONS_V1";
export const CONTEXT_HORIZONS_MINUTES = [5, 15, 30, 60] as const;
export const CONTEXT_MAX_STALENESS_MS = 60_000;
export const BREADTH_MIN_COVERAGE = 0.8;
export const BREADTH_MIN_CONSTITUENTS = 2;

export type ContextHorizon = "5m" | "15m" | "30m" | "60m";
export type ContextQuality = FeatureQuality | "INSUFFICIENT_COVERAGE";
export type MembershipPolicy = "STRICT_AS_OF" | "EXPLICIT_CURRENT_BACKCAST";

export interface ContextMetric {
  valuePct: number | null;
  quality: ContextQuality;
  observedAt: string | null;
}

export type HorizonReturns = Readonly<Record<ContextHorizon, ContextMetric>>;

export interface BenchmarkObservation {
  benchmarkId: string;
  instrumentToken: string;
  interval: "1m";
  startTime: string;
  sessionDate: string;
  open: number;
  high: number;
  low: number;
  close: number;
  previousSessionClose: number | null;
  sourceIdentity: string;
}

export interface EquityContextObservation {
  feature: FeatureSnapshot;
  previousSessionClose: number | null;
}

export interface BreadthContext {
  expectedConstituents: number;
  availableConstituents: number;
  coveragePct: number;
  quality: ContextQuality;
  advancingCount: number;
  decliningCount: number;
  unchangedCount: number;
  advancePct: number | null;
  declinePct: number | null;
  aboveVwapAvailableCount: number;
  aboveVwapCount: number;
  aboveVwapCoveragePct: number;
  aboveVwapPct: number | null;
  aboveVwapQuality: ContextQuality;
}

export interface BenchmarkContext {
  benchmarkId: string;
  instrumentToken: string;
  sourceIdentity: string | null;
  observedAt: string | null;
  close: number | null;
  quality: ContextQuality;
  sessionReturn: ContextMetric;
  horizonReturns: HorizonReturns;
  distanceFromSessionHighPct: ContextMetric;
  distanceFromSessionLowPct: ContextMetric;
  volumeQuality: "NOT_APPLICABLE";
}

export interface MarketContextSnapshot {
  id: string;
  schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  definitionVersion: typeof CONTEXT_DEFINITIONS_VERSION;
  timestamp: string;
  contextUniverseId: string;
  membershipPolicy: MembershipPolicy;
  equitySourceIdentity: string;
  benchmark: Readonly<BenchmarkContext>;
  breadth: Readonly<BreadthContext>;
}

export interface SectorContextSnapshot {
  id: string;
  schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  definitionVersion: typeof CONTEXT_DEFINITIONS_VERSION;
  timestamp: string;
  sectorId: SectorId;
  contextUniverseId: string;
  membershipPolicy: MembershipPolicy;
  equitySourceIdentity: string;
  benchmark: Readonly<BenchmarkContext> | null;
  benchmarkQuality: ContextQuality;
  breadth: Readonly<BreadthContext>;
}

export interface RelativeMetric extends ContextMetric {
  instrumentReturnPct: number | null;
  benchmarkReturnPct: number | null;
  benchmarkObservedAt: string | null;
}

export interface RelativeContextSnapshot {
  id: string;
  schemaVersion: typeof CONTEXT_SCHEMA_VERSION;
  definitionVersion: typeof CONTEXT_DEFINITIONS_VERSION;
  contextUniverseId: string;
  membershipPolicy: MembershipPolicy;
  equitySourceIdentity: string;
  marketSourceIdentity: string | null;
  sectorSourceIdentity: string | null;
  timestamp: string;
  instrumentToken: string;
  sectorId: SectorId | null;
  instrumentVsMarket: Readonly<Record<ContextHorizon, RelativeMetric>>;
  instrumentVsSector: Readonly<Record<ContextHorizon, RelativeMetric>>;
  sectorVsMarket: Readonly<Record<ContextHorizon, RelativeMetric>>;
}

export interface InstrumentMarketContext {
  id: string;
  timestamp: string;
  instrumentToken: string;
  membershipPolicy: MembershipPolicy;
  equitySourceIdentity: string;
  membershipQuality: ContextQuality;
  membershipProvenance: "CURRENT_SNAPSHOT" | "EXPLICIT_HISTORICAL_BACKCAST" | "UNAVAILABLE";
  market: MarketContextSnapshot;
  sector: SectorContextSnapshot | null;
  relative: RelativeContextSnapshot;
}

export const contextDefinitionRegistry = Object.freeze({
  schemaVersion: CONTEXT_SCHEMA_VERSION,
  definitionVersion: CONTEXT_DEFINITIONS_VERSION,
  sourceInterval: "1m finalized OHLC, candle-close available",
  horizonsMinutes: CONTEXT_HORIZONS_MINUTES,
  returnFormula: "(currentClose / exact same-session close H minutes earlier - 1) * 100",
  relativeFormula: "instrumentReturnPct - benchmarkReturnPct; same horizon, each latest closed at or before as-of",
  sessionReset: "exchange trade date",
  referencePrice: "explicit previous-session close for advance/decline; no fallback",
  breadthDenominator: "frozen 25-equity research universe or frozen sector subset; percentages divide by available constituents only after coverage gate",
  breadthMinCoverage: BREADTH_MIN_COVERAGE,
  breadthMinConstituents: BREADTH_MIN_CONSTITUENTS,
  stalenessMs: CONTEXT_MAX_STALENESS_MS,
  missingObservation: "null + explicit quality; no forward fill, interpolation or synthesized index"
});
