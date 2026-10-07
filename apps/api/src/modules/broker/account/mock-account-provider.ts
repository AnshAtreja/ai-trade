import type {
  BrokerAccountHolding,
  BrokerAccountOrder,
  BrokerAccountPosition,
  BrokerAccountProfile,
  BrokerAccountProvider,
  BrokerFunds
} from "./types";

const CAPTURED_AT = "2026-09-10T12:00:00.000Z";

const mockProfile: BrokerAccountProfile = {
  source: "MOCK",
  userId: "MOCKKITE01",
  userName: "Paper Trader",
  userShortName: "PAPER",
  email: "paper.trader@tradepilot.local",
  broker: "ZERODHA",
  userType: "individual",
  products: ["CNC", "MIS", "NRML"],
  exchanges: ["NSE", "BSE", "NFO"],
  orderTypes: ["MARKET", "LIMIT", "SL", "SL-M"]
};

const mockFunds: BrokerFunds = {
  source: "MOCK",
  capturedAt: CAPTURED_AT,
  equity: {
    enabled: true,
    net: 80000,
    available: {
      adhocMargin: 0,
      cash: 100000,
      openingBalance: 100000,
      liveBalance: 80000,
      collateral: 0,
      intradayPayin: 0
    },
    utilised: {
      debits: 20000,
      exposure: 20000,
      m2mRealised: 0,
      m2mUnrealised: 0,
      optionPremium: 0,
      payout: 0,
      span: 0,
      holdingSales: 0,
      turnover: 0,
      liquidCollateral: 0,
      stockCollateral: 0,
      delivery: 0
    }
  },
  commodity: {
    enabled: false,
    net: 0,
    available: {
      adhocMargin: 0,
      cash: 0,
      openingBalance: 0,
      liveBalance: 0,
      collateral: 0,
      intradayPayin: 0
    },
    utilised: {
      debits: 0,
      exposure: 0,
      m2mRealised: 0,
      m2mUnrealised: 0,
      optionPremium: 0,
      payout: 0,
      span: 0,
      holdingSales: 0,
      turnover: 0,
      liquidCollateral: 0,
      stockCollateral: 0,
      delivery: 0
    }
  }
};

const mockPositions: BrokerAccountPosition[] = [
  {
    book: "NET",
    exchange: "NSE",
    tradingSymbol: "RELIANCE",
    product: "MIS",
    quantity: 10,
    overnightQuantity: 0,
    buyQuantity: 10,
    sellQuantity: 0,
    buyAverage: 1400,
    sellAverage: 0,
    averagePrice: 1400,
    lastPrice: 1410,
    realisedPnl: 0,
    unrealisedPnl: 100,
    pnl: 100,
    multiplier: 1,
    value: 14100
  },
  {
    book: "NET",
    exchange: "NSE",
    tradingSymbol: "INFY",
    product: "MIS",
    quantity: -5,
    overnightQuantity: 0,
    buyQuantity: 0,
    sellQuantity: 5,
    buyAverage: 0,
    sellAverage: 1500,
    averagePrice: 1500,
    lastPrice: 1490,
    realisedPnl: 0,
    unrealisedPnl: 50,
    pnl: 50,
    multiplier: 1,
    value: -7450
  }
];

const mockOrders: BrokerAccountOrder[] = [
  {
    orderId: "mock_order_complete_1",
    exchange: "NSE",
    tradingSymbol: "RELIANCE",
    transactionType: "BUY",
    quantity: 10,
    filledQuantity: 10,
    pendingQuantity: 0,
    price: 1400,
    averagePrice: 1400,
    triggerPrice: null,
    orderType: "LIMIT",
    product: "MIS",
    validity: "DAY",
    status: "COMPLETE",
    statusMessage: null,
    orderTimestamp: CAPTURED_AT,
    exchangeTimestamp: CAPTURED_AT
  },
  {
    orderId: "mock_order_pending_1",
    exchange: "NSE",
    tradingSymbol: "INFY",
    transactionType: "SELL",
    quantity: 5,
    filledQuantity: 0,
    pendingQuantity: 5,
    price: 1510,
    averagePrice: 0,
    triggerPrice: null,
    orderType: "LIMIT",
    product: "MIS",
    validity: "DAY",
    status: "OPEN",
    statusMessage: "Pending at exchange",
    orderTimestamp: CAPTURED_AT,
    exchangeTimestamp: null
  }
];

const mockHoldings: BrokerAccountHolding[] = [
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
];

export class MockBrokerAccountProvider implements BrokerAccountProvider {
  readonly source = "MOCK" as const;

  isConfigured() {
    return true;
  }

  isAuthenticated() {
    return true;
  }

  async getProfile() {
    return structuredClone(mockProfile);
  }

  async getFunds() {
    return structuredClone(mockFunds);
  }

  async getPositions() {
    return structuredClone(mockPositions);
  }

  async getOrders() {
    return structuredClone(mockOrders);
  }

  async getHoldings() {
    return structuredClone(mockHoldings);
  }
}

export const mockBrokerAccountProvider = new MockBrokerAccountProvider();
