import { candleIntervalMs } from "../../../common/utils/candle-buckets";
import { getMarketSessionState } from "../../../common/utils/market-session";
import type { MarketSessionState } from "../../../common/utils/market-session";
import { aggregateOneMinuteToFiveMinute } from "../../historical-market-data/aggregation";
import type { NormalizedHistoricalCandle } from "../../historical-market-data/types";
import { LatestMarketStateStore } from "../../market-data/stream/latest-state-store";
import type { MarketTick } from "../../market-data/stream/types";
import type { MarketCandle } from "../../strategies/candle-aggregator";
import type { StrategyContext } from "../../strategies/engine-types";
import type { ScannerCandidate } from "../production-types";
import { floorToCandleBucket } from "../../../common/utils/candle-buckets";

interface InstrumentReplayState {
  instrumentToken: string;
  instrumentId: string | null;
  exchange: string;
  tradingSymbol: string;
  sessionOpen: number;
  previousClose: number;
  dayHigh: number;
  dayLow: number;
  cumulativeVolume: number;
  weightedCloseVolume: number;
  candles: NormalizedHistoricalCandle[];
  candleCount: number;
  candles1mMarket: MarketCandle[];
  openingCandles1m: MarketCandle[];
  candles5mMarket: MarketCandle[];
  candles5mCount: number;
  fiveMinuteMembers: Map<number, NormalizedHistoricalCandle[]>;
  fiveMinuteIndexes: Map<number, number>;
  ticks: MarketTick[];
  positiveRecentPrices: number[];
  openingRange15: { high: number; low: number } | null;
  boundedHistory: boolean;
}

export class HistoricalMarketStateAdapter {
  readonly store: LatestMarketStateStore;
  private readonly states = new Map<string, InstrumentReplayState>();

  constructor(
    staleMs = Number.MAX_SAFE_INTEGER,
    private readonly maxTicksPerInstrument = 240,
    private readonly precomputeStrategyContext = false,
    private readonly boundedHistory = false
  ) {
    this.store = new LatestMarketStateStore(staleMs);
  }

  applyCandle(candle: NormalizedHistoricalCandle): MarketTick {
    const existing = this.states.get(candle.instrumentToken);
    const nextState: InstrumentReplayState = existing
      ? existing
      : {
          instrumentToken: candle.instrumentToken,
          instrumentId: candle.instrumentId,
          exchange: candle.exchange,
          tradingSymbol: candle.tradingSymbol,
          sessionOpen: candle.open,
          previousClose: candle.open,
          dayHigh: candle.high,
          dayLow: candle.low,
          cumulativeVolume: 0,
          weightedCloseVolume: 0,
          candles: [],
          candleCount: 0,
          candles1mMarket: [],
          openingCandles1m: [],
          candles5mMarket: [],
          candles5mCount: 0,
          fiveMinuteMembers: new Map(),
          fiveMinuteIndexes: new Map(),
          ticks: [],
          positiveRecentPrices: [],
          openingRange15: null,
          boundedHistory: this.boundedHistory
        };

    nextState.dayHigh = Math.max(nextState.dayHigh, candle.high);
    nextState.dayLow = Math.min(nextState.dayLow, candle.low);
    nextState.cumulativeVolume += candle.volume;
    nextState.weightedCloseVolume += candle.close * candle.volume;
    nextState.candleCount += 1;
    nextState.candles.push(candle);
    const marketCandle = toMarketCandle(candle);
    if (candle.interval === "1m" && nextState.openingCandles1m.length < 15) nextState.openingCandles1m.push(marketCandle);
    nextState.candles1mMarket.push(marketCandle);
    if (this.boundedHistory) trimRecent(nextState.candles, 32);
    if (this.boundedHistory) trimRecent(nextState.candles1mMarket, 32, nextState.openingCandles1m);
    if (candle.interval === "1m") updateFiveMinuteState(nextState, candle);

    const timestamp = candle.timestamp.toISOString();
    const tick: MarketTick = {
      instrumentToken: candle.instrumentToken,
      exchange: candle.exchange,
      tradingSymbol: candle.tradingSymbol,
      instrumentId: candle.instrumentId,
      timestamp,
      receivedAt: timestamp,
      lastPrice: candle.close,
      volume: nextState.cumulativeVolume,
      lastTradedQuantity: candle.volume,
      open: nextState.sessionOpen,
      high: nextState.dayHigh,
      low: nextState.dayLow,
      close: nextState.previousClose,
      averagePrice: weightedAverageClose(nextState),
      buyQuantity: null,
      sellQuantity: null,
      exchangeTimestamp: timestamp,
      mode: "QUOTE",
      source: candle.source === "KITE" ? "KITE" : "MOCK",
      orderKey: `${candle.instrumentToken}|${timestamp}|${candle.interval}`
    };

    nextState.ticks.push(tick);
    if (tick.lastPrice > 0) nextState.positiveRecentPrices.push(tick.lastPrice);
    while (nextState.ticks.length > this.maxTicksPerInstrument) {
      const removed = nextState.ticks.shift();
      if (removed && removed.lastPrice > 0) nextState.positiveRecentPrices.shift();
    }
    if (!nextState.openingRange15 && nextState.candles1mMarket.length >= 15) {
      const opening = nextState.candles1mMarket.slice(0, 15);
      nextState.openingRange15 = { high: Math.max(...opening.map((item) => item.high)), low: Math.min(...opening.map((item) => item.low)) };
    }

    this.states.set(candle.instrumentToken, nextState);
    this.store.set(tick);
    return tick;
  }

  getContext(candidate: ScannerCandidate, at: Date): StrategyContext {
    return this.getContextForSession(candidate, at, getMarketSessionState(at));
  }

  getContexts(candidates: ScannerCandidate[], at: Date): StrategyContext[] {
    const session = getMarketSessionState(at);
    const timestamp = at.toISOString();
    const setupBucketIso = `${timestamp.slice(0, 16)}:00.000Z`;
    const istMinutes = (at.getUTCHours() * 60 + at.getUTCMinutes() + 330) % 1_440;
    return candidates.map((candidate) => this.getContextForSession(candidate, at, session, { timestamp, setupBucketIso, istMinutes }));
  }

  private getContextForSession(candidate: ScannerCandidate, at: Date, marketSession: MarketSessionState, frame?: { timestamp: string; setupBucketIso: string; istMinutes: number }): StrategyContext {
    const state = this.states.get(candidate.instrumentToken);
    const latestTick = this.store.getLatest(candidate.instrumentToken);
    const candles = state?.candles ?? [];
    const interval = candles[0]?.interval ?? "1m";
    const candles1m = interval === "1m" ? (state ? boundedCandleView(state) : []) : [];
    const candles5m = interval === "1m" ? state?.candles5mMarket ?? [] : candles.map(toMarketCandle);

    return {
      instrumentToken: candidate.instrumentToken,
      tradingSymbol: candidate.tradingSymbol,
      exchange: candidate.exchange,
      instrumentId: candidate.instrumentId,
      latestTick,
        recentTicks: state?.ticks ?? [],
      candles1m,
      candles5m,
      scannerCandidate: candidate,
      scannerSignalId: null,
      marketSession,
      currentTime: at,
      dataAgeMs: latestTick ? Math.max(0, at.getTime() - Date.parse(latestTick.receivedAt)) : null,
      stale: false,
      replayHints: this.precomputeStrategyContext && frame && state
        ? { ...frame, nonEmptyCandles1m: candles1m, openingRange15: state.openingRange15, positiveRecentPrices: state.positiveRecentPrices }
        : undefined
    };
  }

  snapshot(instrumentToken: string, at: Date) {
    const state = this.states.get(instrumentToken);
    if (!state) {
      return {
        recentTickCount: 0,
        candles1mCount: 0,
        candles5mCount: 0,
        latestAvailableTimestamp: at.toISOString()
      };
    }
    const interval = state.candles[0]?.interval ?? "1m";
    const candles5m = interval === "1m" ? state.candles5mMarket : state.candles;
    return {
      recentTickCount: state.ticks.length,
        candles1mCount: interval === "1m" ? state.candleCount : 0,
        candles5mCount: interval === "1m" ? state.candles5mCount : candles5m.length,
        latestAvailableTimestamp: state.candles.at(-1)?.timestamp.toISOString() ?? at.toISOString()
    };
  }

  instruments() {
    return [...this.states.values()].map((state) => ({
      id: state.instrumentId ?? `historical-${state.instrumentToken}`,
      tradingSymbol: state.tradingSymbol,
      exchange: state.exchange,
      name: state.tradingSymbol,
      instrumentToken: state.instrumentToken,
      exchangeToken: null,
      segment: "NSE",
      instrumentType: "EQ",
      expiry: null,
      strike: null,
      tickSize: 0.05,
      lotSize: 1,
      isActive: true
    }));
  }
}

function toMarketCandle(candle: NormalizedHistoricalCandle): MarketCandle {
  const startMs = candle.timestamp.getTime();
  const endMs = startMs + candleIntervalMs(candle.interval) - 1;
  return {
    instrumentToken: candle.instrumentToken,
    interval: candle.interval,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    startTime: candle.timestamp.toISOString(),
    endTime: new Date(endMs).toISOString(),
    tickCount: 1
  };
}

function updateFiveMinuteState(state: InstrumentReplayState, candle: NormalizedHistoricalCandle) {
  const bucket = floorToCandleBucket(candle.timestamp.getTime(), "5m");
  const members = state.fiveMinuteMembers.get(bucket) ?? [];
  members.push(candle);
  state.fiveMinuteMembers.set(bucket, members);
  const asOf = candle.timestamp.getTime() + candleIntervalMs("1m");
  for (const [bucketStart, bucketMembers] of state.fiveMinuteMembers) {
    const bucketEnd = bucketStart + candleIntervalMs("5m");
    if (bucketMembers.length < 5 && bucketEnd > asOf) continue;
    const aggregate = aggregateOneMinuteToFiveMinute(bucketMembers, { includeIncomplete: true, asOf: new Date(asOf) })[0];
    if (!aggregate) continue;
    const market = toMarketCandle(aggregate);
    const index = state.fiveMinuteIndexes.get(bucketStart);
    if (index == null) {
      state.fiveMinuteIndexes.set(bucketStart, state.candles5mMarket.length);
      state.candles5mMarket.push(market);
      state.candles5mCount += 1;
    } else {
      state.candles5mMarket[index] = market;
    }
    if (state.candles5mMarket.length > 64) {
      state.candles5mMarket.shift();
      for (const [key, value] of state.fiveMinuteIndexes) {
        if (value === 0) state.fiveMinuteIndexes.delete(key);
        else state.fiveMinuteIndexes.set(key, value - 1);
      }
    }
    state.fiveMinuteMembers.delete(bucketStart);
  }
}

function trimRecent<T>(items: T[], limit: number, preserve: T[] = []) {
  while (items.length > limit + preserve.length) items.splice(preserve.length, 1);
}

function boundedCandleView(state: InstrumentReplayState) {
  if (!state.boundedHistory) return state.candles1mMarket;
  if (state.candles.length <= 32) return state.candles1mMarket;
  if (state.openingCandles1m.length === 0) return state.candles1mMarket;
  const opening = new Set(state.openingCandles1m);
  return [...state.openingCandles1m, ...state.candles1mMarket.filter((item) => !opening.has(item))];
}

function weightedAverageClose(state: Pick<InstrumentReplayState, "cumulativeVolume" | "weightedCloseVolume" | "candles">) {
  const volume = state.cumulativeVolume;
  if (volume <= 0) {
    return state.candles.at(-1)?.close ?? null;
  }
  return Number((state.weightedCloseVolume / volume).toFixed(4));
}
