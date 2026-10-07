/**
 * Mock broker adapter for demo/paper workflows.
 * persistent: no
 * mock: yes
 * broker integration: fake profile/LTP/candles
 * paper trading: placeOrder here is simulated only
 * live trading disabled: this is not the Kite live adapter; Kite live methods still throw
 */
import type {
  BrokerAdapter,
  BrokerInstrument,
  BrokerLtpQuote,
  BrokerMargins,
  BrokerOrderRequest,
  BrokerOrderResponse,
  BrokerOrderUpdate,
  BrokerProfile,
  HistoricalCandle,
  HistoricalCandleInterval,
  TickSubscription
} from "../types";

const mockInstruments: BrokerInstrument[] = [
  {
    symbol: "NSE:RELIANCE",
    exchange: "NSE",
    instrumentToken: "mock_2885",
    name: "Reliance Industries",
    segment: "NSE",
    tickSize: 0.05,
    lotSize: 1
  },
  {
    symbol: "NSE:TCS",
    exchange: "NSE",
    instrumentToken: "mock_2953217",
    name: "Tata Consultancy Services",
    segment: "NSE",
    tickSize: 0.05,
    lotSize: 1
  },
  {
    symbol: "NSE:INFY",
    exchange: "NSE",
    instrumentToken: "mock_408065",
    name: "Infosys",
    segment: "NSE",
    tickSize: 0.05,
    lotSize: 1
  }
];

export class MockBrokerAdapter implements BrokerAdapter {
  private nextMockOrderId = 1;

  async connect() {
    return {
      broker: "Mock Broker",
      connected: true,
      mode: "MOCK" as const,
      message: "Connected to mock broker adapter."
    };
  }

  async getProfile(): Promise<BrokerProfile> {
    return {
      userId: "mock_user_1",
      userName: "Paper Trader",
      email: "paper.trader@tradepilot.local",
      broker: "Mock Broker",
      exchanges: ["NSE", "BSE"],
      products: ["CNC", "MIS", "NRML"]
    };
  }

  async getMargins(): Promise<BrokerMargins> {
    return {
      availableCash: 500000,
      usedMargin: 125000,
      net: 625000
    };
  }

  async getInstruments() {
    return mockInstruments;
  }

  async getLTP(symbols: string[]) {
    return symbols.reduce<Record<string, BrokerLtpQuote>>((quotes, symbol, index) => {
      quotes[symbol] = {
        symbol,
        lastPrice: Number((1000 + index * 137.45).toFixed(2)),
        updatedAt: new Date().toISOString()
      };

      return quotes;
    }, {});
  }

  async getHistoricalCandles(
    symbol: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ): Promise<HistoricalCandle[]> {
    return this.getHistoricalCandlesByToken(symbol, interval, from, to);
  }

  async getHistoricalCandlesByToken(
    instrumentToken: string,
    _interval: HistoricalCandleInterval,
    from: string,
    to: string
  ): Promise<HistoricalCandle[]> {
    const start = new Date(from);
    const end = new Date(to);
    const candles: HistoricalCandle[] = [];

    if (Number.isNaN(start.getTime()) || Number.isNaN(end.getTime()) || start > end) {
      return candles;
    }

    const basePrice = 1000 + String(instrumentToken).length * 8;

    for (let index = 0; index < 5; index += 1) {
      const open = basePrice + index * 2;
      const close = open + (index % 2 === 0 ? 4 : -3);

      candles.push({
        timestamp: new Date(start.getTime() + index * 60_000).toISOString(),
        open,
        high: Math.max(open, close) + 2,
        low: Math.min(open, close) - 2,
        close,
        volume: 100000 + index * 12500,
        openInterest: null
      });
    }

    return candles;
  }

  async subscribeTicks(symbols: string[]): Promise<TickSubscription> {
    return {
      id: `mock_ticks_${Date.now()}`,
      symbols,
      status: "MOCK_SUBSCRIBED",
      ticks: symbols.map((symbol, index) => ({
        symbol,
        lastPrice: Number((1000 + index * 25.5).toFixed(2)),
        volume: 250000 + index * 10000,
        timestamp: new Date().toISOString()
      }))
    };
  }

  async placeOrder(orderRequest: BrokerOrderRequest): Promise<BrokerOrderResponse> {
    return {
      orderId: `mock_order_${this.nextMockOrderId++}`,
      status: "MOCKED",
      message: `Mock order accepted for ${orderRequest.side} ${orderRequest.quantity} ${orderRequest.symbol}.`
    };
  }

  async modifyOrder(orderId: string, _update: BrokerOrderUpdate): Promise<BrokerOrderResponse> {
    return {
      orderId,
      status: "MOCKED",
      message: "Mock order modification accepted."
    };
  }

  async cancelOrder(orderId: string): Promise<BrokerOrderResponse> {
    return {
      orderId,
      status: "CANCELLED",
      message: "Mock order cancelled."
    };
  }
}

export const mockBrokerAdapter = new MockBrokerAdapter();
