import { env } from "../../config/env";
import type { HistoricalCandleIntervalCode } from "../../db/domain";

export interface HistoricalMarketDataConfig {
  provider: "kite" | "mock";
  persistenceEnabled: boolean;
  /** Minimum delay between Kite historical requests (conservative vs documented 3 req/s). */
  throttleMinIntervalMs: number;
  maxRetries: number;
  retryBackoffMs: number;
  /** Default chunk window for 1m downloads (days). */
  chunkWindowDays1m: number;
  /** Overlap between consecutive chunks to avoid boundary misses (minutes). Deduped on persist. */
  chunkOverlapMinutes: number;
  validateOnPersist: boolean;
  /** When downloading 1m, optionally derive+persist 5m locally. */
  persistDerived5m: boolean;
  defaultInterval: HistoricalCandleIntervalCode;
}

export function getHistoricalMarketDataConfig(
  overrides: Partial<HistoricalMarketDataConfig> = {}
): HistoricalMarketDataConfig {
  return {
    provider: env.HISTORICAL_PROVIDER,
    persistenceEnabled: env.HISTORICAL_PERSISTENCE_ENABLED,
    throttleMinIntervalMs: env.HISTORICAL_THROTTLE_MS,
    maxRetries: env.HISTORICAL_MAX_RETRIES,
    retryBackoffMs: env.HISTORICAL_RETRY_BACKOFF_MS,
    chunkWindowDays1m: env.HISTORICAL_CHUNK_DAYS_1M,
    chunkOverlapMinutes: env.HISTORICAL_CHUNK_OVERLAP_MINUTES,
    validateOnPersist: env.HISTORICAL_VALIDATE_ON_PERSIST,
    persistDerived5m: env.HISTORICAL_PERSIST_DERIVED_5M,
    defaultInterval: "1m",
    ...overrides
  };
}
