import { describe, expect, it } from "vitest";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import { benchmarkRegistry, contextUniverseId } from "./context-universe";
import {
  auditIndexBenchmark, buildIndexContextManifest, INDEX_CONTEXT_FROM, INDEX_CONTEXT_TO,
  indexSessionBounds, INDEX_CONTEXT_DATASET_VERSION
} from "./context-dataset";
import { stableRegimeArtifact, type IndexRegimeAnalysisResult } from "./context-regime-analysis";

const benchmark = benchmarkRegistry[0]!;

function candle(atMs: number, options: Partial<NormalizedHistoricalCandle> = {}): NormalizedHistoricalCandle {
  const timestamp = new Date(atMs);
  return {
    instrumentId: null, instrumentToken: benchmark.instrumentToken, exchange: "NSE", tradingSymbol: benchmark.symbol,
    interval: "1m", timestamp, open: 100, high: 101, low: 99, close: 100, volume: 0,
    openInterest: null, source: "KITE", adjustment: "UNKNOWN", fetchedAt: timestamp, ...options
  };
}

function session(date: string): NormalizedHistoricalCandle[] {
  const bounds = indexSessionBounds(date)!;
  const rows: NormalizedHistoricalCandle[] = [];
  for (let atMs = bounds.fromMs; atMs < bounds.toMs; atMs += 60_000) rows.push(candle(atMs));
  return rows;
}

describe("Phase 9C index-context dataset", () => {
  it("uses calendar special sessions but never equity CAS closing truncation for index expectations", () => {
    expect(INDEX_CONTEXT_DATASET_VERSION).toBe("NSE_INDEX_CONTEXT_2025_2026_V1");
    expect((indexSessionBounds("2025-09-18")!.toMs - indexSessionBounds("2025-09-18")!.fromMs) / 60_000).toBe(375);
    expect((indexSessionBounds("2025-10-21")!.toMs - indexSessionBounds("2025-10-21")!.fromMs) / 60_000).toBe(60);
    expect((indexSessionBounds("2026-02-01")!.toMs - indexSessionBounds("2026-02-01")!.fromMs) / 60_000).toBe(375);
    expect((indexSessionBounds("2026-09-15")!.toMs - indexSessionBounds("2026-09-15")!.fromMs) / 60_000).toBe(375);
    expect(indexSessionBounds("2026-02-19")).toBeNull();
    expect(INDEX_CONTEXT_FROM).toBe("2025-09-18T03:45:00.000Z");
    expect(INDEX_CONTEXT_TO).toBe("2026-09-18T03:45:00.000Z");
  });

  it("reports exact gaps, bad rows, duplicates, ordering and holiday observations without filling", () => {
    const normal = session("2025-09-18");
    const missing = normal[20]!.timestamp;
    normal.splice(20, 1);
    const holiday = candle(Date.parse("2026-02-19T03:45:00.000Z"));
    const invalid = candle(Date.parse("2025-09-18T04:10:00.000Z"), { high: 90 });
    const rows = [...normal, ...session("2025-10-21"), holiday, invalid, normal[0]!];
    const result = auditIndexBenchmark(benchmark, rows);
    expect(result.gaps).toContainEqual({ tradeDate: "2025-09-18", from: missing.toISOString(),
      to: new Date(missing.getTime() + 60_000).toISOString(), count: 1 });
    expect(result.outOfPolicyDates["2026-02-19"]).toBe(1);
    expect(result.invalidOhlcRows).toBe(1);
    expect(result.duplicateTimestamps).toBe(2);
    expect(result.outOfOrderRows).toBeGreaterThan(0);
    expect(result.completeSessions).toBeGreaterThanOrEqual(1);
    expect(result.missingSessions).toBeGreaterThan(0);
    expect(result.unsupportedPeriods).toEqual([]);
    expect(result.zeroVolumeRows).toBe(rows.length);
  });

  it("keeps acquisition timestamps outside stable content identity", async () => {
    const rows = session("2025-09-18");
    const later = rows.map((item) => ({ ...item, fetchedAt: new Date(item.fetchedAt.getTime() + 60_000) }));
    const first = auditIndexBenchmark(benchmark, rows);
    const second = auditIndexBenchmark(benchmark, later);
    expect(first).toEqual(second);
    const load = async (definition: typeof benchmark) => rows.map((item) => ({ ...item, instrumentToken: definition.instrumentToken,
      tradingSymbol: definition.symbol }));
    const manifestA = await buildIndexContextManifest(load);
    const manifestB = await buildIndexContextManifest(load);
    expect(manifestA).toEqual(manifestB);
    expect(manifestA.registryId).toBe(contextUniverseId);
    expect(manifestA.datasetId).toMatch(/^[a-f0-9]{24}$/);
    expect(manifestA.contentHash).toMatch(/^[a-f0-9]{64}$/);
  });

  it("keeps runtime and observed peak memory outside the stable analysis artifact", () => {
    const fixture = {
      analysisId: "stable-research-id",
      activity: { benchmarkObservations: 10, equityObservations: 20, elapsedMs: 100,
        peakObservedRssBytes: 1000 }
    } as IndexRegimeAnalysisResult;
    const changedTelemetry = {
      ...fixture, activity: { ...fixture.activity, elapsedMs: 500, peakObservedRssBytes: 2000 }
    };
    expect(stableRegimeArtifact(fixture)).toEqual(stableRegimeArtifact(changedTelemetry));
    expect(JSON.stringify(stableRegimeArtifact(fixture))).not.toContain("elapsedMs");
    expect(JSON.stringify(stableRegimeArtifact(fixture))).not.toContain("peakObservedRssBytes");
  });
});
