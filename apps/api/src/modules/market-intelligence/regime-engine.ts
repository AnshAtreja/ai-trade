import { createHash } from "node:crypto";
import type { BenchmarkContext, BreadthContext, ContextMetric, ContextQuality, InstrumentMarketContext } from "./context-types";
import { regimeDefinition, regimeDefinitionHash, REGIME_DEFINITION_VERSION, REGIME_SCHEMA_VERSION } from "./regime-definition";
import type {
  BreadthRegime, InstrumentRegimeContext, MarketRegimeSnapshot, RelativeSectorState,
  SectorRegimeSnapshot, TrendRegime, VolatilityRegime
} from "./regime-types";

function identity(value: unknown): string {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex").slice(0, 24);
}

function immutable<T>(value: T): T {
  if (value && typeof value === "object" && !Object.isFrozen(value)) {
    for (const child of Object.values(value as Record<string, unknown>)) immutable(child);
    Object.freeze(value);
  }
  return value;
}

function available(metric: ContextMetric): metric is ContextMetric & { valuePct: number } {
  return metric.quality === "AVAILABLE" && metric.valuePct !== null;
}

function unavailableQuality(benchmark: BenchmarkContext, breadth: BreadthContext): ContextQuality {
  if (benchmark.quality !== "AVAILABLE") return benchmark.quality;
  for (const metric of [benchmark.horizonReturns["15m"], benchmark.horizonReturns["30m"], benchmark.distanceFromSessionHighPct, benchmark.distanceFromSessionLowPct]) {
    if (!available(metric)) return metric.quality;
  }
  if (breadth.quality !== "AVAILABLE") return breadth.quality;
  if (breadth.aboveVwapQuality !== "AVAILABLE") return breadth.aboveVwapQuality;
  return "AVAILABLE";
}

function classifyTrend(benchmark: BenchmarkContext, breadth: BreadthContext): TrendRegime {
  const b = benchmark.horizonReturns;
  const metrics = {
    return15mPct: b["15m"].valuePct, return30mPct: b["30m"].valuePct,
    distanceFromHighPct: benchmark.distanceFromSessionHighPct.valuePct,
    distanceFromLowPct: benchmark.distanceFromSessionLowPct.valuePct,
    advancePct: breadth.advancePct, aboveVwapPct: breadth.aboveVwapPct
  };
  const quality = unavailableQuality(benchmark, breadth);
  if (quality !== "AVAILABLE" || Object.values(metrics).some((value) => value === null)) {
    return { state: "UNCERTAIN", evidenceStrength: "LOW", quality, supporting: [], conflicting: [`INPUT_${quality}`], metrics };
  }

  const t = regimeDefinition.trend;
  const r15 = metrics.return15mPct!;
  const r30 = metrics.return30mPct!;
  const high = metrics.distanceFromHighPct!;
  const low = metrics.distanceFromLowPct!;
  const advance = metrics.advancePct!;
  const vwap = metrics.aboveVwapPct!;
  const up = [r15 >= t.minimum15mPct && r30 >= t.minimum30mPct,
    high <= t.nearSessionExtremePct,
    advance >= t.minimumDirectionalBreadthPct,
    vwap >= t.minimumDirectionalBreadthPct];
  const down = [r15 <= -t.minimum15mPct && r30 <= -t.minimum30mPct,
    low <= t.nearSessionExtremePct,
    advance <= t.maximumOpposingBreadthPct,
    vwap <= t.maximumOpposingBreadthPct];
  const upCodes = ["POSITIVE_15M_30M", "NEAR_SESSION_HIGH", "ADVANCING_SAMPLE", "ABOVE_VWAP_SAMPLE"];
  const downCodes = ["NEGATIVE_15M_30M", "NEAR_SESSION_LOW", "DECLINING_SAMPLE", "BELOW_VWAP_SAMPLE"];
  if (up.every(Boolean)) return { state: "TRENDING_UP", evidenceStrength: "HIGH", quality, supporting: upCodes, conflicting: [], metrics };
  if (down.every(Boolean)) return { state: "TRENDING_DOWN", evidenceStrength: "HIGH", quality, supporting: downCodes, conflicting: [], metrics };
  const range = Math.abs(r15) <= t.maximumRange15mPct && Math.abs(r30) <= t.maximumRange30mPct &&
    advance >= t.rangeBreadthLowerPct && advance <= t.rangeBreadthUpperPct &&
    vwap >= t.rangeBreadthLowerPct && vwap <= t.rangeBreadthUpperPct;
  if (range) return {
    state: "RANGE_BOUND", evidenceStrength: "MEDIUM", quality,
    supporting: ["MUTED_15M_30M", "BALANCED_SAMPLE_BREADTH", "BALANCED_SAMPLE_VWAP"], conflicting: [], metrics
  };
  const supporting = up.filter(Boolean).length >= down.filter(Boolean).length
    ? upCodes.filter((_, index) => up[index]) : downCodes.filter((_, index) => down[index]);
  const conflicting = up.filter(Boolean).length >= down.filter(Boolean).length
    ? upCodes.filter((_, index) => !up[index]) : downCodes.filter((_, index) => !down[index]);
  return { state: "UNCERTAIN", evidenceStrength: supporting.length >= 3 ? "MEDIUM" : "LOW", quality, supporting, conflicting, metrics };
}

function classifyBreadth(trend: TrendRegime, breadth: BreadthContext, universeId: string): BreadthRegime {
  let state: BreadthRegime["state"] = "UNAVAILABLE";
  if (breadth.quality === "AVAILABLE" && breadth.aboveVwapQuality === "AVAILABLE") {
    state = "NEUTRAL";
    if (trend.state === "TRENDING_UP") state = "CONFIRMING";
    else if (trend.state === "TRENDING_DOWN") state = "CONFIRMING";
    else if (trend.metrics.return15mPct != null && trend.metrics.return30mPct != null) {
      const t = regimeDefinition.trend;
      if (trend.metrics.return15mPct >= t.minimum15mPct && trend.metrics.return30mPct >= t.minimum30mPct &&
          breadth.advancePct! <= t.maximumOpposingBreadthPct) state = "CONTRADICTING";
      if (trend.metrics.return15mPct <= -t.minimum15mPct && trend.metrics.return30mPct <= -t.minimum30mPct &&
          breadth.advancePct! >= t.minimumDirectionalBreadthPct) state = "CONTRADICTING";
    }
  }
  return {
    state, quality: breadth.quality !== "AVAILABLE" ? breadth.quality : breadth.aboveVwapQuality,
    contextUniverseId: universeId, expectedConstituents: breadth.expectedConstituents,
    availableConstituents: breadth.availableConstituents, coveragePct: breadth.coveragePct,
    advancePct: breadth.advancePct, aboveVwapPct: breadth.aboveVwapPct
  };
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle]! : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

function overallQuality(trend: TrendRegime, volatility: VolatilityRegime): ContextQuality {
  return trend.quality !== "AVAILABLE" ? trend.quality : volatility.quality;
}

function assertBenchmarkTime(benchmark: BenchmarkContext, atMs: number) {
  const metrics = [benchmark.sessionReturn, ...Object.values(benchmark.horizonReturns),
    benchmark.distanceFromSessionHighPct, benchmark.distanceFromSessionLowPct];
  const times = [benchmark.observedAt, ...metrics.map((metric) => metric.observedAt)];
  if (times.some((time) => time != null && (!Number.isFinite(Date.parse(time)) || Date.parse(time) > atMs))) {
    throw new Error("Future or invalid benchmark metric observation in regime context");
  }
}

interface VolatilityHistory {
  sourceIdentity: string;
  lastObservedAt: string | null;
  samples: number[];
  lastResult: VolatilityRegime | null;
}

/** Research/live-neutral, ordered 9B-context consumer. No trading or persistence side effects. */
export class MarketRegimeEngine {
  private maxSeenMs = Number.NEGATIVE_INFINITY;
  private readonly volatilityHistory = new Map<string, VolatilityHistory>();
  private marketCache: { contextId: string; value: MarketRegimeSnapshot } | null = null;
  private readonly sectorCache = new Map<string, { contextId: string; marketId: string; value: SectorRegimeSnapshot }>();

  observe(context: InstrumentMarketContext): InstrumentRegimeContext {
    const atMs = Date.parse(context.timestamp);
    if (!Number.isFinite(atMs) || atMs < this.maxSeenMs) throw new Error("Regime clock cannot move backward");
    this.maxSeenMs = atMs;
    if (context.market.timestamp !== context.timestamp ||
        (context.sector != null && (context.sector.timestamp !== context.timestamp || context.market.contextUniverseId !== context.sector.contextUniverseId))) {
      throw new Error("Regime inputs must be from one point-in-time context frame");
    }
    assertBenchmarkTime(context.market.benchmark, atMs);
    if (context.sector?.benchmark) assertBenchmarkTime(context.sector.benchmark, atMs);
    if (this.marketCache?.contextId !== context.market.id) {
      const trend = classifyTrend(context.market.benchmark, context.market.breadth);
      const volatility = this.volatility(context.market.benchmark);
      const breadth = classifyBreadth(trend, context.market.breadth, context.market.contextUniverseId);
      const body = {
        schemaVersion: REGIME_SCHEMA_VERSION, definitionVersion: REGIME_DEFINITION_VERSION, definitionHash: regimeDefinitionHash,
        scope: "MARKET" as const, timestamp: context.timestamp, sourceContextId: context.market.id,
        contextUniverseId: context.market.contextUniverseId, trend, volatility, breadth,
        quality: overallQuality(trend, volatility), anomaly: null
      } as const;
      this.marketCache = { contextId: context.market.id, value: immutable({ id: identity(body), ...body }) };
    }
    const market = this.marketCache!.value;
    let sector: SectorRegimeSnapshot | null = null;
    if (context.sector) {
      const cached = this.sectorCache.get(context.sector.sectorId);
      if (cached?.contextId === context.sector.id && cached.marketId === market.id) sector = cached.value;
      else {
        const benchmark = context.sector.benchmark;
        const trend = benchmark ? classifyTrend(benchmark, context.sector.breadth) : this.unavailableTrend(context.sector.benchmarkQuality);
        const volatility = benchmark ? this.volatility(benchmark) : this.unknownVolatility(context.sector.benchmarkQuality, "BENCHMARK_UNAVAILABLE");
        const breadth = classifyBreadth(trend, context.sector.breadth, context.sector.contextUniverseId);
        const relative = context.relative.sectorVsMarket["15m"];
        if ([relative.observedAt, relative.benchmarkObservedAt].some((time) =>
          time != null && (!Number.isFinite(Date.parse(time)) || Date.parse(time) > atMs))) {
          throw new Error("Future relative metric observation in regime context");
        }
        const difference = relative.quality === "AVAILABLE" ? relative.valuePct : null;
        const threshold = regimeDefinition.relative.materialDifferencePct;
        const relativeToMarket: RelativeSectorState = difference == null ? "UNKNOWN" : difference >= threshold
          ? "OUTPERFORMING_MARKET" : difference <= -threshold ? "UNDERPERFORMING_MARKET" : "INLINE_WITH_MARKET";
        const body = {
          schemaVersion: REGIME_SCHEMA_VERSION, definitionVersion: REGIME_DEFINITION_VERSION, definitionHash: regimeDefinitionHash,
          scope: "SECTOR" as const, sectorId: context.sector.sectorId, timestamp: context.timestamp,
          sourceContextId: context.sector.id, contextUniverseId: context.sector.contextUniverseId,
          trend, volatility, breadth, quality: overallQuality(trend, volatility), anomaly: null, relativeToMarket,
          relative15mPct: difference
        } as const;
        const value: SectorRegimeSnapshot = immutable({ id: identity(body), ...body });
        sector = value;
        this.sectorCache.set(context.sector.sectorId, { contextId: context.sector.id, marketId: market.id, value });
      }
    }
    return { market, sector };
  }

  stateSize() {
    return {
      volatilitySeries: this.volatilityHistory.size,
      volatilitySamples: [...this.volatilityHistory.values()].reduce((sum, history) => sum + history.samples.length, 0),
      sectorSnapshots: this.sectorCache.size
    };
  }

  private unavailableTrend(quality: ContextQuality): TrendRegime {
    return {
      state: "UNCERTAIN", evidenceStrength: "LOW", quality,
      supporting: [], conflicting: [`INPUT_${quality}`],
      metrics: { return15mPct: null, return30mPct: null, distanceFromHighPct: null, distanceFromLowPct: null, advancePct: null, aboveVwapPct: null }
    };
  }

  private unknownVolatility(quality: ContextQuality, reason: string): VolatilityRegime {
    return { state: "UNKNOWN", quality, reason, absoluteReturn5mPct: null, priorMedianPct: null, priorObservations: 0, medianMultiple: null };
  }

  private volatility(benchmark: BenchmarkContext): VolatilityRegime {
    const metric = benchmark.horizonReturns["5m"];
    if (benchmark.quality !== "AVAILABLE" || !available(metric) || !benchmark.observedAt || !benchmark.sourceIdentity) {
      return this.unknownVolatility(benchmark.quality !== "AVAILABLE" ? benchmark.quality : metric.quality, "5M_RETURN_UNAVAILABLE");
    }
    const existing = this.volatilityHistory.get(benchmark.benchmarkId);
    if (existing && existing.sourceIdentity !== benchmark.sourceIdentity) throw new Error("Regime benchmark source identity changed");
    if (existing?.lastObservedAt === benchmark.observedAt) return existing.lastResult!;
    if (existing?.lastObservedAt && benchmark.observedAt < existing.lastObservedAt) throw new Error("Regime benchmark time moved backward");
    const history = existing ?? { sourceIdentity: benchmark.sourceIdentity, lastObservedAt: null, samples: [], lastResult: null };
    const absoluteReturn5mPct = Math.abs(metric.valuePct);
    const priorObservations = history.samples.length;
    const baseline = priorObservations >= regimeDefinition.volatility.minimumPriorObservations ? median(history.samples) : null;
    const medianMultiple = baseline && baseline > 0 ? absoluteReturn5mPct / baseline : null;
    const state = medianMultiple == null ? "UNKNOWN" : medianMultiple >= regimeDefinition.volatility.highMedianMultiple
      ? "HIGH" : medianMultiple <= regimeDefinition.volatility.lowMedianMultiple ? "LOW" : "NORMAL";
    const reason = baseline == null ? "VOLATILITY_WARMUP" : medianMultiple == null ? "DEGENERATE_BASELINE" : "TRAILING_MEDIAN_COMPARISON";
    const result: VolatilityRegime = {
      state, quality: state === "UNKNOWN" ? "INSUFFICIENT_HISTORY" : "AVAILABLE", reason,
      absoluteReturn5mPct, priorMedianPct: baseline, priorObservations, medianMultiple
    };
    history.samples.push(absoluteReturn5mPct);
    if (history.samples.length > regimeDefinition.volatility.maximumPriorObservations) history.samples.shift();
    history.lastObservedAt = benchmark.observedAt;
    history.lastResult = result;
    this.volatilityHistory.set(benchmark.benchmarkId, history);
    return result;
  }
}
