import type { StrategyDefinition } from "./types";

export const mockStrategies: StrategyDefinition[] = [
  { id: "strat_1", name: "Gap and Go", market: "Equities", status: "paper-ready" },
  { id: "strat_2", name: "Mean Reversion Reclaim", market: "Equities", status: "draft" },
  { id: "strat_3", name: "Momentum Basket", market: "ETF", status: "live-disabled" }
];

