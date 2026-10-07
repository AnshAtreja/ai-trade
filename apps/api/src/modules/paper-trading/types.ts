import type { OrderRecord, PositionRecord } from "../../db/domain";
import type { PaperAccountView } from "../account-state/types";
import type { CurrentDayStats, RiskProfile, RiskRejectionReason, TradeSide } from "../risk/types";

export type PaperAccount = PaperAccountView;

export interface PaperPosition {
  symbol: string;
  quantity: number;
  averagePrice: number;
  marketPrice: number;
}

export type PaperTradeStatus = "OPEN" | "CLOSED" | "CANCELLED";

export type PaperExitReason = "STOP_LOSS" | "TARGET" | "MANUAL" | "CANCELLED";

export interface ApprovedPaperSignal {
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  stopLoss?: number;
  targetPrice: number;
  timestamp: string;
}

export interface CreatePaperTradeInput {
  signal: ApprovedPaperSignal;
  riskProfile?: RiskProfile;
  currentDayStats?: CurrentDayStats;
  strategyName: string;
  aiExplanation: string;
  scannerSignalId?: string;
}

export interface PaperTrade {
  id: string;
  symbol: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  lastPrice: number;
  status: PaperTradeStatus;
  openedAt: string;
  updatedAt: string;
  closedAt?: string;
  exitPrice?: number;
  exitReason?: PaperExitReason;
  pnl: number;
  maxLoss: number;
  aiExplanation: string;
  strategyName: string;
}

export interface PaperTradeDraft {
  symbol: string;
  side: TradeSide;
  quantity: number;
  entryPrice: number;
  stopLoss: number;
  targetPrice: number;
  maxLoss: number;
  aiExplanation: string;
  strategyName: string;
  openedAt: string;
}

export interface CreatePaperTradeResult {
  allowed: boolean;
  rejectionReasons: RiskRejectionReason[];
  calculatedQuantity: number;
  maxLoss: number;
  trade?: PaperTrade;
  position?: PositionRecord;
  entryOrder?: OrderRecord;
}

export interface PriceTick {
  symbol: string;
  price: number;
  timestamp?: string;
}

export interface PriceRangeTick {
  symbol: string;
  high: number;
  low: number;
  close: number;
  timestamp?: string;
}

export interface PriceTickResult {
  tick: Required<PriceTick>;
  updatedTrades: PaperTrade[];
  closedTrades: PaperTrade[];
}
