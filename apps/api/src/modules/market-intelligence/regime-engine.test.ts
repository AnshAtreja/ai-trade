import { describe, expect, it } from "vitest";
import { performance } from "node:perf_hooks";
import { researchUniverseInstruments } from "../historical-market-data/research-universe";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import type { MarketCandle } from "../strategies/candle-aggregator";
import type { BenchmarkContext, BreadthContext, ContextMetric, InstrumentMarketContext } from "./context-types";
import { contextUniverseId } from "./context-universe";
import { fromCompletedBenchmarkCandle, fromHistoricalBenchmarkCandle, MarketContextEngine } from "./context-engine";
import { fromCompletedMarketCandle, fromHistoricalCandle, MarketFeatureEngine, resolveNseFeatureSession } from "./feature-engine";
import { regimeDefinition, regimeDefinitionHash } from "./regime-definition";
import { MarketRegimeEngine } from "./regime-engine";

function metric(valuePct: number | null, observedAt: string, quality: ContextMetric["quality"] = "AVAILABLE"): ContextMetric {
  return { valuePct, quality, observedAt };
}

function fixture(options: {
  index?: number; date?: string; startTime?: string; direction?: "UP" | "DOWN" | "RANGE" | "CONFLICT";
  breadthCount?: number; benchmarkQuality?: BenchmarkContext["quality"];
  fiveMinuteReturn?: number; sectorReturn?: number; marketReturn?: number; sourceId?: string;
} = {}): InstrumentMarketContext {
  const index = options.index ?? 40;
  const date = options.date ?? "2026-09-18";
  const timestamp = new Date(Date.parse(options.startTime ?? `${date}T03:45:00.000Z`) + (index + 1) * 60_000).toISOString();
  const direction = options.direction ?? "UP";
  const r15 = direction === "RANGE" ? 0.02 : direction === "DOWN" ? -0.4 : 0.4;
  const r30 = direction === "RANGE" ? 0.04 : direction === "DOWN" ? -0.8 : 0.8;
  const advancePct = direction === "RANGE" ? 50 : direction === "DOWN" || direction === "CONFLICT" ? 25 : 75;
  const aboveVwapPct = advancePct;
  const quality = options.benchmarkQuality ?? "AVAILABLE";
  const breadthCount = options.breadthCount ?? 25;
  const benchmark: BenchmarkContext = {
    benchmarkId: "NIFTY_50", instrumentToken: "256265", sourceIdentity: options.sourceId ?? "test-index-dataset",
    observedAt: timestamp, close: quality === "AVAILABLE" ? 100 : null, quality,
    sessionReturn: metric(0.8, timestamp),
    horizonReturns: {
      "5m": metric(options.fiveMinuteReturn ?? 0.2, timestamp),
      "15m": metric(r15, timestamp), "30m": metric(r30, timestamp), "60m": metric(1, timestamp)
    },
    distanceFromSessionHighPct: metric(direction === "DOWN" ? 1 : 0.1, timestamp),
    distanceFromSessionLowPct: metric(direction === "DOWN" ? 0.1 : 1, timestamp), volumeQuality: "NOT_APPLICABLE"
  };
  const breadth: BreadthContext = {
    expectedConstituents: 25, availableConstituents: breadthCount,
    coveragePct: breadthCount * 4, quality: breadthCount >= 20 ? "AVAILABLE" : "INSUFFICIENT_COVERAGE",
    advancingCount: Math.round(breadthCount * advancePct / 100), decliningCount: breadthCount - Math.round(breadthCount * advancePct / 100),
    unchangedCount: 0, advancePct: breadthCount >= 20 ? advancePct : null, declinePct: breadthCount >= 20 ? 100 - advancePct : null,
    aboveVwapAvailableCount: breadthCount, aboveVwapCount: Math.round(breadthCount * aboveVwapPct / 100),
    aboveVwapCoveragePct: breadthCount * 4, aboveVwapPct: breadthCount >= 20 ? aboveVwapPct : null,
    aboveVwapQuality: breadthCount >= 20 ? "AVAILABLE" : "INSUFFICIENT_COVERAGE"
  };
  const difference = options.sectorReturn == null ? null : options.sectorReturn - (options.marketReturn ?? 0);
  return {
    id: `instrument-${date}-${index}`, timestamp, instrumentToken: "408065", membershipPolicy: "EXPLICIT_CURRENT_BACKCAST",
    equitySourceIdentity: "test-equity-dataset", membershipQuality: "AVAILABLE", membershipProvenance: "CURRENT_SNAPSHOT",
    market: {
      id: `market-${date}-${index}-${options.direction ?? "UP"}-${breadthCount}-${quality}`,
      schemaVersion: "MARKET_CONTEXT_V1", definitionVersion: "MARKET_CONTEXT_DEFINITIONS_V1",
      timestamp, contextUniverseId, membershipPolicy: "EXPLICIT_CURRENT_BACKCAST", equitySourceIdentity: "test-equity-dataset",
      benchmark, breadth
    },
    sector: {
      id: `sector-${date}-${index}`, schemaVersion: "MARKET_CONTEXT_V1", definitionVersion: "MARKET_CONTEXT_DEFINITIONS_V1",
      timestamp, sectorId: "INFORMATION_TECHNOLOGY", contextUniverseId, membershipPolicy: "EXPLICIT_CURRENT_BACKCAST",
      equitySourceIdentity: "test-equity-dataset", benchmark: { ...benchmark, benchmarkId: "NIFTY_IT", instrumentToken: "259849" },
      benchmarkQuality: quality, breadth: { ...breadth, expectedConstituents: 4, availableConstituents: 4, coveragePct: 100,
        aboveVwapAvailableCount: 4, aboveVwapCoveragePct: 100 }
    },
    relative: {
      id: `relative-${date}-${index}`, schemaVersion: "MARKET_CONTEXT_V1", definitionVersion: "MARKET_CONTEXT_DEFINITIONS_V1",
      contextUniverseId, membershipPolicy: "EXPLICIT_CURRENT_BACKCAST", equitySourceIdentity: "test-equity-dataset",
      marketSourceIdentity: benchmark.sourceIdentity, sectorSourceIdentity: benchmark.sourceIdentity,
      timestamp, instrumentToken: "408065", sectorId: "INFORMATION_TECHNOLOGY",
      instrumentVsMarket: {} as InstrumentMarketContext["relative"]["instrumentVsMarket"],
      instrumentVsSector: {} as InstrumentMarketContext["relative"]["instrumentVsSector"],
      sectorVsMarket: { "15m": { ...metric(difference, timestamp, difference == null ? "INSUFFICIENT_HISTORY" : "AVAILABLE"),
        instrumentReturnPct: options.sectorReturn ?? null, benchmarkReturnPct: options.marketReturn ?? null, benchmarkObservedAt: timestamp }
      } as unknown as InstrumentMarketContext["relative"]["sectorVsMarket"]
    }
  };
}

describe("Phase 9C deterministic market regime", () => {
  it("freezes the definition identity and keeps volatility orthogonal to trend", () => {
    const result = new MarketRegimeEngine().observe(fixture());
    expect(result.market.definitionVersion).toBe("MARKET_REGIME_V1");
    expect(result.market.definitionHash).toBe(regimeDefinitionHash);
    expect(Object.isFrozen(regimeDefinition.trend)).toBe(true);
    expect(result.market.trend.state).toBe("TRENDING_UP");
    expect(result.market.volatility.state).toBe("UNKNOWN");
    expect(result.market.quality).toBe("INSUFFICIENT_HISTORY");
    expect(result.market.anomaly).toBeNull();
    expect(Object.isFrozen(result.market.trend.metrics)).toBe(true);
    expect(Object.isFrozen(result.sector)).toBe(true);
  });

  it.each([
    ["DOWN", "TRENDING_DOWN"], ["RANGE", "RANGE_BOUND"], ["CONFLICT", "UNCERTAIN"]
  ] as const)("classifies %s evidence as %s", (direction, expected) => {
    const value = new MarketRegimeEngine().observe(fixture({ direction })).market;
    expect(value.trend.state).toBe(expected);
    expect(value.breadth.state).toBe(direction === "CONFLICT" ? "CONTRADICTING" : direction === "RANGE" ? "NEUTRAL" : "CONFIRMING");
    expect(value.trend.conflicting.length).toBe(direction === "CONFLICT" ? 2 : 0);
  });

  it("rejects unavailable benchmark and low 25-stock breadth coverage", () => {
    const missing = new MarketRegimeEngine().observe(fixture({ benchmarkQuality: "DATA_GAP" })).market;
    expect(missing.trend.state).toBe("UNCERTAIN");
    expect(missing.volatility.state).toBe("UNKNOWN");
    expect(missing.trend.quality).toBe("DATA_GAP");
    const lowCoverage = new MarketRegimeEngine().observe(fixture({ breadthCount: 19 })).market;
    expect(lowCoverage.trend.state).toBe("UNCERTAIN");
    expect(lowCoverage.breadth.expectedConstituents).toBe(25);
    expect(lowCoverage.breadth.quality).toBe("INSUFFICIENT_COVERAGE");
  });

  it("uses only earlier unique benchmark observations for the bounded volatility median", () => {
    const engine = new MarketRegimeEngine();
    for (let index = 5; index <= 24; index += 1) {
      const context = fixture({ index, fiveMinuteReturn: 0.2 });
      const first = engine.observe(context).market;
      expect(first.volatility.state).toBe("UNKNOWN");
      expect(engine.observe(context).market).toBe(first);
    }
    expect(engine.observe(fixture({ index: 25, fiveMinuteReturn: 0.1 })).market.volatility).toMatchObject({
      state: "LOW", priorObservations: 20, priorMedianPct: 0.2, medianMultiple: 0.5
    });
    expect(engine.observe(fixture({ index: 26, fiveMinuteReturn: 0.2 })).market.volatility.state).toBe("NORMAL");
    expect(engine.observe(fixture({ index: 27, fiveMinuteReturn: 0.5 })).market.volatility.state).toBe("HIGH");
    for (let index = 28; index < 150; index += 1) engine.observe(fixture({ index, fiveMinuteReturn: 0.2 }));
    expect(engine.stateSize()).toEqual({ volatilitySeries: 2, volatilitySamples: 120, sectorSnapshots: 1 });
  });

  it("classifies sector relative performance without a trading recommendation", () => {
    const ahead = new MarketRegimeEngine().observe(fixture({ sectorReturn: 0.5, marketReturn: 0.2 })).sector!;
    expect(ahead.relativeToMarket).toBe("OUTPERFORMING_MARKET");
    expect(ahead.trend.state).toBe("TRENDING_UP");
    expect(new MarketRegimeEngine().observe(fixture({ sectorReturn: 0.1, marketReturn: 0.3 })).sector?.relativeToMarket).toBe("UNDERPERFORMING_MARKET");
    expect(new MarketRegimeEngine().observe(fixture({ sectorReturn: 0.2, marketReturn: 0.2 })).sector?.relativeToMarket).toBe("INLINE_WITH_MARKET");
    expect(new MarketRegimeEngine().observe(fixture()).sector?.relativeToMarket).toBe("UNKNOWN");
  });

  it("is invariant to future observations and identical in historical/live-style ordered runs", () => {
    const ordered = [fixture({ index: 40 }), fixture({ index: 41, direction: "DOWN" })];
    const historical = new MarketRegimeEngine();
    const first = historical.observe(ordered[0]!);
    historical.observe(ordered[1]!);
    const alternate = new MarketRegimeEngine();
    const sameFirst = alternate.observe(ordered[0]!);
    alternate.observe(fixture({ index: 41, direction: "UP", fiveMinuteReturn: 4 }));
    expect(sameFirst).toEqual(first);
    expect(new MarketRegimeEngine().observe(ordered[0]!)).toEqual(first);
    expect(() => historical.observe(ordered[0]!)).toThrow(/backward/);
    const future = {
      ...ordered[0]!, market: { ...ordered[0]!.market, benchmark: {
        ...ordered[0]!.market.benchmark, observedAt: ordered[1]!.timestamp
      } }
    };
    expect(() => new MarketRegimeEngine().observe(future)).toThrow(/Future or invalid benchmark metric/);
    const futureMetric = {
      ...ordered[0]!, market: { ...ordered[0]!.market, benchmark: {
        ...ordered[0]!.market.benchmark, horizonReturns: {
          ...ordered[0]!.market.benchmark.horizonReturns,
          "15m": { ...ordered[0]!.market.benchmark.horizonReturns["15m"], observedAt: ordered[1]!.timestamp }
        }
      } }
    };
    expect(() => new MarketRegimeEngine().observe(futureMetric)).toThrow(/Future or invalid benchmark metric/);
  });

  it("treats normal, Muhurat, Budget and CAS-era dates as ordered observations without leaking session-local trend", () => {
    const engine = new MarketRegimeEngine();
    const sessions = [
      { date: "2025-10-21", startTime: "2025-10-21T08:15:00.000Z" },
      { date: "2026-02-01", startTime: "2026-02-01T03:45:00.000Z" },
      { date: "2026-08-03", startTime: "2026-08-03T03:45:00.000Z" },
      { date: "2026-09-18", startTime: "2026-09-18T03:45:00.000Z" }
    ];
    for (const { date, startTime } of sessions) {
      const result = engine.observe(fixture({ index: 40, date, startTime }));
      expect(result.market.timestamp.startsWith(date)).toBe(true);
      expect(result.market.volatility.state).toBe("UNKNOWN");
    }
    expect(engine.stateSize().volatilitySamples).toBe(8);
  });

  it("matches historical and completed-live adapters through 9A, 9B and 9C", () => {
    const historicalFeatures = new MarketFeatureEngine();
    const liveFeatures = new MarketFeatureEngine();
    const historicalContext = new MarketContextEngine({ allowBackcastCurrentMembership: true });
    const liveContext = new MarketContextEngine({ allowBackcastCurrentMembership: true });
    const historicalRegime = new MarketRegimeEngine();
    const liveRegime = new MarketRegimeEngine();
    const start = Date.parse("2026-09-18T03:45:00.000Z");
    for (let index = 0; index <= 35; index += 1) {
      const at = new Date(start + index * 60_000);
      for (const definition of [{ id: "NIFTY_50", token: "256265" }, { id: "NIFTY_IT", token: "259849" }]) {
        const close = 100 + index * 0.1;
        const candle: NormalizedHistoricalCandle = {
          instrumentId: null, instrumentToken: definition.token, tradingSymbol: definition.id, exchange: "NSE",
          interval: "1m", timestamp: at, open: close, high: close + 0.1, low: close - 0.1, close,
          volume: 0, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: at
        };
        const live: MarketCandle = {
          instrumentToken: definition.token, interval: "1m", startTime: at.toISOString(), endTime: at.toISOString(),
          open: close, high: close + 0.1, low: close - 0.1, close, volume: 0, tickCount: 1
        };
        historicalContext.ingestBenchmark(fromHistoricalBenchmarkCandle(candle, definition.id, "index-fixture", 99));
        liveContext.ingestBenchmark(fromCompletedBenchmarkCandle(live, definition.id, "index-fixture", 99));
      }
      for (const member of researchUniverseInstruments) {
        const close = 100 + index * 0.1;
        const candle: NormalizedHistoricalCandle = {
          instrumentId: null, instrumentToken: member.instrumentToken, tradingSymbol: member.tradingSymbol, exchange: "NSE",
          interval: "1m", timestamp: at, open: close, high: close + 0.1, low: close - 0.1, close,
          volume: 10, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: at
        };
        const live: MarketCandle = {
          instrumentToken: member.instrumentToken, interval: "1m", startTime: at.toISOString(), endTime: at.toISOString(),
          open: close, high: close + 0.1, low: close - 0.1, close, volume: 10, tickCount: 1
        };
        const session = resolveNseFeatureSession(member, at);
        historicalContext.ingestEquity({
          feature: historicalFeatures.ingest(fromHistoricalCandle(candle, session, "equity-fixture", 99)), previousSessionClose: 99
        });
        liveContext.ingestEquity({
          feature: liveFeatures.ingest(fromCompletedMarketCandle(live, {
            exchange: "NSE", tradingSymbol: member.tradingSymbol, sourceIdentity: "equity-fixture", previousSessionClose: 99
          }, session)), previousSessionClose: 99
        });
      }
      const asOf = new Date(at.getTime() + 60_000);
      const token = researchUniverseInstruments.find((member) => member.tradingSymbol === "HCLTECH")!.instrumentToken;
      const fromHistory = historicalRegime.observe(historicalContext.getContext(token, asOf));
      const fromLive = liveRegime.observe(liveContext.getContext(token, asOf));
      expect(fromHistory).toEqual(fromLive);
    }
    expect(historicalRegime.stateSize().volatilitySamples).toBeLessThanOrEqual(120);
  });

  it("keeps one bounded market/sector state for repeated instrument reads", () => {
    const engine = new MarketRegimeEngine();
    const started = performance.now();
    for (let index = 5; index < 365; index += 1) {
      const input = fixture({ index, fiveMinuteReturn: index % 5 === 0 ? 0.4 : 0.2 });
      for (let instrument = 0; instrument < 25; instrument += 1) {
        const value = engine.observe(input);
        expect(value.market.sourceContextId).toBe(input.market.id);
      }
    }
    const elapsedMs = performance.now() - started;
    expect(engine.stateSize()).toEqual({ volatilitySeries: 2, volatilitySamples: 120, sectorSnapshots: 1 });
    console.info(JSON.stringify({ regimeFixture: "360 frames x 25 reads", observations: 9000, elapsedMs, rssBytes: process.memoryUsage().rss }));
  });
});
