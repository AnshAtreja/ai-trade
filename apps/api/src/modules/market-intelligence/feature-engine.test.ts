import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { featureDefinitionRegistry } from "./feature-definitions";
import { fromCompletedMarketCandle, fromHistoricalCandle, MarketFeatureEngine, resolveNseFeatureSession } from "./feature-engine";
import { FEATURE_DEFINITIONS_VERSION, FEATURE_SCHEMA_VERSION, type FeatureObservation } from "./feature-types";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import type { MarketCandle } from "../strategies/candle-aggregator";

const identity = { instrumentToken: "738561", exchange: "NSE", tradingSymbol: "RELIANCE" };
const day = "2026-07-01";
const first = new Date(`${day}T09:15:00+05:30`);

function observation(index: number, overrides: Partial<FeatureObservation> = {}): FeatureObservation {
  const startTime = new Date(first.getTime() + index * 60_000).toISOString();
  return {
    ...identity, interval: "1m", startTime, open: 100, high: 102, low: 99, close: 101,
    volume: 10, previousSessionClose: 98, sourceIdentity: "test-dataset-v1",
    session: resolveNseFeatureSession(identity, new Date(startTime)), ...overrides
  };
}

function historical(input: FeatureObservation): NormalizedHistoricalCandle {
  return {
    instrumentId: null, instrumentToken: input.instrumentToken, exchange: input.exchange, tradingSymbol: input.tradingSymbol,
    interval: input.interval, timestamp: new Date(input.startTime), open: input.open, high: input.high,
    low: input.low, close: input.close, volume: input.volume ?? 0, openInterest: null,
    source: "KITE", adjustment: "UNKNOWN", fetchedAt: new Date(input.startTime)
  };
}

function live(input: FeatureObservation): MarketCandle {
  return {
    instrumentToken: input.instrumentToken, interval: input.interval, startTime: input.startTime,
    endTime: input.startTime, open: input.open, high: input.high, low: input.low, close: input.close,
    volume: input.volume, tickCount: 1
  };
}

describe("Phase 9A feature foundation", () => {
  it("keeps a complete versioned definition for every canonical field", () => {
    const snapshot = new MarketFeatureEngine().ingest(observation(0));
    expect(snapshot.schemaVersion).toBe(FEATURE_SCHEMA_VERSION);
    expect(snapshot.definitionsVersion).toBe(FEATURE_DEFINITIONS_VERSION);
    expect(Object.keys(featureDefinitionRegistry).sort()).toEqual(Object.keys(snapshot.values).sort());
    for (const definition of Object.values(featureDefinitionRegistry)) {
      expect(definition.missing).not.toBe("");
      expect(definition.normalization).not.toBe("");
    }
    expect(snapshot.values.marketBreadth).toBeNull();
    expect(snapshot.quality.marketBreadth).toBe("NOT_APPLICABLE");
  });

  it("calculates first-candle gap, high/low distance, VWAP and session time from completed bars", () => {
    const engine = new MarketFeatureEngine();
    const firstSnapshot = engine.ingest(observation(0));
    expect(firstSnapshot.timestamp).toBe(new Date(first.getTime() + 60_000).toISOString());
    expect(firstSnapshot.values.sessionHigh).toBe(102);
    expect(firstSnapshot.values.sessionLow).toBe(99);
    expect(firstSnapshot.values.distanceFromSessionHighPct).toBeCloseTo(100 / 102);
    expect(firstSnapshot.values.distanceFromSessionLowPct).toBeCloseTo(200 / 99);
    expect(firstSnapshot.values.gapPct).toBeCloseTo(200 / 98);
    expect(firstSnapshot.values.minutesSinceMarketOpen).toBe(1);
    expect(firstSnapshot.values.timeOfDayBucket).toBe("OPEN");
    expect(firstSnapshot.values.sessionVwap).toBeCloseTo((102 + 99 + 101) / 3);
    expect(firstSnapshot.quality.atr).toBe("INSUFFICIENT_HISTORY");
    const second = engine.ingest(observation(1, { open: 101, high: 105, low: 100, close: 104, volume: 30 }));
    expect(second.values.cumulativeVolume).toBe(40);
    expect(second.values.sessionVwap).toBeCloseTo(((302 / 3) * 10 + 103 * 30) / 40);
    expect(second.values.aboveVwap).toBe(true);
  });

  it("uses a bounded 14-bar true-range window and resets it at a new session", () => {
    const engine = new MarketFeatureEngine();
    let snapshot = engine.ingest(observation(0));
    for (let i = 1; i < 15; i += 1) snapshot = engine.ingest(observation(i));
    expect(snapshot.quality.atr).toBe("AVAILABLE");
    expect(snapshot.values.atr).toBe(3);
    expect(engine.stateSize()).toEqual({ series: 1, retainedTrueRanges: 14 });
    const nextDate = "2026-07-02";
    const next = engine.ingest(observation(0, {
      startTime: new Date(`${nextDate}T09:15:00+05:30`).toISOString(),
      session: resolveNseFeatureSession(identity, new Date(`${nextDate}T09:15:00+05:30`)),
      open: 110, high: 111, low: 109, close: 110, previousSessionClose: 101
    }));
    expect(next.values.sessionHigh).toBe(111);
    expect(next.values.cumulativeVolume).toBe(10);
    expect(next.values.gapPct).toBeCloseTo(900 / 101);
    expect(next.quality.atr).toBe("INSUFFICIENT_HISTORY");
  });

  it("marks missing bars as DATA_GAP rather than silently treating partial session accumulators as complete", () => {
    const engine = new MarketFeatureEngine();
    engine.ingest(observation(0));
    const result = engine.ingest(observation(2));
    expect(result.quality.sessionVwap).toBe("DATA_GAP");
    expect(result.quality.atr).toBe("DATA_GAP");
    expect(result.values.sessionHigh).toBeNull();
    expect(result.values.cumulativeVolume).toBeNull();
    expect(result.values.lastPrice).toBe(101);
    const missingOpen = new MarketFeatureEngine().ingest(observation(1));
    expect(missingOpen.quality.gapPct).toBe("DATA_GAP");
    expect(missingOpen.values.gapPct).toBeNull();
  });

  it("does not fabricate unavailable volume or a previous close", () => {
    const result = new MarketFeatureEngine().ingest(observation(0, { volume: null, previousSessionClose: null }));
    expect(result.quality.sessionVwap).toBe("NOT_APPLICABLE");
    expect(result.values.sessionVwap).toBeNull();
    expect(result.quality.gapPct).toBe("INSUFFICIENT_HISTORY");
    expect(result.values.gapPct).toBeNull();
  });

  it("rejects non-finite source prices rather than publishing non-finite features", () => {
    expect(() => new MarketFeatureEngine().ingest(observation(0, { high: Number.NaN }))).toThrow("Invalid");
    expect(() => new MarketFeatureEngine().ingest(observation(0, { previousSessionClose: Number.POSITIVE_INFINITY }))).toThrow("Invalid");
  });

  it("rejects reads before close, handles stale data with an explicit as-of time, and never consults wall clock", () => {
    const engine = new MarketFeatureEngine();
    const snapshot = engine.ingest(observation(0));
    expect(() => engine.readAt(identity.instrumentToken, "1m", new Date(first), 60_000)).toThrow("before candle close");
    expect(engine.readAt(identity.instrumentToken, "1m", new Date(snapshot.timestamp), 60_000)).toEqual(snapshot);
    const stale = engine.readAt(identity.instrumentToken, "1m", new Date(first.getTime() + 180_000), 60_000)!;
    expect(stale.quality.lastPrice).toBe("STALE");
    expect(stale.values.lastPrice).toBeNull();
    expect(stale.id).not.toBe(snapshot.id);
  });

  it("is future invariant and rejects conflicting or out-of-order observations", () => {
    const a = new MarketFeatureEngine();
    const b = new MarketFeatureEngine();
    const before = a.ingest(observation(0));
    expect(b.ingest(observation(0))).toEqual(before);
    expect(() => a.ingest(observation(0, { close: 100 }))).toThrow("Conflicting duplicate");
    expect(() => a.ingest(observation(0, { volume: 11 }))).toThrow("Conflicting duplicate");
    a.ingest(observation(1, { high: 150, close: 120, low: 99 }));
    b.ingest(observation(1, { high: 110, close: 105, low: 99 }));
    expect(before).toEqual(new MarketFeatureEngine().ingest(observation(0)));
    expect(() => a.ingest(observation(0))).toThrow("Out-of-order");
  });

  it("publishes a 5m bar only at its five-minute close and detects a missing 5m bucket", () => {
    const engine = new MarketFeatureEngine();
    const firstFive = engine.ingest(observation(0, { interval: "5m" }));
    expect(firstFive.timestamp).toBe(new Date(first.getTime() + 300_000).toISOString());
    expect(() => engine.readAt(identity.instrumentToken, "5m", new Date(first.getTime() + 60_000), 300_000)).toThrow("before candle close");
    const later = engine.ingest(observation(10, { interval: "5m" }));
    expect(later.quality.sessionVwap).toBe("DATA_GAP");
  });

  it("produces identical snapshots via historical and completed live-style adapters", () => {
    const historicalEngine = new MarketFeatureEngine();
    const liveEngine = new MarketFeatureEngine();
    for (let i = 0; i < 18; i += 1) {
      const input = observation(i, { high: 102 + i / 10, close: 101 + i / 10 });
      const fromHistory = fromHistoricalCandle(historical(input), input.session, input.sourceIdentity, input.previousSessionClose);
      const fromLive = fromCompletedMarketCandle(live(input), { ...identity, sourceIdentity: input.sourceIdentity, previousSessionClose: input.previousSessionClose }, input.session);
      expect(fromHistory).toEqual(fromLive);
      expect(historicalEngine.ingest(fromHistory)).toEqual(liveEngine.ingest(fromLive));
    }
  });

  it("includes source and policy identity in deterministic snapshot IDs", () => {
    const base = new MarketFeatureEngine().ingest(observation(0));
    expect(new MarketFeatureEngine().ingest(observation(0)).id).toBe(base.id);
    expect(new MarketFeatureEngine().ingest(observation(0, { sourceIdentity: "other-dataset" })).id).not.toBe(base.id);
    expect(new MarketFeatureEngine().ingest(observation(0, { session: { ...observation(0).session, calendarVersion: "OTHER" } })).id).not.toBe(base.id);
    expect(Object.isFrozen(base.values)).toBe(true);
    expect(Object.isFrozen(base.quality)).toBe(true);
  });

  it("honors special and CAS session boundaries and rejects holiday observations", () => {
    const muhurat = resolveNseFeatureSession(identity, new Date("2025-10-21T13:45:00+05:30"));
    expect(muhurat.openTime).toContain("13:45");
    expect(muhurat.closeTime).toContain("14:45");
    const cas = resolveNseFeatureSession(identity, new Date("2026-09-15T09:15:00+05:30"));
    expect(cas.closeTime).toContain("15:15");
    expect(() => resolveNseFeatureSession(identity, new Date("2026-08-26T09:15:00+05:30"))).toThrow("No authoritative");
    expect(() => new MarketFeatureEngine().ingest(observation(375))).toThrow("out-of-session");
  });

  it("remains bounded across many instruments and sessions", () => {
    const engine = new MarketFeatureEngine();
    const started = performance.now();
    let peakRssBytes = process.memoryUsage().rss;
    for (let n = 0; n < 25; n += 1) {
      for (let i = 0; i < 375; i += 1) engine.ingest(observation(i, { instrumentToken: String(1000 + n) }));
      peakRssBytes = Math.max(peakRssBytes, process.memoryUsage().rss);
    }
    expect(engine.stateSize()).toEqual({ series: 25, retainedTrueRanges: 25 * 14 });
    const elapsedMs = performance.now() - started;
    console.info(JSON.stringify({ benchmark: "phase9a-bounded", instruments: 25, observations: 9375, featureEvaluations: 9375, elapsedMs: Math.round(elapsedMs), peakRssMb: Math.round(peakRssBytes / 1048576), retainedTrueRanges: 350, databaseQueries: 0 }));
    expect(elapsedMs).toBeLessThan(10_000);
  });
});
