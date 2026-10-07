import type { MarketTick } from "../../market-data/stream/types";
import type { PaperExecutionConfig } from "./config";

export type PaperOrderType = "MARKET" | "LIMIT";
export type ExecutionPurpose = "ENTRY" | "EXIT";
export type RejectionSource = "PAPER_SIMULATION_REJECTION" | "REAL_KITE_REJECTION";

export type PaperRejectionCode =
  | "MARKET_CLOSED"
  | "STALE_MISSING_MARKET_DATA"
  | "INVALID_QUANTITY"
  | "INVALID_PRICE"
  | "INSUFFICIENT_PAPER_CAPITAL"
  | "INSUFFICIENT_LIQUIDITY"
  | "ORDER_TIMEOUT"
  | "INVALID_INSTRUMENT"
  | "DUPLICATE_REQUEST"
  | "TRADING_BLOCKED"
  | "SQUARE_OFF_BLOCK"
  | "SETUP_STALE"
  | "LIMIT_NOT_CROSSED"
  | "LIVE_TRADING_DISABLED";

export interface ExecutionMarketView {
  instrumentToken: string | null;
  symbol: string;
  exchange: string | null;
  ltp: number;
  bid: number | null;
  ask: number | null;
  bidQty: number | null;
  askQty: number | null;
  spread: number | null;
  usedFallbackSpread: boolean;
  dataTimestamp: string;
  receivedAt: string;
  dataAgeMs: number;
  stale: boolean;
  source: "KITE" | "MOCK" | "TEST";
  mode: string;
}

export interface ExecutionRequest {
  userId: string;
  paperAccountMode: "PAPER";
  symbol: string;
  instrumentToken: string | null;
  instrumentId: string | null;
  side: "BUY" | "SELL";
  orderType: PaperOrderType;
  quantity: number;
  limitPrice: number | null;
  requestedPrice: number | null;
  purpose: ExecutionPurpose;
  strategySetupId: string | null;
  tradeId: string | null;
  positionId: string | null;
  stopLoss: number | null;
  targetPrice: number | null;
  strategyName: string | null;
  explanation: string | null;
  scannerSignalId: string | null;
  clientOrderId: string;
  idempotencyKey: string;
  signalTimestamp: string;
  requestTimestamp: string;
  timeInForceMs: number | null;
}

export interface SimulatedFillSlice {
  quantity: number;
  price: number;
  referencePrice: number;
  slippageAmount: number;
  fillKey: string;
  market: ExecutionMarketView;
}

export interface ExecutionResult {
  status:
    | "REJECTED"
    | "SUBMITTED"
    | "PARTIALLY_FILLED"
    | "FILLED"
    | "EXPIRED"
    | "CANCELLED"
    | "DUPLICATE";
  rejectionCode?: PaperRejectionCode;
  rejectionSource?: RejectionSource;
  orderId?: string;
  tradeId?: string;
  positionId?: string;
  fills: SimulatedFillSlice[];
  message: string;
}

export interface FillDecision {
  action: "FILL" | "PARTIAL" | "REJECT" | "KEEP_OPEN" | "EXPIRE";
  fillQuantity: number;
  referencePrice: number;
  fillPrice: number;
  slippageAmount: number;
  reason: string;
  market: ExecutionMarketView;
}

export function toExecutionMarketView(
  tick: MarketTick | null,
  config: PaperExecutionConfig,
  now = new Date(),
  overrides?: Partial<ExecutionMarketView>
): ExecutionMarketView | null {
  if (!tick || !(tick.lastPrice > 0)) {
    return null;
  }

  const receivedAt = tick.receivedAt;
  const dataTimestamp = tick.exchangeTimestamp ?? tick.receivedAt;
  const dataAgeMs = Math.max(0, now.getTime() - Date.parse(receivedAt));
  const stale = dataAgeMs > config.maxDataAgeMs;

  let bid = overrides?.bid ?? null;
  let ask = overrides?.ask ?? null;
  let usedFallbackSpread = false;

  if (bid == null || ask == null) {
    if (config.allowLtpFallback) {
      const half = (tick.lastPrice * config.fallbackHalfSpreadBps) / 10_000;
      bid = bid ?? round4(tick.lastPrice - half);
      ask = ask ?? round4(tick.lastPrice + half);
      usedFallbackSpread = true;
    }
  }

  const bidQty = overrides?.bidQty ?? tick.buyQuantity;
  const askQty = overrides?.askQty ?? tick.sellQuantity;
  const spread = bid != null && ask != null ? round4(ask - bid) : null;

  return {
    instrumentToken: tick.instrumentToken,
    symbol: (overrides?.symbol ?? tick.tradingSymbol ?? "").toUpperCase(),
    exchange: tick.exchange,
    ltp: overrides?.ltp ?? tick.lastPrice,
    bid,
    ask,
    bidQty,
    askQty,
    spread,
    usedFallbackSpread,
    dataTimestamp,
    receivedAt,
    dataAgeMs,
    stale,
    source: tick.source,
    mode: tick.mode
  };
}

export function applySlippage(
  side: "BUY" | "SELL",
  referencePrice: number,
  config: PaperExecutionConfig
): { fillPrice: number; slippageAmount: number } {
  if (config.slippagePolicy === "NONE") {
    return { fillPrice: round4(referencePrice), slippageAmount: 0 };
  }

  const amount =
    config.slippagePolicy === "BPS"
      ? (referencePrice * config.slippageBps) / 10_000
      : config.slippageTicks * config.tickSize;

  const fillPrice = side === "BUY" ? referencePrice + amount : referencePrice - amount;
  return { fillPrice: round4(Math.max(config.tickSize, fillPrice)), slippageAmount: round6(amount) };
}

export function round4(value: number) {
  return Math.round(value * 10_000) / 10_000;
}

export function round6(value: number) {
  return Math.round(value * 1_000_000) / 1_000_000;
}

export function round2(value: number) {
  return Math.round(value * 100) / 100;
}
