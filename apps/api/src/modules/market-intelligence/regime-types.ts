import type { ContextQuality } from "./context-types";
import type { SectorId } from "./context-universe";
import { REGIME_DEFINITION_VERSION, REGIME_SCHEMA_VERSION } from "./regime-definition";

export type TrendState = "TRENDING_UP" | "TRENDING_DOWN" | "RANGE_BOUND" | "UNCERTAIN";
export type VolatilityState = "HIGH" | "NORMAL" | "LOW" | "UNKNOWN";
export type BreadthState = "CONFIRMING" | "CONTRADICTING" | "NEUTRAL" | "UNAVAILABLE";
export type RelativeSectorState = "OUTPERFORMING_MARKET" | "UNDERPERFORMING_MARKET" | "INLINE_WITH_MARKET" | "UNKNOWN";
export type EvidenceStrength = "LOW" | "MEDIUM" | "HIGH";

export interface TrendRegime {
  state: TrendState;
  evidenceStrength: EvidenceStrength;
  quality: ContextQuality;
  supporting: readonly string[];
  conflicting: readonly string[];
  metrics: Readonly<{
    return15mPct: number | null;
    return30mPct: number | null;
    distanceFromHighPct: number | null;
    distanceFromLowPct: number | null;
    advancePct: number | null;
    aboveVwapPct: number | null;
  }>;
}

export interface VolatilityRegime {
  state: VolatilityState;
  quality: ContextQuality;
  reason: string;
  absoluteReturn5mPct: number | null;
  priorMedianPct: number | null;
  priorObservations: number;
  medianMultiple: number | null;
}

export interface BreadthRegime {
  state: BreadthState;
  quality: ContextQuality;
  contextUniverseId: string;
  expectedConstituents: number;
  availableConstituents: number;
  coveragePct: number;
  advancePct: number | null;
  aboveVwapPct: number | null;
}

export interface BaseRegimeSnapshot {
  id: string;
  schemaVersion: typeof REGIME_SCHEMA_VERSION;
  definitionVersion: typeof REGIME_DEFINITION_VERSION;
  definitionHash: string;
  timestamp: string;
  sourceContextId: string;
  contextUniverseId: string;
  trend: Readonly<TrendRegime>;
  volatility: Readonly<VolatilityRegime>;
  breadth: Readonly<BreadthRegime>;
  quality: ContextQuality;
  anomaly: "ABNORMAL_5M_MOVE" | null;
}

export interface MarketRegimeSnapshot extends BaseRegimeSnapshot {
  scope: "MARKET";
}

export interface SectorRegimeSnapshot extends BaseRegimeSnapshot {
  scope: "SECTOR";
  sectorId: SectorId;
  relativeToMarket: RelativeSectorState;
  relative15mPct: number | null;
}

export interface InstrumentRegimeContext {
  market: Readonly<MarketRegimeSnapshot>;
  sector: Readonly<SectorRegimeSnapshot> | null;
}
