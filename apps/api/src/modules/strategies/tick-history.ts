import type { MarketTick } from "../market-data/stream/types";

/**
 * Bounded in-memory tick ring buffer per instrument.
 * Operational only — not a historical database.
 */
export class TickHistoryBuffer {
  private readonly buffers = new Map<string, MarketTick[]>();

  constructor(private readonly maxSize: number) {
    if (maxSize < 1) {
      throw new Error("Tick history size must be positive.");
    }
  }

  push(tick: MarketTick) {
    const list = this.buffers.get(tick.instrumentToken) ?? [];
    const last = list[list.length - 1];
    if (last && last.orderKey === tick.orderKey) {
      return;
    }

    // Keep chronological by receivedAt / exchange time; drop older out-of-order ticks from the tail only.
    if (last && compareTickTime(tick, last) < 0) {
      return;
    }

    list.push(tick);
    while (list.length > this.maxSize) {
      list.shift();
    }
    this.buffers.set(tick.instrumentToken, list);
  }

  get(instrumentToken: string): MarketTick[] {
    return [...(this.buffers.get(instrumentToken) ?? [])];
  }

  clear(instrumentToken?: string) {
    if (instrumentToken) {
      this.buffers.delete(instrumentToken);
      return;
    }
    this.buffers.clear();
  }

  size(instrumentToken: string) {
    return this.buffers.get(instrumentToken)?.length ?? 0;
  }
}

function compareTickTime(a: MarketTick, b: MarketTick) {
  const at = Date.parse(a.exchangeTimestamp ?? a.receivedAt);
  const bt = Date.parse(b.exchangeTimestamp ?? b.receivedAt);
  if (Number.isFinite(at) && Number.isFinite(bt) && at !== bt) {
    return at - bt;
  }
  return a.orderKey.localeCompare(b.orderKey);
}
