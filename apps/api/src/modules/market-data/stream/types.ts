export type MarketStreamMode = "LTP" | "QUOTE" | "FULL";

export type MarketStreamState =
  | "STOPPED"
  | "CONNECTING"
  | "CONNECTED"
  | "RECONNECTING"
  | "DISCONNECTED"
  | "AUTH_FAILED";

export interface MarketTick {
  instrumentToken: string;
  exchange: string | null;
  tradingSymbol: string | null;
  instrumentId: string | null;
  timestamp: string;
  receivedAt: string;
  lastPrice: number;
  volume: number | null;
  lastTradedQuantity: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  averagePrice: number | null;
  buyQuantity: number | null;
  sellQuantity: number | null;
  exchangeTimestamp: string | null;
  mode: MarketStreamMode;
  source: "KITE" | "MOCK";
  orderKey: string;
}

export interface ParsedTickPacket {
  instrumentToken: string;
  lastPrice: number;
  volume: number | null;
  lastTradedQuantity: number | null;
  averagePrice: number | null;
  buyQuantity: number | null;
  sellQuantity: number | null;
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  exchangeTimestampMs: number | null;
  mode: MarketStreamMode;
}

export interface ParseError {
  code: "MALFORMED_PACKET" | "TRUNCATED_PACKET" | "INVALID_FRAME";
  message: string;
}

export interface ParseResult {
  ticks: ParsedTickPacket[];
  errors: ParseError[];
}

export interface MarketStreamStatus {
  state: MarketStreamState;
  running: boolean;
  connected: boolean;
  receiving: boolean;
  connectedAt: string | null;
  lastMessageAt: string | null;
  reconnectCount: number;
  subscriptionCount: number;
  lastError: { code: string; message: string } | null;
  source: "KITE" | "MOCK";
}

export interface SubscriptionRecord {
  instrumentToken: string;
  mode: MarketStreamMode;
}

export interface MarketStreamProvider {
  readonly source: "KITE" | "MOCK";
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  subscribe(instrumentTokens: string[]): Promise<void>;
  unsubscribe(instrumentTokens: string[]): Promise<void>;
  setMode(instrumentTokens: string[], mode: MarketStreamMode): Promise<void>;
  setHandlers(handlers: MarketStreamHandlers): void;
}

export interface MarketStreamHandlers {
  onOpen?: () => void;
  onClose?: (info: { code?: number; reason?: string }) => void;
  onError?: (error: Error) => void;
  onFrame?: (data: Buffer | string) => void;
}

export function kiteModeName(mode: MarketStreamMode) {
  switch (mode) {
    case "FULL":
      return "full";
    case "QUOTE":
      return "quote";
    default:
      return "ltp";
  }
}

export function parseMarketStreamMode(value: string | undefined): MarketStreamMode {
  const normalized = value?.trim().toUpperCase();
  if (normalized === "QUOTE" || normalized === "FULL" || normalized === "LTP") {
    return normalized;
  }
  return "LTP";
}
