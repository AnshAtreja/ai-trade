import { createHash } from "node:crypto";
import { getTradingDate } from "../../common/utils/trading-date";
import { nseCashCalendar } from "../historical-market-data/calendar";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import type { MarketCandle } from "../strategies/candle-aggregator";
import {
  benchmarkRegistry, BROAD_BENCHMARK_ID, contextUniverseId, getBenchmarkById, getSectorBenchmark,
  isFrozenBreadthConstituent, MEMBERSHIP_AS_OF_DATE, resolveSectorMembership, sectorMemberships,
  type SectorId
} from "./context-universe";
import {
  BREADTH_MIN_CONSTITUENTS, BREADTH_MIN_COVERAGE, CONTEXT_DEFINITIONS_VERSION,
  CONTEXT_HORIZONS_MINUTES, CONTEXT_MAX_STALENESS_MS, CONTEXT_SCHEMA_VERSION,
  type BenchmarkContext, type BenchmarkObservation, type BreadthContext, type ContextHorizon,
  type ContextMetric, type ContextQuality, type EquityContextObservation, type HorizonReturns,
  type InstrumentMarketContext, type MarketContextSnapshot, type MembershipPolicy, type RelativeContextSnapshot,
  type RelativeMetric, type SectorContextSnapshot
} from "./context-types";

const HORIZONS: readonly ContextHorizon[] = CONTEXT_HORIZONS_MINUTES.map((minutes) => `${minutes}m` as ContextHorizon);
const MAX_HORIZON_MS = 60 * 60_000;

interface Point { atMs: number; close: number; gapCount: number; }
interface ReturnSeries {
  sessionDate: string;
  sourceIdentity: string;
  points: Point[];
  high: number;
  low: number;
  gapCount: number;
  previousSessionClose: number | null;
}

function hash(value: unknown) { return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24); }

function frozen<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) frozen(child);
    Object.freeze(value);
  }
  return value;
}

function pointMetric(valuePct: number | null, quality: ContextQuality, observedAt: string | null): ContextMetric {
  return { valuePct, quality, observedAt };
}

function missingMetric(quality: ContextQuality, observedAt: string | null = null): ContextMetric {
  return pointMetric(null, quality, observedAt);
}

function horizonMap(factory: (minutes: number) => ContextMetric): HorizonReturns {
  return Object.fromEntries(CONTEXT_HORIZONS_MINUTES.map((minutes) => [`${minutes}m`, factory(minutes)])) as unknown as HorizonReturns;
}

function updateSeries(existing: ReturnSeries | undefined, input: {
  sessionDate: string; sourceIdentity: string; atMs: number; close: number; high: number; low: number;
  previousSessionClose: number | null; initialGap: boolean;
}): ReturnSeries {
  if (existing?.sessionDate === input.sessionDate && existing.sourceIdentity !== input.sourceIdentity) {
    throw new Error("Context source identity changed within a session");
  }
  const sameSession = existing?.sessionDate === input.sessionDate && existing.sourceIdentity === input.sourceIdentity;
  if (sameSession && existing) {
    const last = existing.points.at(-1)!;
    if (input.atMs <= last.atMs) throw new Error("Duplicate or out-of-order context observation");
    if (input.previousSessionClose !== existing.previousSessionClose) throw new Error("Previous close changed within context session");
  } else if (existing && input.atMs <= existing.points.at(-1)!.atMs) {
    throw new Error("Context session moved backwards");
  }
  const gapCount = (sameSession ? existing!.gapCount : input.initialGap ? 1 : 0) +
    (sameSession && input.atMs - existing!.points.at(-1)!.atMs !== 60_000 ? 1 : 0);
  const points = sameSession ? existing!.points : [];
  points.push({ atMs: input.atMs, close: input.close, gapCount });
  while (points.length > 1 && points[1]!.atMs <= input.atMs - MAX_HORIZON_MS) points.shift();
  return {
    sessionDate: input.sessionDate, sourceIdentity: input.sourceIdentity, points,
    high: sameSession ? Math.max(existing!.high, input.high) : input.high,
    low: sameSession ? Math.min(existing!.low, input.low) : input.low,
    gapCount, previousSessionClose: input.previousSessionClose
  };
}

function freshness(series: ReturnSeries | undefined, asOfMs: number): ContextQuality {
  if (!series) return "INSUFFICIENT_HISTORY";
  const lastMs = series.points.at(-1)!.atMs;
  if (lastMs > asOfMs) throw new Error("Future context observation would leak into earlier read");
  return asOfMs - lastMs > CONTEXT_MAX_STALENESS_MS ? "STALE" : "AVAILABLE";
}

function returnAt(series: ReturnSeries | undefined, minutes: number, asOfMs: number): ContextMetric {
  const quality = freshness(series, asOfMs);
  const observedAt = series ? new Date(series.points.at(-1)!.atMs).toISOString() : null;
  if (quality !== "AVAILABLE") return missingMetric(quality, observedAt);
  const last = series!.points.at(-1)!;
  const anchorMs = last.atMs - minutes * 60_000;
  const anchor = series!.points.find((point) => point.atMs === anchorMs);
  if (!anchor) return missingMetric(series!.points[0]!.atMs <= anchorMs ? "DATA_GAP" : "INSUFFICIENT_HISTORY", observedAt);
  if (last.gapCount !== anchor.gapCount) return missingMetric("DATA_GAP", observedAt);
  return pointMetric((last.close / anchor.close - 1) * 100, "AVAILABLE", observedAt);
}

interface BreadthContribution {
  atMs: number;
  direction: -1 | 0 | 1;
  aboveVwap: boolean | null;
  active: boolean;
}

/** O(1) delta updates and lazy expiration, shared by all instrument reads. */
class BreadthAccumulator {
  private readonly expected: Set<string>;
  private readonly contributions = new Map<string, BreadthContribution>();
  private expirations: Array<{ token: string; atMs: number }> = [];
  private expiryHead = 0;
  private available = 0;
  private advancing = 0;
  private declining = 0;
  private unchanged = 0;
  private vwapAvailable = 0;
  private aboveVwap = 0;

  constructor(tokens: string[]) { this.expected = new Set(tokens); }

  update(token: string, atMs: number, close: number, previousClose: number | null, aboveVwap: boolean | null) {
    if (!this.expected.has(token)) return;
    const existing = this.contributions.get(token);
    if (existing?.active) this.apply(existing, -1);
    if (previousClose == null || !(previousClose > 0)) {
      this.contributions.delete(token);
      return;
    }
    const direction: -1 | 0 | 1 = close > previousClose ? 1 : close < previousClose ? -1 : 0;
    const contribution = { atMs, direction, aboveVwap, active: true };
    this.contributions.set(token, contribution);
    this.apply(contribution, 1);
    this.expirations.push({ token, atMs });
  }

  expire(asOfMs: number) {
    while (this.expiryHead < this.expirations.length) {
      const next = this.expirations[this.expiryHead]!;
      if (next.atMs + CONTEXT_MAX_STALENESS_MS >= asOfMs) break;
      this.expiryHead += 1;
      const current = this.contributions.get(next.token);
      if (current?.active && current.atMs === next.atMs) {
        this.apply(current, -1);
        current.active = false;
      }
    }
    if (this.expiryHead > 64 && this.expiryHead * 2 > this.expirations.length) {
      this.expirations = this.expirations.slice(this.expiryHead);
      this.expiryHead = 0;
    }
  }

  snapshot(): BreadthContext {
    const expectedConstituents = this.expected.size;
    const coveragePct = expectedConstituents ? this.available / expectedConstituents * 100 : 0;
    const sufficient = expectedConstituents >= BREADTH_MIN_CONSTITUENTS && this.available >= BREADTH_MIN_CONSTITUENTS && coveragePct >= BREADTH_MIN_COVERAGE * 100;
    const aboveVwapCoveragePct = expectedConstituents ? this.vwapAvailable / expectedConstituents * 100 : 0;
    const sufficientVwap = expectedConstituents >= BREADTH_MIN_CONSTITUENTS && this.vwapAvailable >= BREADTH_MIN_CONSTITUENTS && aboveVwapCoveragePct >= BREADTH_MIN_COVERAGE * 100;
    return {
      expectedConstituents, availableConstituents: this.available, coveragePct,
      quality: sufficient ? "AVAILABLE" : "INSUFFICIENT_COVERAGE",
      advancingCount: this.advancing, decliningCount: this.declining, unchangedCount: this.unchanged,
      advancePct: sufficient ? this.advancing / this.available * 100 : null,
      declinePct: sufficient ? this.declining / this.available * 100 : null,
      aboveVwapAvailableCount: this.vwapAvailable, aboveVwapCount: this.aboveVwap, aboveVwapCoveragePct,
      aboveVwapPct: sufficientVwap ? this.aboveVwap / this.vwapAvailable * 100 : null,
      aboveVwapQuality: sufficientVwap ? "AVAILABLE" : "INSUFFICIENT_COVERAGE"
    };
  }

  size() { return { entries: this.contributions.size, expiryQueue: this.expirations.length - this.expiryHead }; }

  private apply(value: BreadthContribution, delta: 1 | -1) {
    this.available += delta;
    if (value.direction === 1) this.advancing += delta;
    else if (value.direction === -1) this.declining += delta;
    else this.unchanged += delta;
    if (value.aboveVwap != null) {
      this.vwapAvailable += delta;
      if (value.aboveVwap) this.aboveVwap += delta;
    }
  }
}

function relative(instrument: ContextMetric, benchmark: ContextMetric): RelativeMetric {
  const quality = instrument.quality !== "AVAILABLE" ? instrument.quality : benchmark.quality;
  return {
    valuePct: quality === "AVAILABLE" ? instrument.valuePct! - benchmark.valuePct! : null,
    quality,
    observedAt: instrument.observedAt,
    instrumentReturnPct: instrument.valuePct,
    benchmarkReturnPct: benchmark.valuePct,
    benchmarkObservedAt: benchmark.observedAt
  };
}

function unavailableRelative(quality: ContextQuality): Readonly<Record<ContextHorizon, RelativeMetric>> {
  return Object.fromEntries(HORIZONS.map((horizon) => [horizon, relative(missingMetric(quality), missingMetric(quality))])) as Record<ContextHorizon, RelativeMetric>;
}

export function fromHistoricalBenchmarkCandle(candle: NormalizedHistoricalCandle, benchmarkId: string, sourceIdentity: string, previousSessionClose: number | null): BenchmarkObservation {
  if (candle.interval !== "1m") throw new Error("9B benchmark context requires finalized 1m candles");
  return {
    benchmarkId, instrumentToken: candle.instrumentToken, interval: "1m", startTime: candle.timestamp.toISOString(),
    sessionDate: getTradingDate(candle.timestamp, "Asia/Kolkata"), open: candle.open, high: candle.high,
    low: candle.low, close: candle.close, previousSessionClose, sourceIdentity
  };
}

export function fromCompletedBenchmarkCandle(candle: MarketCandle, benchmarkId: string, sourceIdentity: string, previousSessionClose: number | null): BenchmarkObservation {
  if (candle.interval !== "1m") throw new Error("9B benchmark context requires finalized 1m candles");
  return {
    benchmarkId, instrumentToken: candle.instrumentToken, interval: "1m", startTime: candle.startTime,
    sessionDate: getTradingDate(new Date(candle.startTime), "Asia/Kolkata"), open: candle.open, high: candle.high,
    low: candle.low, close: candle.close, previousSessionClose, sourceIdentity
  };
}

export class MarketContextEngine {
  private readonly equity = new Map<string, ReturnSeries>();
  private readonly benchmarks = new Map<string, ReturnSeries>();
  private readonly marketBreadth = new BreadthAccumulator(sectorMemberships.map((item) => item.instrumentToken));
  private readonly sectorBreadths = new Map<SectorId, BreadthAccumulator>();
  private maxSeenMs = Number.NEGATIVE_INFINITY;
  private equitySourceIdentity: string | null = null;
  private revision = 0;
  private marketCache: { atMs: number; revision: number; value: MarketContextSnapshot } | null = null;
  private readonly sectorCache = new Map<SectorId, { atMs: number; revision: number; value: SectorContextSnapshot }>();

  constructor(private readonly options: { allowBackcastCurrentMembership: boolean } = { allowBackcastCurrentMembership: false }) {
    for (const sectorId of new Set(sectorMemberships.map((item) => item.sectorId))) {
      this.sectorBreadths.set(sectorId, new BreadthAccumulator(sectorMemberships.filter((item) => item.sectorId === sectorId).map((item) => item.instrumentToken)));
    }
  }

  ingestEquity(input: EquityContextObservation) {
    const feature = input.feature;
    if (feature.interval !== "1m" || !isFrozenBreadthConstituent(feature.instrumentToken) || feature.quality.lastPrice !== "AVAILABLE" ||
        feature.values.lastPrice == null || feature.values.high == null || feature.values.low == null) {
      throw new Error("9B requires a finalized 1m frozen-universe equity feature snapshot");
    }
    if (!nseCashCalendar.getDay(feature.sessionDate).session) throw new Error("Equity context date is not an authoritative trading session");
    const atMs = Date.parse(feature.timestamp);
    if (this.equitySourceIdentity && this.equitySourceIdentity !== feature.sourceIdentity) {
      throw new Error("Mixed equity source identities in one context run");
    }
    this.advance(atMs);
    this.equitySourceIdentity = feature.sourceIdentity;
    const existing = this.equity.get(feature.instrumentToken);
    const next = updateSeries(existing, {
      sessionDate: feature.sessionDate, sourceIdentity: feature.sourceIdentity, atMs, close: feature.values.lastPrice,
      high: feature.values.high, low: feature.values.low, previousSessionClose: input.previousSessionClose,
      initialGap: feature.quality.sessionHigh === "DATA_GAP"
    });
    this.equity.set(feature.instrumentToken, next);
    this.revision += 1;
    const membership = resolveSectorMembership(feature.instrumentToken, feature.sessionDate, this.options);
    if (membership) {
      const aboveVwap = feature.quality.aboveVwap === "AVAILABLE" ? feature.values.aboveVwap : null;
      this.marketBreadth.update(feature.instrumentToken, atMs, feature.values.lastPrice, input.previousSessionClose, aboveVwap);
      this.sectorBreadths.get(membership.sectorId)!.update(feature.instrumentToken, atMs, feature.values.lastPrice, input.previousSessionClose, aboveVwap);
    }
  }

  ingestBenchmark(input: BenchmarkObservation) {
    const definition = getBenchmarkById(input.benchmarkId);
    if (!definition || input.instrumentToken !== definition.instrumentToken || input.interval !== "1m") throw new Error("Unknown or mismatched context benchmark");
    const day = nseCashCalendar.getDay(input.sessionDate);
    if (!day.session) throw new Error(`No authoritative trading date for context benchmark: ${input.sessionDate}`);
    if (input.sessionDate < MEMBERSHIP_AS_OF_DATE && !this.options.allowBackcastCurrentMembership) {
      throw new Error("Historical benchmark identity backcast requires explicit opt-in");
    }
    const startMs = Date.parse(input.startTime);
    const atMs = startMs + 60_000;
    if (!Number.isFinite(startMs) || startMs % 60_000 !== 0 ||
        getTradingDate(new Date(atMs - 1), "Asia/Kolkata") !== input.sessionDate ||
        ![input.open, input.high, input.low, input.close].every(Number.isFinite) ||
        !(input.low > 0) || input.high < Math.max(input.open, input.close) || input.low > Math.min(input.open, input.close) ||
        (input.previousSessionClose != null && (!Number.isFinite(input.previousSessionClose) || !(input.previousSessionClose > 0))) || !input.sourceIdentity) {
      throw new Error("Invalid completed index observation");
    }
    this.advance(atMs);
    this.benchmarks.set(input.benchmarkId, updateSeries(this.benchmarks.get(input.benchmarkId), {
      sessionDate: input.sessionDate, sourceIdentity: input.sourceIdentity, atMs,
      close: input.close, high: input.high, low: input.low, previousSessionClose: input.previousSessionClose,
      initialGap: atMs !== Date.parse(`${input.sessionDate}T${day.session.openTimeIst}:00+05:30`) + 60_000
    }));
    this.revision += 1;
  }

  getContext(instrumentToken: string, asOf: Date): InstrumentMarketContext {
    const asOfMs = asOf.getTime();
    if (!this.equity.has(instrumentToken)) throw new Error(`No equity observation for ${instrumentToken}`);
    this.advance(asOfMs);
    const timestamp = asOf.toISOString();
    const equitySeries = this.equity.get(instrumentToken)!;
    const membership = resolveSectorMembership(instrumentToken, equitySeries.sessionDate, this.options);
    const market = this.marketSnapshot(asOfMs, timestamp);
    const sectorDefinition = membership ? getSectorBenchmark(membership.sectorId) : null;
    const sector = membership ? this.sectorSnapshot(membership.sectorId, asOfMs, timestamp) : null;
    const instrumentReturns = horizonMap((minutes) => returnAt(equitySeries, minutes, asOfMs));
    const marketReturns = market.benchmark.horizonReturns;
    const sectorReturns = sectorDefinition ? sector?.benchmark?.horizonReturns ?? horizonMap((minutes) => returnAt(undefined, minutes, asOfMs)) : null;
    const instrumentVsMarket = Object.fromEntries(HORIZONS.map((horizon) => [horizon, relative(instrumentReturns[horizon], marketReturns[horizon])])) as Record<ContextHorizon, RelativeMetric>;
    const instrumentVsSector = sectorReturns
      ? Object.fromEntries(HORIZONS.map((horizon) => [horizon, relative(instrumentReturns[horizon], sectorReturns[horizon])])) as Record<ContextHorizon, RelativeMetric>
      : unavailableRelative("NOT_APPLICABLE");
    const sectorVsMarket = sectorReturns
      ? Object.fromEntries(HORIZONS.map((horizon) => [horizon, relative(sectorReturns[horizon], marketReturns[horizon])])) as Record<ContextHorizon, RelativeMetric>
      : unavailableRelative("NOT_APPLICABLE");
    const relativeBody = {
      schemaVersion: CONTEXT_SCHEMA_VERSION, definitionVersion: CONTEXT_DEFINITIONS_VERSION,
      contextUniverseId, membershipPolicy: this.membershipPolicy(),
      equitySourceIdentity: this.equitySourceIdentity!, marketSourceIdentity: market.benchmark.sourceIdentity,
      sectorSourceIdentity: sector?.benchmark?.sourceIdentity ?? null,
      timestamp, instrumentToken, sectorId: membership?.sectorId ?? null,
      instrumentVsMarket, instrumentVsSector, sectorVsMarket
    } as const;
    const relativeContext: RelativeContextSnapshot = frozen({ id: hash(relativeBody), ...relativeBody });
    const membershipQuality: ContextQuality = membership ? "AVAILABLE" : "INSUFFICIENT_HISTORY";
    const membershipProvenance = !membership ? "UNAVAILABLE" as const : equitySeries.sessionDate < MEMBERSHIP_AS_OF_DATE ? "EXPLICIT_HISTORICAL_BACKCAST" as const : "CURRENT_SNAPSHOT" as const;
    const body = { timestamp, instrumentToken, membershipPolicy: this.membershipPolicy(), equitySourceIdentity: this.equitySourceIdentity!, membershipQuality, membershipProvenance, market, sector, relative: relativeContext };
    return frozen({ id: hash(body), ...body });
  }

  stateSize() {
    const breadthSizes = [this.marketBreadth, ...this.sectorBreadths.values()].map((state) => state.size());
    return {
      equitySeries: this.equity.size,
      benchmarkSeries: this.benchmarks.size,
      retainedReturnPoints: [...this.equity.values(), ...this.benchmarks.values()].reduce((sum, series) => sum + series.points.length, 0),
      breadthEntries: breadthSizes.reduce((sum, size) => sum + size.entries, 0),
      expiryQueue: breadthSizes.reduce((sum, size) => sum + size.expiryQueue, 0),
      cachedSectorSnapshots: this.sectorCache.size
    };
  }

  private marketSnapshot(asOfMs: number, timestamp: string): MarketContextSnapshot {
    if (this.marketCache?.atMs === asOfMs && this.marketCache.revision === this.revision) return this.marketCache.value;
    const body = {
      schemaVersion: CONTEXT_SCHEMA_VERSION, definitionVersion: CONTEXT_DEFINITIONS_VERSION,
      timestamp, contextUniverseId, membershipPolicy: this.membershipPolicy(), equitySourceIdentity: this.equitySourceIdentity!,
      benchmark: this.benchmarkContext(BROAD_BENCHMARK_ID, asOfMs), breadth: this.marketBreadth.snapshot()
    } as const;
    const value: MarketContextSnapshot = frozen({ id: hash(body), ...body });
    this.marketCache = { atMs: asOfMs, revision: this.revision, value };
    return value;
  }

  private sectorSnapshot(sectorId: SectorId, asOfMs: number, timestamp: string): SectorContextSnapshot {
    const cached = this.sectorCache.get(sectorId);
    if (cached?.atMs === asOfMs && cached.revision === this.revision) return cached.value;
    const definition = getSectorBenchmark(sectorId);
    const benchmark = definition ? this.benchmarkContext(definition.id, asOfMs) : null;
    const body = {
      schemaVersion: CONTEXT_SCHEMA_VERSION, definitionVersion: CONTEXT_DEFINITIONS_VERSION,
      timestamp, sectorId, contextUniverseId, membershipPolicy: this.membershipPolicy(), equitySourceIdentity: this.equitySourceIdentity!,
      benchmark, benchmarkQuality: benchmark?.quality ?? "NOT_APPLICABLE" as ContextQuality,
      breadth: this.sectorBreadths.get(sectorId)!.snapshot()
    } as const;
    const value: SectorContextSnapshot = frozen({ id: hash(body), ...body });
    this.sectorCache.set(sectorId, { atMs: asOfMs, revision: this.revision, value });
    return value;
  }

  private benchmarkContext(benchmarkId: string, asOfMs: number): BenchmarkContext {
    const definition = getBenchmarkById(benchmarkId)!;
    const series = this.benchmarks.get(benchmarkId);
    const quality = freshness(series, asOfMs);
    const last = series?.points.at(-1);
    const observedAt = last ? new Date(last.atMs).toISOString() : null;
    const sessionReturn: ContextMetric = quality !== "AVAILABLE" ? missingMetric(quality, observedAt)
      : series!.previousSessionClose == null ? missingMetric("INSUFFICIENT_HISTORY", observedAt)
        : pointMetric((last!.close / series!.previousSessionClose - 1) * 100, "AVAILABLE", observedAt);
    const rangeQuality: ContextQuality = quality !== "AVAILABLE" ? quality : series!.gapCount > 0 ? "DATA_GAP" : "AVAILABLE";
    return frozen({
      benchmarkId, instrumentToken: definition.instrumentToken, sourceIdentity: series?.sourceIdentity ?? null, observedAt,
      close: quality === "AVAILABLE" ? last!.close : null, quality, sessionReturn,
      horizonReturns: horizonMap((minutes) => returnAt(series, minutes, asOfMs)),
      distanceFromSessionHighPct: rangeQuality === "AVAILABLE" ? pointMetric((series!.high - last!.close) / series!.high * 100, rangeQuality, observedAt) : missingMetric(rangeQuality, observedAt),
      distanceFromSessionLowPct: rangeQuality === "AVAILABLE" ? pointMetric((last!.close - series!.low) / series!.low * 100, rangeQuality, observedAt) : missingMetric(rangeQuality, observedAt),
      volumeQuality: "NOT_APPLICABLE" as const
    });
  }

  private advance(asOfMs: number) {
    if (!Number.isFinite(asOfMs) || asOfMs < this.maxSeenMs) throw new Error("Context clock cannot move backward or expose future observations");
    this.maxSeenMs = asOfMs;
    this.marketBreadth.expire(asOfMs);
    for (const state of this.sectorBreadths.values()) state.expire(asOfMs);
  }

  private membershipPolicy(): MembershipPolicy {
    return this.options.allowBackcastCurrentMembership ? "EXPLICIT_CURRENT_BACKCAST" : "STRICT_AS_OF";
  }
}
