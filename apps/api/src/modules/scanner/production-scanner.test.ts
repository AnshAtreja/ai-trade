import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DEMO_USER_ID } from "../../db/domain";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { getTradingDate } from "../../common/utils/trading-date";
import { getMarketSessionState, isScannerTradingSession } from "../../common/utils/market-session";
import { createMarketInstrumentService } from "../market-data/instrument-service";
import { MockInstrumentProvider } from "../market-data/mock-instrument-provider";
import { MockMarketDataProvider } from "../market-data/mock-market-data-provider";
import { LatestMarketStateStore } from "../market-data/stream/latest-state-store";
import type { MarketTick } from "../market-data/stream/types";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { LIVE_TRADING_DISABLED_MESSAGE } from "../broker/adapters/live-trading-disabled";
import { calculateFeatures } from "./feature-calculator";
import { applyScannerFilters } from "./filters";
import { getScannerConfig } from "./config";
import { scoreCandidate } from "./scoring";
import {
  ProductionScannerService,
  resetProductionScannerServiceForTests
} from "./production-service";
import type { ScannerMarketObservation } from "./production-types";

function tick(partial: Partial<MarketTick> & Pick<MarketTick, "instrumentToken" | "lastPrice">): MarketTick {
  const now = partial.receivedAt ?? new Date().toISOString();
  return {
    exchange: "NSE",
    tradingSymbol: partial.tradingSymbol ?? "RELIANCE",
    instrumentId: partial.instrumentId ?? "inst_1",
    timestamp: now,
    receivedAt: now,
    volume: 50000,
    lastTradedQuantity: 100,
    open: 100,
    high: 105,
    low: 99,
    close: 100.5,
    averagePrice: 102,
    buyQuantity: 1000,
    sellQuantity: 900,
    exchangeTimestamp: now,
    mode: "QUOTE",
    source: "MOCK",
    orderKey: `${partial.instrumentToken}|${now}|${partial.lastPrice}`,
    ...partial
  };
}

function observation(partial: Partial<ScannerMarketObservation> = {}): ScannerMarketObservation {
  return {
    instrumentToken: "2885",
    lastPrice: 104,
    open: 100,
    high: 105,
    low: 99,
    close: 100.5,
    volume: 50000,
    averagePrice: 102,
    dataTimestamp: new Date().toISOString(),
    receivedAt: new Date().toISOString(),
    dataAgeMs: 100,
    stale: false,
    missing: false,
    ...partial
  };
}

async function seedUniverse() {
  const repos = createMemoryRepositories();
  resetRepositoriesForTests(repos);
  await createMarketInstrumentService({
    repos: () => repos,
    instrumentProvider: new MockInstrumentProvider(),
    quotes: new MockMarketDataProvider()
  }).syncInstruments();
  return repos;
}

describe("market session helper", () => {
  it("classifies weekday IST regular hours as REGULAR", () => {
    // 2026-09-15 is Tuesday; 10:30 IST = 05:00 UTC
    const at = new Date("2026-09-15T05:00:00.000Z");
    expect(getMarketSessionState(at)).toBe("REGULAR");
    expect(isScannerTradingSession(getMarketSessionState(at))).toBe(true);
  });

  it("classifies weekend as CLOSED", () => {
    const saturday = new Date("2026-09-12T05:00:00.000Z");
    expect(getMarketSessionState(saturday)).toBe("CLOSED");
  });
});

describe("feature calculator", () => {
  const config = getScannerConfig();

  it("computes movement, range, and day-high proximity", () => {
    const features = calculateFeatures(observation({ lastPrice: 105, high: 105 }), config);
    expect(features.changeFromOpenPercent).toBeCloseTo(5, 1);
    expect(features.intradayRangePercent).toBeGreaterThan(0);
    expect(features.nearDayHigh).toBe(true);
    expect(features.breakingDayHigh).toBe(true);
    expect(features.volumeSpike).toBe("UNKNOWN");
    expect(features.volumeSpikeRatio).toBeNull();
    expect(features.momentumBias).toBe("UP");
  });

  it("marks missing optional fields as null without inventing zeros", () => {
    const features = calculateFeatures(
      observation({ open: null, high: null, low: null, close: null, volume: null }),
      config
    );
    expect(features.changeFromOpenPercent).toBeNull();
    expect(features.intradayRangePercent).toBeNull();
    expect(features.nearDayHigh).toBeNull();
    expect(features.volumeActivity).toBe("UNAVAILABLE");
    expect(features.volumeSpike).toBe("UNKNOWN");
  });
});

describe("filters", () => {
  const config = getScannerConfig({ minVolume: 1000, minPrice: 20, maxPrice: 1000, minVolatilityPercent: 0.1 });

  it("rejects missing, stale, and out-of-bounds prices", () => {
    expect(
      applyScannerFilters({
        observation: observation({ missing: true, lastPrice: null }),
        features: calculateFeatures(observation({ missing: true, lastPrice: null }), config),
        config,
        isActive: true
      }).ok
    ).toBe(false);

    expect(
      applyScannerFilters({
        observation: observation({ stale: true }),
        features: calculateFeatures(observation(), config),
        config,
        isActive: true
      }).ok
    ).toBe(false);

    expect(
      applyScannerFilters({
        observation: observation({ lastPrice: 5 }),
        features: calculateFeatures(observation({ lastPrice: 5 }), config),
        config,
        isActive: true
      }).ok
    ).toBe(false);
  });

  it("rejects illiquid absolute volume when volume is present", () => {
    const result = applyScannerFilters({
      observation: observation({ volume: 10 }),
      features: calculateFeatures(observation({ volume: 10 }), config),
      config,
      isActive: true
    });
    expect(result).toMatchObject({ ok: false, reason: "LIQUIDITY" });
  });
});

describe("scoring and direction", () => {
  const config = getScannerConfig();

  it("produces bullish candidates with supported reasons", () => {
    const features = calculateFeatures(
      observation({ lastPrice: 105, open: 100, high: 105, low: 99, close: 101, volume: 80000 }),
      config
    );
    const scored = scoreCandidate(features, config);
    expect(scored.direction).toBe("BULLISH");
    expect(scored.score).toBeGreaterThan(40);
    expect(scored.reasons).toEqual(
      expect.arrayContaining(["positive intraday momentum", "near day high", "breaking day high"])
    );
    for (const reason of scored.reasons) {
      if (reason === "positive intraday momentum") {
        expect(features.momentumBias).toBe("UP");
      }
      if (reason === "near day high") {
        expect(features.nearDayHigh).toBe(true);
      }
      if (reason === "breaking day high") {
        expect(features.breakingDayHigh).toBe(true);
      }
      if (reason === "elevated volume activity") {
        expect(features.volumeActivity).toBe("AVAILABLE");
      }
      if (reason === "range expansion") {
        expect(features.intradayRangePercent).not.toBeNull();
      }
    }
    const sum =
      scored.scoreComponents.volumeActivity +
      scored.scoreComponents.momentum +
      scored.scoreComponents.rangeExpansion +
      scored.scoreComponents.dayExtremumProximity +
      scored.scoreComponents.priceMovement;
    expect(scored.score).toBe(sum);
  });

  it("produces bearish candidates near day low", () => {
    const features = calculateFeatures(
      observation({ lastPrice: 99.1, open: 104, high: 104.5, low: 99, close: 103, volume: 70000 }),
      config
    );
    const scored = scoreCandidate(features, config);
    expect(scored.direction).toBe("BEARISH");
    expect(scored.reasons).toEqual(expect.arrayContaining(["negative intraday momentum", "near day low"]));
  });

  it("returns NEUTRAL on conflicting signals", () => {
    const features = calculateFeatures(
      observation({ lastPrice: 102, open: 100, high: 105, low: 99, close: 100, volume: 50000 }),
      config
    );
    features.momentumBias = "FLAT";
    features.nearDayHigh = true;
    features.breakingDayHigh = false;
    features.nearDayLow = true;
    features.breakingDayLow = false;
    features.changeFromPreviousClosePercent = 0;
    const scored = scoreCandidate(features, config);
    expect(scored.direction).toBe("NEUTRAL");
  });
});

describe("production scanner service", () => {
  afterEach(() => {
    resetProductionScannerServiceForTests();
    resetRepositoriesForTests();
    vi.useRealTimers();
  });

  it("ranks candidates from latest market state without overlapping runs", async () => {
    const repos = await seedUniverse();
    const store = new LatestMarketStateStore(60_000);
    const now = new Date("2026-09-15T05:00:00.000Z");
    const receivedAt = now.toISOString();

    store.set(
      tick({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        lastPrice: 105,
        open: 100,
        high: 105,
        low: 99,
        close: 101,
        volume: 90000,
        receivedAt
      })
    );
    store.set(
      tick({
        instrumentToken: "408065",
        tradingSymbol: "INFY",
        lastPrice: 99.2,
        open: 104,
        high: 104.5,
        low: 99,
        close: 103,
        volume: 85000,
        receivedAt
      })
    );
    store.set(
      tick({
        instrumentToken: "2953217",
        tradingSymbol: "TCS",
        lastPrice: 100.1,
        open: 100,
        high: 100.2,
        low: 99.9,
        close: 100,
        volume: 50,
        receivedAt
      })
    );

    const scanner = new ProductionScannerService({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      now: () => now,
      ignoreMarketSession: true,
      persist: true,
      config: { minScore: 30, minVolume: 1000, maxCandidates: 10 }
    });
    resetProductionScannerServiceForTests(scanner);

    const first = scanner.runOnce({ force: true });
    await expect(scanner.runOnce({ force: true })).rejects.toMatchObject({ code: "SCANNER_BUSY" });
    const result = await first;

    expect(result.status).toBe("COMPLETE");
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates[0]?.score).toBeGreaterThanOrEqual(result.candidates.at(-1)?.score ?? 0);
    const symbols = result.candidates.map((item) => item.tradingSymbol);
    expect(symbols).toContain("RELIANCE");
    expect(symbols).toContain("INFY");

    const persisted = await repos.scannerSignals.listByUser(MEMORY_DEMO_USER_ID);
    expect(persisted.length).toBe(result.candidates.length);

    const second = await scanner.runOnce({ force: true });
    const after = await repos.scannerSignals.listByUser(MEMORY_DEMO_USER_ID);
    expect(after.length).toBe(persisted.length + second.candidates.length);
    expect(second.runId).not.toBe(result.runId);
  });

  it("excludes stale and missing market data from candidates", async () => {
    const repos = await seedUniverse();
    const store = new LatestMarketStateStore(60_000);
    const now = new Date("2026-09-15T05:00:00.000Z");
    store.set(
      tick({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        lastPrice: 105,
        open: 100,
        high: 105,
        low: 99,
        volume: 90000,
        receivedAt: new Date(now.getTime() - 120_000).toISOString()
      })
    );

    const scanner = new ProductionScannerService({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      now: () => now,
      ignoreMarketSession: true,
      persist: false,
      config: { maxDataAgeMs: 30_000, minScore: 10 }
    });

    const result = await scanner.runOnce({ force: true });
    expect(result.stats.skippedStale).toBeGreaterThan(0);
    expect(result.candidates.find((item) => item.tradingSymbol === "RELIANCE")).toBeUndefined();
    expect(result.stats.skippedMissingData).toBeGreaterThan(0);
  });

  it("skips closed sessions unless forced", async () => {
    const repos = await seedUniverse();
    const store = new LatestMarketStateStore(60_000);
    const closed = new Date("2026-09-12T05:00:00.000Z");
    const scanner = new ProductionScannerService({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      now: () => closed,
      ignoreMarketSession: false,
      persist: false
    });

    const skipped = await scanner.runOnce();
    expect(skipped.status).toBe("SKIPPED_MARKET_CLOSED");
  });

  it("scheduler is single-flight and stop cancels the timer", async () => {
    vi.useFakeTimers();
    const repos = await seedUniverse();
    const store = new LatestMarketStateStore(60_000);
    const now = new Date("2026-09-15T05:00:00.000Z");
    store.set(
      tick({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        lastPrice: 105,
        open: 100,
        high: 105,
        low: 99,
        volume: 90000,
        receivedAt: now.toISOString()
      })
    );

    let runs = 0;
    const scanner = new ProductionScannerService({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      now: () => now,
      ignoreMarketSession: true,
      persist: false,
      config: { intervalMs: 1000, minScore: 10, minVolume: 1 }
    });
    const original = scanner.runOnce.bind(scanner);
    vi.spyOn(scanner, "runOnce").mockImplementation(async (...args) => {
      runs += 1;
      return original(...args);
    });

    scanner.startScheduler();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(runs).toBeGreaterThanOrEqual(1);
    scanner.stopScheduler();
    const afterStop = runs;
    await vi.advanceTimersByTimeAsync(5000);
    expect(runs).toBe(afterStop);
    expect(scanner.getStatus().schedulerRunning).toBe(false);
  });

  it("does not place orders or mutate paper/account state", async () => {
    const repos = await seedUniverse();
    const store = new LatestMarketStateStore(60_000);
    const now = new Date("2026-09-15T05:00:00.000Z");
    store.set(
      tick({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        lastPrice: 105,
        open: 100,
        high: 105,
        low: 99,
        volume: 90000,
        receivedAt: now.toISOString()
      })
    );

    const scanner = new ProductionScannerService({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      now: () => now,
      ignoreMarketSession: true,
      persist: true,
      config: { minScore: 10, minVolume: 1 }
    });
    await scanner.runOnce({ force: true });

    expect(await repos.trades.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.orders.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.positions.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.paperAccounts.findByUser(MEMORY_DEMO_USER_ID, "PAPER")).toBeNull();
    expect(await repos.brokerAccountSnapshots.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    await expect(kiteBrokerAdapter.placeOrder({} as never)).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(kiteBrokerAdapter.modifyOrder("1", {})).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(kiteBrokerAdapter.cancelOrder("1")).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    expect(getTradingDate(now)).toBe("2026-09-15");
  });
});
