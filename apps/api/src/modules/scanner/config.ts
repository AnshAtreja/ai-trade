import { env } from "../../config/env";

export interface ScannerConfig {
  enabled: boolean;
  intervalMs: number;
  maxCandidates: number;
  minScore: number;
  minPrice: number;
  maxPrice: number;
  minVolume: number;
  volumeSpikeThreshold: number;
  minVolatilityPercent: number;
  maxVolatilityPercent: number;
  maxDataAgeMs: number;
  nearHighLowPercent: number;
  breakoutTolerancePercent: number;
  momentumMinPercent: number;
  scoreWeights: {
    volumeActivity: number;
    momentum: number;
    rangeExpansion: number;
    dayExtremumProximity: number;
    priceMovement: number;
  };
}

export function getScannerConfig(overrides: Partial<ScannerConfig> = {}): ScannerConfig {
  const base: ScannerConfig = {
    enabled: env.SCANNER_ENABLED,
    intervalMs: env.SCANNER_INTERVAL_MS,
    maxCandidates: env.SCANNER_MAX_CANDIDATES,
    minScore: env.SCANNER_MIN_SCORE,
    minPrice: env.SCANNER_MIN_PRICE,
    maxPrice: env.SCANNER_MAX_PRICE,
    minVolume: env.SCANNER_MIN_VOLUME,
    volumeSpikeThreshold: env.SCANNER_VOLUME_SPIKE_THRESHOLD,
    minVolatilityPercent: env.SCANNER_MIN_VOLATILITY,
    maxVolatilityPercent: env.SCANNER_MAX_VOLATILITY,
    maxDataAgeMs: env.SCANNER_MAX_DATA_AGE_MS,
    nearHighLowPercent: env.SCANNER_NEAR_HIGH_LOW_PERCENT,
    breakoutTolerancePercent: env.SCANNER_BREAKOUT_TOLERANCE_PERCENT,
    momentumMinPercent: env.SCANNER_MOMENTUM_MIN_PERCENT,
    scoreWeights: {
      volumeActivity: 25,
      momentum: 25,
      rangeExpansion: 20,
      dayExtremumProximity: 20,
      priceMovement: 10
    }
  };

  return {
    ...base,
    ...overrides,
    scoreWeights: { ...base.scoreWeights, ...overrides.scoreWeights }
  };
}
