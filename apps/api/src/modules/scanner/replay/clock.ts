import type { LoadedReplayCandle } from "./types";

export type ReplayClockEvent =
  | { type: "CANDLE"; timestamp: Date; instrumentToken: string; candle: LoadedReplayCandle }
  | { type: "DATA_GAP"; timestamp: Date; instrumentToken: string; reason: string }
  | { type: "DUPLICATE_CANDLE"; timestamp: Date; instrumentToken: string; candle: LoadedReplayCandle; reason: string };

export class HistoricalReplayClock {
  private events: ReplayClockEvent[] | null;
  private candles: LoadedReplayCandle[] | null;
  private sparseEvents: ReplayClockEvent[];
  private cursor = 0;
  private sparseCursor = 0;
  private currentTimestamp: Date | null = null;

  constructor(events: ReplayClockEvent[]) {
    this.events = [...events].sort(compareClockEvents);
    this.candles = null;
    this.sparseEvents = [];
  }

  /**
   * Optimized replay keeps one sorted reference array for candles. A clock
   * event wrapper is created only for the candle being visited, instead of
   * retaining one wrapper object per historical candle.
   */
  static fromCandleReferences(candles: LoadedReplayCandle[], sparseEvents: ReplayClockEvent[] = []) {
    const clock = Object.create(HistoricalReplayClock.prototype) as HistoricalReplayClock;
    clock.events = null;
    clock.candles = candles;
    clock.sparseEvents = [...sparseEvents].sort(compareClockEvents);
    clock.cursor = 0;
    clock.sparseCursor = 0;
    clock.currentTimestamp = null;
    return clock;
  }

  get timestamp() {
    return this.currentTimestamp;
  }

  get remaining() {
    return (this.events?.length ?? this.candles!.length + this.sparseEvents.length) - this.cursor - this.sparseCursor;
  }

  step() {
    if (this.events) {
      const event = this.events[this.cursor] ?? null;
      if (!event) return null;
      this.cursor += 1;
      this.currentTimestamp = event.timestamp;
      return event;
    }
    const candle = this.candles![this.cursor] ?? null;
    const sparse = this.sparseEvents[this.sparseCursor] ?? null;
    if (!candle && !sparse) return null;
    const candleEvent: ReplayClockEvent | null = candle ? { type: "CANDLE", timestamp: candle.timestamp, instrumentToken: candle.instrumentToken, candle } : null;
    const event = candleEvent && sparse && compareClockEvents(candleEvent, sparse) <= 0 ? candleEvent : sparse ?? candleEvent;
    if (!event) return null;
    if (event.type === "CANDLE") this.cursor += 1;
    else this.sparseCursor += 1;
    this.currentTimestamp = event.timestamp;
    return event;
  }

  run(visit: (event: ReplayClockEvent) => void | Promise<void>) {
    return this.runInternal(visit);
  }

  private async runInternal(visit: (event: ReplayClockEvent) => void | Promise<void>) {
    for (let event = this.step(); event; event = this.step()) {
      await visit(event);
    }
  }
}

function compareClockEvents(a: ReplayClockEvent, b: ReplayClockEvent) {
  const byTime = a.timestamp.getTime() - b.timestamp.getTime();
  if (byTime !== 0) {
    return byTime;
  }

  const byToken = a.instrumentToken.localeCompare(b.instrumentToken);
  if (byToken !== 0) {
    return byToken;
  }

  const byType = typeRank(a.type) - typeRank(b.type);
  if (byType !== 0) {
    return byType;
  }

  return loadIndex(a) - loadIndex(b);
}

function typeRank(type: ReplayClockEvent["type"]) {
  switch (type) {
    case "DATA_GAP":
      return 0;
    case "CANDLE":
      return 1;
    case "DUPLICATE_CANDLE":
      return 2;
  }
}

function loadIndex(event: ReplayClockEvent) {
  return "candle" in event ? event.candle.loadIndex ?? 0 : 0;
}
