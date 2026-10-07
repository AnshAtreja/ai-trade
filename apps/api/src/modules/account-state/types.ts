import type { RiskProfile } from "../risk/types";

export type AccountStatus = "ACTIVE" | "TRADING_BLOCKED_DAILY_LOSS";

export type AccountSnapshotEvent =
  | "PAPER_ACCOUNT_INITIALIZED"
  | "PAPER_TRADE_OPENED"
  | "PAPER_TRADE_CLOSED"
  | "POSITION_OPENED"
  | "POSITION_CLOSED"
  | "PAPER_ACCOUNT_REFRESHED";

export interface PaperAccountState {
  tradingMode: "PAPER";
  userId: string;
  sessionDate: string;
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
  winningTradesToday: number;
  losingTradesToday: number;
  dailyLossLimit: number;
  maxRiskPerTrade: number;
  maxOpenPositions: number;
  maxTradesPerDay: number;
  maxCapitalExposure: number;
  riskUsedToday: number;
  riskRemainingToday: number;
  realisedLossesToday: number;
  status: AccountStatus;
  capturedAt: string;
}

export interface PaperAccountView extends Omit<
  PaperAccountState,
  | "userId"
  | "sessionDate"
  | "capturedAt"
  | "winningTradesToday"
  | "losingTradesToday"
  | "dailyLossLimit"
  | "maxRiskPerTrade"
  | "maxOpenPositions"
  | "maxTradesPerDay"
  | "maxCapitalExposure"
  | "realisedLossesToday"
> {
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
  status: AccountStatus;
}

export interface InitializePaperAccountInput {
  startingCapital?: number;
  riskConfiguration?: Partial<RiskProfile> & {
    maxOpenPositions?: number;
    maxCapitalExposure?: number;
    maxTradesPerDay?: number;
    maxPositionSize?: number;
    allowShortSelling?: boolean;
    tradeStartTime?: string;
    tradeEndTime?: string;
    maxRiskPerTradePercent?: number;
    maxDailyLossPercent?: number;
    capital?: number;
  };
}
