import { createHash } from "node:crypto";
import { getTradingDate } from "../../common/utils/trading-date";
import { nseCashCalendar } from "../historical-market-data/calendar";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import { benchmarkRegistry, contextUniverseId, type BenchmarkDefinition } from "./context-universe";

export const INDEX_CONTEXT_DATASET_VERSION = "NSE_INDEX_CONTEXT_2025_2026_V1";
export const INDEX_SESSION_SEMANTICS_VERSION = "NSE_INDEX_CONTINUOUS_2025_2026_V1";
export const INDEX_CONTEXT_FROM = "2025-09-18T03:45:00.000Z";
export const INDEX_CONTEXT_TO = "2026-09-18T03:45:00.000Z";

export interface IndexGapRange {
  tradeDate: string;
  from: string;
  to: string;
  count: number;
}

export interface IndexBenchmarkCoverage {
  benchmarkId: string;
  symbol: string;
  instrumentToken: string;
  expectedSessions: number;
  observedSessions: number;
  completeSessions: number;
  incompleteSessions: number;
  missingSessions: number;
  expectedCandles: number;
  policyValidCandles: number;
  rawCandles: number;
  outOfPolicyRows: number;
  invalidOhlcRows: number;
  duplicateTimestamps: number;
  outOfOrderRows: number;
  zeroVolumeRows: number;
  missingCandles: number;
  gaps: IndexGapRange[];
  unsupportedPeriods: Array<{ tradeDate: string; reason: "UNKNOWN_CALENDAR" | "UNMODELED_SPECIAL_SESSION" }>;
  outOfPolicyDates: Record<string, number>;
  first: string | null;
  last: string | null;
  contentHash: string;
}

export interface IndexContextDatasetManifest {
  version: typeof INDEX_CONTEXT_DATASET_VERSION;
  registryId: string;
  provider: "KITE";
  interval: "1m";
  requestedFrom: string;
  requestedTo: string;
  calendarVersion: string;
  sessionSemanticsVersion: string;
  sessionSemantics: string;
  provenance: string;
  benchmarkCoverage: IndexBenchmarkCoverage[];
  totalExpectedCandles: number;
  totalPolicyValidCandles: number;
  totalMissingCandles: number;
  totalOutOfPolicyRows: number;
  contentHash: string;
  datasetId: string;
}

export function indexSessionBounds(date: string): { fromMs: number; toMs: number } | null {
  const session = nseCashCalendar.getDay(date).session;
  if (!session) return null;
  return {
    fromMs: Date.parse(`${date}T${session.openTimeIst}:00+05:30`),
    toMs: Date.parse(`${date}T${session.closeTimeIst}:00+05:30`)
  };
}

function datesInResearchRange(): string[] {
  const dates: string[] = [];
  for (let atMs = Date.parse(INDEX_CONTEXT_FROM); atMs < Date.parse(INDEX_CONTEXT_TO); atMs += 86_400_000) {
    dates.push(getTradingDate(new Date(atMs), "Asia/Kolkata"));
  }
  return dates;
}

function candleValid(candle: NormalizedHistoricalCandle): boolean {
  return [candle.open, candle.high, candle.low, candle.close, candle.volume].every(Number.isFinite) &&
    candle.low > 0 && candle.high >= Math.max(candle.open, candle.close) &&
    candle.low <= Math.min(candle.open, candle.close) && candle.volume >= 0;
}

function appendGap(gaps: IndexGapRange[], date: string, atMs: number) {
  const last = gaps.at(-1);
  if (last?.tradeDate === date && Date.parse(last.to) === atMs) {
    last.to = new Date(atMs + 60_000).toISOString();
    last.count += 1;
  } else {
    gaps.push({ tradeDate: date, from: new Date(atMs).toISOString(), to: new Date(atMs + 60_000).toISOString(), count: 1 });
  }
}

export function auditIndexBenchmark(definition: BenchmarkDefinition, input: readonly NormalizedHistoricalCandle[]): IndexBenchmarkCoverage {
  const raw = [...input];
  let outOfOrderRows = 0;
  for (let index = 1; index < raw.length; index += 1) {
    if (raw[index]!.timestamp.getTime() < raw[index - 1]!.timestamp.getTime()) outOfOrderRows += 1;
  }
  const rows = raw.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const hash = createHash("sha256");
  const timestampsByDate = new Map<string, Set<number>>();
  const outOfPolicyDates: Record<string, number> = {};
  let invalidOhlcRows = 0;
  let duplicateTimestamps = 0;
  let zeroVolumeRows = 0;
  let outOfPolicyRows = 0;
  let policyValidCandles = 0;
  let lastMs = Number.NEGATIVE_INFINITY;
  for (const candle of rows) {
    if (candle.instrumentToken !== definition.instrumentToken || candle.interval !== "1m") {
      throw new Error(`Mismatched index dataset row for ${definition.id}`);
    }
    const atMs = candle.timestamp.getTime();
    if (atMs === lastMs) duplicateTimestamps += 1;
    lastMs = atMs;
    if (!candleValid(candle)) invalidOhlcRows += 1;
    if (candle.volume === 0) zeroVolumeRows += 1;
    hash.update(JSON.stringify([definition.id, candle.timestamp.toISOString(), candle.open, candle.high, candle.low, candle.close,
      candle.volume, candle.openInterest, candle.source, candle.adjustment]));
    hash.update("\n");
    const date = getTradingDate(candle.timestamp, "Asia/Kolkata");
    const bounds = indexSessionBounds(date);
    if (atMs < Date.parse(INDEX_CONTEXT_FROM) || atMs >= Date.parse(INDEX_CONTEXT_TO) ||
        !bounds || atMs < bounds.fromMs || atMs >= bounds.toMs || atMs % 60_000 !== 0) {
      outOfPolicyRows += 1;
      outOfPolicyDates[date] = (outOfPolicyDates[date] ?? 0) + 1;
      continue;
    }
    const timestamps = timestampsByDate.get(date) ?? new Set<number>();
    timestamps.add(atMs);
    timestampsByDate.set(date, timestamps);
    policyValidCandles += 1;
  }

  let expectedSessions = 0;
  let observedSessions = 0;
  let completeSessions = 0;
  let incompleteSessions = 0;
  let missingSessions = 0;
  let expectedCandles = 0;
  let missingCandles = 0;
  const gaps: IndexGapRange[] = [];
  const unsupportedPeriods: IndexBenchmarkCoverage["unsupportedPeriods"] = [];
  for (const date of datesInResearchRange()) {
    const day = nseCashCalendar.getDay(date);
    if (day.type === "UNKNOWN") unsupportedPeriods.push({ tradeDate: date, reason: "UNKNOWN_CALENDAR" });
    if (day.type === "SPECIAL_SESSION" && day.session === null) unsupportedPeriods.push({ tradeDate: date, reason: "UNMODELED_SPECIAL_SESSION" });
    const bounds = indexSessionBounds(date);
    if (!bounds) continue;
    expectedSessions += 1;
    const timestamps = timestampsByDate.get(date) ?? new Set<number>();
    if (timestamps.size) observedSessions += 1;
    let dayMissing = 0;
    for (let atMs = bounds.fromMs; atMs < bounds.toMs; atMs += 60_000) {
      expectedCandles += 1;
      if (!timestamps.has(atMs)) {
        missingCandles += 1;
        dayMissing += 1;
        appendGap(gaps, date, atMs);
      }
    }
    if (!timestamps.size) missingSessions += 1;
    else if (dayMissing) incompleteSessions += 1;
    else completeSessions += 1;
  }
  return {
    benchmarkId: definition.id, symbol: definition.symbol, instrumentToken: definition.instrumentToken,
    expectedSessions, observedSessions, completeSessions, incompleteSessions, missingSessions,
    expectedCandles, policyValidCandles, rawCandles: rows.length, outOfPolicyRows,
    invalidOhlcRows, duplicateTimestamps, outOfOrderRows, zeroVolumeRows,
    missingCandles, gaps, unsupportedPeriods, outOfPolicyDates,
    first: rows[0]?.timestamp.toISOString() ?? null,
    last: rows.at(-1)?.timestamp.toISOString() ?? null,
    contentHash: hash.digest("hex")
  };
}

export async function buildIndexContextManifest(load: (definition: BenchmarkDefinition) => Promise<NormalizedHistoricalCandle[]>): Promise<IndexContextDatasetManifest> {
  const benchmarkCoverage: IndexBenchmarkCoverage[] = [];
  for (const definition of benchmarkRegistry) benchmarkCoverage.push(auditIndexBenchmark(definition, await load(definition)));
  const stable = {
    version: INDEX_CONTEXT_DATASET_VERSION as typeof INDEX_CONTEXT_DATASET_VERSION, registryId: contextUniverseId, provider: "KITE" as const,
    interval: "1m" as const, requestedFrom: INDEX_CONTEXT_FROM, requestedTo: INDEX_CONTEXT_TO,
    calendarVersion: nseCashCalendar.version, sessionSemanticsVersion: INDEX_SESSION_SEMANTICS_VERSION,
    sessionSemantics: "index continuous bars at calendar trading-date/session hours; no equity CAS truncation",
    provenance: "Kite authenticated historical endpoint; normalized by existing historical provider; canonical index tokens from 9B registry",
    benchmarkCoverage,
    totalExpectedCandles: benchmarkCoverage.reduce((sum, row) => sum + row.expectedCandles, 0),
    totalPolicyValidCandles: benchmarkCoverage.reduce((sum, row) => sum + row.policyValidCandles, 0),
    totalMissingCandles: benchmarkCoverage.reduce((sum, row) => sum + row.missingCandles, 0),
    totalOutOfPolicyRows: benchmarkCoverage.reduce((sum, row) => sum + row.outOfPolicyRows, 0)
  };
  const contentHash = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
  return { ...stable, contentHash, datasetId: contentHash.slice(0, 24) };
}
