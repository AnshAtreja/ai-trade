import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { kiteBrokerAdapter } from "../../broker/adapters/kite-broker-adapter";
import { LIVE_TRADING_DISABLED_MESSAGE } from "../../broker/adapters/live-trading-disabled";
import { AccountStateService } from "../../account-state/service";
import { getRepositories, resetRepositoriesForTests } from "../../../db/persistence";
import { createMemoryRepositories } from "../../../db/repositories/memory-repositories";
import { LatestMarketStateStore } from "../../market-data/stream/latest-state-store";
import type { MarketTick } from "../../market-data/stream/types";
import { getPaperExecutionConfig } from "./config";
import { evaluateFill } from "./fill-model";
import { evaluateLiveExit, evaluateRangeExitPolicy } from "./exits";
import { calculatePaperCharges, netPnlFromGross } from "./charges";
import {
  PaperExecutionProvider,
  resetPaperExecutionProviderForTests
} from "./provider";
import { toExecutionMarketView, type ExecutionRequest } from "./types";

const REGULAR = new Date("2026-09-15T05:00:00.000Z"); // ~10:30 IST Mon

function tick(partial: Partial<MarketTick> & { lastPrice: number }): MarketTick {
  const receivedAt = partial.receivedAt ?? REGULAR.toISOString();
  return {
    instrumentToken: partial.instrumentToken ?? "2885",
    exchange: "NSE",
    tradingSymbol: partial.tradingSymbol ?? "RELIANCE",
    instrumentId: null,
    timestamp: receivedAt,
    receivedAt,
    lastPrice: partial.lastPrice,
    volume: 10000,
    lastTradedQuantity: 1,
    open: partial.open ?? partial.lastPrice,
    high: partial.high ?? partial.lastPrice,
    low: partial.low ?? partial.lastPrice,
    close: partial.close ?? partial.lastPrice,
    averagePrice: partial.lastPrice,
    buyQuantity: partial.buyQuantity ?? 1000,
    sellQuantity: partial.sellQuantity ?? 1000,
    exchangeTimestamp: receivedAt,
    mode: "QUOTE",
    source: "MOCK",
    orderKey: partial.orderKey ?? `${receivedAt}|${partial.lastPrice}`
  };
}

describe("Phase 7 fill model", () => {
  const config = getPaperExecutionConfig({
    allowLtpFallback: true,
    slippagePolicy: "NONE",
    liquidityPolicy: "FILL_AVAILABLE_LIQUIDITY",
    maxDataAgeMs: 60_000
  });

  it("fills market BUY against ask with available liquidity", () => {
    const market = toExecutionMarketView(tick({ lastPrice: 100, sellQuantity: 1000 }), config, REGULAR, {
      bid: 99.9,
      ask: 100.1,
      askQty: 1000,
      usedFallbackSpread: false
    })!;
    const decision = evaluateFill({
      side: "BUY",
      orderType: "MARKET",
      quantity: 500,
      filledQuantity: 0,
      limitPrice: null,
      market,
      config
    });
    expect(decision.action).toBe("FILL");
    expect(decision.fillQuantity).toBe(500);
    expect(decision.fillPrice).toBe(100.1);
  });

  it("partially fills when ask quantity is limited", () => {
    const market = toExecutionMarketView(tick({ lastPrice: 100, sellQuantity: 300 }), config, REGULAR, {
      bid: 99.9,
      ask: 100,
      askQty: 300
    })!;
    const decision = evaluateFill({
      side: "BUY",
      orderType: "MARKET",
      quantity: 1000,
      filledQuantity: 0,
      limitPrice: null,
      market,
      config
    });
    expect(decision.action).toBe("PARTIAL");
    expect(decision.fillQuantity).toBe(300);
  });

  it("keeps limit BUY open when ask is above limit", () => {
    const market = toExecutionMarketView(tick({ lastPrice: 101 }), config, REGULAR, {
      bid: 100.5,
      ask: 101,
      askQty: 500
    })!;
    const decision = evaluateFill({
      side: "BUY",
      orderType: "LIMIT",
      quantity: 10,
      filledQuantity: 0,
      limitPrice: 100,
      market,
      config
    });
    expect(decision.action).toBe("KEEP_OPEN");
  });

  it("rejects fills on stale market data", () => {
    const market = toExecutionMarketView(tick({ lastPrice: 100 }), config, REGULAR)!;
    market.stale = true;
    const decision = evaluateFill({
      side: "BUY",
      orderType: "MARKET",
      quantity: 10,
      filledQuantity: 0,
      limitPrice: null,
      market,
      config
    });
    expect(decision.action).toBe("REJECT");
  });
});

describe("Phase 7 exits and charges", () => {
  it("gap-through stop uses trigger price not stop", () => {
    const config = getPaperExecutionConfig({ stopGapPolicy: "FILL_AT_TRIGGER_PRICE", markPricePolicy: "LTP" });
    const market = toExecutionMarketView(tick({ lastPrice: 90 }), config, REGULAR)!;
    const exit = evaluateLiveExit({
      side: "BUY",
      stopLoss: 95,
      targetPrice: 110,
      market,
      config
    });
    expect(exit?.reason).toBe("STOP_LOSS");
    expect(exit?.exitPrice).toBe(90);
    expect(exit?.gapAmount).toBe(5);
  });

  it("ambiguous range uses conservative stop by default", () => {
    const config = getPaperExecutionConfig({ ambiguousExitPolicy: "CONSERVATIVE_STOP" });
    const exit = evaluateRangeExitPolicy({
      side: "BUY",
      stopLoss: 95,
      targetPrice: 105,
      high: 106,
      low: 94,
      config
    });
    expect(exit?.reason).toBe("STOP_LOSS");
    expect(exit?.ambiguous).toBe(true);
  });

  it("computes gross/charges/net", () => {
    const charges = calculatePaperCharges({
      turnover: 100_000,
      config: getPaperExecutionConfig({ chargeRateBps: 3, minCharge: 5 })
    });
    expect(charges.charges).toBe(30);
    expect(netPnlFromGross(100, 30)).toBe(70);
  });
});

describe("PaperExecutionProvider scenarios", () => {
  let store: LatestMarketStateStore;
  let provider: PaperExecutionProvider;
  let userId: string;

  beforeEach(async () => {
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    store = new LatestMarketStateStore(60_000);
    const account = new AccountStateService(() => repos);
    const user = await repos.users.upsertByEmail({ email: "demo@tradepilot.local", name: "Demo" });
    userId = user.id;
    await account.initializePaperAccount(userId, {
      riskConfiguration: {
        capital: 100000,
        maxRiskPerTradePercent: 1,
        maxDailyLossPercent: 5,
        maxTradesPerDay: 50,
        maxPositionSize: 50000,
        maxOpenPositions: 20,
        maxCapitalExposure: 1_000_000,
        allowShortSelling: true,
        tradeStartTime: "00:00",
        tradeEndTime: "23:59"
      }
    });

    provider = new PaperExecutionProvider({
      resolveRepos: () => repos,
      getLatestStore: () => store,
      accountState: account,
      now: () => REGULAR,
      config: {
        maxLatencyMs: 0,
        slippagePolicy: "NONE",
        allowLtpFallback: true,
        liquidityPolicy: "FILL_AVAILABLE_LIQUIDITY",
        maxDataAgeMs: 60_000,
        orderTimeoutMs: 120_000,
        blockEntriesAfterSquareOff: false
      }
    });
    resetPaperExecutionProviderForTests(provider);
  });

  afterEach(() => {
    resetPaperExecutionProviderForTests();
    resetRepositoriesForTests();
  });

  function baseRequest(overrides: Partial<ExecutionRequest> = {}): ExecutionRequest {
    return {
      userId,
      paperAccountMode: "PAPER",
      symbol: "RELIANCE",
      instrumentToken: "2885",
      instrumentId: null,
      side: "BUY",
      orderType: "MARKET",
      quantity: 100,
      limitPrice: null,
      requestedPrice: 100,
      purpose: "ENTRY",
      strategySetupId: null,
      tradeId: null,
      positionId: null,
      stopLoss: 98,
      targetPrice: 104,
      strategyName: "test",
      explanation: "phase7",
      scannerSignalId: null,
      clientOrderId: overrides.clientOrderId ?? `c_${Math.random()}`,
      idempotencyKey: overrides.idempotencyKey ?? `k_${Math.random()}`,
      signalTimestamp: REGULAR.toISOString(),
      requestTimestamp: REGULAR.toISOString(),
      timeInForceMs: 60_000,
      ...overrides
    };
  }

  it("fills a market BUY and opens a position", async () => {
    store.set(tick({ lastPrice: 100, sellQuantity: 1000 }));
    const result = await provider.submit(baseRequest({ quantity: 50 }));
    expect(result.status).toBe("FILLED");
    expect(result.fills[0]?.quantity).toBe(50);
    expect(result.positionId).toBeTruthy();
  });

  it("partially fills when liquidity is insufficient", async () => {
    store.set(tick({ lastPrice: 100, sellQuantity: 30 }));
    const result = await provider.submit(baseRequest({ quantity: 100, clientOrderId: "partial1", idempotencyKey: "partial1" }));
    expect(result.status).toBe("PARTIALLY_FILLED");
    expect(result.fills[0]?.quantity).toBe(30);
  });

  it("is idempotent for duplicate requests", async () => {
    store.set(tick({ lastPrice: 100, sellQuantity: 500 }));
    const req = baseRequest({ clientOrderId: "dup1", idempotencyKey: "dup1" });
    const first = await provider.submit(req);
    const second = await provider.submit(req);
    expect(first.status).toBe("FILLED");
    expect(second.status).toBe("DUPLICATE");
    expect(second.orderId).toBe(first.orderId);
  });

  it("rejects stale market data", async () => {
    const repos = createMemoryRepositories();
    const staleStore = new LatestMarketStateStore(60_000);
    staleStore.set(tick({ lastPrice: 100, receivedAt: "2026-09-15T04:00:00.000Z" }));
    const account = new AccountStateService(() => repos);
    const user = await repos.users.upsertByEmail({ email: "demo@tradepilot.local", name: "Demo" });
    await account.initializePaperAccount(user.id, {
      riskConfiguration: {
        capital: 100000,
        maxRiskPerTradePercent: 1,
        maxDailyLossPercent: 5,
        maxTradesPerDay: 50,
        maxPositionSize: 50000,
        maxOpenPositions: 20,
        maxCapitalExposure: 1_000_000,
        allowShortSelling: true,
        tradeStartTime: "00:00",
        tradeEndTime: "23:59"
      }
    });
    const staleProvider = new PaperExecutionProvider({
      resolveRepos: () => repos,
      getLatestStore: () => staleStore,
      accountState: account,
      now: () => REGULAR,
      config: { maxLatencyMs: 0, maxDataAgeMs: 1000, allowLtpFallback: true, blockEntriesAfterSquareOff: false }
    });
    const result = await staleProvider.submit({
      userId: user.id,
      paperAccountMode: "PAPER",
      symbol: "RELIANCE",
      instrumentToken: "2885",
      instrumentId: null,
      side: "BUY",
      orderType: "MARKET",
      quantity: 10,
      limitPrice: null,
      requestedPrice: 100,
      purpose: "ENTRY",
      strategySetupId: null,
      tradeId: null,
      positionId: null,
      stopLoss: 98,
      targetPrice: 104,
      strategyName: "test",
      explanation: "stale",
      scannerSignalId: null,
      clientOrderId: "stale1",
      idempotencyKey: "stale1",
      signalTimestamp: REGULAR.toISOString(),
      requestTimestamp: REGULAR.toISOString(),
      timeInForceMs: 60_000
    });
    expect(result.status).toBe("REJECTED");
    expect(result.rejectionCode).toBe("STALE_MISSING_MARKET_DATA");
  });

  it("never calls Kite placeOrder/modifyOrder/cancelOrder", async () => {
    const place = vi.spyOn(kiteBrokerAdapter, "placeOrder");
    const modify = vi.spyOn(kiteBrokerAdapter, "modifyOrder");
    const cancel = vi.spyOn(kiteBrokerAdapter, "cancelOrder");
    store.set(tick({ lastPrice: 100, sellQuantity: 500 }));
    await provider.submit(baseRequest({ clientOrderId: "safe1", idempotencyKey: "safe1" }));
    expect(place).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
    await expect(kiteBrokerAdapter.placeOrder({} as never)).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
  });

  it("restart reconcile does not duplicate fills", async () => {
    store.set(tick({ lastPrice: 100, sellQuantity: 500 }));
    const first = await provider.submit(baseRequest({ clientOrderId: "r1", idempotencyKey: "r1", quantity: 10 }));
    expect(first.status).toBe("FILLED");
    const fillsBefore = await getRepositories().paperFills.listByOrder(first.orderId!);
    await provider.reconcile();
    const fillsAfter = await getRepositories().paperFills.listByOrder(first.orderId!);
    expect(fillsAfter.length).toBe(fillsBefore.length);
  });

  it("triggers stop with gap-through price via monitor", async () => {
    store.set(tick({ lastPrice: 100, sellQuantity: 500, buyQuantity: 500 }));
    const opened = await provider.submit(
      baseRequest({
        clientOrderId: "stop1",
        idempotencyKey: "stop1",
        quantity: 10,
        stopLoss: 95,
        targetPrice: 110
      })
    );
    expect(opened.status).toBe("FILLED");
    store.set(tick({ lastPrice: 90, buyQuantity: 500, sellQuantity: 500, orderKey: "gap" }));
    await provider.monitorOpenPositions(userId);
    const position = await getRepositories().positions.findById(opened.positionId!);
    expect(position?.status).toBe("CLOSED");
    expect(position?.exitReason).toBe("STOP_LOSS");
    expect(position?.realizedPnl).toBeLessThan(0);
  });
});
