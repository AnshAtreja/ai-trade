import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { getStrategyEngineService } from "./engine-service";
import { mockStrategies } from "./mock-data";

export interface StrategiesService {
  listStrategies: () => Promise<typeof mockStrategies>;
  getSummary: () => ModuleSummary;
}

export class MockStrategiesService implements StrategiesService {
  async listStrategies() {
    return mockStrategies;
  }

  getSummary(): ModuleSummary {
    const engine = getStrategyEngineService();
    const strategies = engine.listStrategies();
    const setups = engine.getLatestSignals();
    return {
      key: "strategies",
      title: "Strategies",
      description:
        "Deterministic intraday strategy engine. Outputs analytical setups only — never places orders.",
      status: "Active",
      metrics: [
        { label: "Strategies", value: String(strategies.length) },
        { label: "Enabled", value: String(strategies.filter((s) => s.enabled).length) },
        { label: "Latest setups", value: String(setups.length) }
      ]
    };
  }
}

export const strategiesService = new MockStrategiesService();
