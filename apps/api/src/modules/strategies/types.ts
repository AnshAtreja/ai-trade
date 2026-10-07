export interface StrategyDefinition {
  id: string;
  name: string;
  market: string;
  status: "draft" | "paper-ready" | "live-disabled";
}

