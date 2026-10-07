export type AiAnalysisDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type ConfidenceLabel = "HIGH" | "MEDIUM" | "LOW";

export type SuggestedAction =
  | "WATCH_FOR_LONG_SETUP"
  | "WATCH_FOR_SHORT_SETUP"
  | "WAIT"
  | "SKIP"
  | "REVIEW_RISK_FIRST";

export interface AiPriceData {
  currentPrice?: number;
  openPrice?: number;
  previousClose?: number;
  currentVolume?: number;
  averageVolume?: number;
  dayHigh?: number;
  dayLow?: number;
  vwap?: number;
}

export interface AiRiskData {
  invalidationLevel: number;
  maxLoss?: number;
  calculatedQuantity?: number;
  riskPerTradePercent?: number;
  rewardToRiskRatio?: number;
  rejectionReasons?: string[];
}

export interface AiScannerAnalysisInput {
  symbol: string;
  direction: AiAnalysisDirection;
  score: number;
  signals: string[];
  priceData: AiPriceData;
  riskData: AiRiskData;
}

export interface AiScannerAnalysisOutput {
  summary: string;
  reasons: string[];
  risks: string[];
  suggestedAction: SuggestedAction;
  confidenceLabel: ConfidenceLabel;
}
