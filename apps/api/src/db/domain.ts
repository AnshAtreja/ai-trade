export type TradingMode = "PAPER" | "LIVE";
export type OrderSide = "BUY" | "SELL";
export type OrderStatus =
  | "CREATED"
  | "SUBMITTED"
  | "OPEN"
  | "PARTIALLY_FILLED"
  | "FILLED"
  | "REJECTED"
  | "CANCELLED"
  | "FAILED"
  | "EXPIRED";
export type PositionStatus = "OPEN" | "CLOSED";
export type SignalDirection = "BULLISH" | "BEARISH" | "NEUTRAL";
export type TradeStatus = "PENDING" | "OPEN" | "CLOSED" | "CANCELLED" | "REJECTED";
export type JournalEntryType = "NOTE" | "TRADE_REVIEW" | "RISK_EVENT" | "SYSTEM";
export type SystemLogLevel = "DEBUG" | "INFO" | "WARN" | "ERROR" | "SAFE" | "BLOCKED";
export type BrokerConnectionStatus = "DISCONNECTED" | "CONNECTED" | "SANDBOX";
export type StrategyStatus = "DRAFT" | "PAPER_READY" | "DISABLED";
export type PaperOrderType = "MARKET" | "LIMIT";
export type OrderPurpose = "ENTRY" | "EXIT";

export interface PersistedUser {
  id: string;
  email: string;
  name: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface InstrumentRecord {
  id: string;
  symbol: string;
  exchange: string;
  name: string;
  instrumentToken: string | null;
  exchangeToken: string | null;
  segment: string | null;
  instrumentType: string | null;
  expiry: Date | null;
  strike: number | null;
  tickSize: number;
  lotSize: number;
  isActive: boolean;
  createdAt: Date;
  updatedAt: Date;
}

export interface AccountSnapshotRecord {
  id: string;
  userId: string;
  brokerConnectionId: string | null;
  tradingMode: TradingMode;
  source: string;
  sessionDate: string | null;
  event: string | null;
  status: string;
  startingCapital: number | null;
  equity: number;
  buyingPower: number;
  availableCash: number;
  usedMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dayPnl: number | null;
  openExposure: number | null;
  riskUsedToday: number | null;
  tradesToday: number | null;
  openPositionCount: number | null;
  capturedAt: Date;
  createdAt: Date;
}

export interface BrokerAccountSnapshotRecord {
  id: string;
  userId: string;
  source: string;
  tradingMode: TradingMode;
  event: string;
  refreshStatus: string;
  equityNet: number;
  availableCash: number;
  usedMargin: number;
  realizedPnl: number;
  unrealizedPnl: number;
  dayPnl: number;
  positionCount: number;
  orderCount: number;
  holdingCount: number;
  /** Normalized BrokerAccountState JSON. Never contains tokens. */
  state: unknown;
  capturedAt: Date;
  createdAt: Date;
}

export interface PaperAccountRecord {
  id: string;
  userId: string;
  tradingMode: TradingMode;
  startingCapital: number;
  initializedAt: Date;
  createdAt: Date;
  updatedAt: Date;
}

export interface ScannerSignalRecord {
  id: string;
  userId: string;
  instrumentId: string | null;
  symbol: string;
  direction: SignalDirection;
  score: number;
  matchedSignals: string[];
  explanation: string;
  entryTrigger: number | null;
  stopLoss: number | null;
  target: number | null;
  riskAmount: number | null;
  riskApproved: boolean;
  suggestedAction: string | null;
  confidenceLabel: string | null;
  tradingMode: TradingMode;
  sessionDate: string;
  dedupeKey: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface OrderRecord {
  id: string;
  userId: string;
  tradeId: string | null;
  positionId: string | null;
  strategyId: string | null;
  brokerConnectionId: string | null;
  instrumentId: string | null;
  brokerOrderId: string | null;
  clientOrderId: string | null;
  idempotencyKey: string | null;
  symbol: string;
  side: OrderSide;
  status: OrderStatus;
  purpose: OrderPurpose;
  tradingMode: TradingMode;
  orderType: PaperOrderType;
  quantity: number;
  filledQuantity: number;
  price: number | null;
  limitPrice: number | null;
  averageFillPrice: number | null;
  instrumentToken: string | null;
  strategySetupId: string | null;
  rejectionCode: string | null;
  rejectionSource: string | null;
  submittedAt: Date | null;
  firstFillAt: Date | null;
  filledAt: Date | null;
  cancelledAt: Date | null;
  rejectedAt: Date | null;
  expiredAt: Date | null;
  executableAt: Date | null;
  executionProvenance: Record<string, unknown> | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PaperFillRecord {
  id: string;
  orderId: string;
  userId: string;
  quantity: number;
  price: number;
  fillKey: string;
  marketTimestamp: Date | null;
  receivedAt: Date | null;
  referenceLtp: number | null;
  referenceBid: number | null;
  referenceAsk: number | null;
  referenceBidQty: number | null;
  referenceAskQty: number | null;
  slippageAmount: number | null;
  provenance: Record<string, unknown> | null;
  createdAt: Date;
}

export interface TradeRecord {
  id: string;
  userId: string;
  strategyId: string | null;
  scannerSignalId: string | null;
  instrumentId: string | null;
  symbol: string;
  side: OrderSide;
  status: TradeStatus;
  tradingMode: TradingMode;
  quantity: number;
  entryPrice: number;
  stopLoss: number | null;
  targetPrice: number | null;
  exitPrice: number | null;
  pnl: number;
  maxLoss: number | null;
  rewardToRisk: number | null;
  exitReason: string | null;
  strategyName: string | null;
  explanation: string | null;
  grossPnl: number | null;
  charges: number | null;
  strategySetupId: string | null;
  instrumentToken: string | null;
  openedAt: Date | null;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface PositionRecord {
  id: string;
  userId: string;
  tradeId: string | null;
  instrumentId: string | null;
  symbol: string;
  side: OrderSide;
  status: PositionStatus;
  tradingMode: TradingMode;
  quantity: number;
  originalQuantity: number | null;
  averagePrice: number;
  currentPrice: number | null;
  stopLoss: number | null;
  targetPrice: number | null;
  unrealizedPnl: number;
  realizedPnl: number;
  exitReason: string | null;
  instrumentToken: string | null;
  lastProcessedTickKey: string | null;
  exitInProgress: boolean;
  openedAt: Date;
  closedAt: Date | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface RiskConfigurationRecord {
  id: string;
  userId: string;
  tradingMode: TradingMode;
  capital: number;
  maxRiskPerTradePercent: number;
  maxDailyLossPercent: number;
  maxTradesPerDay: number;
  maxPositionSize: number;
  maxOpenPositions: number;
  maxCapitalExposure: number;
  allowShortSelling: boolean;
  tradeStartTime: string;
  tradeEndTime: string;
  createdAt: Date;
  updatedAt: Date;
}

export interface JournalEntryRecord {
  id: string;
  authorId: string;
  tradeId: string | null;
  type: JournalEntryType;
  title: string;
  body: string;
  mood: string | null;
  tags: string[];
  symbol: string | null;
  createdAt: Date;
  updatedAt: Date;
}

export interface SystemLogRecord {
  id: string;
  userId: string | null;
  level: SystemLogLevel;
  source: string;
  message: string;
  metadata: Record<string, unknown> | null;
  createdAt: Date;
}

export interface MarketSnapshotRecord {
  id: string;
  instrumentId: string | null;
  instrumentToken: string | null;
  symbol: string;
  exchange: string | null;
  source: string;
  lastPrice: number;
  openPrice: number | null;
  highPrice: number | null;
  lowPrice: number | null;
  closePrice: number | null;
  volume: number | null;
  averagePrice: number | null;
  buyQuantity: number | null;
  sellQuantity: number | null;
  capturedAt: Date;
  createdAt: Date;
}

export interface StrategySetupRecord {
  id: string;
  userId: string;
  setupIdentity: string;
  strategyId: string;
  strategyVersion: string;
  instrumentId: string | null;
  instrumentToken: string | null;
  symbol: string;
  exchange: string | null;
  direction: SignalDirection;
  status: string;
  confidence: number | null;
  confidenceComponents: Record<string, number> | null;
  entryType: string | null;
  entryPrice: number | null;
  stopLoss: number;
  target: number;
  rewardRisk: number;
  riskPerUnit: number | null;
  conditions: unknown;
  reasons: string[];
  invalidation: unknown | null;
  scannerSignalId: string | null;
  marketDataTimestamp: Date | null;
  marketSession: string | null;
  capturedAt: Date;
  createdAt: Date;
}

export type HistoricalCandleIntervalCode = "1m" | "5m";
export type HistoricalCandleSource = "KITE" | "MOCK" | "DERIVED_5M";
export type HistoricalCandleAdjustment = "UNADJUSTED" | "ADJUSTED" | "UNKNOWN";

export interface HistoricalCandleRecord {
  id: string;
  instrumentId: string | null;
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  interval: HistoricalCandleIntervalCode;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
  source: HistoricalCandleSource | string;
  adjustment: HistoricalCandleAdjustment | string;
  fetchedAt: Date;
  createdAt: Date;
}

export const DEMO_USER_EMAIL = "demo@tradepilot.local";
export const DEMO_USER_NAME = "TradePilot Demo";
export const MEMORY_DEMO_USER_ID = "user_demo_tradepilot";
