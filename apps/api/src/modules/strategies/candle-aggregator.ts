import type { MarketTick } from "../market-data/stream/types";
import {
  candleBucketEndMs,
  floorToCandleBucket,
  type CandleBucketInterval
} from "../../common/utils/candle-buckets";

export type CandleInterval = CandleBucketInterval;

export interface MarketCandle {
  instrumentToken: string;
  interval: CandleInterval;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number | null;
  startTime: string;
  endTime: string;
  tickCount: number;
}

/**
 * Lightweight in-memory OHLCV aggregator from ticks.
 * Missing periods are gaps (not zero candles).
 */
export class CandleAggregator {
  private readonly candles = new Map<string, MarketCandle[]>();
  private readonly openBuckets = new Map<string, MarketCandle>();

  constructor(
    private readonly intervals: CandleInterval[] = ["1m", "5m"],
    private readonly maxCandlesPerSeries = 240
  ) {}

  ingest(tick: MarketTick) {
    if (!(tick.lastPrice > 0)) {
      return;
    }

    const tickMs = Date.parse(tick.exchangeTimestamp ?? tick.receivedAt);
    if (!Number.isFinite(tickMs)) {
      return;
    }

    for (const interval of this.intervals) {
      this.ingestForInterval(tick, tickMs, interval);
    }
  }

  getCandles(instrumentToken: string, interval: CandleInterval): MarketCandle[] {
    const key = seriesKey(instrumentToken, interval);
    const closed = this.candles.get(key) ?? [];
    const open = this.openBuckets.get(key);
    return open ? [...closed, open] : [...closed];
  }

  getCompletedCandles(instrumentToken: string, interval: CandleInterval): MarketCandle[] {
    return [...(this.candles.get(seriesKey(instrumentToken, interval)) ?? [])];
  }

  clear(instrumentToken?: string) {
    if (!instrumentToken) {
      this.candles.clear();
      this.openBuckets.clear();
      return;
    }
    for (const interval of this.intervals) {
      const key = seriesKey(instrumentToken, interval);
      this.candles.delete(key);
      this.openBuckets.delete(key);
    }
  }

  private ingestForInterval(tick: MarketTick, tickMs: number, interval: CandleInterval) {
    const key = seriesKey(tick.instrumentToken, interval);
    const bucketStart = floorToCandleBucket(tickMs, interval);
    const bucketEnd = candleBucketEndMs(bucketStart, interval);
    const open = this.openBuckets.get(key);

    if (open && Date.parse(open.startTime) === bucketStart) {
      open.high = Math.max(open.high, tick.lastPrice);
      open.low = Math.min(open.low, tick.lastPrice);
      open.close = tick.lastPrice;
      open.tickCount += 1;
      open.volume = mergeVolume(open.volume, tick.volume);
      open.endTime = new Date(Math.min(tickMs, bucketEnd - 1)).toISOString();
      return;
    }

    if (open) {
      this.closeBucket(key, open);
    }

    if (open && Date.parse(open.startTime) > bucketStart) {
      return;
    }

    this.openBuckets.set(key, {
      instrumentToken: tick.instrumentToken,
      interval,
      open: tick.lastPrice,
      high: tick.lastPrice,
      low: tick.lastPrice,
      close: tick.lastPrice,
      volume: tick.volume,
      startTime: new Date(bucketStart).toISOString(),
      endTime: new Date(Math.min(tickMs, bucketEnd - 1)).toISOString(),
      tickCount: 1
    });
  }

  private closeBucket(key: string, candle: MarketCandle) {
    const list = this.candles.get(key) ?? [];
    list.push(candle);
    while (list.length > this.maxCandlesPerSeries) {
      list.shift();
    }
    this.candles.set(key, list);
    this.openBuckets.delete(key);
  }
}

function seriesKey(instrumentToken: string, interval: CandleInterval) {
  return `${instrumentToken}|${interval}`;
}

function mergeVolume(current: number | null, incoming: number | null) {
  if (current == null && incoming == null) {
    return null;
  }
  return (current ?? 0) + (incoming ?? 0);
}
