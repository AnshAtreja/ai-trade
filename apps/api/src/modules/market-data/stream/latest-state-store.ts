import { env } from "../../../config/env";
import type { MarketTick } from "./types";

export type AppliedTickListener = (tick: MarketTick) => void;

export class LatestMarketStateStore {
  private readonly ticks = new Map<string, MarketTick>();
  private readonly staleMs: number;
  private readonly appliedListeners = new Set<AppliedTickListener>();

  constructor(staleMs = env.MARKET_TICK_STALE_MS) {
    this.staleMs = staleMs;
  }

  /** Every successfully applied tick (not latest-wins). Used by strategy tick history. */
  onAppliedTick(listener: AppliedTickListener) {
    this.appliedListeners.add(listener);
    return () => this.appliedListeners.delete(listener);
  }

  getLatest(instrumentToken: string) {
    return this.ticks.get(instrumentToken) ?? null;
  }

  getLatestMany(instrumentTokens: string[]) {
    return instrumentTokens
      .map((token) => this.ticks.get(token))
      .filter((tick): tick is MarketTick => Boolean(tick));
  }

  getAll() {
    return [...this.ticks.values()];
  }

  has(instrumentToken: string) {
    return this.ticks.has(instrumentToken);
  }

  /**
   * Apply a tick if it is not older than the stored one.
   * Returns: applied | duplicate | out_of_order
   */
  set(tick: MarketTick): "applied" | "duplicate" | "out_of_order" {
    const current = this.ticks.get(tick.instrumentToken);
    if (current && current.orderKey === tick.orderKey) {
      return "duplicate";
    }

    if (current && compareOrder(tick, current) < 0) {
      return "out_of_order";
    }

    this.ticks.set(tick.instrumentToken, tick);
    for (const listener of this.appliedListeners) {
      try {
        listener(tick);
      } catch {
        // Listener failures must not break market-state updates.
      }
    }
    return "applied";
  }

  isStale(instrumentToken: string, now = Date.now()) {
    const tick = this.ticks.get(instrumentToken);
    if (!tick) {
      return true;
    }

    return now - Date.parse(tick.receivedAt) > this.staleMs;
  }

  remove(instrumentToken: string) {
    this.ticks.delete(instrumentToken);
  }

  clear() {
    this.ticks.clear();
  }

  size() {
    return this.ticks.size;
  }
}

function compareOrder(incoming: MarketTick, stored: MarketTick) {
  const incomingTs = orderTime(incoming);
  const storedTs = orderTime(stored);
  if (incomingTs !== storedTs) {
    return incomingTs - storedTs;
  }

  return incoming.orderKey.localeCompare(stored.orderKey);
}

function orderTime(tick: MarketTick) {
  const exchange = tick.exchangeTimestamp ? Date.parse(tick.exchangeTimestamp) : Number.NaN;
  if (Number.isFinite(exchange)) {
    return exchange;
  }

  return Date.parse(tick.receivedAt);
}
