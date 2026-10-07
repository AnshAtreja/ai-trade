import { floorToCandleBucket } from "../../common/utils/candle-buckets";
import type { NormalizedHistoricalCandle } from "./types";

/**
 * Aggregate finalized 1m OHLCV candles into 5m candles.
 * - open = first open
 * - high = max high
 * - low = min low
 * - close = last close
 * - volume = sum
 * - openInterest = last non-null OI in the bucket (else null)
 *
 * Incomplete trailing buckets (fewer than expected minutes and not closed) are omitted when
 * `includeIncomplete` is false (default) — historical replay should use finalized candles.
 */
export function aggregateOneMinuteToFiveMinute(
  candles1m: NormalizedHistoricalCandle[],
  options?: { includeIncomplete?: boolean; asOf?: Date }
): NormalizedHistoricalCandle[] {
  const includeIncomplete = options?.includeIncomplete === true;
  const asOfMs = options?.asOf?.getTime() ?? Number.POSITIVE_INFINITY;
  const buckets = new Map<number, NormalizedHistoricalCandle[]>();

  for (const candle of candles1m) {
    if (candle.interval !== "1m") {
      continue;
    }
    if (candle.timestamp.getTime() >= asOfMs) {
      continue;
    }
    const bucket = floorToCandleBucket(candle.timestamp.getTime(), "5m");
    const list = buckets.get(bucket) ?? [];
    list.push(candle);
    buckets.set(bucket, list);
  }

  const result: NormalizedHistoricalCandle[] = [];
  const sortedKeys = [...buckets.keys()].sort((a, b) => a - b);

  for (const bucketStart of sortedKeys) {
    const members = (buckets.get(bucketStart) ?? []).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime()
    );
    if (members.length === 0) continue;

    const bucketEnd = bucketStart + 300_000;
    const complete = members.length >= 5 || bucketEnd <= asOfMs;
    if (!complete && !includeIncomplete) {
      continue;
    }

    const first = members[0]!;
    const last = members[members.length - 1]!;
    let oi: number | null = null;
    for (const m of members) {
      if (m.openInterest != null) oi = m.openInterest;
    }

    result.push({
      instrumentId: first.instrumentId,
      instrumentToken: first.instrumentToken,
      exchange: first.exchange,
      tradingSymbol: first.tradingSymbol,
      interval: "5m",
      timestamp: new Date(bucketStart),
      open: first.open,
      high: Math.max(...members.map((m) => m.high)),
      low: Math.min(...members.map((m) => m.low)),
      close: last.close,
      volume: members.reduce((sum, m) => sum + m.volume, 0),
      openInterest: oi,
      source: "DERIVED_5M",
      adjustment: first.adjustment,
      fetchedAt: new Date(Math.max(...members.map((m) => m.fetchedAt.getTime())))
    });
  }

  return result;
}
