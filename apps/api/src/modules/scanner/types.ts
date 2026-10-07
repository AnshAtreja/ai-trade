export interface ScanCandidate {
  symbol: string;
  setup: string;
  score: number;
  timeframe: string;
}

export type IntradayDirection = "BULLISH" | "BEARISH" | "NEUTRAL";

export type IntradaySignal =
  | "GAP_UP"
  | "GAP_DOWN"
  | "VOLUME_SPIKE"
  | "PRICE_NEAR_DAY_HIGH"
  | "PRICE_NEAR_DAY_LOW"
  | "BREAKOUT_ABOVE_PREVIOUS_HIGH"
  | "BREAKDOWN_BELOW_PREVIOUS_LOW";

export interface IntradayInstrumentInput {
  symbol: string;
  currentPrice: number;
  openPrice: number;
  previousClose: number;
  currentVolume: number;
  averageVolume: number;
  dayHigh: number;
  dayLow: number;
  vwap?: number;
  previousHigh?: number;
  previousLow?: number;
}

export interface IntradayScannerOptions {
  gapThresholdPercent?: number;
  volumeSpikeThreshold?: number;
  nearHighLowThresholdPercent?: number;
}

export interface IntradayWatchlistCandidate {
  symbol: string;
  direction: IntradayDirection;
  score: number;
  matchedSignals: IntradaySignal[];
  explanation: string;
}
