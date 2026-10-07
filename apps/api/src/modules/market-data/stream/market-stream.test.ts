import { afterEach, describe, expect, it, vi } from "vitest";
import { MEMORY_DEMO_USER_ID } from "../../../db/domain";
import { resetRepositoriesForTests } from "../../../db/persistence";
import { createMemoryRepositories } from "../../../db/repositories/memory-repositories";
import { kiteBrokerAdapter } from "../../broker/adapters/kite-broker-adapter";
import { LIVE_TRADING_DISABLED_MESSAGE } from "../../broker/adapters/live-trading-disabled";
import { createMarketInstrumentService } from "../instrument-service";
import { MockInstrumentProvider } from "../mock-instrument-provider";
import { MockMarketDataProvider } from "../mock-market-data-provider";
import { ConnectionManager } from "./connection-manager";
import { MarketTickEventBus } from "./event-bus";
import {
  encodeFullPacket,
  encodeKiteBinaryFrame,
  encodeLtpPacket,
  encodeQuotePacket,
  parseKiteBinaryFrame
} from "./kite-binary-parser";
import { LatestMarketStateStore } from "./latest-state-store";
import { MockMarketStreamProvider } from "./mock-stream-provider";
import { MarketStreamService, resetMarketStreamServiceForTests } from "./service";
import { SubscriptionManager } from "./subscription-manager";
import type { MarketTick } from "./types";

async function seedInstruments() {
  const repos = createMemoryRepositories();
  resetRepositoriesForTests(repos);
  await createMarketInstrumentService({
    repos: () => repos,
    instrumentProvider: new MockInstrumentProvider(),
    quotes: new MockMarketDataProvider()
  }).syncInstruments();
  return repos;
}

async function setup(options?: { reconnectBaseMs?: number }) {
  const repos = await seedInstruments();
  const provider = new MockMarketStreamProvider(0);
  const service = new MarketStreamService({
    provider,
    autoTickMs: 0,
    reconnectBaseMs: options?.reconnectBaseMs ?? 10,
    reconnectMaxMs: 50
  });
  resetMarketStreamServiceForTests(service);
  return { service, provider, repos };
}

describe("kite binary parser", () => {
  it("parses LTP, QUOTE, and FULL packets including multi-packet frames", () => {
    const frame = encodeKiteBinaryFrame([
      encodeLtpPacket(2885, 12345),
      encodeQuotePacket({
        instrumentToken: 408065,
        lastPricePaise: 150000,
        volume: 10,
        openPaise: 149000,
        highPaise: 151000,
        lowPaise: 148000,
        closePaise: 149500,
        averagePricePaise: 149800,
        buyQuantity: 100,
        sellQuantity: 90
      }),
      encodeFullPacket({
        instrumentToken: 2953217,
        lastPricePaise: 400000,
        volume: 5,
        exchangeTimestampSeconds: 1_700_000_000
      })
    ]);

    const parsed = parseKiteBinaryFrame(frame);
    expect(parsed.errors).toHaveLength(0);
    expect(parsed.ticks[0]).toMatchObject({ instrumentToken: "2885", lastPrice: 123.45, mode: "LTP", volume: null });
    expect(parsed.ticks[1]).toMatchObject({ instrumentToken: "408065", mode: "QUOTE", volume: 10, open: 1490 });
    expect(parsed.ticks[2]).toMatchObject({ mode: "FULL", exchangeTimestampMs: 1_700_000_000_000 });
  });

  it("rejects truncated and malformed packets without throwing", () => {
    const truncated = Buffer.from([0, 1, 0, 20, 1, 2]);
    const malformed = encodeKiteBinaryFrame([Buffer.from([1, 2, 3])]);
    expect(parseKiteBinaryFrame(truncated).errors[0]?.code).toBe("TRUNCATED_PACKET");
    expect(parseKiteBinaryFrame(malformed).errors[0]?.code).toBe("MALFORMED_PACKET");
    expect(() => parseKiteBinaryFrame(truncated)).not.toThrow();
  });
});

describe("subscription manager", () => {
  it("is idempotent and diffs desired vs actual", () => {
    const manager = new SubscriptionManager();
    manager.subscribe(["2885", "2885", "408065"], "LTP");
    manager.subscribe(["2885"], "LTP");
    expect(manager.size()).toBe(2);
    const first = manager.diff();
    expect(first.subscribe).toHaveLength(2);
    manager.markActual(["2885", "408065"], "LTP");
    expect(manager.diff()).toEqual({ subscribe: [], unsubscribe: [], setMode: [] });
    manager.unsubscribe(["2885"]);
    manager.unsubscribe(["2885"]);
    expect(manager.diff().unsubscribe).toEqual(["2885"]);
  });
});

describe("latest state store", () => {
  it("updates latest, ignores out-of-order, detects duplicates and staleness", () => {
    const store = new LatestMarketStateStore(1000);
    const base: MarketTick = {
      instrumentToken: "2885",
      exchange: "NSE",
      tradingSymbol: "RELIANCE",
      instrumentId: "1",
      timestamp: "2026-09-10T12:00:02.000Z",
      receivedAt: "2026-09-10T12:00:02.000Z",
      lastPrice: 100,
      volume: 1,
      lastTradedQuantity: null,
      open: null,
      high: null,
      low: null,
      close: null,
      averagePrice: null,
      buyQuantity: null,
      sellQuantity: null,
      exchangeTimestamp: "2026-09-10T12:00:02.000Z",
      mode: "FULL",
      source: "MOCK",
      orderKey: "2885|2026-09-10T12:00:02.000Z|100|1|FULL"
    };

    expect(store.set(base)).toBe("applied");
    expect(store.set({ ...base, lastPrice: 101, timestamp: "2026-09-10T12:00:01.000Z", exchangeTimestamp: "2026-09-10T12:00:01.000Z", orderKey: "2885|2026-09-10T12:00:01.000Z|101|1|FULL" })).toBe("out_of_order");
    expect(store.getLatest("2885")?.lastPrice).toBe(100);
    expect(store.set(base)).toBe("duplicate");
    expect(store.isStale("2885", Date.parse("2026-09-10T12:00:04.000Z"))).toBe(true);
    expect(store.getLatest("2885")?.lastPrice).not.toBe(0);
  });
});

describe("market stream connection and pipeline", () => {
  let active: MarketStreamService | undefined;

  afterEach(async () => {
    await active?.stop().catch(() => undefined);
    active = undefined;
    resetMarketStreamServiceForTests();
    resetRepositoriesForTests();
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it("connects, disconnects, and treats duplicate start as safe", async () => {
    const { service } = await setup();
    active = service;
    const first = await service.start();
    const second = await service.start();
    expect(first.state).toBe("CONNECTED");
    expect(second.state).toBe("CONNECTED");
    const stopped = await service.stop();
    expect(stopped.state).toBe("STOPPED");
  });

  it("clears actual subscriptions on manual stop while retaining desired subscriptions for restart", async () => {
    const { service, provider } = await setup();
    active = service;
    await service.start();
    await service.subscribe(["2885"]);
    expect(service.subscriptions.getActual()).toHaveLength(1);

    await service.stop();
    expect(service.subscriptions.getActual()).toEqual([]);
    expect(service.listSubscriptions().map((item) => item.instrumentToken)).toEqual(["2885"]);

    await service.start();
    expect(provider.subscribed.has("2885")).toBe(true);
    await vi.waitFor(() => expect(service.subscriptions.getActual()).toHaveLength(1));
  });

  it("does not report receiving after the stream is stopped", async () => {
    const { service, provider } = await setup();
    active = service;
    await service.start();
    await service.subscribe(["2885"]);
    provider.emitLtp("2885", 101.25);
    await vi.waitFor(() => expect(service.getStatus().receiving).toBe(true));

    await service.stop();

    expect(service.getStatus()).toMatchObject({ state: "STOPPED", connected: false, receiving: false });
  });

  it("uses exponential backoff and cancels reconnect on stop", async () => {
    vi.useFakeTimers();
    const provider = new MockMarketStreamProvider(0);
    provider.alwaysFailConnect = true;
    const connection = new ConnectionManager(provider, () => undefined, 1000, 30000);

    await connection.start();
    expect(connection.state).toBe("RECONNECTING");
    expect(connection.reconnectCount).toBe(1);
    expect(connection.delayForAttempt(0)).toBe(1000);
    expect(connection.delayForAttempt(1)).toBe(2000);
    expect(connection.delayForAttempt(2)).toBe(4000);
    expect(connection.delayForAttempt(5)).toBe(30000);

    await vi.advanceTimersByTimeAsync(1000);
    await Promise.resolve();
    expect(connection.reconnectCount).toBe(2);

    await vi.advanceTimersByTimeAsync(2000);
    await Promise.resolve();
    expect(connection.reconnectCount).toBe(3);

    await connection.stop();
    const reconnectsAfterStop = connection.reconnectCount;
    await vi.advanceTimersByTimeAsync(60000);
    await Promise.resolve();
    expect(connection.reconnectCount).toBe(reconnectsAfterStop);
    expect(connection.isRunning()).toBe(false);
    expect(connection.state).toBe("STOPPED");
  });

  it("subscribes idempotently, unsubscribes, and restores after reconnect", async () => {
    const { service, provider } = await setup({ reconnectBaseMs: 20 });
    active = service;
    await service.start();
    await service.subscribe(["2885", "408065"]);
    await service.subscribe(["2885", "408065"]);
    expect(provider.subscribed.size).toBe(2);
    await service.unsubscribe(["408065"]);
    expect(provider.subscribed.has("408065")).toBe(false);
    expect(service.listSubscriptions().map((item) => item.instrumentToken)).toEqual(["2885"]);

    provider.simulateDisconnect("network drop");
    await vi.waitFor(() => {
      expect(provider.connectCalls).toBeGreaterThan(1);
      expect(service.getStatus().state).toBe("CONNECTED");
    });
    expect(provider.subscribed.has("2885")).toBe(true);
    expect(provider.subscribed.has("408065")).toBe(false);
  });

  it("resolves a canonical token omitted from the bounded startup index before subscribing", async () => {
    const { service, provider, repos } = await setup();
    active = service;
    await service.start();
    expect(service.index.get("256265")).toBeNull();
    await repos.instruments.upsertByExchangeSymbol({ symbol: "NIFTY 50", name: "NIFTY 50", exchange: "NSE",
      segment: "INDICES", instrumentType: "EQ", instrumentToken: "256265", exchangeToken: "1001", expiry: null,
      strike: null, tickSize: 0, lotSize: 1, isActive: true });
    await service.subscribe(["256265"], "QUOTE");
    expect(provider.subscribed.has("256265")).toBe(true);
    expect(service.index.get("256265")?.symbol).toBe("NIFTY 50");
  });

  it("normalizes ticks, skips unknown tokens, and does not block on consumers", async () => {
    const { service, provider } = await setup();
    active = service;
    await service.start();
    await service.subscribe(["2885"]);
    service.bus.onTick(() => {
      throw new Error("consumer boom");
    });

    const started = Date.now();
    provider.emitLtp("2885", 1400.5);
    provider.emitLtp("999999", 1);
    expect(Date.now() - started).toBeLessThan(40);
    expect(service.store.getLatest("2885")?.lastPrice).toBe(1400.5);
    expect(service.store.getLatest("2885")?.volume).toBeNull();
    expect(service.store.has("999999")).toBe(false);

    provider.emitFrame(
      encodeKiteBinaryFrame([
        encodeQuotePacket({ instrumentToken: 2885, lastPricePaise: 140100, volume: 20, openPaise: 139000 })
      ])
    );
    expect(service.store.getLatest("2885")?.open).toBe(1390);
    expect(service.getStatus().connected).toBe(true);
  });

  it("does not write postgres per tick and survives persistence errors", async () => {
    const repos = await seedInstruments();
    const create = vi.spyOn(repos.marketSnapshots, "create");
    const provider = new MockMarketStreamProvider(0);
    const service = new MarketStreamService({ provider, autoTickMs: 0 });
    resetMarketStreamServiceForTests(service);
    active = service;
    await service.start();
    await service.subscribe(["2885"]);
    provider.emitLtp("2885", 100);
    provider.emitLtp("2885", 101);
    provider.emitLtp("2885", 102);
    expect(create).not.toHaveBeenCalled();
    await service.persistSnapshots();
    expect(create).toHaveBeenCalledTimes(1);
    create.mockRejectedValueOnce(new Error("db down"));
    await expect(service.persistence.persistLatest()).rejects.toThrow("db down");
    provider.emitLtp("2885", 103);
    expect(service.getStatus().connected).toBe(true);
  });

  it("never contacts Kite in mock mode and leaves paper/trading state untouched", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    const { service, provider, repos } = await setup();
    active = service;
    await service.start();
    await service.subscribe(["2885"]);
    provider.emitLtp("2885", 250);
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(await repos.trades.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.orders.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.positions.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.paperAccounts.findByUser(MEMORY_DEMO_USER_ID, "PAPER")).toBeNull();
    expect(await repos.brokerAccountSnapshots.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    await expect(kiteBrokerAdapter.placeOrder({} as never)).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(kiteBrokerAdapter.modifyOrder("1", {})).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(kiteBrokerAdapter.cancelOrder("1")).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
  });

  it("serializes connect/disconnect/subscribe without leaving desired state inconsistent", async () => {
    const { service, provider } = await setup();
    active = service;
    const startA = service.start();
    const startB = service.start();
    await Promise.all([startA, startB]);
    const sub = service.subscribe(["2885"]);
    const stop = service.stop();
    await Promise.all([sub, stop]);
    expect(service.listSubscriptions().some((item) => item.instrumentToken === "2885")).toBe(true);
    await service.start();
    expect(provider.subscribed.has("2885")).toBe(true);
  });
});

describe("event bus latest-wins", () => {
  it("keeps only the latest pending tick per token", async () => {
    const bus = new MarketTickEventBus();
    const seen: number[] = [];
    bus.onTick((tick) => {
      seen.push(tick.lastPrice);
    });
    const tick = (price: number): MarketTick => ({
      instrumentToken: "2885",
      exchange: "NSE",
      tradingSymbol: "RELIANCE",
      instrumentId: "1",
      timestamp: new Date().toISOString(),
      receivedAt: new Date().toISOString(),
      lastPrice: price,
      volume: null,
      lastTradedQuantity: null,
      open: null,
      high: null,
      low: null,
      close: null,
      averagePrice: null,
      buyQuantity: null,
      sellQuantity: null,
      exchangeTimestamp: null,
      mode: "LTP",
      source: "MOCK",
      orderKey: `k${price}`
    });
    bus.emitTick(tick(1));
    bus.emitTick(tick(2));
    bus.emitTick(tick(3));
    expect(bus.pendingCount()).toBe(1);
    await new Promise((resolve) => setImmediate(resolve));
    expect(seen).toEqual([3]);
  });
});
