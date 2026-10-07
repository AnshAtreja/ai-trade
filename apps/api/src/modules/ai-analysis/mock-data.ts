import type { AiScannerAnalysisInput } from "./types";

export const mockAnalysisInputs: AiScannerAnalysisInput[] = [
  {
    symbol: "NVDA",
    direction: "BULLISH",
    score: 86,
    signals: ["GAP_UP", "VOLUME_SPIKE", "PRICE_NEAR_DAY_HIGH", "BREAKOUT_ABOVE_PREVIOUS_HIGH"],
    priceData: {
      currentPrice: 1048.12,
      dayHigh: 1050,
      vwap: 1037.45
    },
    riskData: {
      invalidationLevel: 1037.45,
      maxLoss: 250,
      calculatedQuantity: 25,
      rewardToRiskRatio: 2.1
    }
  },
  {
    symbol: "TSLA",
    direction: "BEARISH",
    score: 66,
    signals: ["GAP_DOWN", "PRICE_NEAR_DAY_LOW", "BREAKDOWN_BELOW_PREVIOUS_LOW"],
    priceData: {
      currentPrice: 176.1,
      dayLow: 175.9,
      vwap: 178.22
    },
    riskData: {
      invalidationLevel: 178.22,
      maxLoss: 180,
      calculatedQuantity: 30,
      rewardToRiskRatio: 1.4
    }
  }
];
