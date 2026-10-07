import type { StrategyConfig } from "./config";
import type { Strategy, StrategyDefinitionMeta } from "./engine-types";
import { BreakoutStrategy } from "./impl/breakout-strategy";
import { BreakdownStrategy } from "./impl/breakdown-strategy";
import { MomentumStrategy } from "./impl/momentum-strategy";
import { OpeningMomentumStrategy } from "./impl/opening-momentum-strategy";

export class StrategyRegistry {
  private readonly strategies = new Map<string, Strategy>();
  private enabledIds: Set<string>;

  constructor(
    strategies: Strategy[],
    enabledIds: string[]
  ) {
    for (const strategy of strategies) {
      this.strategies.set(strategy.id, strategy);
    }
    this.enabledIds = new Set(enabledIds);
  }

  static createDefault(config: StrategyConfig) {
    const strategies: Strategy[] = [
      new BreakoutStrategy(config),
      new BreakdownStrategy(config),
      new MomentumStrategy(config),
      new OpeningMomentumStrategy(config)
    ];
    return new StrategyRegistry(strategies, config.enabledStrategies);
  }

  list(): StrategyDefinitionMeta[] {
    return [...this.strategies.values()].map((strategy) => ({
      id: strategy.id,
      name: strategy.name,
      version: strategy.version,
      enabled: this.enabledIds.has(strategy.id),
      allowedSessions: strategy.allowedSessions,
      description: `${strategy.name} v${strategy.version}`
    }));
  }

  get(id: string) {
    return this.strategies.get(id) ?? null;
  }

  setEnabled(ids: string[]) {
    this.enabledIds = new Set(ids);
  }

  isEnabled(id: string) {
    return this.enabledIds.has(id);
  }

  enabledStrategies(filterIds?: string[]): Strategy[] {
    const wanted = filterIds?.length ? new Set(filterIds) : this.enabledIds;
    return [...this.strategies.values()].filter(
      (strategy) => wanted.has(strategy.id) && this.enabledIds.has(strategy.id)
    );
  }

  allStrategies() {
    return [...this.strategies.values()];
  }
}
