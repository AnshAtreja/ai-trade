import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { contextUniverseId, BREADTH_UNIVERSE_VERSION } from "./context-universe";
import { regimeDefinitionHash } from "./regime-definition";

export const FEATURE_ABLATION_VERSION = "PHASE_9D_FEATURE_ABLATION_V1";
export const FEATURE_ABLATION_ROOT = path.resolve(__dirname, "../../../../../");

const sources = {
  phase8Evidence: {
    path: "apps/artifacts/phase8f/phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1.json",
    fileSha256: "ee65b033ba4a6c73553cc51af04aa99d778434616621eca919e66d1bf375c91e",
    researchContentSha256: "6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41"
  },
  phase8Baseline: {
    path: "apps/artifacts/phase8e/frozen-baseline-2026-09-19-final.compact.result.json",
    fileSha256: "8070a2f7e6e1c23aafc9cf801d385b2aa064cd004cdfb298e9214594de23c852",
    runId: "1fd46d5ef1f0e98f"
  },
  phase9Context: {
    path: "apps/artifacts/phase9c/index-context-0671adf35f4fae2f1d4ec05a-manifest.json",
    fileSha256: "6a06a25ed1f06a6ab6d7bd8d88f43e501a2d1dbf6ddd4af45504bced44caf196",
    datasetId: "0671adf35f4fae2f1d4ec05a"
  },
  phase9Regime: {
    path: "apps/artifacts/phase9c/regime-analysis-45b39097f8bf0cfef978486a-stable.json",
    fileSha256: "6a7bafc13b220d98d56ae5b7e9b0b19b918d6ad5c53e796769a122342474569e",
    analysisId: "45b39097f8bf0cfef978486a"
  }
} as const;

export const featureAblationSpec = Object.freeze({
  version: FEATURE_ABLATION_VERSION,
  sources,
  contextRegistryId: contextUniverseId,
  contextDatasetId: sources.phase9Context.datasetId,
  regimeDefinitionHash,
  breadthUniverseVersion: BREADTH_UNIVERSE_VERSION,
  strategies: ["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"],
  range: { from: "2025-09-18T03:45:00.000Z", to: "2026-09-18T03:45:00.000Z" },
  population: {
    folds: ["fold-01", "fold-02", "fold-03", "fold-04"],
    partitions: ["TRAIN", "VALIDATION", "TEST"],
    eligibility: "Frozen 25-instrument Phase 8E strategy setups from complete 1m sessions; existing isolated paper execution outcomes only",
    decisionTime: "Phase 8 replay candle start + 60 seconds (completed 1m candle); retain original replay/setup timestamp separately",
    primary: "TRAIN; VALIDATION is a separate consistency check; previously observed TEST is retrospective audit only",
    duplicatePolicy: "Fold-overlapping setup/trade observations retain fold and partition provenance; do not pretend pooled folds are independent"
  },
  families: {
    marketRegime: ["market.trend", "market.volatility", "market.breadth.confirmation"],
    marketContext: ["market.return.5m", "market.return.15m", "market.return.30m", "market.return.60m", "market.session.highDistancePct", "market.session.lowDistancePct", "market.indexVwap.UNSUPPORTED_ZERO_VOLUME"],
    sectorContext: ["sector.trend", "sector.volatility", "sector.relativeToMarket", "sector.breadth.advancePct", "sector.breadth.aboveVwapPct", "sector.return.5m", "sector.return.15m", "sector.return.30m", "sector.return.60m"],
    relative: ["instrumentVsMarket.5m", "instrumentVsMarket.15m", "instrumentVsMarket.30m", "instrumentVsMarket.60m", "instrumentVsSector.5m", "instrumentVsSector.15m", "instrumentVsSector.30m", "instrumentVsSector.60m"],
    instrument: ["instrument.vwapDistancePct", "instrument.atrPct", "instrument.session.highDistancePct", "instrument.session.lowDistancePct", "instrument.gapPct", "instrument.minutesSinceOpen"],
    time: ["sessionProgressFifth"]
  },
  views: ["BASELINE", "MARKET_CONTEXT", "SECTOR_CONTEXT", "RELATIVE_CONTEXT", "REGIME_CONTEXT", "INSTRUMENT_CONTEXT"],
  interactions: [
    ["market.trend", "sector.relativeToMarket"],
    ["market.trend", "market.volatility"],
    ["instrumentVsSector.15m", "sector.relativeToMarket"],
    ["instrument.aboveVwap", "market.trend"]
  ],
  bins: {
    signedPercent: { NEGATIVE: "value < 0", ZERO: "value === 0", POSITIVE: "value > 0" },
    atrPct: { ZERO: "value === 0", LOW: "0 < value < 0.5", MEDIUM: "0.5 <= value < 1", HIGH: "1 <= value < 2", VERY_HIGH: "value >= 2" },
    breadthPct: { LOW: "value < 40", BALANCED: "40 <= value <= 60", HIGH: "value > 60" },
    distancePct: { NEAR: "value <= 0.5", FAR: "value > 0.5" },
    time: { OPEN: "first fifth of policy session", MORNING: "second fifth", MIDDAY: "third fifth", AFTERNOON: "fourth fifth", CLOSE: "last fifth" }
  },
  outcomeMetrics: ["setupCount", "closedTradeCount", "wins", "losses", "netPnl", "expectancy", "expectancyR", "profitFactor", "averageR", "medianR", "maxDrawdownWhereMeaningful", "averageHoldingMs"],
  sampleRules: {
    sufficientClosedTrades: 30,
    minimumContributingFolds: 2,
    minimumClosedTradesPerContributingFold: 5,
    statuses: ["SUFFICIENT_SAMPLE", "LOW_SAMPLE", "NO_SAMPLE", "NO_ACTIVITY_FOR_FEATURE_ABLATION"],
    noOutcomeForUnfilledSetup: true
  },
  evidenceRules: {
    statuses: ["PROMISING_CONTEXT_SIGNAL", "INCONSISTENT_CONTEXT_SIGNAL", "INSUFFICIENT_SAMPLE", "NO_OBSERVED_SEPARATION", "NO_ACTIVITY_FOR_ABLATION"],
    promising: "Only a pre-registered primary TRAIN slice with sufficient sample, same-sign expectancy separation in VALIDATION with sufficient sample, and no single fold/instrument/sector contributing over 50% of closed trades; descriptive, not deployable",
    inconsistent: "Sufficient TRAIN and VALIDATION samples but expectancy difference changes sign",
    noObservedSeparation: "Sufficient TRAIN and VALIDATION samples and exactly zero expectancy difference",
    fallback: "INSUFFICIENT_SAMPLE when either sample gate fails; NO_ACTIVITY_FOR_ABLATION when strategy has zero closed trades"
  },
  missingContext: "Never coerce UNKNOWN/STALE/DATA_GAP/INSUFFICIENT_HISTORY/INSUFFICIENT_COVERAGE/NOT_APPLICABLE to a number; count by family and source quality",
  multipleComparisons: "Pre-registered groups/interactions only; count every attempted contrast; no p-values or statistical significance claims; no winner selection or threshold changes",
  concentration: ["instrument", "sector", "fold", "sessionProgressFifth", "direction"],
  noMutation: ["strategy rules", "strategy parameters", "MARKET_REGIME_V1", "historical candles", "Phase 8 artifacts", "paper/live order paths"]
});

export const featureAblationSpecHash = createHash("sha256").update(JSON.stringify(featureAblationSpec)).digest("hex");

export function assertFeatureAblationSources() {
  for (const source of Object.values(sources)) {
    const contents = readFileSync(path.resolve(FEATURE_ABLATION_ROOT, source.path));
    const actual = createHash("sha256").update(contents).digest("hex");
    if (actual !== source.fileSha256) throw new Error(`Frozen source hash mismatch: ${source.path}`);
  }
  const evidence = JSON.parse(readFileSync(path.resolve(FEATURE_ABLATION_ROOT, sources.phase8Evidence.path), "utf8")) as { researchContentSha256?: string };
  if (evidence.researchContentSha256 !== sources.phase8Evidence.researchContentSha256) throw new Error("Phase 8 research content identity mismatch");
}
