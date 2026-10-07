import { performance } from "node:perf_hooks";
import { describe, expect, it } from "vitest";
import { isTradableNseEquity } from "../market-data/universe";
import { researchUniverseInstruments } from "../historical-market-data/research-universe";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import type { MarketCandle } from "../strategies/candle-aggregator";
import { fromCompletedMarketCandle, fromHistoricalCandle, MarketFeatureEngine, resolveNseFeatureSession } from "./feature-engine";
import { benchmarkRegistry, contextUniverseId, getBenchmarkById, getSectorBenchmark, isContextBenchmarkToken, resolveSectorMembership, sectorMemberships } from "./context-universe";
import { fromCompletedBenchmarkCandle, fromHistoricalBenchmarkCandle, MarketContextEngine } from "./context-engine";
import { CONTEXT_DEFINITIONS_VERSION, CONTEXT_SCHEMA_VERSION, contextDefinitionRegistry } from "./context-types";

const date = "2026-09-18";
const start = new Date(`${date}T09:15:00+05:30`);
const equitySource = "frozen-equity-fixture-v1";
const benchmarkSource = "separate-index-fixture-v1";
const reliance = researchUniverseInstruments.find((item) => item.tradingSymbol === "RELIANCE")!;
const hcltech = researchUniverseInstruments.find((item) => item.tradingSymbol === "HCLTECH")!;

function candle(token: string, symbol: string, index: number, close: number, source: "KITE" | "MOCK" = "MOCK", at = start): NormalizedHistoricalCandle {
  const timestamp = new Date(at.getTime() + index * 60_000);
  return {
    instrumentId: null, instrumentToken: token, exchange: "NSE", tradingSymbol: symbol,
    interval: "1m", timestamp, open: close, high: close + 1, low: close - 1, close,
    volume: 10, openInterest: null, source, adjustment: "UNKNOWN", fetchedAt: timestamp
  };
}

function liveCandle(item: NormalizedHistoricalCandle): MarketCandle {
  return {
    instrumentToken: item.instrumentToken, interval: "1m", startTime: item.timestamp.toISOString(),
    endTime: item.timestamp.toISOString(), open: item.open, high: item.high, low: item.low,
    close: item.close, volume: item.volume, tickCount: 1
  };
}

function addEquity(featureEngine: MarketFeatureEngine, context: MarketContextEngine, instrument: typeof reliance, index: number, close: number, previousClose = 99, at = start) {
  const item = candle(instrument.instrumentToken, instrument.tradingSymbol, index, close, "MOCK", at);
  const session = resolveNseFeatureSession(instrument, item.timestamp);
  const normalized = fromHistoricalCandle(item, session, equitySource, previousClose);
  const feature = featureEngine.ingest(normalized);
  context.ingestEquity({ feature, previousSessionClose: previousClose });
  return feature;
}

function addBenchmark(context: MarketContextEngine, benchmarkId: string, index: number, close: number, previousClose = 99, at = start) {
  const definition = getBenchmarkById(benchmarkId)!;
  const item = candle(definition.instrumentToken, definition.symbol, index, close, "MOCK", at);
  context.ingestBenchmark(fromHistoricalBenchmarkCandle(item, benchmarkId, benchmarkSource, previousClose));
}

function asOf(index: number, at = start) { return new Date(at.getTime() + (index + 1) * 60_000); }

describe("Phase 9B market and sector context", () => {
  it("keeps index benchmark identities outside the tradable NSE EQ universe", () => {
    expect(benchmarkRegistry).toHaveLength(8);
    expect(new Set(benchmarkRegistry.map((item) => item.instrumentToken)).size).toBe(8);
    expect(benchmarkRegistry.every((item) => item.segment === "INDICES" && item.exchange === "NSE")).toBe(true);
    expect(isContextBenchmarkToken("256265")).toBe(true);
    expect(isTradableNseEquity({
      isActive: true, expiry: null, exchange: "NSE", instrumentType: "EQ", segment: "INDICES",
      name: "NIFTY 50", symbol: "NIFTY 50"
    } as Parameters<typeof isTradableNseEquity>[0])).toBe(false);
    expect(sectorMemberships).toHaveLength(25);
    expect(contextUniverseId).toMatch(/^[a-f0-9]{24}$/);
    expect(contextDefinitionRegistry.horizonsMinutes).toEqual([5, 15, 30, 60]);
  });

  it("maps stable sector IDs and records unmapped sector benchmarks explicitly", () => {
    expect(resolveSectorMembership(hcltech.instrumentToken, date, { allowBackcastCurrentMembership: false })?.sectorId).toBe("INFORMATION_TECHNOLOGY");
    expect(getSectorBenchmark("INFORMATION_TECHNOLOGY")?.id).toBe("NIFTY_IT");
    expect(getSectorBenchmark("TELECOMMUNICATION")).toBeNull();
    expect(getSectorBenchmark("CONSUMER_DURABLES")).toBeNull();
    expect(getSectorBenchmark("INDUSTRIALS")).toBeNull();
  });

  it("requires explicit backcast to apply 2026 current membership to older history", () => {
    expect(resolveSectorMembership(hcltech.instrumentToken, "2025-10-21", { allowBackcastCurrentMembership: false })).toBeNull();
    expect(resolveSectorMembership(hcltech.instrumentToken, "2025-10-21", { allowBackcastCurrentMembership: true })?.sectorId).toBe("INFORMATION_TECHNOLOGY");
    const strict = new MarketContextEngine();
    const permissive = new MarketContextEngine({ allowBackcastCurrentMembership: true });
    const at = new Date("2025-10-21T13:45:00+05:30");
    addEquity(new MarketFeatureEngine(), strict, hcltech, 0, 100, 99, at);
    addEquity(new MarketFeatureEngine(), permissive, hcltech, 0, 100, 99, at);
    expect(strict.getContext(hcltech.instrumentToken, asOf(0, at)).sector).toBeNull();
    const backcast = permissive.getContext(hcltech.instrumentToken, asOf(0, at));
    expect(backcast.membershipProvenance).toBe("EXPLICIT_HISTORICAL_BACKCAST");
    expect(backcast.sector?.sectorId).toBe("INFORMATION_TECHNOLOGY");
    expect(backcast.sector?.breadth.quality).toBe("INSUFFICIENT_COVERAGE");
  });

  it("computes exact 5m equity-market, equity-sector and sector-market relative returns", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    for (let index = 0; index <= 5; index += 1) {
      addEquity(features, context, hcltech, index, 100 + index * 2);
      addBenchmark(context, "NIFTY_50", index, 100 + index);
      addBenchmark(context, "NIFTY_IT", index, 100 + index * 1.4);
    }
    const result = context.getContext(hcltech.instrumentToken, asOf(5));
    expect(result.market.schemaVersion).toBe(CONTEXT_SCHEMA_VERSION);
    expect(result.market.definitionVersion).toBe(CONTEXT_DEFINITIONS_VERSION);
    expect(result.market.benchmark.sessionReturn.valuePct).toBeCloseTo((105 / 99 - 1) * 100);
    expect(result.relative.instrumentVsMarket["5m"].valuePct).toBeCloseTo(5);
    expect(result.relative.instrumentVsSector["5m"].valuePct).toBeCloseTo(3);
    expect(result.relative.sectorVsMarket["5m"].valuePct).toBeCloseTo(2);
    expect(result.relative.instrumentVsMarket["15m"].quality).toBe("INSUFFICIENT_HISTORY");
    expect(result.market.benchmark.volumeQuality).toBe("NOT_APPLICABLE");
    expect(result.market.benchmark.distanceFromSessionHighPct.valuePct).toBeCloseTo(1 / 106 * 100);
  });

  it("uses frozen 25-stock breadth denominator and makes 80% coverage explicit", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    for (let index = 0; index < 20; index += 1) {
      const stock = researchUniverseInstruments[index]!;
      addEquity(features, context, stock, 0, index < 15 ? 102 : 98, 100);
    }
    const result = context.getContext(reliance.instrumentToken, asOf(0));
    expect(result.market.breadth).toMatchObject({
      expectedConstituents: 25, availableConstituents: 20, coveragePct: 80, quality: "AVAILABLE",
      advancingCount: 15, decliningCount: 5, unchangedCount: 0, advancePct: 75, declinePct: 25,
      aboveVwapAvailableCount: 20, aboveVwapCoveragePct: 80
    });
    expect(result.market.breadth.aboveVwapPct).toBe(0);
    expect(result.market.benchmark.quality).toBe("INSUFFICIENT_HISTORY");
  });

  it("suppresses percentages below market and sector coverage gates", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    for (let index = 0; index < 19; index += 1) {
      const stock = researchUniverseInstruments[index]!;
      addEquity(features, context, stock, 0, 102, 100);
    }
    const market = context.getContext(reliance.instrumentToken, asOf(0)).market.breadth;
    expect(market.availableConstituents).toBe(19);
    expect(market.quality).toBe("INSUFFICIENT_COVERAGE");
    expect(market.advancePct).toBeNull();
    const sector = context.getContext(hcltech.instrumentToken, asOf(0)).sector!;
    expect(sector.breadth.expectedConstituents).toBe(4);
    expect(sector.breadth.quality).toBe("AVAILABLE");
    const energy = context.getContext(reliance.instrumentToken, asOf(0)).sector!;
    expect(energy.breadth.expectedConstituents).toBe(1);
    expect(energy.breadth.quality).toBe("INSUFFICIENT_COVERAGE");
  });

  it("gates VWAP breadth independently when price breadth has enough coverage", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    for (let index = 0; index < 20; index += 1) {
      const stock = researchUniverseInstruments[index]!;
      if (index !== 19) {
        addEquity(features, context, stock, 0, 102, 100);
        continue;
      }
      const item = candle(stock.instrumentToken, stock.tradingSymbol, 0, 102);
      item.volume = 0;
      const session = resolveNseFeatureSession(stock, item.timestamp);
      const feature = features.ingest(fromHistoricalCandle(item, session, equitySource, 100));
      context.ingestEquity({ feature, previousSessionClose: 100 });
    }
    const breadth = context.getContext(reliance.instrumentToken, asOf(0)).market.breadth;
    expect(breadth.quality).toBe("AVAILABLE");
    expect(breadth.advancePct).toBe(100);
    expect(breadth.aboveVwapAvailableCount).toBe(19);
    expect(breadth.aboveVwapQuality).toBe("INSUFFICIENT_COVERAGE");
    expect(breadth.aboveVwapPct).toBeNull();
  });

  it("shares one immutable market and sector snapshot across stock reads in the same frame", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    const infy = researchUniverseInstruments.find((item) => item.tradingSymbol === "INFY")!;
    addEquity(features, context, hcltech, 0, 101);
    addEquity(features, context, infy, 0, 102);
    const hcl = context.getContext(hcltech.instrumentToken, asOf(0));
    const infosys = context.getContext(infy.instrumentToken, asOf(0));
    expect(hcl.market).toBe(infosys.market);
    expect(hcl.sector).toBe(infosys.sector);
    expect(Object.isFrozen(hcl.market)).toBe(true);
    expect(Object.isFrozen(hcl.sector?.breadth)).toBe(true);
  });

  it("marks missing and stale benchmark observations unavailable without inventing a value", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    addEquity(features, context, hcltech, 0, 100);
    const absent = context.getContext(hcltech.instrumentToken, asOf(0));
    expect(absent.market.benchmark.close).toBeNull();
    expect(absent.relative.instrumentVsMarket["5m"].valuePct).toBeNull();
    addBenchmark(context, "NIFTY_50", 0, 100);
    const stale = context.getContext(hcltech.instrumentToken, new Date(asOf(0).getTime() + 60_001));
    expect(stale.market.benchmark.quality).toBe("STALE");
    expect(stale.market.benchmark.close).toBeNull();
    expect(stale.market.breadth.availableConstituents).toBe(0);
    expect(stale.market.breadth.quality).toBe("INSUFFICIENT_COVERAGE");
  });

  it("uses the latest closed earlier benchmark only within the frozen freshness window", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    addBenchmark(context, "NIFTY_50", 0, 100);
    addEquity(features, context, hcltech, 1, 101);
    const result = context.getContext(hcltech.instrumentToken, asOf(1));
    expect(result.market.benchmark.quality).toBe("AVAILABLE");
    expect(result.market.benchmark.observedAt).toBe(asOf(0).toISOString());
    expect(result.market.benchmark.close).toBe(100);
    expect(result.relative.instrumentVsMarket["5m"].valuePct).toBeNull();
    expect(result.market.benchmark.observedAt! < result.timestamp).toBe(true);
  });

  it("does not apply equity CAS closing semantics to an observed index bar", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    addEquity(features, context, hcltech, 0, 100);
    const lateIndex = candle("256265", "NIFTY 50", 365, 101);
    context.ingestBenchmark(fromHistoricalBenchmarkCandle(lateIndex, "NIFTY_50", benchmarkSource, 99));
    const result = context.getContext(hcltech.instrumentToken, asOf(365));
    expect(result.market.benchmark.close).toBe(101);
    expect(result.market.benchmark.distanceFromSessionHighPct.quality).toBe("DATA_GAP");
    expect(() => addEquity(features, context, hcltech, 365, 101)).toThrow("out-of-session");
  });

  it("rejects holiday index rows and implicit historical benchmark identity backcasts", () => {
    const context = new MarketContextEngine();
    const holiday = new Date("2026-08-26T09:15:00+05:30");
    const holidayBar = candle("256265", "NIFTY 50", 0, 100, "MOCK", holiday);
    expect(() => context.ingestBenchmark(fromHistoricalBenchmarkCandle(holidayBar, "NIFTY_50", benchmarkSource, 99))).toThrow("authoritative trading date");
    const old = new Date("2025-10-21T13:45:00+05:30");
    const oldBar = candle("256265", "NIFTY 50", 0, 100, "MOCK", old);
    expect(() => context.ingestBenchmark(fromHistoricalBenchmarkCandle(oldBar, "NIFTY_50", benchmarkSource, 99))).toThrow("explicit opt-in");
  });

  it("never lets a future index bar change a context captured at T", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    addEquity(features, context, hcltech, 0, 100);
    addBenchmark(context, "NIFTY_50", 0, 100);
    const before = context.getContext(hcltech.instrumentToken, asOf(0));
    const cloneFeatures = new MarketFeatureEngine();
    const cloneContext = new MarketContextEngine();
    addEquity(cloneFeatures, cloneContext, hcltech, 0, 100);
    addBenchmark(cloneContext, "NIFTY_50", 0, 100);
    addEquity(features, context, hcltech, 1, 101);
    addBenchmark(context, "NIFTY_50", 1, 500);
    expect(before).toEqual(cloneContext.getContext(hcltech.instrumentToken, asOf(0)));
    expect(() => context.getContext(hcltech.instrumentToken, asOf(0))).toThrow("backward");
  });

  it("distinguishes real data gaps from insufficient warmup and resets at the next session", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine();
    addEquity(features, context, hcltech, 0, 100);
    addBenchmark(context, "NIFTY_50", 0, 100);
    addEquity(features, context, hcltech, 5, 105);
    addBenchmark(context, "NIFTY_50", 5, 104);
    expect(context.getContext(hcltech.instrumentToken, asOf(5)).relative.instrumentVsMarket["5m"].quality).toBe("DATA_GAP");
    const next = new Date("2026-09-21T09:15:00+05:30");
    // The index observation model does not infer cash-equity CAS hours or synthesize missing sessions.
    addBenchmark(context, "NIFTY_50", 0, 110, 104, next);
    const staleEquity = context.getContext(hcltech.instrumentToken, asOf(0, next));
    expect(staleEquity.market.benchmark.horizonReturns["5m"].quality).toBe("INSUFFICIENT_HISTORY");
  });

  it("produces identical outputs from historical and live-style completed observation adapters", () => {
    const historicalFeatures = new MarketFeatureEngine();
    const liveFeatures = new MarketFeatureEngine();
    const historicalContext = new MarketContextEngine();
    const liveContext = new MarketContextEngine();
    for (let index = 0; index <= 6; index += 1) {
      const equity = candle(hcltech.instrumentToken, hcltech.tradingSymbol, index, 100 + index);
      const session = resolveNseFeatureSession(hcltech, equity.timestamp);
      const histFeature = historicalFeatures.ingest(fromHistoricalCandle(equity, session, equitySource, 99));
      const liveFeature = liveFeatures.ingest(fromCompletedMarketCandle(liveCandle(equity), {
        exchange: "NSE", tradingSymbol: hcltech.tradingSymbol, sourceIdentity: equitySource, previousSessionClose: 99
      }, session));
      expect(histFeature).toEqual(liveFeature);
      historicalContext.ingestEquity({ feature: histFeature, previousSessionClose: 99 });
      liveContext.ingestEquity({ feature: liveFeature, previousSessionClose: 99 });
      for (const benchmarkId of ["NIFTY_50", "NIFTY_IT"]) {
        const definition = getBenchmarkById(benchmarkId)!;
        const indexCandle = candle(definition.instrumentToken, definition.symbol, index, 100 + index / 2);
        const fromHistory = fromHistoricalBenchmarkCandle(indexCandle, benchmarkId, benchmarkSource, 99);
        const fromLive = fromCompletedBenchmarkCandle(liveCandle(indexCandle), benchmarkId, benchmarkSource, 99);
        expect(fromHistory).toEqual(fromLive);
        historicalContext.ingestBenchmark(fromHistory);
        liveContext.ingestBenchmark(fromLive);
      }
      expect(historicalContext.getContext(hcltech.instrumentToken, asOf(index))).toEqual(liveContext.getContext(hcltech.instrumentToken, asOf(index)));
    }
  });

  it("changes context identity when source dataset identity changes", () => {
    const aFeatures = new MarketFeatureEngine();
    const bFeatures = new MarketFeatureEngine();
    const a = new MarketContextEngine();
    const b = new MarketContextEngine();
    const item = candle(hcltech.instrumentToken, hcltech.tradingSymbol, 0, 100);
    const session = resolveNseFeatureSession(hcltech, item.timestamp);
    a.ingestEquity({ feature: aFeatures.ingest(fromHistoricalCandle(item, session, "equity-A", 99)), previousSessionClose: 99 });
    b.ingestEquity({ feature: bFeatures.ingest(fromHistoricalCandle(item, session, "equity-B", 99)), previousSessionClose: 99 });
    const aResult = a.getContext(hcltech.instrumentToken, asOf(0));
    const bResult = b.getContext(hcltech.instrumentToken, asOf(0));
    expect(aResult.id).not.toBe(bResult.id);
    expect(aResult.relative.id).not.toBe(bResult.relative.id);
    const backcast = new MarketContextEngine({ allowBackcastCurrentMembership: true });
    backcast.ingestEquity({ feature: new MarketFeatureEngine().ingest(fromHistoricalCandle(item, session, "equity-A", 99)), previousSessionClose: 99 });
    expect(backcast.getContext(hcltech.instrumentToken, asOf(0)).id).not.toBe(aResult.id);
  });

  it("keeps histories and breadth expiration state bounded during a 25-stock intraday frame", () => {
    const features = new MarketFeatureEngine();
    const context = new MarketContextEngine({ allowBackcastCurrentMembership: true });
    const normalSession = new Date("2026-07-01T09:15:00+05:30");
    const started = performance.now();
    let peakRss = process.memoryUsage().rss;
    let relativeEvaluations = 0;
    for (let index = 0; index < 375; index += 1) {
      for (const stock of researchUniverseInstruments) addEquity(features, context, stock, index, 100 + index / 100, 99, normalSession);
      addBenchmark(context, "NIFTY_50", index, 100 + index / 200, 99, normalSession);
      addBenchmark(context, "NIFTY_IT", index, 100 + index / 300, 99, normalSession);
      for (const stock of researchUniverseInstruments) {
        context.getContext(stock.instrumentToken, asOf(index, normalSession));
        relativeEvaluations += 1;
      }
      peakRss = Math.max(peakRss, process.memoryUsage().rss);
    }
    const size = context.stateSize();
    const elapsedMs = Math.round(performance.now() - started);
    console.info(JSON.stringify({ benchmark: "phase9b-bounded", instruments: 25, benchmarkInstruments: 2, observations: 10125, contextUpdates: 10125, relativeEvaluations, elapsedMs, peakRssMb: Math.round(peakRss / 1048576), state: size }));
    expect(relativeEvaluations).toBe(9375);
    expect(size.equitySeries).toBe(25);
    expect(size.benchmarkSeries).toBe(2);
    expect(size.retainedReturnPoints).toBeLessThanOrEqual(27 * 61);
    expect(size.expiryQueue).toBeLessThan(150);
    expect(elapsedMs).toBeLessThan(15_000);
  });
});
