import { beforeEach, describe, expect, it } from "vitest";
import { MEMORY_DEMO_USER_ID } from "../domain";
import {
  InMemoryAccountSnapshotRepository,
  InMemoryInstrumentRepository,
  InMemoryJournalEntryRepository,
  InMemoryOrderRepository,
  InMemoryPositionRepository,
  InMemoryScannerSignalRepository,
  InMemorySystemLogRepository,
  InMemoryTradeRepository,
  createMemoryRepositories
} from "./memory-repositories";

describe("in-memory repositories CRUD", () => {
  let repos: ReturnType<typeof createMemoryRepositories>;

  beforeEach(() => {
    repos = createMemoryRepositories();
  });

  it("upserts instruments by exchange and symbol", async () => {
    const instruments = new InMemoryInstrumentRepository();
    const created = await instruments.upsertByExchangeSymbol({
      symbol: "nvda",
      exchange: "mock",
      name: "NVIDIA",
      instrumentToken: null,
      segment: "EQ",
      tickSize: 0.01,
      lotSize: 1,
      isActive: true
    });
    const updated = await instruments.upsertByExchangeSymbol({
      symbol: "NVDA",
      exchange: "MOCK",
      name: "NVIDIA Corp",
      instrumentToken: "123",
      segment: "EQ",
      tickSize: 0.01,
      lotSize: 1,
      isActive: true
    });

    expect(updated.id).toBe(created.id);
    expect(updated.name).toBe("NVIDIA Corp");
    expect(await instruments.findByExchangeSymbol("MOCK", "NVDA")).toMatchObject({ name: "NVIDIA Corp" });
  });

  it("creates and lists account snapshots for a user", async () => {
    const snapshots = new InMemoryAccountSnapshotRepository();
    await snapshots.create({
      userId: MEMORY_DEMO_USER_ID,
      brokerConnectionId: null,
      tradingMode: "PAPER",
      equity: 100000,
      buyingPower: 50000,
      availableCash: 40000,
      usedMargin: 10000,
      realizedPnl: 120,
      unrealizedPnl: 80
    });

    const listed = await snapshots.listByUser(MEMORY_DEMO_USER_ID, { tradingMode: "PAPER" });
    expect(listed).toHaveLength(1);
    expect(listed[0]?.equity).toBe(100000);
  });

  it("creates, updates, and lists orders, trades, and positions", async () => {
    const orders = new InMemoryOrderRepository();
    const trades = new InMemoryTradeRepository();
    const positions = new InMemoryPositionRepository();

    const trade = await trades.create({
      userId: MEMORY_DEMO_USER_ID,
      strategyId: null,
      scannerSignalId: null,
      instrumentId: null,
      symbol: "NVDA",
      side: "BUY",
      status: "OPEN",
      tradingMode: "PAPER",
      quantity: 10,
      entryPrice: 100,
      stopLoss: 95,
      targetPrice: 110,
      exitPrice: null,
      pnl: 0,
      maxLoss: 50,
      rewardToRisk: 2,
      exitReason: null,
      strategyName: "test",
      explanation: "test",
      openedAt: new Date(),
      closedAt: null
    });

    const order = await orders.create({
      userId: MEMORY_DEMO_USER_ID,
      tradeId: trade.id,
      positionId: null,
      strategyId: null,
      brokerConnectionId: null,
      instrumentId: null,
      brokerOrderId: "paper_1",
      symbol: "NVDA",
      side: "BUY",
      status: "FILLED",
      purpose: "ENTRY",
      tradingMode: "PAPER",
      quantity: 10,
      filledQuantity: 10,
      price: 100
    });

    await expect(
      orders.create({
        ...order,
        id: undefined,
        brokerOrderId: "paper_1"
      })
    ).rejects.toThrow(/Duplicate broker order ID/);

    const position = await positions.create({
      userId: MEMORY_DEMO_USER_ID,
      tradeId: trade.id,
      instrumentId: null,
      symbol: "NVDA",
      side: "BUY",
      status: "OPEN",
      tradingMode: "PAPER",
      quantity: 10,
      averagePrice: 100,
      currentPrice: 104,
      stopLoss: 95,
      targetPrice: 110,
      unrealizedPnl: 40,
      realizedPnl: 0,
      exitReason: null,
      lastProcessedTickKey: null,
      exitInProgress: false,
      openedAt: new Date(),
      closedAt: null
    });

    await orders.update(order.id, { status: "CANCELLED" });
    await trades.update(trade.id, { status: "CLOSED", pnl: 40 });
    await positions.update(position.id, { status: "CLOSED", closedAt: new Date() });

    expect((await orders.findByBrokerOrderId("paper_1"))?.status).toBe("CANCELLED");
    expect((await trades.listByUser(MEMORY_DEMO_USER_ID, { status: "CLOSED" }))[0]?.pnl).toBe(40);
    expect((await positions.listByUser(MEMORY_DEMO_USER_ID, { status: "CLOSED" }))).toHaveLength(1);
  });

  it("creates journal entries and system logs", async () => {
    const journal = new InMemoryJournalEntryRepository();
    const logs = new InMemorySystemLogRepository();

    await journal.create({
      authorId: MEMORY_DEMO_USER_ID,
      tradeId: null,
      type: "NOTE",
      title: "Focus",
      body: "Skipped weak AAPL setup.",
      mood: "Disciplined",
      tags: ["skip"],
      symbol: "AAPL"
    });
    await logs.create({
      userId: MEMORY_DEMO_USER_ID,
      level: "SAFE",
      source: "risk",
      message: "Paper validation only.",
      metadata: { liveTrading: false }
    });

    expect(await journal.listByAuthor(MEMORY_DEMO_USER_ID, { symbol: "AAPL" })).toHaveLength(1);
    expect(await logs.list({ source: "risk" })).toHaveLength(1);
  });

  it("upserts scanner signals by dedupe key instead of duplicating", async () => {
    const signals = new InMemoryScannerSignalRepository();
    const first = await signals.upsertByDedupeKey({
      userId: MEMORY_DEMO_USER_ID,
      instrumentId: null,
      symbol: "NVDA",
      direction: "BULLISH",
      score: 80,
      matchedSignals: ["GAP_UP"],
      explanation: "first",
      entryTrigger: 100,
      stopLoss: 99,
      target: 102,
      riskAmount: 50,
      riskApproved: true,
      suggestedAction: "WATCH_FOR_LONG_SETUP",
      confidenceLabel: "MEDIUM",
      tradingMode: "PAPER",
      sessionDate: "2026-09-10",
      dedupeKey: "demo|PAPER|2026-09-10|NVDA|BULLISH"
    });
    const second = await signals.upsertByDedupeKey({
      userId: MEMORY_DEMO_USER_ID,
      instrumentId: null,
      symbol: "NVDA",
      direction: "BULLISH",
      score: 91,
      matchedSignals: ["GAP_UP", "VOLUME_SPIKE"],
      explanation: "updated",
      entryTrigger: 101,
      stopLoss: 99,
      target: 105,
      riskAmount: 60,
      riskApproved: true,
      suggestedAction: "WATCH_FOR_LONG_SETUP",
      confidenceLabel: "HIGH",
      tradingMode: "PAPER",
      sessionDate: "2026-09-10",
      dedupeKey: "demo|PAPER|2026-09-10|NVDA|BULLISH"
    });

    expect(second.id).toBe(first.id);
    expect(second.score).toBe(91);
    expect(await signals.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(1);
  });

  it("bootstraps the demo user in the memory user repository", async () => {
    const user = await repos.users.findByEmail("demo@tradepilot.local");
    expect(user?.id).toBe(MEMORY_DEMO_USER_ID);
  });
});
