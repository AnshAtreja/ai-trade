/**
 * Shared candle bucket alignment (UTC epoch floor).
 * Used by Phase 6 live tick aggregation and Phase 8A historical 1m→5m aggregation.
 * NSE cash 09:15 IST (= 03:45 UTC) aligns to epoch 1m/5m boundaries.
 */
export type CandleBucketInterval = "1m" | "5m";

export function candleIntervalMs(interval: CandleBucketInterval): number {
  return interval === "1m" ? 60_000 : 300_000;
}

export function floorToCandleBucket(ms: number, interval: CandleBucketInterval): number {
  const size = candleIntervalMs(interval);
  return Math.floor(ms / size) * size;
}

export function candleBucketEndMs(bucketStartMs: number, interval: CandleBucketInterval): number {
  return bucketStartMs + candleIntervalMs(interval);
}
