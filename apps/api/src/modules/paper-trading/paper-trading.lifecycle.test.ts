import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { AccountStateService } from "../account-state/service";
import { PaperTradingError } from "./errors";
import { PaperTradingService } from "./service";
import type { CreatePaperTradeInput } from "./types";

const longRisk = {
  capital: 100000,
  maxRiskPerTradePercent: 1,
  maxDailyLossPercent: 5,
  maxTradesPerDay: 20,
  maxPositionSize: 1000,
  allowShortSelling: true,
  tradeStartTime: "00:00",
  tradeEndTime: "23:59"
};

const longInput: CreatePaperTradeInput = {
  signal: {
    symbol: "NVDA",
    side: "BUY",
    entryPrice: 100,
    stopLoss: 99,
    targetPrice: 102,
    timestamp: "10:15"
  },
  riskProfile: longRisk,
  currentDayStats: { dailyLoss: 0, tradesTaken: 0 },
  strategyName: "Opening Range Breakout",
  aiExplanation: "Paper long after scanner alignment."
};

const shortInput: CreatePaperTradeInput = {
  ...longInput,
  signal: {
    symbol: "TSLA",
    side: "SHORT",
    entryPrice: 100,
    stopLoss: 102,
    targetPrice: 96,
    timestamp: "10:15"
  }
};

describe("persistent paper trading lifecycle", () => {
  let service: PaperTradingService;

  beforeEach(async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    service = new PaperTradingService();
    const accountState = new AccountStateService();
    await accountState.initializePaperAccount(undefined, {
      riskConfiguration: {
        ...longRisk,
        maxOpenPositions: 20,
        maxCapitalExposure: 1_000_000
      }
    });
  });

  afterEach(() => {
    resetRepositoriesForTests();
  });

  it("does not open a position when risk validation rejects the trade", async () => {
    const result = await service.createTrade({
      ...longInput,
      signal: { ...longInput.signal, stopLoss: undefined }
    });

    expect(result.allowed).toBe(false);
    expect(result.position).toBeUndefined();
    expect(await service.getOpenPositions()).toHaveLength(0);
  });

  it("creates a trade, filled entry order, and open position when approved", async () => {
    const result = await service.createTrade(longInput);

    expect(result.allowed).toBe(true);
    expect(result.trade?.status).toBe("OPEN");
    expect(result.entryOrder?.status).toBe("FILLED");
    expect(result.entryOrder?.purpose).toBe("ENTRY");
    expect(result.position?.status).toBe("OPEN");
    expect(result.position?.tradingMode).toBe("PAPER");

    const bundle = await service.getTradeBundle(result.trade!.id);
    expect(bundle?.entryOrder?.status).toBe("FILLED");
    expect(bundle?.position?.status).toBe("OPEN");
  });

  it("updates unrealised PnL for a long position", async () => {
    const created = await service.createTrade(longInput);
    const tick = await service.updateWithTick({ symbol: "NVDA", price: 101, timestamp: "2026-09-10T10:20:00.000Z" });

    expect(tick.closedTrades).toHaveLength(0);
    expect(tick.updatedTrades[0]?.pnl).toBe(10);
    expect((await service.getPosition(created.position!.id))?.unrealizedPnl).toBe(10);
  });

  it("updates unrealised PnL for a short position", async () => {
    const created = await service.createTrade(shortInput);
    const tick = await service.updateWithTick({ symbol: "TSLA", price: 99, timestamp: "2026-09-10T10:20:00.000Z" });

    expect(tick.closedTrades).toHaveLength(0);
    expect(tick.updatedTrades[0]?.pnl).toBe(10);
    expect((await service.getPosition(created.position!.id))?.unrealizedPnl).toBe(10);
  });

  it("closes the position at stop loss and records realised PnL", async () => {
    const created = await service.createTrade(longInput);
    const tick = await service.updateWithTick({ symbol: "NVDA", price: 98.5, timestamp: "2026-09-10T10:21:00.000Z" });

    expect(tick.closedTrades).toHaveLength(1);
    expect(tick.closedTrades[0]?.exitReason).toBe("STOP_LOSS");
    expect(tick.closedTrades[0]?.pnl).toBe(-15);

    const position = await service.getPosition(created.position!.id);
    expect(position?.status).toBe("CLOSED");
    expect(position?.unrealizedPnl).toBe(0);
    expect(position?.realizedPnl).toBe(-15);

    const bundle = await service.getTradeBundle(created.trade!.id);
    expect(bundle?.trade.status).toBe("CLOSED");
    expect(bundle?.exitOrder?.status).toBe("FILLED");
    expect(bundle?.exitOrder?.purpose).toBe("EXIT");
  });

  it("closes the position at target and records realised PnL", async () => {
    const created = await service.createTrade(longInput);
    await service.updateWithTick({ symbol: "NVDA", price: 102.5, timestamp: "2026-09-10T10:22:00.000Z" });

    const position = await service.getPosition(created.position!.id);
    expect(position?.status).toBe("CLOSED");
    expect(position?.exitReason).toBe("TARGET");
    expect(position?.realizedPnl).toBe(25);
  });

  it("does not create another exit order when the same tick is replayed after exit", async () => {
    const created = await service.createTrade(longInput);
    const timestamp = "2026-09-10T10:23:00.000Z";
    await service.updateWithTick({ symbol: "NVDA", price: 102.5, timestamp });
    await service.updateWithTick({ symbol: "NVDA", price: 102.5, timestamp });
    await service.updateWithTick({ symbol: "NVDA", price: 103, timestamp: "2026-09-10T10:24:00.000Z" });

    const bundle = await service.getTradeBundle(created.trade!.id);
    const exitOrders = [bundle?.exitOrder].filter(Boolean);

    expect(bundle?.trade.status).toBe("CLOSED");
    expect(exitOrders).toHaveLength(1);
  });

  it("rejects a second manual close on an already closed position", async () => {
    const created = await service.createTrade(longInput);
    await service.closePosition({ positionId: created.position!.id, exitPrice: 101, timestamp: "2026-09-10T10:25:00.000Z" });

    await expect(service.closePosition({ positionId: created.position!.id, exitPrice: 101 })).rejects.toBeInstanceOf(
      PaperTradingError
    );
    await expect(service.closePosition({ positionId: created.position!.id, exitPrice: 101 })).rejects.toMatchObject({
      code: "ALREADY_CLOSED"
    });
  });

  it("survives a repository restart in the same process using a fresh service instance", async () => {
    const created = await service.createTrade(longInput);
    const repos = (await import("../../db/persistence")).getRepositories();

    resetRepositoriesForTests(repos);
    const restarted = new PaperTradingService();
    const open = await restarted.getOpenPositions();

    expect(open.map((item) => item.id)).toContain(created.position!.id);

    await restarted.updateWithTick({ symbol: "NVDA", price: 102.5, timestamp: "2026-09-10T10:26:00.000Z" });
    const closed = await restarted.getPosition(created.position!.id);
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.realizedPnl).toBe(25);
  });
});
