export interface ModuleCardPayload {
  key: string;
  title: string;
  description: string;
  status: string;
  metrics: Array<{
    label: string;
    value: string;
  }>;
}

export interface KiteStatusPayload {
  status: "NOT_CONFIGURED" | "DISCONNECTED" | "VERIFYING" | "CONNECTED" | "AUTH_REQUIRED" | "ERROR";
  brokerConnected: boolean;
  hasStoredSession: boolean;
  verified: boolean;
  lastVerifiedAt: string | null;
  reasonCode: string | null;
  reason: string;
  marketDataLive: boolean;
  paperTradingModeEnabled: boolean;
  liveTradingDisabled: boolean;
  loginUrl: string | null;
  user: {
    userId?: string;
    userName?: string;
    email?: string;
    loginTime?: string;
  } | null;
}

export interface BrokerLtpQuotePayload {
  symbol: string;
  lastPrice: number;
  updatedAt: string;
}

export interface KiteProfilePayload {
  userId: string;
  userName: string;
  email: string;
  broker: string;
  exchanges: string[];
  products: string[];
}

export interface KiteMarginsPayload {
  availableCash: number;
  usedMargin: number;
  net: number;
}

export interface SignalCardPayload {
  symbol: string;
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  score: number;
  matchedSignals: string[];
  entryTrigger: number;
  stopLoss: number;
  target: number;
  riskAmount: number;
  aiExplanation: string;
  riskApproved: boolean;
  suggestedAction: string;
  confidenceLabel: string;
}

export interface ScannerPipelinePayload {
  signalCards: SignalCardPayload[];
  debug: {
    rawInstrumentInput: unknown[];
    scannerOutput: unknown[];
    riskOutput: unknown[];
    finalSignalCards: SignalCardPayload[];
  };
}

export interface PaperAccountView {
  tradingMode: "PAPER";
  startingCapital: number;
  currentEquity: number;
  availableCapital: number;
  usedCapital: number;
  realisedPnl: number;
  unrealisedPnl: number;
  totalPnl: number;
  dayPnl: number;
  openExposure: number;
  tradesToday: number;
  openPositions: number;
  riskUsedToday: number;
  riskRemainingToday: number;
  status: "ACTIVE" | "TRADING_BLOCKED_DAILY_LOSS";
}

export interface BrokerAccountStatePayload {
  source: "KITE" | "MOCK";
  tradingMode: "LIVE";
  authenticated: boolean;
  refreshStatus: "COMPLETE" | "PARTIAL";
  capturedAt: string;
  profile: {
    userId: string;
    userName: string;
    email: string | null;
    broker: string;
  } | null;
  funds: {
    equity: {
      available: { cash: number | null; liveBalance: number | null };
      utilised: { debits: number | null };
      net: number | null;
    } | null;
  } | null;
  positions: Array<{
    tradingSymbol: string;
    exchange: string;
    quantity: number;
    averagePrice: number | null;
    lastPrice: number | null;
    pnl: number | null;
    product: string;
    book: string;
  }>;
  orders: Array<{
    orderId: string;
    tradingSymbol: string;
    status: string;
    transactionType: string;
    quantity: number;
    price: number | null;
  }>;
  holdings: Array<{
    tradingSymbol: string;
    quantity: number;
    averagePrice: number | null;
    lastPrice: number | null;
    pnl: number | null;
  }>;
  pnl: { realised: number; unrealised: number; day: number };
  errors: Array<{ section: string; code: string; message: string }>;
}

export interface MarketStreamStatusPayload {
  state: string;
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

export interface MarketInstrumentPayload {
  id: string;
  exchange: string;
  tradingSymbol: string;
  instrumentToken: string;
  instrumentType: string | null;
  isActive: boolean;
  name?: string | null;
}

export interface MarketUniversePayload {
  equities: MarketInstrumentPayload[];
  page: number;
  pageSize: number;
  hasNext: boolean;
}

export interface PaperTradePayload {
  id: string;
  symbol: string;
  side: string;
  status: string;
  quantity: number;
  pnl: number | null;
  entryPrice?: number | null;
  exitPrice?: number | null;
}

export interface StrategyDefinitionPayload {
  id: string;
  name: string;
  version: string;
  enabled: boolean;
  allowedSessions: string[];
  description: string;
}

export interface StrategyListPayload {
  strategies: StrategyDefinitionPayload[];
  legacy: Array<{ id: string; name: string; market: string; status: string }>;
}

export interface StrategyConditionPayload {
  name: string;
  passed: boolean;
  detail?: string;
}

export interface StrategyEvaluationPayload {
  strategyId: string;
  strategyVersion: string;
  setupIdentity: string;
  instrumentToken: string;
  tradingSymbol: string;
  exchange: string;
  status: "NO_SETUP" | "SETUP_DETECTED" | "SETUP_INVALID" | "DATA_UNAVAILABLE";
  direction: "BULLISH" | "BEARISH" | "NEUTRAL";
  confidence: number | null;
  conditions: StrategyConditionPayload[];
  reasons: string[];
  entry: { type: string; price: number } | null;
  stopLoss: number | null;
  target: number | null;
  rewardRisk: number | null;
  marketSession: string;
  timestamp: string;
}

export interface StrategyStatusPayload {
  lifecycle: string;
  schedulerRunning: boolean;
  busy: boolean;
  enabledStrategyIds: string[];
  lastEvaluations: StrategyEvaluationPayload[];
  marketSession: string;
}

export interface StrategyEvaluatePayload {
  evaluatedAt: string;
  marketSession: string;
  candidateCount: number;
  evaluationCount: number;
  setupCount: number;
  evaluations: StrategyEvaluationPayload[];
  persisted: { count: number; mode: string } | null;
}

export interface StrategySetupRecordPayload {
  id: string;
  setupIdentity: string;
  strategyId: string;
  strategyVersion: string;
  symbol: string;
  exchange: string | null;
  direction: string;
  status: string;
  confidence: number | null;
  entryPrice: number | null;
  stopLoss: number;
  target: number;
  rewardRisk: number;
  reasons: string[];
  capturedAt: string;
}

export interface StrategySignalsPayload {
  mode: string;
  setups: StrategySetupRecordPayload[];
}

export interface ScannerStatusPayload {
  lifecycle: string;
  schedulerRunning: boolean;
  busy: boolean;
  marketSession: string;
  lastRun: {
    runId: string;
    status: string;
    message?: string;
    stats?: {
      candidateCount?: number;
      universeSize?: number;
      evaluatedCount?: number;
    };
    candidateCount?: number;
    candidates?: Array<{
      tradingSymbol: string;
      instrumentToken: string;
      direction: string;
      score: number;
      lastPrice: number;
      reasons: string[];
      dataAgeMs?: number;
      stale?: boolean;
      exchange?: string;
    }>;
  } | null;
  config: {
    enabled: boolean;
    intervalMs: number;
    maxCandidates: number;
    minScore: number;
  };
}

export interface ScannerLatestPayload {
  candidates: Array<{
    tradingSymbol: string;
    instrumentToken: string;
    exchange: string;
    direction: string;
    score: number;
    lastPrice: number;
    reasons: string[];
    dataAgeMs: number;
    stale: boolean;
  }>;
  run: ScannerStatusPayload["lastRun"];
}

export interface PaperExecutionStatusPayload {
  provider: string;
  liveKiteOrders: boolean;
  autoPaperExecution: boolean;
  reconcilerRunning: boolean;
  busy: boolean;
  config: Record<string, unknown>;
  marketSession: string;
}

export interface PaperOrderPayload {
  id: string;
  symbol: string;
  side: string;
  status: string;
  purpose: string;
  orderType?: string;
  quantity: number;
  filledQuantity: number;
  averageFillPrice: number | null;
  price: number | null;
  rejectionCode: string | null;
  createdAt: string;
}
