import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetRepositoriesForTests } from "../../../db/persistence";
import { createMemoryRepositories } from "../../../db/repositories/memory-repositories";
import { AccountStateService } from "../../account-state/service";
import { KiteBrokerAdapter } from "../adapters/kite-broker-adapter";
import { LIVE_TRADING_DISABLED_MESSAGE } from "../adapters/live-trading-disabled";
import { PaperTradingService } from "../../paper-trading/service";
import { KiteAccountError } from "./errors";
import { mapKiteFunds, mapKiteHoldings, mapKiteOrders, mapKitePositions, mapKiteProfile } from "./mappers";
import { MockBrokerAccountProvider } from "./mock-account-provider";
import { BrokerAccountService } from "./service";
import { resetRefreshThrottleForTests } from "./throttle";
import type { BrokerAccountProvider } from "./types";

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

class UnauthenticatedProvider implements BrokerAccountProvider {
  readonly source = "KITE" as const;
  isConfigured() {
    return true;
  }
  isAuthenticated() {
    return false;
  }
  async getProfile(): Promise<never> {
    throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing.");
  }
  async getFunds(): Promise<never> {
    throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing.");
  }
  async getPositions(): Promise<never> {
    throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing.");
  }
  async getOrders(): Promise<never> {
    throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing.");
  }
  async getHoldings(): Promise<never> {
    throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing.");
  }
}

class ExpiredAuthProvider extends MockBrokerAccountProvider implements BrokerAccountProvider {
  override isAuthenticated() {
    return true;
  }
  override async getProfile(): Promise<never> {
    throw new KiteAccountError("KITE_AUTH_EXPIRED", "Kite access token is invalid or expired.");
  }
}

class PartialFundsProvider extends MockBrokerAccountProvider {
  async getFunds(): Promise<never> {
    throw new KiteAccountError("KITE_API_ERROR", "Margins endpoint unavailable.");
  }
}

function service(provider?: BrokerAccountProvider) {
  return new BrokerAccountService(undefined, provider ?? new MockBrokerAccountProvider());
}

describe("read-only kite account state", () => {
  beforeEach(() => {
    resetRepositoriesForTests(createMemoryRepositories());
    resetRefreshThrottleForTests();
  });

  afterEach(() => {
    resetRepositoriesForTests();
    resetRefreshThrottleForTests();
  });

  it("returns a stable error when Kite is not authenticated", async () => {
    await expect(service(new UnauthenticatedProvider()).refreshBrokerAccount()).rejects.toMatchObject({
      code: "KITE_NOT_AUTHENTICATED"
    });
  });

  it("returns a stable error when Kite authentication is expired", async () => {
    await expect(service(new ExpiredAuthProvider()).refreshBrokerAccount()).rejects.toMatchObject({
      code: "KITE_AUTH_EXPIRED"
    });
  });

  it("normalizes a Kite profile payload", () => {
    const profile = mapKiteProfile(
      {
        user_id: "AB1234",
        user_name: "Ada",
        user_shortname: "ADA",
        email: "ada@example.com",
        broker: "ZERODHA",
        user_type: "individual",
        products: ["MIS", "CNC"],
        exchanges: ["NSE"],
        order_types: ["LIMIT"]
      },
      "KITE"
    );

    expect(profile).toMatchObject({
      source: "KITE",
      userId: "AB1234",
      userName: "Ada",
      email: "ada@example.com",
      userType: "individual"
    });
  });

  it("normalizes Kite funds without inventing unknown fields", () => {
    const funds = mapKiteFunds(
      {
        equity: {
          enabled: true,
          net: 80000,
          available: { cash: 100000, collateral: 5000, live_balance: 80000, opening_balance: 100000 },
          utilised: { debits: 20000, exposure: 15000 }
        },
        commodity: { enabled: false, net: 0 }
      },
      "KITE",
      "2026-09-10T12:00:00.000Z"
    );

    expect(funds.equity?.available.cash).toBe(100000);
    expect(funds.equity?.utilised.debits).toBe(20000);
    expect(funds.equity?.available.collateral).toBe(5000);
    expect(funds.commodity?.enabled).toBe(false);
  });

  it("preserves net, buy, and sell quantities from Kite positions", () => {
    const positions = mapKitePositions({
      net: [
        {
          tradingsymbol: "RELIANCE",
          exchange: "NSE",
          product: "MIS",
          quantity: 10,
          overnight_quantity: 2,
          buy_quantity: 12,
          sell_quantity: 2,
          buy_price: 1400,
          sell_price: 1410,
          average_price: 1398,
          last_price: 1415,
          realised: 20,
          unrealised: 170,
          pnl: 190,
          multiplier: 1,
          value: 14150
        }
      ],
      day: []
    });

    expect(positions[0]).toMatchObject({
      book: "NET",
      tradingSymbol: "RELIANCE",
      quantity: 10,
      buyQuantity: 12,
      sellQuantity: 2,
      overnightQuantity: 2
    });
  });

  it("preserves filled, pending, and rejected broker order states", () => {
    const orders = mapKiteOrders([
      {
        order_id: "1",
        tradingsymbol: "INFY",
        exchange: "NSE",
        transaction_type: "BUY",
        quantity: 10,
        filled_quantity: 10,
        pending_quantity: 0,
        status: "COMPLETE",
        order_type: "LIMIT",
        product: "MIS"
      },
      {
        order_id: "2",
        tradingsymbol: "INFY",
        exchange: "NSE",
        transaction_type: "BUY",
        quantity: 5,
        filled_quantity: 0,
        pending_quantity: 5,
        status: "OPEN",
        order_type: "LIMIT",
        product: "MIS"
      },
      {
        order_id: "3",
        tradingsymbol: "INFY",
        exchange: "NSE",
        transaction_type: "BUY",
        quantity: 1,
        filled_quantity: 0,
        pending_quantity: 0,
        status: "REJECTED",
        status_message: "Insufficient funds",
        order_type: "MARKET",
        product: "MIS"
      }
    ]);

    expect(orders.map((order) => order.status)).toEqual(["COMPLETE", "OPEN", "REJECTED"]);
    expect(orders[0]?.filledQuantity).toBe(10);
    expect(orders[1]?.pendingQuantity).toBe(5);
  });

  it("normalizes holdings without treating them as intraday positions", () => {
    const holdings = mapKiteHoldings([
      {
        tradingsymbol: "TCS",
        exchange: "NSE",
        quantity: 2,
        average_price: 3500,
        last_price: 3600,
        pnl: 200,
        authorised_quantity: 2,
        product: "CNC"
      }
    ]);

    expect(holdings).toEqual([
      {
        tradingSymbol: "TCS",
        exchange: "NSE",
        quantity: 2,
        averagePrice: 3500,
        lastPrice: 3600,
        pnl: 200,
        authorisedQuantity: 2,
        product: "CNC"
      }
    ]);
  });

  it("creates an immutable snapshot on full mock refresh", async () => {
    const account = service();
    const first = await account.refreshBrokerAccount();
    expect(first.refreshStatus).toBe("COMPLETE");
    expect(first.funds?.equity?.available.cash).toBe(100000);
    expect(first.funds?.equity?.utilised.debits).toBe(20000);
    expect(first.positions.map((item) => item.tradingSymbol)).toEqual(["RELIANCE", "INFY"]);

    const latest = await account.getBrokerAccountState();
    expect(latest.positions).toHaveLength(2);
    expect(latest.orders.map((order) => order.status)).toEqual(["COMPLETE", "OPEN"]);
    expect(latest.holdings[0]?.tradingSymbol).toBe("TCS");

    resetRefreshThrottleForTests();
    const second = await account.refreshBrokerAccount();
    const snapshots = await account.listBrokerAccountSnapshots();
    expect(snapshots).toHaveLength(2);
    expect(snapshots[1]?.state).toMatchObject({ capturedAt: first.capturedAt });
    expect(second.capturedAt).not.toBe(first.capturedAt);
  });

  it("handles partial broker failure without inventing funds", async () => {
    const account = service(new PartialFundsProvider());
    const state = await account.refreshBrokerAccount();

    expect(state.refreshStatus).toBe("PARTIAL");
    expect(state.funds).toBeNull();
    expect(state.positions.length).toBeGreaterThan(0);
    expect(state.errors.some((error) => error.section === "funds")).toBe(true);
  });

  it("does not modify paper account, paper positions, or paper PnL", async () => {
    const paper = new PaperTradingService();
    const paperState = new AccountStateService();
    await paperState.initializePaperAccount(undefined, { riskConfiguration: longRisk });
    const created = await paper.createTrade({
      signal: {
        symbol: "NVDA",
        side: "BUY",
        entryPrice: 100,
        stopLoss: 99,
        targetPrice: 102,
        timestamp: "10:15"
      },
      strategyName: "Isolation",
      aiExplanation: "Paper trade must stay independent of Kite snapshots."
    });

    expect(created.allowed).toBe(true);
    const before = await paperState.getPaperAccountState();
    const openBefore = await paper.getOpenPositions();

    await service().refreshBrokerAccount();

    const after = await paperState.getPaperAccountState();
    const openAfter = await paper.getOpenPositions();
    expect(after.startingCapital).toBe(before.startingCapital);
    expect(after.currentEquity).toBe(before.currentEquity);
    expect(after.realisedPnl).toBe(before.realisedPnl);
    expect(after.unrealisedPnl).toBe(before.unrealisedPnl);
    expect(openAfter.map((item) => item.id)).toEqual(openBefore.map((item) => item.id));
    expect(openAfter[0]?.tradingMode).toBe("PAPER");
  });

  it("serves mock account state without Kite credentials", async () => {
    const state = await service().getBrokerAccountState();
    expect(state.source).toBe("MOCK");
    expect(state.authenticated).toBe(true);
    expect(state.profile?.userId).toBe("MOCKKITE01");
  });

  it("keeps live Kite order methods disabled", async () => {
    const adapter = new KiteBrokerAdapter({ apiKey: "demo", apiSecret: "demo-secret" });
    await expect(
      adapter.placeOrder({
        symbol: "NSE:RELIANCE",
        exchange: "NSE",
        side: "BUY",
        quantity: 1,
        orderType: "MARKET",
        product: "MIS",
        validity: "DAY"
      })
    ).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(adapter.modifyOrder("1", { quantity: 2 })).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(adapter.cancelOrder("1")).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
  });

  it("throttles explicit refresh", async () => {
    const account = service();
    await account.refreshBrokerAccount();
    await expect(account.refreshBrokerAccount()).rejects.toMatchObject({ code: "KITE_RATE_LIMITED" });
  });
});
