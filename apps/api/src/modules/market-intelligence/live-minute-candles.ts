import type { MarketTick } from "../market-data/stream/types";
import type { MarketCandle } from "../strategies/candle-aggregator";
import type { FeatureSession } from "./feature-types";

export interface CompletedLiveCandle {
  candle: MarketCandle;
  session: FeatureSession;
  exchange: string;
  tradingSymbol: string;
  previousSessionClose: number | null;
  sourceIdentity: string;
  benchmark: boolean;
}

interface OpenMinute {
  result: CompletedLiveCandle;
  startMs: number;
  volumeKnown: boolean;
}

/** Bounded, observation-only minute assembly. Missing minutes stay missing. */
export class LiveMinuteCandleAssembler {
  private readonly open = new Map<string, OpenMinute>();
  private readonly pending: CompletedLiveCandle[] = [];
  private readonly lastFinalized = new Map<string, number>();
  private readonly cumulative = new Map<string, { sessionDate: string; value: number }>();
  private readonly closeBySession = new Map<string, { sessionDate: string; close: number }>();
  private droppedLate = 0;
  private rejected = 0;
  private overflow = 0;

  ingest(tick: MarketTick, session: FeatureSession, benchmark: boolean): void {
    const atMs = Date.parse(tick.exchangeTimestamp ?? tick.receivedAt);
    const startMs = Math.floor(atMs / 60_000) * 60_000;
    if (!Number.isFinite(atMs) || !(tick.lastPrice > 0) || !tick.exchange || !tick.tradingSymbol ||
        startMs < Date.parse(session.openTime) || startMs + 60_000 > Date.parse(session.closeTime)) {
      this.rejected += 1;
      return;
    }
    const token = tick.instrumentToken;
    if (startMs <= (this.lastFinalized.get(token) ?? Number.NEGATIVE_INFINITY)) { this.droppedLate += 1; return; }
    const existing = this.open.get(token);
    if (existing && startMs < existing.startMs) { this.droppedLate += 1; return; }
    const previous = this.cumulative.get(token);
    const cumulative = !benchmark && tick.volume != null && Number.isFinite(tick.volume) && tick.volume >= 0 ? tick.volume : null;
    let increment: number | null = null;
    if (cumulative != null) {
      if (previous?.sessionDate === session.tradeDate && cumulative >= previous.value) increment = cumulative - previous.value;
      else if (!previous || previous.sessionDate !== session.tradeDate) {
        if (startMs === Date.parse(session.openTime)) increment = cumulative;
      }
      this.cumulative.set(token, { sessionDate: session.tradeDate, value: cumulative });
    }
    const priorClose = tick.close != null && Number.isFinite(tick.close) && tick.close > 0 ? tick.close : null;
    const rememberedClose = this.closeBySession.get(token);
    if (rememberedClose?.sessionDate === session.tradeDate && priorClose != null && priorClose !== rememberedClose.close) {
      throw new Error(`Previous close changed during live intelligence session for ${token}`);
    }
    const sessionClose = rememberedClose?.sessionDate === session.tradeDate ? rememberedClose.close : priorClose;
    if (sessionClose != null) this.closeBySession.set(token, { sessionDate: session.tradeDate, close: sessionClose });
    if (existing && existing.startMs === startMs) {
      const candle = existing.result.candle;
      candle.high = Math.max(candle.high, tick.lastPrice);
      candle.low = Math.min(candle.low, tick.lastPrice);
      candle.close = tick.lastPrice;
      candle.tickCount += 1;
      candle.endTime = new Date(atMs).toISOString();
      if (increment == null) { candle.volume = null; existing.volumeKnown = false; }
      else if (existing.volumeKnown) candle.volume = (candle.volume ?? 0) + increment;
      return;
    }
    if (existing) {
      this.open.delete(token);
      this.lastFinalized.set(token, existing.startMs);
      if (this.pending.length >= 1_024) this.overflow += 1;
      else this.pending.push(existing.result);
    }
    const candle: MarketCandle = { instrumentToken: token, interval: "1m", open: tick.lastPrice, high: tick.lastPrice,
      low: tick.lastPrice, close: tick.lastPrice, volume: increment, startTime: new Date(startMs).toISOString(),
      endTime: new Date(atMs).toISOString(), tickCount: 1 };
    this.open.set(token, { startMs, volumeKnown: increment != null, result: {
      candle, session, exchange: tick.exchange, tradingSymbol: tick.tradingSymbol,
      previousSessionClose: sessionClose ?? null, sourceIdentity: `LIVE_${tick.source}_9E_V1`, benchmark
    } });
  }

  /** Settle after close; a late tick for a finalized minute is rejected, never revised. */
  drain(asOf: Date, settleMs = 1_000): CompletedLiveCandle[] {
    const cutoffMs = asOf.getTime() - settleMs;
    const ready: CompletedLiveCandle[] = [];
    for (let i = this.pending.length - 1; i >= 0; i -= 1) {
      const item = this.pending[i]!;
      if (Date.parse(item.candle.startTime) + 60_000 <= cutoffMs) ready.push(...this.pending.splice(i, 1));
    }
    for (const [token, item] of this.open) {
      if (item.startMs + 60_000 > cutoffMs) continue;
      this.open.delete(token);
      this.lastFinalized.set(token, item.startMs);
      ready.push(item.result);
    }
    ready.sort((a, b) => Date.parse(a.candle.startTime) - Date.parse(b.candle.startTime) ||
      Number(b.benchmark) - Number(a.benchmark) || a.candle.instrumentToken.localeCompare(b.candle.instrumentToken));
    return ready;
  }

  discardOpen() { this.open.clear(); this.pending.length = 0; this.cumulative.clear(); }
  size() { return { openBuckets: this.open.size, cumulativeBaselines: this.cumulative.size,
    previousCloses: this.closeBySession.size, finalizedTokens: this.lastFinalized.size, pending: this.pending.length,
    droppedLate: this.droppedLate, rejected: this.rejected, overflow: this.overflow }; }
}
