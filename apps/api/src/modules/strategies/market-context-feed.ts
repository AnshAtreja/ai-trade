import { env } from "../../config/env";
import type { MarketTick } from "../market-data/stream/types";
import { CandleAggregator } from "./candle-aggregator";
import { TickHistoryBuffer } from "./tick-history";

/**
 * In-memory operational buffers fed from the Phase 4 tick bus.
 * Not a historical database.
 */
export class StrategyMarketContextFeed {
  readonly tickHistory: TickHistoryBuffer;
  readonly candles: CandleAggregator;
  private unsubscribe: (() => void) | null = null;

  constructor(tickHistorySize = env.STRATEGY_TICK_HISTORY_SIZE) {
    this.tickHistory = new TickHistoryBuffer(tickHistorySize);
    this.candles = new CandleAggregator(["1m", "5m"]);
  }

  ingest(tick: MarketTick) {
    this.tickHistory.push(tick);
    this.candles.ingest(tick);
  }

  attach(subscribe: (handler: (tick: MarketTick) => void) => () => void) {
    this.detach();
    this.unsubscribe = subscribe((tick) => this.ingest(tick));
  }

  detach() {
    if (this.unsubscribe) {
      this.unsubscribe();
      this.unsubscribe = null;
    }
  }

  clear() {
    this.tickHistory.clear();
    this.candles.clear();
  }
}

let feed: StrategyMarketContextFeed | null = null;

export function getStrategyMarketContextFeed() {
  if (!feed) {
    feed = new StrategyMarketContextFeed();
  }
  return feed;
}

export function resetStrategyMarketContextFeedForTests(next?: StrategyMarketContextFeed) {
  feed?.detach();
  feed = next ?? null;
}
