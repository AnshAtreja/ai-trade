import type { FeatureSession, FeatureSnapshot } from "./feature-types";
import type { ContextMetric, InstrumentMarketContext } from "./context-types";
import type { InstrumentRegimeContext } from "./regime-types";
import { featureAblationSpec } from "./feature-ablation-spec";

export type ResearchValue = string | number | boolean | null;
export interface ResearchFeature { value: ResearchValue; quality: string; }
export type ResearchFeatureMap = Record<string, ResearchFeature>;

export const registeredFeatureNames = Object.freeze([
  ...Object.values(featureAblationSpec.families).flat(), "instrument.aboveVwap"
]);

function set(map: ResearchFeatureMap, name: string, value: ResearchValue, quality: string) {
  map[name] = { value: quality === "AVAILABLE" || typeof value === "string" ? value : null, quality };
}

function assertNotFuture(observedAt: string | null, asOf: string, field: string) {
  if (observedAt && observedAt > asOf) throw new Error(`Future Phase 9 context at ${field}: ${observedAt} > ${asOf}`);
}

function setMetric(map: ResearchFeatureMap, name: string, metric: ContextMetric, asOf: string) {
  assertNotFuture(metric.observedAt, asOf, name);
  set(map, name, metric.valuePct, metric.quality);
}

export function sessionProgressFifth(asOf: string, session: FeatureSession) {
  const start = Date.parse(session.openTime);
  const end = Date.parse(session.closeTime);
  const current = Date.parse(asOf);
  if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start || current < start || current > end) {
    throw new Error(`Invalid session-relative time ${asOf} for ${session.tradeDate}`);
  }
  return (["OPEN", "MORNING", "MIDDAY", "AFTERNOON", "CLOSE"] as const)[Math.min(4, Math.floor((current - start) / (end - start) * 5))]!;
}

export function semanticBin(name: string, feature: ResearchFeature): string {
  if (typeof feature.value === "string") return feature.value;
  if (feature.quality !== "AVAILABLE" || feature.value === null) return `QUALITY:${feature.quality}`;
  if (typeof feature.value !== "number") return String(feature.value);
  const value = feature.value;
  if (!Number.isFinite(value)) throw new Error(`Non-finite feature ${name}`);
  if (name === "instrument.atrPct") return value === 0 ? "ZERO" : value < 0.5 ? "LOW" : value < 1 ? "MEDIUM" : value < 2 ? "HIGH" : "VERY_HIGH";
  if (name.endsWith("advancePct") || name.endsWith("aboveVwapPct")) return value < 40 ? "LOW" : value <= 60 ? "BALANCED" : "HIGH";
  if (name.endsWith("highDistancePct") || name.endsWith("lowDistancePct")) return value <= 0.5 ? "NEAR" : "FAR";
  return value < 0 ? "NEGATIVE" : value === 0 ? "ZERO" : "POSITIVE";
}

export function extractResearchFeatures(input: { asOf: string; session: FeatureSession; instrument: FeatureSnapshot;
  context: InstrumentMarketContext; regime: InstrumentRegimeContext }): ResearchFeatureMap {
  const { asOf, session, instrument, context, regime } = input;
  if (instrument.timestamp > asOf || context.timestamp > asOf || regime.market.timestamp > asOf ||
      (regime.sector && regime.sector.timestamp > asOf)) throw new Error("Future Phase 9 feature snapshot in setup join");
  if (instrument.instrumentToken !== context.instrumentToken) throw new Error("Phase 9 instrument/context identity mismatch");
  const out: ResearchFeatureMap = {};
  set(out, "market.trend", regime.market.trend.state, regime.market.trend.quality);
  set(out, "market.volatility", regime.market.volatility.state, regime.market.volatility.quality);
  set(out, "market.breadth.confirmation", regime.market.breadth.state, regime.market.breadth.quality);
  assertNotFuture(context.market.benchmark.observedAt, asOf, "market benchmark");
  for (const horizon of ["5m", "15m", "30m", "60m"] as const) {
    setMetric(out, `market.return.${horizon}`, context.market.benchmark.horizonReturns[horizon], asOf);
  }
  setMetric(out, "market.session.highDistancePct", context.market.benchmark.distanceFromSessionHighPct, asOf);
  setMetric(out, "market.session.lowDistancePct", context.market.benchmark.distanceFromSessionLowPct, asOf);
  set(out, "market.indexVwap.UNSUPPORTED_ZERO_VOLUME", null, "NOT_APPLICABLE");

  const sector = context.sector;
  if (sector) assertNotFuture(sector.benchmark?.observedAt ?? null, asOf, "sector benchmark");
  set(out, "sector.trend", regime.sector?.trend.state ?? null, regime.sector?.trend.quality ?? "NOT_APPLICABLE");
  set(out, "sector.volatility", regime.sector?.volatility.state ?? null, regime.sector?.volatility.quality ?? "NOT_APPLICABLE");
  set(out, "sector.relativeToMarket", regime.sector?.relativeToMarket ?? null,
    regime.sector?.relativeToMarket === "UNKNOWN" ? "INSUFFICIENT_HISTORY" : regime.sector ? "AVAILABLE" : "NOT_APPLICABLE");
  set(out, "sector.breadth.advancePct", sector?.breadth.advancePct ?? null, sector?.breadth.quality ?? "NOT_APPLICABLE");
  set(out, "sector.breadth.aboveVwapPct", sector?.breadth.aboveVwapPct ?? null, sector?.breadth.aboveVwapQuality ?? "NOT_APPLICABLE");
  for (const horizon of ["5m", "15m", "30m", "60m"] as const) {
    const metric = sector?.benchmark?.horizonReturns[horizon];
    if (metric) setMetric(out, `sector.return.${horizon}`, metric, asOf);
    else set(out, `sector.return.${horizon}`, null, sector?.benchmarkQuality ?? "NOT_APPLICABLE");
    for (const [prefix, value] of [["instrumentVsMarket", context.relative.instrumentVsMarket[horizon]],
      ["instrumentVsSector", context.relative.instrumentVsSector[horizon]]] as const) {
      assertNotFuture(value.observedAt, asOf, `${prefix}.${horizon}`);
      assertNotFuture(value.benchmarkObservedAt, asOf, `${prefix}.${horizon} benchmark`);
      set(out, `${prefix}.${horizon}`, value.valuePct, value.quality);
    }
  }
  const instrumentFields = {
    "instrument.vwapDistancePct": "vwapDistancePct",
    "instrument.atrPct": "atrPct",
    "instrument.session.highDistancePct": "distanceFromSessionHighPct",
    "instrument.session.lowDistancePct": "distanceFromSessionLowPct",
    "instrument.gapPct": "gapPct",
    "instrument.minutesSinceOpen": "minutesSinceMarketOpen",
    "instrument.aboveVwap": "aboveVwap"
  } as const;
  for (const [name, field] of Object.entries(instrumentFields) as Array<[keyof typeof instrumentFields, typeof instrumentFields[keyof typeof instrumentFields]]>) {
    set(out, name, instrument.values[field], instrument.quality[field]);
  }
  set(out, "sessionProgressFifth", sessionProgressFifth(asOf, session), "AVAILABLE");
  if (registeredFeatureNames.some((name) => !out[name])) throw new Error("Unpopulated Phase 9D registered feature");
  return out;
}
