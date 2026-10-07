import type { RiskProfile } from "./types";

export const mockRiskProfile: RiskProfile = {
  capital: 100000,
  maxRiskPerTradePercent: 1,
  maxDailyLossPercent: 3,
  maxTradesPerDay: 8,
  maxPositionSize: 5000,
  allowShortSelling: false,
  tradeStartTime: "09:30",
  tradeEndTime: "15:30"
};
