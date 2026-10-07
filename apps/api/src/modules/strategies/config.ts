import { z } from "zod";
import { env } from "../../config/env";

const strategyConfigSchema = z.object({
  enabledStrategies: z.array(z.string()).min(1),
  tickHistorySize: z.number().int().positive(),
  maxDataAgeMs: z.number().int().positive(),
  evaluationIntervalMs: z.number().int().positive(),
  schedulerEnabled: z.boolean(),
  minRewardRisk: z.number().positive(),
  breakout: z.object({
    minVolume: z.number().nonnegative(),
    proximityPercent: z.number().positive(),
    confirmationTicks: z.number().int().positive(),
    stopBufferPercent: z.number().positive(),
    targetRewardRisk: z.number().positive(),
    minMomentumPercent: z.number().positive()
  }),
  breakdown: z.object({
    minVolume: z.number().nonnegative(),
    proximityPercent: z.number().positive(),
    confirmationTicks: z.number().int().positive(),
    stopBufferPercent: z.number().positive(),
    targetRewardRisk: z.number().positive(),
    minMomentumPercent: z.number().positive()
  }),
  momentum: z.object({
    minVolume: z.number().nonnegative(),
    minMovePercent: z.number().positive(),
    maxExtensionPercent: z.number().positive(),
    minSustainedCandles: z.number().int().positive(),
    stopBufferPercent: z.number().positive(),
    targetRewardRisk: z.number().positive()
  }),
  openingMomentum: z.object({
    minVolume: z.number().nonnegative(),
    openingRangeMinutes: z.number().int().positive(),
    breakBufferPercent: z.number().positive(),
    stopBufferPercent: z.number().positive(),
    targetRewardRisk: z.number().positive(),
    minMomentumPercent: z.number().positive()
  })
});

export type StrategyConfig = z.infer<typeof strategyConfigSchema>;

export function getStrategyConfig(overrides: Partial<StrategyConfig> = {}): StrategyConfig {
  const base: StrategyConfig = {
    enabledStrategies: env.STRATEGY_ENABLED_IDS.split(",")
      .map((id) => id.trim())
      .filter(Boolean),
    tickHistorySize: env.STRATEGY_TICK_HISTORY_SIZE,
    maxDataAgeMs: env.STRATEGY_MAX_DATA_AGE_MS,
    evaluationIntervalMs: env.STRATEGY_INTERVAL_MS,
    schedulerEnabled: env.STRATEGY_ENABLED,
    minRewardRisk: env.STRATEGY_MIN_REWARD_RISK,
    breakout: {
      minVolume: 1000,
      proximityPercent: 0.35,
      confirmationTicks: 2,
      stopBufferPercent: 0.15,
      targetRewardRisk: 2,
      minMomentumPercent: 0.2
    },
    breakdown: {
      minVolume: 1000,
      proximityPercent: 0.35,
      confirmationTicks: 2,
      stopBufferPercent: 0.15,
      targetRewardRisk: 2,
      minMomentumPercent: 0.2
    },
    momentum: {
      minVolume: 1000,
      minMovePercent: 0.35,
      maxExtensionPercent: 4,
      minSustainedCandles: 2,
      stopBufferPercent: 0.2,
      targetRewardRisk: 1.8
    },
    openingMomentum: {
      minVolume: 500,
      openingRangeMinutes: 15,
      breakBufferPercent: 0.05,
      stopBufferPercent: 0.2,
      targetRewardRisk: 2,
      minMomentumPercent: 0.15
    }
  };

  const merged: StrategyConfig = {
    ...base,
    ...overrides,
    breakout: { ...base.breakout, ...overrides.breakout },
    breakdown: { ...base.breakdown, ...overrides.breakdown },
    momentum: { ...base.momentum, ...overrides.momentum },
    openingMomentum: { ...base.openingMomentum, ...overrides.openingMomentum },
    enabledStrategies: overrides.enabledStrategies ?? base.enabledStrategies
  };

  return strategyConfigSchema.parse(merged);
}
