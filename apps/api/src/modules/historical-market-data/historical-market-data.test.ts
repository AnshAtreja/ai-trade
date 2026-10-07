import { describe, expect, it, vi } from "vitest";
import { KiteAccountError } from "../broker/account/errors";
import { buildHistoricalChunks } from "./chunking";
import { HistoricalCandleDownloader } from "./downloader";
import { HistoricalMarketDataError } from "./errors";
import { KiteHistoricalMarketDataProvider } from "./kite-historical-provider";
import { MockHistoricalMarketDataProvider } from "./mock-historical-provider";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { resetRepositoriesForTests } from "../../db/persistence";
import { aggregateOneMinuteToFiveMinute } from "./aggregation";
import { validateHistoricalCandles } from "./validation";
import type { NormalizedHistoricalCandle } from "./types";

function candle(partial: Partial<NormalizedHistoricalCandle> & { timestamp: Date }): NormalizedHistoricalCandle {
  return {
    instrumentId: null,
    instrumentToken: "2885",
    exchange: "NSE",
    tradingSymbol: "RELIANCE",
    interval: "1m",
    open: 100,
    high: 101,
    low: 99,
    close: 100.5,
    volume: 1000,
    openInterest: null,
    source: "MOCK",
    adjustment: "UNADJUSTED",
    fetchedAt: new Date("2026-09-15T10:00:00.000Z"),
    ...partial
  };
}

describe("MockHistoricalMarketDataProvider", () => {
  it("generates deterministic session candles and respects [from, to)", async () => {
    const provider = new MockHistoricalMarketDataProvider();
    const from = new Date("2026-09-15T03:45:00.000Z"); // 09:15 IST
    const to = new Date("2026-09-15T03:50:00.000Z");
    const result = await provider.fetchRange({
      instrumentToken: "2885",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      interval: "1m",
      from,
      to
    });
    expect(result.candles.length).toBe(5);
    expect(result.candles.every((c) => c.timestamp.getTime() >= from.getTime())).toBe(true);
    expect(result.candles.every((c) => c.timestamp.getTime() < to.getTime())).toBe(true);
  });
});

describe("KiteHistoricalMarketDataProvider", () => {
  it("maps Kite candles and drops out-of-range rows", async () => {
    const adapter = {
      getStatus: vi.fn(async () => ({ verified: true })),
      getHistoricalCandlesByToken: vi.fn(async () => [
        {
          timestamp: "2026-09-15T09:15:00+05:30",
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          volume: 100,
          openInterest: 1
        },
        {
          timestamp: "2026-09-15T09:20:00+05:30",
          open: 10,
          high: 11,
          low: 9,
          close: 10.5,
          volume: 100,
          openInterest: null
        }
      ])
    };
    const provider = new KiteHistoricalMarketDataProvider(adapter as never);
    const result = await provider.fetchRange({
      instrumentToken: "2885",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      interval: "1m",
      from: new Date("2026-09-15T03:45:00.000Z"),
      to: new Date("2026-09-15T03:50:00.000Z")
    });
    expect(result.candles).toHaveLength(1);
    expect(result.candles[0]?.adjustment).toBe("UNKNOWN");
    expect(result.source).toBe("KITE");
  });

  it("maps auth and rate-limit errors", async () => {
    const authProvider = new KiteHistoricalMarketDataProvider({
      getStatus: async () => ({ verified: false, reasonCode: "KITE_NOT_AUTHENTICATED", reason: "missing token" }),
      getHistoricalCandlesByToken: async () => {
        throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "missing token");
      }
    } as never);
    await expect(
      authProvider.fetchRange({
        instrumentToken: "2885",
        interval: "1m",
        from: new Date("2026-09-15T03:45:00.000Z"),
        to: new Date("2026-09-15T03:46:00.000Z")
      })
    ).rejects.toMatchObject({ code: "HISTORICAL_AUTH" });

    const rateProvider = new KiteHistoricalMarketDataProvider({
      getStatus: async () => ({ verified: true }),
      getHistoricalCandlesByToken: async () => {
        throw new KiteAccountError("KITE_RATE_LIMITED", "slow down");
      }
    } as never);
    await expect(
      rateProvider.fetchRange({
        instrumentToken: "2885",
        interval: "1m",
        from: new Date("2026-09-15T03:45:00.000Z"),
        to: new Date("2026-09-15T03:46:00.000Z")
      })
    ).rejects.toMatchObject({ code: "HISTORICAL_RATE_LIMITED" });
  });

  it("maps malformed responses", async () => {
    const provider = new KiteHistoricalMarketDataProvider({
      getStatus: async () => ({ verified: true }),
      getHistoricalCandlesByToken: async () => {
        throw new KiteAccountError("KITE_MALFORMED_RESPONSE", "bad payload");
      }
    } as never);
    await expect(
      provider.fetchRange({
        instrumentToken: "2885",
        interval: "1m",
        from: new Date("2026-09-15T03:45:00.000Z"),
        to: new Date("2026-09-15T03:46:00.000Z")
      })
    ).rejects.toMatchObject({ code: "HISTORICAL_MALFORMED" });
  });
});

describe("HistoricalCandleDownloader retries", () => {
  it("retries rate limits then succeeds", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    let attempts = 0;
    const provider = {
      source: "MOCK" as const,
      fetchCandles: async () => {
        throw new Error("unused");
      },
      fetchRange: async () => {
        attempts += 1;
        if (attempts < 3) {
          throw new HistoricalMarketDataError("HISTORICAL_RATE_LIMITED", "429");
        }
        return {
          source: "MOCK" as const,
          requested: {
            from: "2026-09-15T03:45:00.000Z",
            to: "2026-09-15T03:46:00.000Z",
            interval: "1m" as const
          },
          candles: [
            candle({ timestamp: new Date("2026-09-15T03:45:00.000Z") })
          ]
        };
      },
      getStoredCandles: async () => [],
      validateRange: async () => ({
        instrumentToken: "2885",
        interval: "1m" as const,
        from: "",
        to: "",
        candleCount: 0,
        valid: true,
        issues: []
      })
    };

    const downloader = new HistoricalCandleDownloader(
      provider,
      createMemoryRepositories,
      {
        provider: "mock",
        persistenceEnabled: true,
        throttleMinIntervalMs: 0,
        maxRetries: 3,
        retryBackoffMs: 1,
        chunkWindowDays1m: 5,
        chunkOverlapMinutes: 0,
        validateOnPersist: false,
        persistDerived5m: false,
        defaultInterval: "1m"
      },
      () => undefined,
      async () => undefined
    );

    const result = await downloader.download({
      instrumentToken: "2885",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      interval: "1m",
      from: new Date("2026-09-15T03:45:00.000Z"),
      to: new Date("2026-09-15T03:46:00.000Z")
    });
    expect(attempts).toBe(3);
    expect(result.inserted).toBe(1);
  });
});

describe("chunking", () => {
  it("builds overlapping half-open chunks", () => {
    const chunks = buildHistoricalChunks({
      from: new Date("2026-09-01T00:00:00.000Z"),
      to: new Date("2026-09-12T00:00:00.000Z"),
      interval: "1m",
      windowDays: 5,
      overlapMinutes: 60
    });
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0]?.from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(chunks.every((c) => c.from < c.to)).toBe(true);
  });
});

describe("persistence idempotency + temporal", () => {
  it("skips duplicates and never returns candles at/after exclusive end", async () => {
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    const base = candle({ timestamp: new Date("2026-09-15T03:45:00.000Z") });
    const first = await repos.historicalCandles.insertMany([base]);
    const second = await repos.historicalCandles.insertMany([base]);
    expect(first.inserted).toBe(1);
    expect(second.skipped).toBe(1);

    await repos.historicalCandles.insertMany([
      candle({ timestamp: new Date("2026-09-15T03:46:00.000Z") }),
      candle({ timestamp: new Date("2026-09-15T03:47:00.000Z") })
    ]);

    const end = new Date("2026-09-15T03:47:00.000Z");
    const rows = await repos.historicalCandles.listRange({
      instrumentToken: "2885",
      interval: "1m",
      from: new Date("2026-09-15T03:45:00.000Z"),
      to: end
    });
    expect(rows.map((r) => r.timestamp.toISOString())).toEqual([
      "2026-09-15T03:45:00.000Z",
      "2026-09-15T03:46:00.000Z"
    ]);
    expect(rows.every((r) => r.timestamp.getTime() < end.getTime())).toBe(true);

    const coverage = await repos.historicalCandles.coverage({ instrumentToken: "2885" });
    expect(coverage[0]?.count).toBe(3);
  });

  it("resumes download without duplicating stored candles", async () => {
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    await repos.historicalCandles.insertMany([candle({ timestamp: new Date("2026-09-15T03:45:00.000Z") })]);

    const provider = new MockHistoricalMarketDataProvider(() => repos);
    const downloader = new HistoricalCandleDownloader(
      provider,
      () => repos,
      {
        provider: "mock",
        persistenceEnabled: true,
        throttleMinIntervalMs: 0,
        maxRetries: 0,
        retryBackoffMs: 1,
        chunkWindowDays1m: 5,
        chunkOverlapMinutes: 0,
        validateOnPersist: false,
        persistDerived5m: false,
        defaultInterval: "1m"
      },
      () => undefined,
      async () => undefined
    );

    const result = await downloader.download({
      instrumentToken: "2885",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      interval: "1m",
      from: new Date("2026-09-15T03:45:00.000Z"),
      to: new Date("2026-09-15T03:47:00.000Z")
    });
    expect(result.skipped).toBeGreaterThanOrEqual(1);
    const count = await repos.historicalCandles.count({
      instrumentToken: "2885",
      interval: "1m",
      from: new Date("2026-09-15T03:45:00.000Z"),
      to: new Date("2026-09-15T03:47:00.000Z")
    });
    expect(count).toBe(2);
  });
});

describe("validation", () => {
  it("flags invalid OHLC, negative volume, duplicates, and out-of-order", () => {
    const report = validateHistoricalCandles({
      instrumentToken: "2885",
      interval: "1m",
      from: new Date("2026-09-15T03:45:00.000Z"),
      to: new Date("2026-09-15T03:50:00.000Z"),
      candles: [
        candle({ timestamp: new Date("2026-09-15T03:46:00.000Z"), high: 90, low: 100, open: 100, close: 100 }),
        candle({ timestamp: new Date("2026-09-15T03:45:00.000Z"), volume: -1 }),
        candle({ timestamp: new Date("2026-09-15T03:45:00.000Z") })
      ]
    });
    expect(report.valid).toBe(false);
    expect(report.issues.some((i) => i.kind === "INVALID_OHLC")).toBe(true);
    expect(report.issues.some((i) => i.kind === "NEGATIVE_VOLUME")).toBe(true);
    expect(report.issues.some((i) => i.kind === "DUPLICATE_TIMESTAMP")).toBe(true);
    expect(report.issues.some((i) => i.kind === "OUT_OF_ORDER")).toBe(true);
  });

  it("treats weekend gaps as expected session gaps", () => {
    const report = validateHistoricalCandles({
      instrumentToken: "2885",
      interval: "1m",
      from: new Date("2026-09-11T10:00:00.000Z"), // Friday
      to: new Date("2026-09-14T10:00:00.000Z"), // Monday
      candles: [
        candle({ timestamp: new Date("2026-09-11T10:00:00.000Z") }),
        candle({ timestamp: new Date("2026-09-14T03:45:00.000Z") })
      ]
    });
    expect(report.issues.some((i) => i.kind === "EXPECTED_SESSION_GAP")).toBe(true);
  });
});

describe("1m → 5m aggregation", () => {
  it("aggregates OHLC/volume and aligns bucket timestamps", () => {
    const start = new Date("2026-09-15T03:45:00.000Z");
    const oneMinute: NormalizedHistoricalCandle[] = [];
    for (let i = 0; i < 5; i += 1) {
      oneMinute.push(
        candle({
          timestamp: new Date(start.getTime() + i * 60_000),
          open: 100 + i,
          high: 110 + i,
          low: 90 + i,
          close: 101 + i,
          volume: 10
        })
      );
    }
    const five = aggregateOneMinuteToFiveMinute(oneMinute);
    expect(five).toHaveLength(1);
    expect(five[0]?.timestamp.toISOString()).toBe("2026-09-15T03:45:00.000Z");
    expect(five[0]?.open).toBe(100);
    expect(five[0]?.high).toBe(114);
    expect(five[0]?.low).toBe(90);
    expect(five[0]?.close).toBe(105);
    expect(five[0]?.volume).toBe(50);
    expect(five[0]?.source).toBe("DERIVED_5M");
  });

  it("omits incomplete trailing buckets by default", () => {
    const start = new Date("2026-09-15T03:45:00.000Z");
    const oneMinute = [0, 1, 2].map((i) =>
      candle({ timestamp: new Date(start.getTime() + i * 60_000), open: 100, high: 101, low: 99, close: 100, volume: 1 })
    );
    expect(aggregateOneMinuteToFiveMinute(oneMinute, { asOf: new Date(start.getTime() + 3 * 60_000) })).toHaveLength(0);
    expect(
      aggregateOneMinuteToFiveMinute(oneMinute, {
        includeIncomplete: true,
        asOf: new Date(start.getTime() + 3 * 60_000)
      })
    ).toHaveLength(1);
  });
});
