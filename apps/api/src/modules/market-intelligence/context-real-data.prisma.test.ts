import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { researchUniverseInstruments } from "../historical-market-data/research-universe";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import type { MarketCandle } from "../strategies/candle-aggregator";
import { KiteHistoricalMarketDataProvider } from "../historical-market-data/kite-historical-provider";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { fromCompletedMarketCandle, fromHistoricalCandle, MarketFeatureEngine, resolveNseFeatureSession } from "./feature-engine";
import { fromCompletedBenchmarkCandle, fromHistoricalBenchmarkCandle, MarketContextEngine } from "./context-engine";
import { MarketRegimeEngine } from "./regime-engine";
import { benchmarkRegistry } from "./context-universe";
import { indexSessionBounds } from "./context-dataset";

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });
const from = new Date("2026-09-17T03:45:00.000Z");
const to = new Date("2026-09-17T04:30:00.000Z");

function completed(candle: NormalizedHistoricalCandle): MarketCandle {
  return {
    instrumentToken: candle.instrumentToken, interval: "1m", startTime: candle.timestamp.toISOString(),
    endTime: new Date(candle.timestamp.getTime() + 60_000).toISOString(),
    open: candle.open, high: candle.high, low: candle.low, close: candle.close,
    volume: candle.volume, tickCount: 1
  };
}

describe("Phase 9C real persisted index/equity point-in-time audit", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("confirms all eight observed index session boundaries including post-CAS close", async () => {
    try { await prisma.$queryRaw`SELECT 1`; }
    catch {
      console.warn("Skipping Phase 9C real index session test: PostgreSQL is not reachable.");
      return;
    }
    const provider = new KiteHistoricalMarketDataProvider(kiteBrokerAdapter);
    for (const date of ["2025-09-18", "2025-10-21", "2026-02-01", "2026-09-15"]) {
      const bounds = indexSessionBounds(date)!;
      const expected = (bounds.toMs - bounds.fromMs) / 60_000;
      for (const benchmark of benchmarkRegistry) {
        const rows = await provider.getStoredCandles({
          instrumentToken: benchmark.instrumentToken, tradingSymbol: benchmark.symbol, exchange: "NSE",
          interval: "1m", from: new Date(bounds.fromMs), to: new Date(bounds.toMs)
        });
        expect(rows.length, `${benchmark.id} ${date}`).toBe(expected);
        expect(rows[0]!.timestamp.getTime(), `${benchmark.id} ${date} first`).toBe(bounds.fromMs);
        expect(rows.at(-1)!.timestamp.getTime(), `${benchmark.id} ${date} last`).toBe(bounds.toMs - 60_000);
        expect(rows.every((row) => row.volume === 0), `${benchmark.id} ${date} volume`).toBe(true);
      }
    }
  });

  it("keeps earlier regimes unchanged by a later index change and matches completed-live adapters", async () => {
    try { await prisma.$queryRaw`SELECT 1`; }
    catch {
      console.warn("Skipping Phase 9C real-data parity test: PostgreSQL is not reachable.");
      return;
    }
    const provider = new KiteHistoricalMarketDataProvider(kiteBrokerAdapter);
    const indexes = benchmarkRegistry.filter((item) => item.id === "NIFTY_50" || item.id === "NIFTY_IT");
    const indexRows = await Promise.all(indexes.map(async (item) => ({ item, rows: await provider.getStoredCandles({
      instrumentToken: item.instrumentToken, tradingSymbol: item.symbol, exchange: "NSE", interval: "1m", from, to
    }) })));
    const equities = await Promise.all(researchUniverseInstruments.map(async (item) => ({ item, rows: await provider.getStoredCandles({
      instrumentToken: item.instrumentToken, tradingSymbol: item.tradingSymbol, exchange: "NSE", interval: "1m", from, to
    }) })));
    expect(indexRows.every(({ rows }) => rows.length === 45)).toBe(true);
    expect(equities.every(({ rows }) => rows.length === 45)).toBe(true);
    const token = researchUniverseInstruments.find((item) => item.tradingSymbol === "HCLTECH")!.instrumentToken;
    const replay = (mode: "historical" | "live", alterFuture: boolean, withholdBenchmarkAt: number | null = null) => {
      const featureEngine = new MarketFeatureEngine();
      const contextEngine = new MarketContextEngine({ allowBackcastCurrentMembership: true });
      const regimeEngine = new MarketRegimeEngine();
      const ids: string[] = [];
      const laggedReads: string[] = [];
      const trendQualities: string[] = [];
      for (let minute = 0; minute < 45; minute += 1) {
        for (const { item, rows } of indexRows) {
          if (minute === withholdBenchmarkAt && item.id === "NIFTY_50") continue;
          const original = rows[minute]!;
          const candle = alterFuture && minute === 40 && item.id === "NIFTY_50"
            ? { ...original, close: original.close + 100, high: original.high + 100 } : original;
          contextEngine.ingestBenchmark(mode === "historical"
            ? fromHistoricalBenchmarkCandle(candle, item.id, "real-index-fixture", null)
            : fromCompletedBenchmarkCandle(completed(candle), item.id, "real-index-fixture", null));
        }
        for (const { item, rows } of equities) {
          const candle = rows[minute]!;
          const session = resolveNseFeatureSession(item, candle.timestamp);
          const feature = featureEngine.ingest(mode === "historical"
            ? fromHistoricalCandle(candle, session, "real-equity-fixture", null)
            : fromCompletedMarketCandle(completed(candle), {
              exchange: "NSE", tradingSymbol: item.tradingSymbol,
              sourceIdentity: "real-equity-fixture", previousSessionClose: null
            }, session));
          contextEngine.ingestEquity({ feature, previousSessionClose: null });
        }
        const asOf = new Date(from.getTime() + (minute + 1) * 60_000);
        const current = contextEngine.getContext(token, asOf);
        const snapshot = regimeEngine.observe(current).market;
        ids.push(snapshot.id);
        trendQualities.push(snapshot.trend.quality);
        if (current.market.benchmark.observedAt && current.market.benchmark.observedAt < asOf.toISOString()) {
          laggedReads.push(current.market.benchmark.observedAt);
        }
      }
      return { ids, laggedReads, trendQualities };
    };
    const historical = replay("historical", false);
    expect(replay("live", false)).toEqual(historical);
    const altered = replay("historical", true);
    expect(altered.ids.slice(0, 40)).toEqual(historical.ids.slice(0, 40));
    expect(altered.ids[40]).not.toBe(historical.ids[40]);
    const misaligned = replay("historical", false, 20);
    expect(misaligned.ids.slice(0, 20)).toEqual(historical.ids.slice(0, 20));
    expect(misaligned.laggedReads).toContain(new Date(from.getTime() + 20 * 60_000).toISOString());
    expect(misaligned.trendQualities[21]).toBe("DATA_GAP");
  });
});
