import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { getTradingDate } from "../../common/utils/trading-date";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { validateTrade } from "../risk/validator";
import { PaperTradingService } from "../paper-trading/service";
import { AccountStateService } from "./service";

const testRisk = {
  capital: 100000,
  maxRiskPerTradePercent: 1,
  maxDailyLossPercent: 3,
  maxTradesPerDay: 8,
  maxPositionSize: 20000,
  maxOpenPositions: 5,
  maxCapitalExposure: 100000,
  allowShortSelling: true,
  tradeStartTime: "00:00",
  tradeEndTime: "23:59"
};

function tradeInput(overrides?: { symbol?: string; entryPrice?: number; stopLoss?: number; targetPrice?: number }) {
  return {
    signal: {
      symbol: overrides?.symbol ?? "NVDA",
      side: "BUY" as const,
      entryPrice: overrides?.entryPrice ?? 100,
      stopLoss: overrides?.stopLoss ?? 97.5,
      targetPrice: overrides?.targetPrice ?? 105,
      timestamp: "10:15"
    },
    strategyName: "Account State Test",
    aiExplanation: "Phase 1C paper account coverage."
  };
}

describe("paper account state", () => {
  let accountState: AccountStateService;
  let paper: PaperTradingService;

  beforeEach(async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, { riskConfiguration: testRisk });
  });

  afterEach(() => {
    resetRepositoriesForTests();
  });

  it("initializes a paper account with configured starting capital", async () => {
    const state = await accountState.getAccountView();
    expect(state.startingCapital).toBe(env.PAPER_STARTING_CAPITAL);
    expect(state.currentEquity).toBe(env.PAPER_STARTING_CAPITAL);
    expect(state.availableCapital).toBe(env.PAPER_STARTING_CAPITAL);
    expect(state.status).toBe("ACTIVE");
  });

  it("does not reset starting capital when initialize is called again with a different value", async () => {
    await accountState.initializePaperAccount(undefined, { startingCapital: 1 });
    const state = await accountState.getAccountView();
    expect(state.startingCapital).toBe(100000);
  });

  it("computes equity, exposure, available capital, and risk after opening a paper trade", async () => {
    const created = await paper.createTrade(tradeInput());
    expect(created.allowed).toBe(true);
    expect(created.calculatedQuantity).toBe(200);

    const state = await accountState.getAccountView();
    expect(state.openExposure).toBe(20000);
    expect(state.usedCapital).toBe(20000);
    expect(state.availableCapital).toBe(80000);
    expect(state.currentEquity).toBe(100000);
    expect(state.riskUsedToday).toBe(500);
    expect(state.riskRemainingToday).toBe(2500);
    expect(state.tradesToday).toBe(1);
    expect(state.openPositions).toBe(1);
  });

  it("includes unrealised PnL in current equity", async () => {
    await paper.createTrade(tradeInput());
    await paper.updateWithTick({ symbol: "NVDA", price: 102.5, timestamp: "2026-09-10T10:20:00.000Z" });

    const state = await accountState.getAccountView();
    expect(state.unrealisedPnl).toBe(500);
    expect(state.currentEquity).toBe(100500);
    expect(state.realisedPnl).toBe(0);
  });

  it("realises PnL and releases capital on close", async () => {
    const created = await paper.createTrade(tradeInput());
    await paper.updateWithTick({ symbol: "NVDA", price: 102.5, timestamp: "2026-09-10T10:20:00.000Z" });
    await paper.closePosition({
      positionId: created.position!.id,
      exitPrice: 102.5,
      timestamp: "2026-09-10T10:45:00.000Z"
    });

    const state = await accountState.getAccountView();
    expect(state.realisedPnl).toBe(500);
    expect(state.unrealisedPnl).toBe(0);
    expect(state.currentEquity).toBe(100500);
    expect(state.openExposure).toBe(0);
    expect(state.availableCapital).toBe(100500);
    expect(state.openPositions).toBe(0);
  });

  it("survives a mock-mode service restart in the same process", async () => {
    const created = await paper.createTrade(tradeInput());
    await paper.closePosition({
      positionId: created.position!.id,
      exitPrice: 102.5,
      timestamp: "2026-09-10T10:45:00.000Z"
    });

    const restarted = new AccountStateService();
    const state = await restarted.getAccountView();
    expect(state.startingCapital).toBe(100000);
    expect(state.currentEquity).toBe(100500);
    expect(state.realisedPnl).toBe(500);
    expect(state.openExposure).toBe(0);
  });

  it("rejects a trade when max trades per day is reached", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, {
      riskConfiguration: { ...testRisk, maxTradesPerDay: 1 }
    });

    expect((await paper.createTrade(tradeInput())).allowed).toBe(true);
    const second = await paper.createTrade(tradeInput({ symbol: "AAPL" }));
    expect(second.allowed).toBe(false);
    expect(second.rejectionReasons.some((reason) => reason.code === "MAX_TRADES_REACHED")).toBe(true);
  });

  it("rejects a trade when max open positions is reached", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, {
      riskConfiguration: { ...testRisk, maxOpenPositions: 1, maxPositionSize: 25000 }
    });

    expect((await paper.createTrade(tradeInput())).allowed).toBe(true);
    const second = await paper.createTrade(tradeInput({ symbol: "AAPL" }));
    expect(second.allowed).toBe(false);
    expect(second.rejectionReasons.some((reason) => reason.code === "MAX_OPEN_POSITIONS_REACHED")).toBe(true);
  });

  it("rejects a trade when max capital exposure would be exceeded", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, {
      riskConfiguration: { ...testRisk, maxCapitalExposure: 25000, maxPositionSize: 25000 }
    });

    expect((await paper.createTrade(tradeInput())).allowed).toBe(true);
    const second = await paper.createTrade(tradeInput({ symbol: "AAPL" }));
    expect(second.allowed).toBe(false);
    expect(second.rejectionReasons.some((reason) => reason.code === "MAX_CAPITAL_EXPOSURE_EXCEEDED")).toBe(true);
  });

  it("rejects a trade when available capital is insufficient", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, {
      startingCapital: 1000,
      riskConfiguration: {
        ...testRisk,
        capital: 1000,
        maxPositionSize: 25000,
        maxCapitalExposure: 25000,
        maxRiskPerTradePercent: 50
      }
    });

    const result = await paper.createTrade(tradeInput({ entryPrice: 100, stopLoss: 99, targetPrice: 110 }));
    expect(result.allowed).toBe(false);
    expect(result.rejectionReasons.some((reason) => reason.code === "INSUFFICIENT_AVAILABLE_CAPITAL")).toBe(true);
  });

  it("blocks new trades after daily loss protection is hit", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, {
      riskConfiguration: { ...testRisk, maxDailyLossPercent: 0.01, maxPositionSize: 1000 }
    });

    const created = await paper.createTrade(tradeInput({ entryPrice: 100, stopLoss: 99, targetPrice: 110 }));
    expect(created.allowed).toBe(true);
    await paper.closePosition({
      positionId: created.position!.id,
      exitPrice: 99,
      timestamp: `${getTradingDate()}T11:00:00+05:30`
    });

    const blocked = await paper.createTrade(tradeInput({ symbol: "AAPL", entryPrice: 100, stopLoss: 99, targetPrice: 110 }));
    expect(blocked.allowed).toBe(false);
    expect(blocked.rejectionReasons.some((reason) => reason.code === "TRADING_BLOCKED_DAILY_LOSS")).toBe(true);
  });

  it("serializes concurrent creates so a second trade cannot bypass max open positions", async () => {
    resetRepositoriesForTests(createMemoryRepositories());
    accountState = new AccountStateService();
    paper = new PaperTradingService();
    await accountState.initializePaperAccount(undefined, {
      riskConfiguration: { ...testRisk, maxOpenPositions: 1 }
    });

    const [first, second] = await Promise.all([
      paper.createTrade(tradeInput({ symbol: "NVDA" })),
      paper.createTrade(tradeInput({ symbol: "AAPL" }))
    ]);

    const allowed = [first, second].filter((result) => result.allowed);
    const rejected = [first, second].filter((result) => !result.allowed);
    expect(allowed).toHaveLength(1);
    expect(rejected).toHaveLength(1);
    expect(rejected[0]?.rejectionReasons.some((reason) => reason.code === "MAX_OPEN_POSITIONS_REACHED")).toBe(true);
    expect((await paper.getOpenPositions()).length).toBe(1);
  });

  it("keeps existing RiskValidator rules without account context", () => {
    const result = validateTrade(
      {
        symbol: "NVDA",
        side: "BUY",
        entryPrice: 100,
        stopLoss: 101,
        targetPrice: 110,
        quantity: 1,
        timestamp: "10:15"
      },
      testRisk,
      { dailyLoss: 0, tradesTaken: 0 }
    );

    expect(result.allowed).toBe(false);
    expect(result.rejectionReasons.some((reason) => reason.code === "INVALID_STOP_LOSS")).toBe(true);
  });

  it("writes account snapshots on init, open, and close", async () => {
    const created = await paper.createTrade(tradeInput());
    await paper.closePosition({
      positionId: created.position!.id,
      exitPrice: 102.5,
      timestamp: "2026-09-10T10:45:00.000Z"
    });

    const snapshots = await accountState.listSnapshots();
    const events = snapshots.map((snapshot) => snapshot.event);
    expect(events).toContain("PAPER_ACCOUNT_INITIALIZED");
    expect(events).toContain("PAPER_TRADE_OPENED");
    expect(events).toContain("PAPER_TRADE_CLOSED");
  });
});
