export interface BrokerConnection {
  id: string;
  broker: string;
  accountMask: string;
  status: "connected" | "disconnected" | "sandbox";
}

export type BrokerOrderSide = "BUY" | "SELL";

export type BrokerOrderType = "MARKET" | "LIMIT" | "SL" | "SL_MARKET";

export type BrokerProductType = "CNC" | "MIS" | "NRML";

export type BrokerValidity = "DAY" | "IOC";

export type BrokerOrderStatus = "OPEN" | "COMPLETE" | "CANCELLED" | "REJECTED" | "MOCKED";

export interface BrokerAdapter {
  connect: () => Promise<BrokerConnectionResult>;
  getProfile: () => Promise<BrokerProfile>;
  getMargins: () => Promise<BrokerMargins>;
  getInstruments: () => Promise<BrokerInstrument[]>;
  getLTP: (symbols: string[]) => Promise<Record<string, BrokerLtpQuote>>;
  getHistoricalCandles: (
    symbol: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ) => Promise<HistoricalCandle[]>;
  /** Prefer token-based historical fetch when the instrument token is already known. */
  getHistoricalCandlesByToken: (
    instrumentToken: string,
    interval: HistoricalCandleInterval,
    from: string,
    to: string
  ) => Promise<HistoricalCandle[]>;
  subscribeTicks: (symbols: string[]) => Promise<TickSubscription>;
  placeOrder: (orderRequest: BrokerOrderRequest) => Promise<BrokerOrderResponse>;
  modifyOrder: (orderId: string, update: BrokerOrderUpdate) => Promise<BrokerOrderResponse>;
  cancelOrder: (orderId: string) => Promise<BrokerOrderResponse>;
}

export interface KiteSession {
  accessToken: string;
  publicToken?: string;
  userId?: string;
  userName?: string;
  email?: string;
  loginTime?: string;
  storedAt: string;
}

export interface BrokerConnectionResult {
  broker: string;
  connected: boolean;
  mode: "MOCK" | "LIVE_DISABLED";
  message: string;
}

export interface BrokerProfile {
  userId: string;
  userName: string;
  email: string;
  broker: string;
  exchanges: string[];
  products: BrokerProductType[];
}

export interface BrokerMargins {
  availableCash: number;
  usedMargin: number;
  net: number;
}

export interface BrokerInstrument {
  symbol: string;
  exchange: string;
  instrumentToken: string;
  exchangeToken?: string;
  name: string;
  segment: string;
  instrumentType?: string;
  expiry?: string | null;
  strike?: number | null;
  tickSize: number;
  lotSize: number;
}

export interface BrokerLtpQuote {
  symbol: string;
  lastPrice: number;
  updatedAt: string;
}

export interface BrokerMarketQuote extends BrokerLtpQuote {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  averagePrice?: number;
  instrumentToken?: number;
  buyQuantity?: number;
  sellQuantity?: number;
}

export type HistoricalCandleInterval = "minute" | "3minute" | "5minute" | "15minute" | "30minute" | "day";

export interface HistoricalCandle {
  timestamp: string;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest?: number | null;
}

export interface TickSubscription {
  id: string;
  symbols: string[];
  status: "MOCK_SUBSCRIBED" | "DISCONNECTED";
  ticks: BrokerTick[];
}

export interface BrokerTick {
  symbol: string;
  lastPrice: number;
  volume: number;
  timestamp: string;
}

export interface BrokerOrderRequest {
  symbol: string;
  exchange: string;
  side: BrokerOrderSide;
  quantity: number;
  orderType: BrokerOrderType;
  product: BrokerProductType;
  validity: BrokerValidity;
  price?: number;
  triggerPrice?: number;
  tag?: string;
}

export interface BrokerOrderUpdate {
  quantity?: number;
  price?: number;
  triggerPrice?: number;
  validity?: BrokerValidity;
}

export interface BrokerOrderResponse {
  orderId: string;
  status: BrokerOrderStatus;
  message: string;
}
