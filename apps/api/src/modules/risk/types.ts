export interface RiskProfile {
  capital: number;
  maxRiskPerTradePercent: number;
  maxDailyLossPercent: number;
  maxTradesPerDay: number;
  maxPositionSize: number;
  maxOpenPositions?: number;
  maxCapitalExposure?: number;
  allowShortSelling: boolean;
  tradeStartTime: string;
  tradeEndTime: string;
}

export type TradeSide = "BUY" | "SELL" | "SHORT";

export interface TradeSignal {
  symbol: string;
  side: TradeSide;
  entryPrice: number;
  stopLoss?: number;
  targetPrice: number;
  quantity: number;
  timestamp: string;
}

export interface CurrentDayStats {
  dailyLoss: number;
  tradesTaken: number;
}

export interface AccountRiskContext {
  availableCapital: number;
  openExposure: number;
  openPositions: number;
  dayPnl: number;
  dailyLossLimit: number;
  newTradeExposure: number;
  status?: "ACTIVE" | "TRADING_BLOCKED_DAILY_LOSS";
  maxOpenPositions?: number;
  maxCapitalExposure?: number;
}

export type RiskRejectionCode =
  | "STOP_LOSS_MISSING"
  | "INVALID_QUANTITY"
  | "INVALID_STOP_LOSS"
  | "INVALID_TARGET"
  | "RISK_PER_TRADE_EXCEEDS_LIMIT"
  | "DAILY_LOSS_LIMIT_REACHED"
  | "DAILY_LOSS_LIMIT_WOULD_BE_EXCEEDED"
  | "MAX_TRADES_REACHED"
  | "OUTSIDE_ALLOWED_TIME"
  | "TARGET_SMALLER_THAN_RISK"
  | "POSITION_SIZE_EXCEEDS_LIMIT"
  | "SHORT_SELLING_NOT_ALLOWED"
  | "MAX_OPEN_POSITIONS_REACHED"
  | "MAX_CAPITAL_EXPOSURE_EXCEEDED"
  | "INSUFFICIENT_AVAILABLE_CAPITAL"
  | "TRADING_BLOCKED_DAILY_LOSS";

export interface RiskRejectionReason {
  code: RiskRejectionCode;
  message: string;
}

export interface TradeRiskValidationResult {
  allowed: boolean;
  rejectionReasons: RiskRejectionReason[];
  calculatedQuantity: number;
  maxLoss: number;
}
