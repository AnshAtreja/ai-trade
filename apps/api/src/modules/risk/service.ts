import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { mockRiskProfile } from "./mock-data";
import type { CurrentDayStats, RiskProfile, TradeSignal } from "./types";
import { validateTrade } from "./validator";

export interface RiskService {
  getProfile: () => Promise<typeof mockRiskProfile>;
  validateTrade: (signal: TradeSignal, riskProfile: RiskProfile, currentDayStats: CurrentDayStats) => ReturnType<typeof validateTrade>;
  getSummary: () => ModuleSummary;
}

export class MockRiskService implements RiskService {
  async getProfile() {
    return mockRiskProfile;
  }

  validateTrade(signal: TradeSignal, riskProfile: RiskProfile, currentDayStats: CurrentDayStats) {
    return validateTrade(signal, riskProfile, currentDayStats);
  }

  getSummary(): ModuleSummary {
    return {
      key: "risk",
      title: "Risk",
      description: "Strict trade validation checks stops, sizing, daily limits, trade count, schedule, and reward-to-risk.",
      status: "Active",
      metrics: [
        { label: "Capital", value: `$${mockRiskProfile.capital.toLocaleString()}` },
        { label: "Risk per trade", value: `${mockRiskProfile.maxRiskPerTradePercent}%` }
      ]
    };
  }
}

export const riskService = new MockRiskService();
