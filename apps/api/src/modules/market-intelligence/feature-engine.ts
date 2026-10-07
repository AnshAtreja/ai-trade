import { createHash } from "node:crypto";
import { candleIntervalMs } from "../../common/utils/candle-buckets";
import { getTradingDate } from "../../common/utils/trading-date";
import { nseCashCalendar } from "../historical-market-data/calendar";
import { historicalCasEligibilityDataset, NseCashInstrumentSessionPolicy } from "../historical-market-data/session-policy";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import type { MarketCandle } from "../strategies/candle-aggregator";
import { ATR_PERIOD_9A } from "./feature-definitions";
import { FEATURE_DEFINITIONS_VERSION, FEATURE_SCHEMA_VERSION, type FeatureObservation, type FeatureQuality, type FeatureSession, type FeatureSnapshot, type FeatureValues } from "./feature-types";


interface InstrumentState {
  sessionKey: string;
  lastStartMs: number;
  high: number;
  low: number;
  openingPrice: number;
  previousClose: number | null;
  lastClose: number;
  lastVolume: number | null;
  count: number;
  volume: number;
  weightedVolume: number;
  volumeAvailable: boolean;
  gap: boolean;
  trueRanges: number[];
  trueRangeSum: number;
  snapshot: FeatureSnapshot;
}

/** Resolve only authoritative NSE cash sessions. Unknown CAS eligibility is not guessed. */
export function resolveNseFeatureSession(identity: { instrumentToken: string; exchange: string; tradingSymbol: string }, at: Date): FeatureSession {
  if (identity.exchange !== "NSE") throw new Error("Only NSE cash sessions are supported by the 9A resolver");
  const tradeDate = getTradingDate(at, "Asia/Kolkata");
  const day = nseCashCalendar.getDay(tradeDate);
  if (!day.session) throw new Error(`No authoritative NSE cash session for ${tradeDate}: ${day.type}`);
  const policy = new NseCashInstrumentSessionPolicy(historicalCasEligibilityDataset);
  const session = policy.getSession({ ...identity, eligibility: "UNKNOWN", eligibilitySource: "Phase 9A resolver" }, tradeDate);
  if (tradeDate >= policy.effectiveDate && session.eligibility === "UNKNOWN") throw new Error(`Unknown CAS eligibility for ${identity.instrumentToken} on ${tradeDate}`);
  const close = day.type === "SPECIAL_SESSION" ? day.session.closeTimeIst : session.continuousSession?.closeTimeIst ?? day.session.closeTimeIst;
  return {
    tradeDate,
    openTime: `${tradeDate}T${day.session.openTimeIst}:00+05:30`,
    closeTime: `${tradeDate}T${close}:00+05:30`,
    calendarVersion: nseCashCalendar.version,
    sessionPolicyVersion: session.policyVersion,
    casEligibilityVersion: session.eligibilityDatasetVersion
  };
}

/** Both adapters produce the same finalized-bar contract. No open tick bucket enters 9A. */
export function fromHistoricalCandle(candle: NormalizedHistoricalCandle, session: FeatureSession, sourceIdentity: string, previousSessionClose: number | null): FeatureObservation {
  return {
    instrumentToken: candle.instrumentToken, exchange: candle.exchange, tradingSymbol: candle.tradingSymbol,
    interval: candle.interval, startTime: candle.timestamp.toISOString(), open: candle.open, high: candle.high,
    low: candle.low, close: candle.close, volume: candle.volume, session, sourceIdentity, previousSessionClose
  };
}

export function fromCompletedMarketCandle(candle: MarketCandle, metadata: { exchange: string; tradingSymbol: string; sourceIdentity: string; previousSessionClose: number | null }, session: FeatureSession): FeatureObservation {
  return {
    instrumentToken: candle.instrumentToken, exchange: metadata.exchange, tradingSymbol: metadata.tradingSymbol,
    interval: candle.interval, startTime: candle.startTime, open: candle.open, high: candle.high,
    low: candle.low, close: candle.close, volume: candle.volume, session, sourceIdentity: metadata.sourceIdentity,
    previousSessionClose: metadata.previousSessionClose
  };
}

function sessionKey(observation: FeatureObservation) {
  const { session } = observation;
  return [observation.exchange, observation.tradingSymbol, session.tradeDate, session.openTime, session.closeTime, session.calendarVersion, session.sessionPolicyVersion, session.casEligibilityVersion, observation.sourceIdentity].join("|");
}

function toSnapshot(observation: FeatureObservation, state: Omit<InstrumentState, "snapshot">, closeMs: number, sessionOpenMs: number, sessionCloseMs: number): FeatureSnapshot {
  const values = {} as FeatureValues;
  const quality = {} as Record<keyof FeatureValues, FeatureQuality>;
  const set = <K extends keyof FeatureValues>(key: K, value: FeatureValues[K], status: FeatureQuality) => {
    values[key] = value;
    quality[key] = status;
  };
  const available = "AVAILABLE" as const;
  const gapQuality = state.gap ? "DATA_GAP" : available;
  set("lastPrice", observation.close, available);
  set("open", observation.open, available);
  set("high", observation.high, available);
  set("low", observation.low, available);
  set("sessionHigh", state.gap ? null : state.high, gapQuality);
  set("sessionLow", state.gap ? null : state.low, gapQuality);
  set("distanceFromSessionHighPct", state.gap ? null : (state.high - observation.close) / state.high * 100, gapQuality);
  set("distanceFromSessionLowPct", state.gap ? null : (observation.close - state.low) / state.low * 100, gapQuality);
  const vwapQuality: FeatureQuality = state.gap ? "DATA_GAP" : !state.volumeAvailable || state.volume === 0 ? "NOT_APPLICABLE" : available;
  const vwap = vwapQuality === available ? state.weightedVolume / state.volume : null;
  set("sessionVwap", vwap, vwapQuality);
  set("vwapDistancePct", vwap == null ? null : (observation.close - vwap) / vwap * 100, vwapQuality);
  set("aboveVwap", vwap == null ? null : observation.close > vwap, vwapQuality);
  const atrQuality: FeatureQuality = state.gap ? "DATA_GAP" : state.trueRanges.length < ATR_PERIOD_9A ? "INSUFFICIENT_HISTORY" : available;
  const atr = atrQuality === available ? state.trueRangeSum / ATR_PERIOD_9A : null;
  set("atr", atr, atrQuality);
  set("atrPct", atr == null ? null : atr / observation.close * 100, atrQuality);
  const gapPercentQuality: FeatureQuality = state.gap ? "DATA_GAP" : state.previousClose == null ? "INSUFFICIENT_HISTORY" : available;
  set("gapPct", gapPercentQuality === available ? (state.openingPrice - state.previousClose!) / state.previousClose! * 100 : null, gapPercentQuality);
  const volumeQuality: FeatureQuality = state.gap ? "DATA_GAP" : state.volumeAvailable ? available : "NOT_APPLICABLE";
  set("cumulativeVolume", volumeQuality === available ? state.volume : null, volumeQuality);
  const minutes = (closeMs - sessionOpenMs) / 60_000;
  set("minutesSinceMarketOpen", minutes, available);
  set("timeOfDayBucket", minutes <= 60 ? "OPEN" : sessionCloseMs - closeMs < 3_600_000 ? "CLOSE" : "MID", available);
  for (const key of [
    "realizedVolatility", "recentRangeExpansion", "relativeVolume", "volumeAcceleration", "openingRangeHigh", "openingRangeLow",
    "openingRangePosition", "openingRangeBreakState", "marketRelativeStrength", "sectorRelativeStrength", "benchmarkRelativeReturn",
    "marketBreadth", "marketTrend", "marketVolatilityContext", "sectorTrend", "sectorBreadth"
  ] as const) set(key, null, "NOT_APPLICABLE");

  const timestamp = new Date(closeMs).toISOString();
  const identity = {
    schemaVersion: FEATURE_SCHEMA_VERSION, definitionsVersion: FEATURE_DEFINITIONS_VERSION,
    instrumentToken: observation.instrumentToken, exchange: observation.exchange, tradingSymbol: observation.tradingSymbol,
    interval: observation.interval, timestamp,
    session: observation.session, sourceIdentity: observation.sourceIdentity, values, quality
  };
  const snapshot: FeatureSnapshot = {
    id: createHash("sha256").update(JSON.stringify(identity)).digest("hex").slice(0, 24),
    schemaVersion: FEATURE_SCHEMA_VERSION, definitionsVersion: FEATURE_DEFINITIONS_VERSION,
    instrumentToken: observation.instrumentToken, exchange: observation.exchange, tradingSymbol: observation.tradingSymbol,
    interval: observation.interval, timestamp, observedAt: timestamp, sessionDate: observation.session.tradeDate,
    sourceIdentity: observation.sourceIdentity, calendarVersion: observation.session.calendarVersion,
    sessionPolicyVersion: observation.session.sessionPolicyVersion, casEligibilityVersion: observation.session.casEligibilityVersion,
    values: Object.freeze(values), quality: Object.freeze(quality)
  };
  return Object.freeze(snapshot);
}

/** Stateful but bounded: one session accumulator and 14 true ranges per instrument/interval. */
export class MarketFeatureEngine {
  private readonly states = new Map<string, InstrumentState>();

  ingest(observation: FeatureObservation): FeatureSnapshot {
    const startMs = Date.parse(observation.startTime);
    const durationMs = candleIntervalMs(observation.interval);
    const closeMs = startMs + durationMs;
    const openMs = Date.parse(observation.session.openTime);
    const sessionCloseMs = Date.parse(observation.session.closeTime);
    if (![startMs, openMs, sessionCloseMs].every(Number.isFinite) || startMs < openMs || closeMs > sessionCloseMs ||
        getTradingDate(new Date(closeMs - 1), "Asia/Kolkata") !== observation.session.tradeDate ||
        startMs % durationMs !== 0 || ![observation.open, observation.high, observation.low, observation.close].every(Number.isFinite) ||
        !(observation.open > 0) || !(observation.close > 0) ||
        !(observation.low > 0) || observation.high < observation.low ||
        observation.high < Math.max(observation.open, observation.close) || observation.low > Math.min(observation.open, observation.close) ||
        (observation.volume != null && (!Number.isFinite(observation.volume) || observation.volume < 0)) ||
        (observation.previousSessionClose != null && (!Number.isFinite(observation.previousSessionClose) || !(observation.previousSessionClose > 0))) || !observation.sourceIdentity) {
      throw new Error("Invalid or out-of-session completed feature candle");
    }
    const key = `${observation.instrumentToken}|${observation.interval}`;
    const current = this.states.get(key);
    const sameSession = current?.sessionKey === sessionKey(observation);
    if (sameSession && current) {
      if (startMs === current.lastStartMs) {
        if (current.snapshot.values.open === observation.open && current.snapshot.values.high === observation.high &&
            current.snapshot.values.low === observation.low && current.snapshot.values.lastPrice === observation.close &&
            current.lastVolume === observation.volume) return current.snapshot;
        throw new Error("Conflicting duplicate feature candle");
      }
      if (startMs < current.lastStartMs) throw new Error("Out-of-order feature candle");
      if (observation.previousSessionClose !== current.previousClose) throw new Error("Previous close changed during feature session");
    } else if (current && startMs <= current.lastStartMs) {
      throw new Error("Feature session moved backwards");
    }
    const gap = sameSession ? current!.gap || startMs !== current!.lastStartMs + durationMs : startMs !== openMs;
    const priorClose = sameSession ? current!.lastClose : null;
    const trueRange = priorClose == null ? observation.high - observation.low : Math.max(
      observation.high - observation.low, Math.abs(observation.high - priorClose), Math.abs(observation.low - priorClose)
    );
    const trueRanges = sameSession ? [...current!.trueRanges] : [];
    let trueRangeSum = (sameSession ? current!.trueRangeSum : 0) + trueRange;
    trueRanges.push(trueRange);
    if (trueRanges.length > ATR_PERIOD_9A) trueRangeSum -= trueRanges.shift()!;
    const volumeAvailable = (sameSession ? current!.volumeAvailable : true) && observation.volume != null;
    const volume = (sameSession ? current!.volume : 0) + (observation.volume ?? 0);
    const stateBase = {
      sessionKey: sessionKey(observation), lastStartMs: startMs,
      high: sameSession ? Math.max(current!.high, observation.high) : observation.high,
      low: sameSession ? Math.min(current!.low, observation.low) : observation.low,
      openingPrice: sameSession ? current!.openingPrice : observation.open,
      previousClose: sameSession ? current!.previousClose : observation.previousSessionClose,
      lastClose: observation.close, lastVolume: observation.volume, count: (sameSession ? current!.count : 0) + 1,
      volume, weightedVolume: (sameSession ? current!.weightedVolume : 0) + (observation.volume ?? 0) * (observation.high + observation.low + observation.close) / 3,
      volumeAvailable, gap, trueRanges, trueRangeSum
    };
    const snapshot = toSnapshot(observation, stateBase, closeMs, openMs, sessionCloseMs);
    this.states.set(key, { ...stateBase, snapshot });
    return snapshot;
  }

  /** Explicit simulated as-of time; never consults wall clock. */
  readAt(instrumentToken: string, interval: FeatureObservation["interval"], asOf: Date, staleAfterMs: number): FeatureSnapshot | null {
    const snapshot = this.states.get(`${instrumentToken}|${interval}`)?.snapshot ?? null;
    if (!snapshot) return null;
    const asOfMs = asOf.getTime();
    if (!Number.isFinite(asOfMs) || asOfMs < Date.parse(snapshot.timestamp)) throw new Error("Feature read before candle close");
    if (!(staleAfterMs >= 0)) throw new Error("Invalid stale threshold");
    if (asOfMs - Date.parse(snapshot.timestamp) <= staleAfterMs) return snapshot;
    const quality = {} as Record<keyof FeatureValues, FeatureQuality>;
    const values = {} as FeatureValues;
    for (const key of Object.keys(snapshot.values) as Array<keyof FeatureValues>) {
      quality[key] = snapshot.quality[key] === "AVAILABLE" ? "STALE" : snapshot.quality[key];
      values[key] = null;
    }
    const observedAt = asOf.toISOString();
    return Object.freeze({ ...snapshot, id: createHash("sha256").update(`${snapshot.id}|${observedAt}|STALE`).digest("hex").slice(0, 24), observedAt, values: Object.freeze(values), quality: Object.freeze(quality) });
  }

  /** For bounded-state assertions and research diagnostics only. */
  stateSize() {
    return { series: this.states.size, retainedTrueRanges: [...this.states.values()].reduce((sum, state) => sum + state.trueRanges.length, 0) };
  }
}
