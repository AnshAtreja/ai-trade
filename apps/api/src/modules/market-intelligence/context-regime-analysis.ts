import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { getHistoricalMarketDataService } from "../historical-market-data/service";
import { researchUniverseInstruments } from "../historical-market-data/research-universe";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import { getTradingDate } from "../../common/utils/trading-date";
import { fromHistoricalCandle, MarketFeatureEngine, resolveNseFeatureSession } from "./feature-engine";
import { fromHistoricalBenchmarkCandle, MarketContextEngine } from "./context-engine";
import { benchmarkRegistry, BREADTH_UNIVERSE_VERSION, contextUniverseId, resolveSectorMembership, type SectorId } from "./context-universe";
import { INDEX_CONTEXT_FROM, INDEX_CONTEXT_TO, indexSessionBounds, type IndexContextDatasetManifest } from "./context-dataset";
import { regimeDefinitionHash } from "./regime-definition";
import { MarketRegimeEngine } from "./regime-engine";
import type { MarketRegimeSnapshot, SectorRegimeSnapshot, TrendState, VolatilityState } from "./regime-types";
import { KiteHistoricalMarketDataProvider } from "../historical-market-data/kite-historical-provider";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";

const EQUITY_SOURCE_ID = "505dca3f27301e72";
type Counter = Record<string, number>;

function count(counter: Counter, key: string, amount = 1) { counter[key] = (counter[key] ?? 0) + amount; }
function percent(counter: Counter): Record<string, number> {
  const total = Object.values(counter).reduce((sum, value) => sum + value, 0);
  return Object.fromEntries(Object.entries(counter).map(([key, value]) => [key, total ? value / total * 100 : 0]));
}
function median(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[mid]! : (sorted[mid - 1]! + sorted[mid]!) / 2;
}
function timeBucket(timestamp: string) {
  const atMs = Date.parse(timestamp) + 330 * 60_000;
  const local = new Date(atMs);
  const hour = local.getUTCHours().toString().padStart(2, "0");
  const minute = local.getUTCMinutes() < 30 ? "00" : "30";
  return `${hour}:${minute} IST`;
}

interface TrendSequence {
  lastState: TrendState | null;
  lastMs: number;
  length: number;
  lastDirectional: TrendState | null;
  crossedUncertain: boolean;
}

class MarketSummary {
  readonly trend: Counter = {};
  readonly volatility: Counter = {};
  readonly quality: Counter = {};
  readonly monthly: Record<string, Counter> = {};
  readonly monthlyVolatility: Record<string, Counter> = {};
  readonly timeOfDay: Record<string, Counter> = {};
  readonly timeOfDayVolatility: Record<string, Counter> = {};
  readonly breadthQuality: Counter = {};
  breadthCoverageSumPct = 0;
  breadthCoverageMinimumPct = Number.POSITIVE_INFINITY;
  breadthCoverageMaximumPct = Number.NEGATIVE_INFINITY;
  breadthObservations = 0;
  readonly transitions: Counter = {};
  readonly transitionTimeOfDay: Counter = {};
  readonly flipsPerSession: Counter = {};
  readonly observedSessions = new Set<string>();
  readonly durationsMinutes: number[] = [];
  directUpDownTransitions = 0;
  transitionsThroughUncertain = 0;
  volatilityWarmup = 0;
  laggedBenchmarkReads = 0;
  private sequence: TrendSequence = { lastState: null, lastMs: Number.NEGATIVE_INFINITY, length: 0, lastDirectional: null, crossedUncertain: false };
  private lastDate: string | null = null;

  add(value: MarketRegimeSnapshot) {
    count(this.trend, value.trend.state);
    count(this.volatility, value.volatility.state);
    count(this.quality, value.quality);
    count(this.breadthQuality, value.breadth.quality);
    this.breadthCoverageSumPct += value.breadth.coveragePct;
    this.breadthCoverageMinimumPct = Math.min(this.breadthCoverageMinimumPct, value.breadth.coveragePct);
    this.breadthCoverageMaximumPct = Math.max(this.breadthCoverageMaximumPct, value.breadth.coveragePct);
    this.breadthObservations += 1;
    if (value.volatility.reason === "VOLATILITY_WARMUP") this.volatilityWarmup += 1;
    const date = getTradingDate(new Date(value.timestamp), "Asia/Kolkata");
    this.observedSessions.add(date);
    const month = date.slice(0, 7);
    const bucket = timeBucket(value.timestamp);
    this.monthly[month] ??= {};
    this.monthlyVolatility[month] ??= {};
    this.timeOfDay[bucket] ??= {};
    this.timeOfDayVolatility[bucket] ??= {};
    count(this.monthly[month], value.trend.state);
    count(this.monthlyVolatility[month], value.volatility.state);
    count(this.timeOfDay[bucket], value.trend.state);
    count(this.timeOfDayVolatility[bucket], value.volatility.state);
    const atMs = Date.parse(value.timestamp);
    const sequence = this.sequence;
    const continuous = date === this.lastDate && atMs - sequence.lastMs === 60_000;
    if (!continuous) {
      this.finishRun();
      sequence.lastState = null;
      sequence.lastDirectional = null;
      sequence.crossedUncertain = false;
    }
    if (sequence.lastState && sequence.lastState !== value.trend.state) {
      this.finishRun();
      count(this.transitions, `${sequence.lastState}->${value.trend.state}`);
      count(this.transitionTimeOfDay, bucket);
      count(this.flipsPerSession, date);
      if ((sequence.lastState === "TRENDING_UP" && value.trend.state === "TRENDING_DOWN") ||
          (sequence.lastState === "TRENDING_DOWN" && value.trend.state === "TRENDING_UP")) this.directUpDownTransitions += 1;
    }
    if (value.trend.state === "UNCERTAIN" && sequence.lastDirectional) sequence.crossedUncertain = true;
    if (value.trend.state === "TRENDING_UP" || value.trend.state === "TRENDING_DOWN") {
      if (sequence.crossedUncertain && sequence.lastDirectional && sequence.lastDirectional !== value.trend.state) {
        this.transitionsThroughUncertain += 1;
      }
      sequence.lastDirectional = value.trend.state;
      sequence.crossedUncertain = false;
    }
    sequence.lastState = value.trend.state;
    sequence.lastMs = atMs;
    sequence.length += 1;
    this.lastDate = date;
  }

  finish() {
    this.finishRun();
    return {
      trendCounts: this.trend, trendPercent: percent(this.trend),
      volatilityCounts: this.volatility, volatilityPercent: percent(this.volatility), qualityCounts: this.quality,
      monthlyTrendCounts: this.monthly, monthlyVolatilityCounts: this.monthlyVolatility,
      timeOfDayTrendCounts: this.timeOfDay, timeOfDayVolatilityCounts: this.timeOfDayVolatility,
      breadthQualityCounts: this.breadthQuality,
      breadthCoverage: {
        universe: BREADTH_UNIVERSE_VERSION, observations: this.breadthObservations,
        averagePct: this.breadthObservations ? this.breadthCoverageSumPct / this.breadthObservations : null,
        minimumPct: this.breadthObservations ? this.breadthCoverageMinimumPct : null,
        maximumPct: this.breadthObservations ? this.breadthCoverageMaximumPct : null
      },
      transitionCounts: this.transitions, transitionTimeOfDayCounts: this.transitionTimeOfDay,
      directUpDownTransitions: this.directUpDownTransitions, transitionsThroughUncertain: this.transitionsThroughUncertain,
      transitionCount: Object.values(this.transitions).reduce((sum, value) => sum + value, 0),
      averageRegimeDurationMinutes: this.durationsMinutes.length
        ? this.durationsMinutes.reduce((sum, value) => sum + value, 0) / this.durationsMinutes.length : null,
      medianRegimeDurationMinutes: median(this.durationsMinutes),
      flipsPerSession: this.flipsPerSession,
      observedSessions: this.observedSessions.size,
      averageFlipsPerObservedSession: this.observedSessions.size
        ? Object.values(this.flipsPerSession).reduce((sum, value) => sum + value, 0) / this.observedSessions.size : 0,
      volatilityWarmup: this.volatilityWarmup, laggedBenchmarkReads: this.laggedBenchmarkReads
    };
  }

  private finishRun() {
    if (this.sequence.length) this.durationsMinutes.push(this.sequence.length);
    this.sequence.length = 0;
  }
}

class SectorSummary {
  readonly trend: Counter = {};
  readonly volatility: Counter = {};
  readonly relative: Counter = {};
  readonly breadthQuality: Counter = {};
  readonly quality: Counter = {};
  breadthCoverageSumPct = 0;
  breadthCoverageMinimumPct = Number.POSITIVE_INFINITY;
  breadthCoverageMaximumPct = Number.NEGATIVE_INFINITY;
  breadthObservations = 0;
  add(value: SectorRegimeSnapshot) {
    count(this.trend, value.trend.state);
    count(this.volatility, value.volatility.state);
    count(this.relative, value.relativeToMarket);
    count(this.breadthQuality, value.breadth.quality);
    count(this.quality, value.quality);
    this.breadthCoverageSumPct += value.breadth.coveragePct;
    this.breadthCoverageMinimumPct = Math.min(this.breadthCoverageMinimumPct, value.breadth.coveragePct);
    this.breadthCoverageMaximumPct = Math.max(this.breadthCoverageMaximumPct, value.breadth.coveragePct);
    this.breadthObservations += 1;
  }
  finish() {
    return { trendCounts: this.trend, trendPercent: percent(this.trend), volatilityCounts: this.volatility,
      volatilityPercent: percent(this.volatility), relativeCounts: this.relative, breadthQualityCounts: this.breadthQuality,
      qualityCounts: this.quality, breadthCoverage: {
        observations: this.breadthObservations,
        averagePct: this.breadthObservations ? this.breadthCoverageSumPct / this.breadthObservations : null,
        minimumPct: this.breadthObservations ? this.breadthCoverageMinimumPct : null,
        maximumPct: this.breadthObservations ? this.breadthCoverageMaximumPct : null
      } };
  }
}

export interface IndexRegimeAnalysisResult {
  analysisVersion: "PHASE_9C_REAL_CONTEXT_ANALYSIS_V1";
  contextDatasetId: string;
  contextDatasetHash: string;
  regimeDefinitionHash: string;
  breadthContextRegistryId: string;
  breadthUniverseVersion: string;
  equitySourceId: string;
  range: { from: string; to: string };
  membershipPolicy: "EXPLICIT_CURRENT_BACKCAST";
  qualityPolicy: "COMPLETE_EQUITY_1M_SESSIONS_ONLY_INDEX_GAPS_VISIBLE";
  market: ReturnType<MarketSummary["finish"]>;
  sectors: Record<string, ReturnType<SectorSummary["finish"]>>;
  equityExclusions: Record<string, number>;
  activity: {
    benchmarkObservations: number; equityObservations: number; marketRegimeUpdates: number;
    sectorRegimeUpdates: number; elapsedMs: number; peakObservedRssBytes: number;
    featureState: ReturnType<MarketFeatureEngine["stateSize"]>;
    contextState: ReturnType<MarketContextEngine["stateSize"]>;
    regimeState: ReturnType<MarketRegimeEngine["stateSize"]>;
  };
  analysisId: string;
}

export async function analyzeRealContext(manifest: IndexContextDatasetManifest,
  progress: (date: string, completedDates: number, totalDates: number) => void = () => {}): Promise<IndexRegimeAnalysisResult> {
  if (manifest.registryId !== contextUniverseId || manifest.benchmarkCoverage.some((row) =>
    row.rawCandles === 0 || row.invalidOhlcRows > 0 || row.unsupportedPeriods.length > 0)) {
    throw new Error("Index context dataset identity/quality gate failed");
  }
  const started = performance.now();
  const features = new MarketFeatureEngine();
  const context = new MarketContextEngine({ allowBackcastCurrentMembership: true });
  const regime = new MarketRegimeEngine();
  const provider = new KiteHistoricalMarketDataProvider(kiteBrokerAdapter);
  const equityService = getHistoricalMarketDataService();
  const market = new MarketSummary();
  const sectors = new Map<SectorId, SectorSummary>();
  const indexPreviousClose = new Map<string, number | null>();
  const equityPreviousClose = new Map<string, number | null>();
  const equityExclusions: Counter = {};
  let benchmarkObservations = 0;
  let equityObservations = 0;
  let marketRegimeUpdates = 0;
  let sectorRegimeUpdates = 0;
  let peakObservedRssBytes = process.memoryUsage().rss;
  const dates: string[] = [];
  for (let atMs = Date.parse(INDEX_CONTEXT_FROM); atMs < Date.parse(INDEX_CONTEXT_TO); atMs += 86_400_000) {
    const date = getTradingDate(new Date(atMs), "Asia/Kolkata");
    if (indexSessionBounds(date)) dates.push(date);
  }
  for (const [dateIndex, date] of dates.entries()) {
    const bounds = indexSessionBounds(date)!;
    const from = new Date(bounds.fromMs);
    const to = new Date(bounds.toMs);
    const indexDay = await Promise.all(benchmarkRegistry.map(async (definition) => ({
      definition,
      candles: await provider.getStoredCandles({ instrumentToken: definition.instrumentToken, exchange: "NSE",
        tradingSymbol: definition.symbol, interval: "1m", from, to })
    })));
    const equityDay = await Promise.all(researchUniverseInstruments.map(async (instrument) => ({
      instrument, result: await equityService.getResearchCandles({ instrumentToken: instrument.instrumentToken,
        interval: "1m", from, to, requireCompleteSession: true })
    })));
    const byTime = new Map<number, { indexes: Array<{ id: string; candle: NormalizedHistoricalCandle }>;
      equities: Array<{ candle: NormalizedHistoricalCandle; previousClose: number | null }> }>();
    const frame = (atMs: number) => {
      const value = byTime.get(atMs) ?? { indexes: [], equities: [] };
      byTime.set(atMs, value);
      return value;
    };
    for (const { definition, candles } of indexDay) {
      for (const candle of candles) frame(candle.timestamp.getTime()).indexes.push({ id: definition.id, candle });
    }
    for (const { instrument, result } of equityDay) {
      for (const rejected of result.rejectedSessions) {
        count(equityExclusions, rejected.reason ?? "UNKNOWN", 1);
      }
      const previousClose = equityPreviousClose.get(instrument.instrumentToken) ?? null;
      for (const candle of result.candles) frame(candle.timestamp.getTime()).equities.push({ candle, previousClose });
    }
    for (const [atMs, group] of [...byTime.entries()].sort((a, b) => a[0] - b[0])) {
      for (const { id, candle } of group.indexes) {
        context.ingestBenchmark(fromHistoricalBenchmarkCandle(candle, id, manifest.datasetId,
          indexPreviousClose.get(id) ?? null));
        benchmarkObservations += 1;
      }
      const tokens = new Map<SectorId, string>();
      for (const { candle, previousClose } of group.equities) {
        const session = resolveNseFeatureSession(candle, candle.timestamp);
        const feature = features.ingest(fromHistoricalCandle(candle, session, EQUITY_SOURCE_ID, previousClose));
        context.ingestEquity({ feature, previousSessionClose: previousClose });
        equityObservations += 1;
        const membership = resolveSectorMembership(candle.instrumentToken, date, { allowBackcastCurrentMembership: true });
        if (membership) tokens.set(membership.sectorId, candle.instrumentToken);
      }
      let emittedMarket = false;
      for (const token of tokens.values()) {
        const observation = context.getContext(token, new Date(atMs + 60_000));
        const snapshot = regime.observe(observation);
        if (!emittedMarket) {
          market.add(snapshot.market);
          marketRegimeUpdates += 1;
          emittedMarket = true;
          if (observation.market.benchmark.observedAt && observation.market.benchmark.observedAt < observation.timestamp) {
            market.laggedBenchmarkReads += 1;
          }
        }
        if (snapshot.sector) {
          const sector = sectors.get(snapshot.sector.sectorId) ?? new SectorSummary();
          sector.add(snapshot.sector);
          sectors.set(snapshot.sector.sectorId, sector);
          sectorRegimeUpdates += 1;
        }
      }
    }
    for (const { definition, candles } of indexDay) {
      const expected = (bounds.toMs - bounds.fromMs) / 60_000;
      indexPreviousClose.set(definition.id, candles.length === expected ? candles.at(-1)!.close : null);
    }
    for (const { instrument, result } of equityDay) {
      equityPreviousClose.set(instrument.instrumentToken, result.rejectedSessions.length ? null : result.candles.at(-1)?.close ?? null);
    }
    peakObservedRssBytes = Math.max(peakObservedRssBytes, process.memoryUsage().rss);
    if ((dateIndex + 1) % 10 === 0 || dateIndex + 1 === dates.length) progress(date, dateIndex + 1, dates.length);
  }
  const core = {
    analysisVersion: "PHASE_9C_REAL_CONTEXT_ANALYSIS_V1" as const,
    contextDatasetId: manifest.datasetId, contextDatasetHash: manifest.contentHash,
    regimeDefinitionHash, breadthContextRegistryId: contextUniverseId,
    breadthUniverseVersion: BREADTH_UNIVERSE_VERSION, equitySourceId: EQUITY_SOURCE_ID,
    range: { from: INDEX_CONTEXT_FROM, to: INDEX_CONTEXT_TO },
    membershipPolicy: "EXPLICIT_CURRENT_BACKCAST" as const,
    qualityPolicy: "COMPLETE_EQUITY_1M_SESSIONS_ONLY_INDEX_GAPS_VISIBLE" as const,
    market: market.finish(), sectors: Object.fromEntries([...sectors.entries()].map(([key, value]) => [key, value.finish()])),
    equityExclusions
  };
  const analysisId = createHash("sha256").update(JSON.stringify(core)).digest("hex").slice(0, 24);
  return {
    ...core, activity: { benchmarkObservations, equityObservations, marketRegimeUpdates, sectorRegimeUpdates,
      elapsedMs: performance.now() - started, peakObservedRssBytes, featureState: features.stateSize(),
      contextState: context.stateSize(), regimeState: regime.stateSize() }, analysisId
  };
}

export function stableRegimeArtifact(result: IndexRegimeAnalysisResult) {
  const { elapsedMs: _elapsedMs, peakObservedRssBytes: _peakObservedRssBytes, ...deterministicActivity } = result.activity;
  return { ...result, activity: deterministicActivity };
}
