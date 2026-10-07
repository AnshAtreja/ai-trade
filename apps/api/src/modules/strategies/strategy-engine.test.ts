import { beforeEach, describe, expect, it } from "vitest";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { resetRepositoriesForTests } from "../../db/persistence";
import { LatestMarketStateStore } from "../market-data/stream/latest-state-store";
import { getStrategyConfig } from "./config";
import {
  StrategyEngineService,
  buildStrategyContext,
  makeTick,
  resetStrategyEngineServiceForTests
} from "./engine-service";
import { BreakoutStrategy } from "./impl/breakout-strategy";
import { BreakdownStrategy } from "./impl/breakdown-strategy";
import { MomentumStrategy } from "./impl/momentum-strategy";
import { OpeningMomentumStrategy } from "./impl/opening-momentum-strategy";
import { StrategyMarketContextFeed, resetStrategyMarketContextFeedForTests } from "./market-context-feed";
import { StrategyRegistry } from "./registry";
import { TickHistoryBuffer } from "./tick-history";
import type { MarketCandle } from "./candle-aggregator";

const REGULAR_MS = Date.parse("2026-09-15T05:00:00.000Z"); // ~10:30 IST Monday
const OPENING_MS = Date.parse("2026-09-15T03:40:00.000Z"); // ~09:10 IST
const CLOSED_MS = Date.parse("2026-09-15T12:00:00.000Z"); // ~17:30 IST

function candle(partial: Partial<MarketCandle> & { open: number; high: number; low: number; close: number; startTime: string }): MarketCandle {
  return {
    instrumentToken: "2885",
    interval: "1m",
    volume: 1000,
    endTime: partial.endTime ?? partial.startTime,
    tickCount: 3,
    ...partial
  };
}

describe("StrategyRegistry", () => {
  it("lists versioned strategies and respects enable/disable", () => {
    const config = getStrategyConfig({ enabledStrategies: ["breakout", "momentum"] });
    const registry = StrategyRegistry.createDefault(config);
    expect(registry.list().map((s) => `${s.id}:v${s.version}`).sort()).toEqual([
      "breakdown:v1",
      "breakout:v1",
      "momentum:v1",
      "opening-momentum:v1"
    ]);
    expect(registry.enabledStrategies().map((s) => s.id).sort()).toEqual(["breakout", "momentum"]);
  });
});

describe("TickHistoryBuffer", () => {
  it("bounds history and skips duplicates / out-of-order", () => {
    const buf = new TickHistoryBuffer(3);
    buf.push(makeTick({ instrumentToken: "1", lastPrice: 1, receivedAt: "2026-09-15T01:00:00.000Z", orderKey: "a" }));
    buf.push(makeTick({ instrumentToken: "1", lastPrice: 1, receivedAt: "2026-09-15T01:00:00.000Z", orderKey: "a" }));
    buf.push(makeTick({ instrumentToken: "1", lastPrice: 2, receivedAt: "2026-09-15T01:00:01.000Z", orderKey: "b" }));
    buf.push(makeTick({ instrumentToken: "1", lastPrice: 0.5, receivedAt: "2026-09-15T00:59:00.000Z", orderKey: "z" }));
    buf.push(makeTick({ instrumentToken: "1", lastPrice: 3, receivedAt: "2026-09-15T01:00:02.000Z", orderKey: "c" }));
    buf.push(makeTick({ instrumentToken: "1", lastPrice: 4, receivedAt: "2026-09-15T01:00:03.000Z", orderKey: "d" }));
    expect(buf.get("1").map((t) => t.lastPrice)).toEqual([2, 3, 4]);
  });
});

describe("BreakoutStrategy", () => {
  const strategy = new BreakoutStrategy(getStrategyConfig());
  const now = new Date(REGULAR_MS);

  it("detects confirmed breakout", () => {
    const prior = [
      makeTick({ instrumentToken: "2885", lastPrice: 100, high: 100, receivedAt: "2026-09-15T04:59:50.000Z", orderKey: "1", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 100.1, high: 100.1, receivedAt: "2026-09-15T04:59:51.000Z", orderKey: "2", volume: 5000 })
    ];
    const confirm = [
      makeTick({ instrumentToken: "2885", lastPrice: 100.5, high: 100.5, receivedAt: "2026-09-15T04:59:58.000Z", orderKey: "3", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 100.8, high: 100.8, receivedAt: "2026-09-15T04:59:59.000Z", orderKey: "4", volume: 5000 })
    ];
    const latest = confirm[1]!;
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: latest,
        recentTicks: [...prior, ...confirm],
        marketSession: "REGULAR",
        currentTime: now,
        dataAgeMs: 100,
        stale: false
      })
    );
    expect(result.status).toBe("SETUP_DETECTED");
    expect(result.direction).toBe("BULLISH");
    expect(result.entry).not.toBeNull();
    expect(result.stopLoss).not.toBeNull();
    expect(result.target).not.toBeNull();
    expect(result.rewardRisk).toBeGreaterThanOrEqual(1.5);
    expect(result.conditions.find((c) => c.name === "breakout_level")?.passed).toBe(true);
    expect(result.reasons.length).toBeGreaterThan(0);
    expect(result.invalidation?.rules.length).toBeGreaterThan(0);
  });

  it("does not treat near-high as breakout", () => {
    const ticks = [
      makeTick({ instrumentToken: "2885", lastPrice: 99.7, high: 100, receivedAt: "2026-09-15T04:59:50.000Z", orderKey: "1", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 99.8, high: 100, receivedAt: "2026-09-15T04:59:51.000Z", orderKey: "2", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 99.85, high: 100, receivedAt: "2026-09-15T04:59:52.000Z", orderKey: "3", volume: 5000 })
    ];
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: ticks[2]!,
        recentTicks: ticks,
        marketSession: "REGULAR",
        currentTime: now,
        dataAgeMs: 50,
        stale: false
      })
    );
    expect(result.status).toBe("NO_SETUP");
    expect(result.conditions.find((c) => c.name === "breakout_level")?.detail).toMatch(/NEAR_HIGH|NONE|BREAKING/);
  });

  it("rejects stale data", () => {
    const tick = makeTick({ instrumentToken: "2885", lastPrice: 101, high: 100, receivedAt: now.toISOString(), volume: 5000 });
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: tick,
        recentTicks: [tick, tick, tick],
        marketSession: "REGULAR",
        currentTime: now,
        dataAgeMs: 120_000,
        stale: true
      })
    );
    expect(result.status).toBe("SETUP_INVALID");
  });

  it("is deterministic for identical context", () => {
    const prior = [
      makeTick({ instrumentToken: "2885", lastPrice: 100, high: 100, receivedAt: "2026-09-15T04:59:50.000Z", orderKey: "1", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 100.2, high: 100.2, receivedAt: "2026-09-15T04:59:51.000Z", orderKey: "2", volume: 5000 })
    ];
    const confirm = [
      makeTick({ instrumentToken: "2885", lastPrice: 100.6, high: 100.6, receivedAt: "2026-09-15T04:59:58.000Z", orderKey: "3", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 100.9, high: 100.9, receivedAt: "2026-09-15T04:59:59.000Z", orderKey: "4", volume: 5000 })
    ];
    const ctx = buildStrategyContext({
      instrumentToken: "2885",
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      latestTick: confirm[1]!,
      recentTicks: [...prior, ...confirm],
      marketSession: "REGULAR",
      currentTime: now,
      dataAgeMs: 10,
      stale: false
    });
    expect(strategy.evaluate(ctx)).toEqual(strategy.evaluate(ctx));
  });
});

describe("BreakdownStrategy", () => {
  it("detects confirmed breakdown", () => {
    const strategy = new BreakdownStrategy(getStrategyConfig());
    const now = new Date(REGULAR_MS);
    const prior = [
      makeTick({ instrumentToken: "2885", lastPrice: 100, low: 100, receivedAt: "2026-09-15T04:59:50.000Z", orderKey: "1", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 99.9, low: 99.9, receivedAt: "2026-09-15T04:59:51.000Z", orderKey: "2", volume: 5000 })
    ];
    const confirm = [
      makeTick({ instrumentToken: "2885", lastPrice: 99.5, low: 99.5, receivedAt: "2026-09-15T04:59:58.000Z", orderKey: "3", volume: 5000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 99.2, low: 99.2, receivedAt: "2026-09-15T04:59:59.000Z", orderKey: "4", volume: 5000 })
    ];
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: confirm[1]!,
        recentTicks: [...prior, ...confirm],
        marketSession: "REGULAR",
        currentTime: now,
        dataAgeMs: 20,
        stale: false
      })
    );
    expect(result.status).toBe("SETUP_DETECTED");
    expect(result.direction).toBe("BEARISH");
    expect(result.stopLoss!).toBeGreaterThan(result.entry!.price);
  });
});

describe("MomentumStrategy", () => {
  it("detects sustained bullish continuation", () => {
    const strategy = new MomentumStrategy(getStrategyConfig());
    const candles = [
      candle({ open: 100, high: 100.2, low: 99.8, close: 100.1, startTime: "2026-09-15T04:55:00.000Z" }),
      candle({ open: 100.1, high: 100.5, low: 100, close: 100.4, startTime: "2026-09-15T04:56:00.000Z" }),
      candle({ open: 100.4, high: 100.9, low: 100.3, close: 100.8, startTime: "2026-09-15T04:57:00.000Z" })
    ];
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: makeTick({
          instrumentToken: "2885",
          lastPrice: 100.8,
          open: 100,
          volume: 5000,
          receivedAt: new Date(REGULAR_MS).toISOString()
        }),
        candles1m: candles,
        marketSession: "REGULAR",
        currentTime: new Date(REGULAR_MS),
        dataAgeMs: 10,
        stale: false
      })
    );
    expect(result.status).toBe("SETUP_DETECTED");
    expect(result.direction).toBe("BULLISH");
  });

  it("returns DATA_UNAVAILABLE without candle history", () => {
    const strategy = new MomentumStrategy(getStrategyConfig());
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: makeTick({ instrumentToken: "2885", lastPrice: 100, volume: 5000, receivedAt: new Date(REGULAR_MS).toISOString() }),
        candles1m: [],
        marketSession: "REGULAR",
        currentTime: new Date(REGULAR_MS),
        dataAgeMs: 10,
        stale: false
      })
    );
    expect(result.status).toBe("DATA_UNAVAILABLE");
  });
});

describe("OpeningMomentumStrategy", () => {
  it("returns DATA_UNAVAILABLE before opening range is established", () => {
    const strategy = new OpeningMomentumStrategy(getStrategyConfig());
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: makeTick({ instrumentToken: "2885", lastPrice: 100, receivedAt: new Date(OPENING_MS).toISOString() }),
        candles1m: [candle({ open: 100, high: 101, low: 99, close: 100.5, startTime: "2026-09-15T03:45:00.000Z" })],
        marketSession: "OPENING",
        currentTime: new Date(OPENING_MS),
        dataAgeMs: 10,
        stale: false
      })
    );
    expect(result.status).toBe("DATA_UNAVAILABLE");
  });

  it("rejects outside session", () => {
    const strategy = new OpeningMomentumStrategy(getStrategyConfig());
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: makeTick({ instrumentToken: "2885", lastPrice: 100, receivedAt: new Date(CLOSED_MS).toISOString() }),
        marketSession: "CLOSED",
        currentTime: new Date(CLOSED_MS),
        dataAgeMs: 10,
        stale: false
      })
    );
    expect(result.status).toBe("NO_SETUP");
  });

  it("detects opening range breakout", () => {
    const strategy = new OpeningMomentumStrategy(getStrategyConfig());
    const or = Array.from({ length: 15 }, (_, i) =>
      candle({
        open: 100,
        high: 100.5,
        low: 99.5,
        close: 100.2,
        startTime: new Date(Date.parse("2026-09-15T03:45:00.000Z") + i * 60_000).toISOString()
      })
    );
    const now = new Date("2026-09-15T04:05:00.000Z"); // ~09:35 IST REGULAR early
    const ticks = [
      makeTick({ instrumentToken: "2885", lastPrice: 100.4, receivedAt: "2026-09-15T04:04:50.000Z", orderKey: "a", volume: 2000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 100.7, receivedAt: "2026-09-15T04:04:55.000Z", orderKey: "b", volume: 2000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 101.0, receivedAt: "2026-09-15T04:04:58.000Z", orderKey: "c", volume: 2000 }),
      makeTick({ instrumentToken: "2885", lastPrice: 101.2, receivedAt: "2026-09-15T04:04:59.000Z", orderKey: "d", volume: 2000 })
    ];
    const result = strategy.evaluate(
      buildStrategyContext({
        instrumentToken: "2885",
        tradingSymbol: "RELIANCE",
        exchange: "NSE",
        latestTick: ticks[3]!,
        recentTicks: ticks,
        candles1m: or,
        marketSession: "REGULAR",
        currentTime: now,
        dataAgeMs: 5,
        stale: false
      })
    );
    expect(result.status).toBe("SETUP_DETECTED");
    expect(result.direction).toBe("BULLISH");
  });
});

describe("StrategyEngineService persistence and separation", () => {
  beforeEach(() => {
    resetRepositoriesForTests(createMemoryRepositories());
    resetStrategyMarketContextFeedForTests(new StrategyMarketContextFeed(50));
    resetStrategyEngineServiceForTests();
  });

  it("persists SETUP_DETECTED only and does not create orders/trades/positions", async () => {
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    const store = new LatestMarketStateStore();
    const feed = new StrategyMarketContextFeed(50);
    feed.attach((handler) => store.onAppliedTick(handler));

    const priorHigh = 100;
    const ticks = [
      makeTick({ instrumentToken: "2885", tradingSymbol: "RELIANCE", lastPrice: priorHigh, high: priorHigh, receivedAt: "2026-09-15T04:59:50.000Z", orderKey: "1", volume: 5000 }),
      makeTick({ instrumentToken: "2885", tradingSymbol: "RELIANCE", lastPrice: 100.1, high: 100.1, receivedAt: "2026-09-15T04:59:51.000Z", orderKey: "2", volume: 5000 }),
      makeTick({ instrumentToken: "2885", tradingSymbol: "RELIANCE", lastPrice: 100.6, high: 100.6, receivedAt: "2026-09-15T04:59:58.000Z", orderKey: "3", volume: 5000 }),
      makeTick({ instrumentToken: "2885", tradingSymbol: "RELIANCE", lastPrice: 100.9, high: 100.9, receivedAt: "2026-09-15T04:59:59.000Z", orderKey: "4", volume: 5000 })
    ];
    for (const t of ticks) {
      store.set(t);
    }

    const engine = new StrategyEngineService({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      getFeed: () => feed,
      getCandidates: () => [
        {
          instrumentToken: "2885",
          tradingSymbol: "RELIANCE",
          exchange: "NSE",
          instrumentId: null,
          direction: "BULLISH",
          score: 70,
          scoreComponents: {
            volumeActivity: 20,
            momentum: 20,
            rangeExpansion: 10,
            dayExtremumProximity: 10,
            priceMovement: 10
          },
          lastPrice: 100.9,
          dataTimestamp: ticks[3]!.receivedAt,
          dataAgeMs: 10,
          stale: false,
          features: {
            changeFromOpenPercent: 1,
            changeFromPreviousClosePercent: 1,
            intradayRangePercent: 1,
            distanceFromDayHighPercent: 0,
            distanceFromDayLowPercent: 1,
            nearDayHigh: true,
            nearDayLow: false,
            breakingDayHigh: true,
            breakingDayLow: false,
            volume: 5000,
            volumeActivity: "AVAILABLE",
            volumeSpike: "UNKNOWN",
            volumeSpikeRatio: null,
            volatilityPercent: 1,
            momentumBias: "UP"
          },
          reasons: ["scanner candidate"],
          marketRegime: "TRENDING_BULL",
          source: "SCANNER"
        }
      ],
      now: () => new Date(REGULAR_MS),
      ignoreMarketSession: true,
      config: { enabledStrategies: ["breakout"] }
    });

    const result = await engine.evaluate({ strategyIds: ["breakout"], force: true });
    expect(result.setupCount).toBeGreaterThanOrEqual(1);
    expect(result.persisted?.count).toBeGreaterThanOrEqual(1);

    const listed = await engine.listSignals({ strategyId: "breakout" });
    expect(listed.setups.length).toBeGreaterThanOrEqual(1);

    // Re-persist same identity must not duplicate
    await engine.evaluate({ strategyIds: ["breakout"], force: true });
    const again = await engine.listSignals({ strategyId: "breakout" });
    expect(again.setups.length).toBe(listed.setups.length);

    expect(await repos.orders.listByUser((await repos.users.upsertByEmail({ email: "demo@tradepilot.local", name: "x" })).id)).toEqual([]);
    expect(await repos.trades.listByUser((await repos.users.upsertByEmail({ email: "demo@tradepilot.local", name: "x" })).id)).toEqual([]);
    expect(await repos.positions.listByUser((await repos.users.upsertByEmail({ email: "demo@tradepilot.local", name: "x" })).id)).toEqual([]);
  });

  it("does not persist NO_SETUP results", async () => {
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    const engine = new StrategyEngineService({
      resolveRepos: () => repos,
      getLatestStore: () => new LatestMarketStateStore(),
      getFeed: () => new StrategyMarketContextFeed(10),
      getCandidates: () => [],
      now: () => new Date(REGULAR_MS),
      ignoreMarketSession: true
    });

    const breakout = new BreakoutStrategy(getStrategyConfig());
    const noSetup = breakout.evaluate(
      buildStrategyContext({
        instrumentToken: "1",
        tradingSymbol: "X",
        exchange: "NSE",
        latestTick: makeTick({ instrumentToken: "1", lastPrice: 50, high: 60, receivedAt: new Date(REGULAR_MS).toISOString() }),
        recentTicks: [],
        marketSession: "REGULAR",
        currentTime: new Date(REGULAR_MS),
        dataAgeMs: 10,
        stale: false
      })
    );
    expect(noSetup.status).not.toBe("SETUP_DETECTED");

    const result = await engine.evaluate({
      force: true,
      strategyIds: ["breakout"],
      contexts: [
        buildStrategyContext({
          instrumentToken: "1",
          tradingSymbol: "X",
          exchange: "NSE",
          latestTick: makeTick({ instrumentToken: "1", lastPrice: 50, high: 60, receivedAt: new Date(REGULAR_MS).toISOString() }),
          recentTicks: [],
          marketSession: "REGULAR",
          currentTime: new Date(REGULAR_MS),
          dataAgeMs: 10,
          stale: false
        })
      ]
    });
    expect(result.setupCount).toBe(0);
    expect(result.persisted).toBeNull();
    const listed = await engine.listSignals();
    expect(listed.setups.length).toBe(0);
  });
});
