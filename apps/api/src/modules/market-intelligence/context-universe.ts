import { createHash } from "node:crypto";
import { researchUniverseInstruments, researchUniverseManifestId } from "../historical-market-data/research-universe";
import type { InstrumentRecord } from "../../db/domain";

export const CONTEXT_UNIVERSE_VERSION = "NSE_MARKET_CONTEXT_2026_V1";
export const SECTOR_TAXONOMY_VERSION = "NSE_RESEARCH_SECTORS_2026_V1";
export const BREADTH_UNIVERSE_VERSION = "NSE_EQ_25_BREADTH_2026_V1";
export const MEMBERSHIP_AS_OF_DATE = "2026-09-18";
export const BROAD_BENCHMARK_ID = "NIFTY_50";

export type BenchmarkRole = "BROAD_MARKET" | "SECTOR";
export type SectorId =
  | "ENERGY" | "FINANCIAL_SERVICES" | "INFORMATION_TECHNOLOGY" | "TELECOMMUNICATION"
  | "AUTOMOBILE" | "CONSUMER_DURABLES" | "FMCG" | "HEALTHCARE" | "INDUSTRIALS" | "METALS";

export interface BenchmarkDefinition {
  id: string;
  symbol: string;
  name: string;
  exchange: "NSE";
  segment: "INDICES";
  instrumentToken: string;
  role: BenchmarkRole;
  sectorId: SectorId | null;
  knownAsOfDate: string;
  provenance: string;
  /** Frozen 9B verification-time status; current history/coverage lives in the 9C context manifest. */
  historicalObservationStatus: "NO_PERSISTED_CANDLES_PROVIDER_UNVERIFIED";
  sessionSemantics: "OBSERVED_INDEX_BARS_NO_EQUITY_CAS_INFERENCE";
}

/** Verified against the synchronized Phase 3 Kite master on 2026-09-29. */
export const benchmarkRegistry: readonly BenchmarkDefinition[] = Object.freeze([
  ["NIFTY_50", "NIFTY 50", "256265", "BROAD_MARKET", null],
  ["NIFTY_ENERGY", "NIFTY ENERGY", "261641", "SECTOR", "ENERGY"],
  ["NIFTY_FIN_SERVICE", "NIFTY FIN SERVICE", "257801", "SECTOR", "FINANCIAL_SERVICES"],
  ["NIFTY_IT", "NIFTY IT", "259849", "SECTOR", "INFORMATION_TECHNOLOGY"],
  ["NIFTY_AUTO", "NIFTY AUTO", "263433", "SECTOR", "AUTOMOBILE"],
  ["NIFTY_FMCG", "NIFTY FMCG", "261897", "SECTOR", "FMCG"],
  ["NIFTY_HEALTHCARE", "NIFTY HEALTHCARE", "288521", "SECTOR", "HEALTHCARE"],
  ["NIFTY_METAL", "NIFTY METAL", "263689", "SECTOR", "METALS"]
].map(([id, symbol, instrumentToken, role, sectorId]) => Object.freeze({
  id: id!, symbol: symbol!, name: symbol!, exchange: "NSE" as const, segment: "INDICES" as const,
  instrumentToken: instrumentToken!, role: role as BenchmarkRole, sectorId: sectorId as SectorId | null,
  knownAsOfDate: MEMBERSHIP_AS_OF_DATE,
  provenance: "Local Phase 3 Kite instrument master; synchronized 2026-09-18 and inspected read-only 2026-09-29",
  historicalObservationStatus: "NO_PERSISTED_CANDLES_PROVIDER_UNVERIFIED" as const,
  sessionSemantics: "OBSERVED_INDEX_BARS_NO_EQUITY_CAS_INFERENCE" as const
})));

const sectorByResearchLabel: Readonly<Record<string, SectorId>> = Object.freeze({
  Energy: "ENERGY",
  "Financial Services": "FINANCIAL_SERVICES",
  "Information Technology": "INFORMATION_TECHNOLOGY",
  Telecommunication: "TELECOMMUNICATION",
  "Automobile and Auto Components": "AUTOMOBILE",
  "Consumer Durables": "CONSUMER_DURABLES",
  "Fast Moving Consumer Goods": "FMCG",
  Healthcare: "HEALTHCARE",
  "Industrials / Capital Goods": "INDUSTRIALS",
  "Metals and Mining": "METALS"
});

export interface SectorMembership {
  instrumentToken: string;
  tradingSymbol: string;
  sectorId: SectorId;
  knownAsOfDate: string;
  source: string;
}

export const sectorMemberships: readonly SectorMembership[] = Object.freeze(researchUniverseInstruments.map((instrument) => {
  const sectorId = sectorByResearchLabel[instrument.sector];
  if (!sectorId) throw new Error(`Missing stable sector mapping for ${instrument.tradingSymbol}`);
  return Object.freeze({
    instrumentToken: instrument.instrumentToken, tradingSymbol: instrument.tradingSymbol, sectorId,
    knownAsOfDate: MEMBERSHIP_AS_OF_DATE,
    source: `Frozen ${researchUniverseManifestId} research-universe sector label; current snapshot, not historical membership`
  });
}));

const membershipByToken = new Map(sectorMemberships.map((item) => [item.instrumentToken, item]));
const benchmarkById = new Map(benchmarkRegistry.map((item) => [item.id, item]));
const benchmarkByToken = new Map(benchmarkRegistry.map((item) => [item.instrumentToken, item]));
const benchmarkBySector = new Map(benchmarkRegistry.filter((item) => item.sectorId).map((item) => [item.sectorId!, item]));

if (membershipByToken.size !== 25 || benchmarkById.size !== benchmarkRegistry.length || benchmarkByToken.size !== benchmarkRegistry.length) {
  throw new Error("Invalid Phase 9B context universe identity");
}

export const contextUniverseId = createHash("sha256").update(JSON.stringify({
  version: CONTEXT_UNIVERSE_VERSION, taxonomyVersion: SECTOR_TAXONOMY_VERSION,
  breadthVersion: BREADTH_UNIVERSE_VERSION, researchUniverseManifestId, asOf: MEMBERSHIP_AS_OF_DATE,
  benchmarks: benchmarkRegistry, memberships: sectorMemberships
})).digest("hex").slice(0, 24);

export function getBenchmarkById(id: string) { return benchmarkById.get(id) ?? null; }
export function getBenchmarkByToken(token: string) { return benchmarkByToken.get(token) ?? null; }
export function getSectorBenchmark(sectorId: SectorId) { return benchmarkBySector.get(sectorId) ?? null; }

export function resolveSectorMembership(token: string, tradeDate: string, options: { allowBackcastCurrentMembership: boolean }): SectorMembership | null {
  if (tradeDate < MEMBERSHIP_AS_OF_DATE && !options.allowBackcastCurrentMembership) return null;
  return membershipByToken.get(token) ?? null;
}

export function isContextBenchmarkToken(token: string) { return benchmarkByToken.has(token); }
export function isFrozenBreadthConstituent(token: string) { return membershipByToken.has(token); }

export function matchesSynchronizedBenchmark(definition: BenchmarkDefinition, record: Pick<InstrumentRecord, "instrumentToken" | "symbol" | "exchange" | "segment" | "isActive">): boolean {
  return record.isActive && record.instrumentToken === definition.instrumentToken && record.symbol === definition.symbol &&
    record.exchange === definition.exchange && record.segment === definition.segment;
}
