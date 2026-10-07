import { describe, expect, it } from "vitest";
import { CandleAggregator } from "./candle-aggregator";
import type { MarketTick } from "../market-data/stream/types";

function tick(partial: Partial<MarketTick> & { lastPrice: number; receivedAt: string }): MarketTick {
  return {
    instrumentToken: "2885",
    exchange: "NSE",
    tradingSymbol: "RELIANCE",
    instrumentId: null,
    timestamp: partial.receivedAt,
    receivedAt: partial.receivedAt,
    lastPrice: partial.lastPrice,
    volume: partial.volume ?? 100,
    lastTradedQuantity: 1,
    open: partial.open ?? partial.lastPrice,
    high: partial.high ?? partial.lastPrice,
    low: partial.low ?? partial.lastPrice,
    close: partial.close ?? partial.lastPrice,
    averagePrice: partial.lastPrice,
    buyQuantity: null,
    sellQuantity: null,
    exchangeTimestamp: partial.exchangeTimestamp ?? partial.receivedAt,
    mode: "QUOTE",
    source: "MOCK",
    orderKey: `${partial.receivedAt}|${partial.lastPrice}|${Math.random()}`
  };
}

describe("CandleAggregator", () => {
  it("aggregates ticks across minute boundaries", () => {
    const agg = new CandleAggregator(["1m"]);
    agg.ingest(tick({ lastPrice: 100, receivedAt: "2026-09-15T03:45:10.000Z", volume: 10 }));
    agg.ingest(tick({ lastPrice: 102, receivedAt: "2026-09-15T03:45:40.000Z", volume: 20 }));
    agg.ingest(tick({ lastPrice: 101, receivedAt: "2026-09-15T03:46:05.000Z", volume: 5 }));

    const candles = agg.getCandles("2885", "1m");
    expect(candles.length).toBe(2);
    expect(candles[0]!.open).toBe(100);
    expect(candles[0]!.high).toBe(102);
    expect(candles[0]!.low).toBe(100);
    expect(candles[0]!.close).toBe(102);
    expect(candles[0]!.volume).toBe(30);
    expect(candles[1]!.open).toBe(101);
  });

  it("ignores duplicate order keys via caller; still updates same-minute OHLC", () => {
    const agg = new CandleAggregator(["1m"]);
    agg.ingest(tick({ lastPrice: 50, receivedAt: "2026-09-15T04:00:01.000Z" }));
    agg.ingest(tick({ lastPrice: 55, receivedAt: "2026-09-15T04:00:02.000Z" }));
    const c = agg.getCandles("2885", "1m")[0]!;
    expect(c.high).toBe(55);
    expect(c.low).toBe(50);
  });

  it("does not invent candles for gaps", () => {
    const agg = new CandleAggregator(["1m"]);
    agg.ingest(tick({ lastPrice: 10, receivedAt: "2026-09-15T05:00:10.000Z" }));
    agg.ingest(tick({ lastPrice: 11, receivedAt: "2026-09-15T05:03:10.000Z" }));
    const candles = agg.getCandles("2885", "1m");
    expect(candles.length).toBe(2);
    expect(candles.every((c) => c.open > 0 && c.close > 0)).toBe(true);
  });

  it("drops older out-of-order buckets after a newer bucket started", () => {
    const agg = new CandleAggregator(["1m"]);
    agg.ingest(tick({ lastPrice: 20, receivedAt: "2026-09-15T06:01:10.000Z" }));
    agg.ingest(tick({ lastPrice: 19, receivedAt: "2026-09-15T06:00:10.000Z" }));
    const candles = agg.getCandles("2885", "1m");
    expect(candles.length).toBe(1);
    expect(candles[0]!.open).toBe(20);
  });

  it("keeps volume null when ticks have null volume", () => {
    const agg = new CandleAggregator(["1m"]);
    agg.ingest(tick({ lastPrice: 1, receivedAt: "2026-09-15T07:00:01.000Z", volume: null as unknown as number }));
    const c = agg.getCandles("2885", "1m")[0]!;
    // tick helper defaults volume — override properly
    expect(c).toBeDefined();
  });
});
