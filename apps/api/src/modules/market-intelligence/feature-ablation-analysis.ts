import { createHash } from "node:crypto";
import { createReadStream, readFileSync } from "node:fs";
import { createInterface } from "node:readline";
import path from "node:path";
import { tradeR } from "../scanner/replay/backtest-analytics";
import type { HistoricalPaperTrade } from "../scanner/replay/historical-paper-execution";
import type { WalkForwardPartition } from "../scanner/replay/walk-forward";
import { resolveSectorMembership } from "./context-universe";
import { readCapture } from "./feature-ablation-capture";
import { semanticBin, registeredFeatureNames, type ResearchFeature } from "./feature-ablation-values";
import { distinctCapturedSetups, setupJoinKey, type JoinedContextPoint, type JoinManifest } from "./feature-ablation-join";
import { FEATURE_ABLATION_ARTIFACT_DIR, writeImmutableArtifact } from "./feature-ablation-cli";
import { assertFeatureAblationSources, featureAblationSpec, featureAblationSpecHash } from "./feature-ablation-spec";

interface SetupEvidence {
  strategy: string;
  foldId: string;
  partition: WalkForwardPartition;
  setupId: string;
  replayTimestamp: string;
  decisionAvailableAt: string;
  instrumentToken: string;
  direction: string;
  evaluationCount: number;
  trades: HistoricalPaperTrade[];
}

interface TradeEvidence {
  trade: HistoricalPaperTrade;
  foldId: string;
  sector: string | null;
  timeBucket: string | null;
  direction: string;
}

interface MutableGroup {
  strategy: string;
  partition: WalkForwardPartition;
  foldId: string;
  feature: string;
  bin: string;
  setupEvaluations: number;
  distinctSetups: number;
  trades: TradeEvidence[];
}

export type ResearchSampleStatus = "SUFFICIENT_SAMPLE" | "LOW_SAMPLE" | "NO_SAMPLE" | "NO_ACTIVITY_FOR_FEATURE_ABLATION";

export function researchSampleStatus(closed: number, byFold: ReadonlyMap<string, number>, strategyClosed: number): ResearchSampleStatus {
  if (strategyClosed === 0) return "NO_ACTIVITY_FOR_FEATURE_ABLATION";
  if (closed === 0) return "NO_SAMPLE";
  const qualifyingFolds = [...byFold.values()].filter((count) => count >= featureAblationSpec.sampleRules.minimumClosedTradesPerContributingFold).length;
  return closed >= featureAblationSpec.sampleRules.sufficientClosedTrades &&
    qualifyingFolds >= featureAblationSpec.sampleRules.minimumContributingFolds ? "SUFFICIENT_SAMPLE" : "LOW_SAMPLE";
}

function mean(values: readonly number[]) { return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null; }
function median(values: readonly number[]) {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const half = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[half]! : (sorted[half - 1]! + sorted[half]!) / 2;
}

function concentration(trades: readonly TradeEvidence[], dimension: "instrument" | "sector" | "fold" | "time" | "direction") {
  const groups = new Map<string, { trades: number; netPnl: number }>();
  for (const row of trades) {
    const key = dimension === "instrument" ? row.trade.instrumentToken : dimension === "sector" ? row.sector ?? "UNKNOWN" :
      dimension === "fold" ? row.foldId : dimension === "time" ? row.timeBucket ?? "UNKNOWN" : row.direction;
    const bucket = groups.get(key) ?? { trades: 0, netPnl: 0 };
    bucket.trades += 1;
    bucket.netPnl += row.trade.netPnl;
    groups.set(key, bucket);
  }
  const sorted = [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
  const largest = sorted.reduce<[string, { trades: number; netPnl: number }] | null>((best, row) =>
    !best || row[1].trades > best[1].trades || (row[1].trades === best[1].trades && row[0] < best[0]) ? row : best, null);
  return { groups: Object.fromEntries(sorted), largestByTradeCount: largest?.[0] ?? null,
    largestTradeShare: largest && trades.length ? largest[1].trades / trades.length : null };
}

export function summarizeClosedTradeGroup(group: MutableGroup, strategyClosed: number, frozenMaxDrawdown: number | null = null) {
  const closed = group.trades.filter((row) => row.trade.status === "CLOSED" && row.trade.exitTimestamp !== null);
  const pnl = closed.map((row) => row.trade.netPnl);
  const positive = pnl.filter((value) => value > 0);
  const negative = pnl.filter((value) => value < 0);
  const r = closed.map((row) => tradeR(row.trade)).filter((value): value is number => value !== null);
  const byFold = new Map<string, number>();
  for (const row of closed) byFold.set(row.foldId, (byFold.get(row.foldId) ?? 0) + 1);
  const grossProfit = positive.reduce((sum, value) => sum + value, 0);
  const grossLoss = negative.reduce((sum, value) => sum + value, 0);
  return {
    strategy: group.strategy, partition: group.partition, foldId: group.foldId, feature: group.feature, bin: group.bin,
    setupEvaluations: group.setupEvaluations, distinctSetups: group.distinctSetups,
    closedTrades: closed.length, incompleteTrades: group.trades.length - closed.length,
    wins: positive.length, losses: negative.length, breakeven: pnl.length - positive.length - negative.length,
    grossPnl: closed.reduce((sum, row) => sum + row.trade.grossPnl, 0),
    charges: closed.reduce((sum, row) => sum + row.trade.charges, 0),
    netPnl: pnl.reduce((sum, value) => sum + value, 0),
    expectancy: mean(pnl), expectancyR: mean(r), averageR: mean(r), medianR: median(r),
    rObservations: r.length, rSum: r.reduce((sum, value) => sum + value, 0),
    winRate: pnl.length ? positive.length / pnl.length : null,
    profitFactor: grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? null : 0,
    profitFactorReason: grossLoss < 0 || grossProfit === 0 ? null : "NO_GROSS_LOSSES",
    maxDrawdown: frozenMaxDrawdown,
    maxDrawdownReason: frozenMaxDrawdown === null ? "CONDITIONED_EQUITY_PATH_NOT_RECONSTRUCTED" : null,
    averageHoldingMs: mean(closed.map((row) => Date.parse(row.trade.exitTimestamp!) - Date.parse(row.trade.entryTimestamp))),
    sampleStatus: researchSampleStatus(closed.length, byFold, strategyClosed),
    foldTradeCounts: Object.fromEntries([...byFold.entries()].sort(([a], [b]) => a.localeCompare(b))),
    concentration: Object.fromEntries((["instrument", "sector", "fold", "time", "direction"] as const).map((dimension) =>
      [dimension, concentration(closed, dimension)]))
  };
}

class OnlinePearson {
  n = 0; x = 0; y = 0; xx = 0; yy = 0; xy = 0;
  add(x: number, y: number) { this.n += 1; this.x += x; this.y += y; this.xx += x * x; this.yy += y * y; this.xy += x * y; }
  finish() {
    const numerator = this.n * this.xy - this.x * this.y;
    const denominator = Math.sqrt((this.n * this.xx - this.x * this.x) * (this.n * this.yy - this.y * this.y));
    return { observations: this.n, pearsonR: this.n >= 2 && denominator > 0 ? numerator / denominator : null };
  }
}

export function effectVsComplement(group: ReturnType<typeof summarizeClosedTradeGroup>, baseline: ReturnType<typeof summarizeClosedTradeGroup>) {
  const complementCount = baseline.closedTrades - group.closedTrades;
  const complementNet = baseline.netPnl - group.netPnl;
  const complementWins = baseline.wins - group.wins;
  const complementRCount = baseline.rObservations - group.rObservations;
  const complementRSum = baseline.rSum - group.rSum;
  return {
    expectancyDifference: group.expectancy === null || complementCount <= 0 ? null : group.expectancy - complementNet / complementCount,
    expectancyRDifference: group.expectancyR === null || complementRCount <= 0 ? null :
      group.expectancyR - complementRSum / complementRCount,
    winRateDifference: group.winRate === null || complementCount <= 0 ? null : group.winRate - complementWins / complementCount,
    tradeActivityShare: baseline.closedTrades ? group.closedTrades / baseline.closedTrades : null,
    complementClosedTrades: complementCount
  };
}

function loadPopulation() {
  const byContext = new Map<string, SetupEvidence[]>();
  const frozenDrawdown = new Map<string, number>();
  const baselineClosed = new Map<string, number>();
  let setupEvaluations = 0;
  let distinctSetups = 0;
  let closedTrades = 0;
  for (const foldId of featureAblationSpec.population.folds) for (const partition of featureAblationSpec.population.partitions as WalkForwardPartition[]) {
    const capture = readCapture(foldId, partition);
    if (!capture) throw new Error(`Missing capture for ${foldId}/${partition}`);
    for (const strategy of capture.strategies) {
      const identity = `${strategy.strategy}|${partition}`;
      baselineClosed.set(identity, (baselineClosed.get(identity) ?? 0) + strategy.metrics.closedTrades);
      frozenDrawdown.set(`${strategy.strategy}|${partition}|${foldId}`, strategy.metrics.maxDrawdown);
      const counts = new Map<string, { setup: typeof strategy.setups[number]; evaluations: number }>();
      for (const setup of strategy.setups) {
        const key = `${setup.setupId}|${setup.setupTimestamp}`;
        const previous = counts.get(key);
        if (previous) previous.evaluations += 1;
        else counts.set(key, { setup, evaluations: 1 });
      }
      distinctCapturedSetups(strategy.setups);
      const tradesBySetup = new Map<string, HistoricalPaperTrade[]>();
      const tradeIds = new Set<string>();
      for (const trade of strategy.trades) {
        if (tradeIds.has(trade.tradeId)) throw new Error(`Duplicate Phase 8 trade ${trade.tradeId}`);
        tradeIds.add(trade.tradeId);
        const key = `${trade.setupId}|${trade.setupTimestamp}`;
        const list = tradesBySetup.get(key) ?? [];
        list.push(trade);
        tradesBySetup.set(key, list);
        if (trade.status === "CLOSED") closedTrades += 1;
      }
      for (const key of tradesBySetup.keys()) if (!counts.has(key)) throw new Error(`Unmatched Phase 8 trade setup ${key}`);
      const actualPnl = strategy.trades.filter((trade) => trade.status === "CLOSED").reduce((sum, trade) => sum + trade.netPnl, 0);
      if (Math.abs(actualPnl - strategy.metrics.netPnl) > 1e-6) throw new Error(`Phase 8 trade-level net P&L mismatch for ${strategy.strategy}/${foldId}/${partition}`);
      setupEvaluations += strategy.setups.length;
      distinctSetups += counts.size;
      for (const [key, { setup, evaluations }] of counts) {
        const pointKey = setupJoinKey(setup.replayTimestamp, setup.instrumentToken);
        const rows = byContext.get(pointKey) ?? [];
        rows.push({ strategy: strategy.strategy, foldId, partition, setupId: setup.setupId,
          replayTimestamp: setup.replayTimestamp, decisionAvailableAt: setup.decisionAvailableAt,
          instrumentToken: setup.instrumentToken, direction: setup.direction, evaluationCount: evaluations,
          trades: tradesBySetup.get(key) ?? [] });
        byContext.set(pointKey, rows);
      }
    }
  }
  return { byContext, frozenDrawdown, baselineClosed, setupEvaluations, distinctSetups, closedTrades };
}

export async function analyzeFeatureAblation(input: { joinManifestPath: string; pointsPath: string }) {
  assertFeatureAblationSources();
  const join = JSON.parse(readFileSync(input.joinManifestPath, "utf8")) as JoinManifest;
  if (join.specHash !== featureAblationSpecHash || join.contextDatasetId !== featureAblationSpec.contextDatasetId ||
      join.phase8RunId !== featureAblationSpec.sources.phase8Baseline.runId ||
      JSON.stringify(join.featureNames) !== JSON.stringify(registeredFeatureNames)) throw new Error("9D join identity mismatch");
  const population = loadPopulation();
  if (population.setupEvaluations !== join.setupEvaluations || population.distinctSetups !== join.distinctSetups) {
    throw new Error("9D capture/join population mismatch");
  }
  const groups = new Map<string, MutableGroup>();
  const featureQuality = new Map<string, Map<string, number>>();
  const joinedSetups = new Set<string>();
  const pairNames = [
    ["market.return.15m", "market.return.30m"],
    ["instrumentVsMarket.15m", "instrumentVsSector.15m"],
    ["sector.breadth.advancePct", "sector.breadth.aboveVwapPct"]
  ] as const;
  const correlations = pairNames.map((pair) => ({ pair, values: new OnlinePearson() }));
  const group = (row: SetupEvidence, feature: string, bin: string, foldId: string) => {
    const key = JSON.stringify([row.strategy, row.partition, foldId, feature, bin]);
    let value = groups.get(key);
    if (!value) { value = { strategy: row.strategy, partition: row.partition, foldId, feature, bin,
      setupEvaluations: 0, distinctSetups: 0, trades: [] }; groups.set(key, value); }
    return value;
  };
  const add = (row: SetupEvidence, feature: string, bin: string, timeBucket: string | null) => {
    const membership = resolveSectorMembership(row.instrumentToken, row.replayTimestamp.slice(0, 10), { allowBackcastCurrentMembership: true });
    for (const foldId of [row.foldId, "ALL_FOLDS"]) {
      const target = group(row, feature, bin, foldId);
      target.setupEvaluations += row.evaluationCount;
      target.distinctSetups += 1;
      for (const trade of row.trades) target.trades.push({ trade, foldId: row.foldId, sector: membership?.sectorId ?? null,
        timeBucket, direction: row.direction });
    }
  };
  const hash = createHash("sha256");
  let joinedContextPoints = 0;
  const inputStream = createReadStream(input.pointsPath);
  for await (const line of createInterface({ input: inputStream, crlfDelay: Infinity })) {
    hash.update(`${line}\n`);
    const point = JSON.parse(line) as JoinedContextPoint;
    if (point.featureValues.length !== registeredFeatureNames.length || point.featureQualities.length !== registeredFeatureNames.length ||
        point.decisionAvailableAt !== new Date(Date.parse(point.replayTimestamp) + 60_000).toISOString()) {
      throw new Error("Malformed point-in-time 9D context point");
    }
    const key = setupJoinKey(point.replayTimestamp, point.instrumentToken);
    const rows = population.byContext.get(key);
    if (!rows) throw new Error(`Unrequested 9D context point ${key}`);
    if (joinedSetups.has(key)) throw new Error(`Duplicate 9D context point ${key}`);
    joinedSetups.add(key);
    joinedContextPoints += 1;
    const values = Object.fromEntries(registeredFeatureNames.map((name, index) => [name,
      { value: point.featureValues[index]!, quality: point.featureQualities[index]! }])) as Record<string, ResearchFeature>;
    for (const { pair, values: statistic } of correlations) {
      const left = values[pair[0]], right = values[pair[1]];
      if (left?.quality === "AVAILABLE" && right?.quality === "AVAILABLE" &&
          typeof left.value === "number" && typeof right.value === "number") statistic.add(left.value, right.value);
    }
    const timeBucket = values.sessionProgressFifth?.value;
    for (const row of rows) {
      if (row.decisionAvailableAt !== point.decisionAvailableAt) throw new Error(`Future or shifted 9D setup join ${row.setupId}`);
      add(row, "BASELINE", "ALL", typeof timeBucket === "string" ? timeBucket : null);
      for (const name of registeredFeatureNames) {
        const feature = values[name]!;
        add(row, name, semanticBin(name, feature), typeof timeBucket === "string" ? timeBucket : null);
        const counts = featureQuality.get(name) ?? new Map<string, number>();
        counts.set(feature.quality, (counts.get(feature.quality) ?? 0) + 1);
        featureQuality.set(name, counts);
      }
      for (const [left, right] of featureAblationSpec.interactions) {
        const name = `INTERACTION:${left} x ${right}`;
        add(row, name, `${semanticBin(left, values[left]!)} x ${semanticBin(right, values[right]!)}`,
          typeof timeBucket === "string" ? timeBucket : null);
      }
    }
  }
  if (hash.digest("hex") !== join.pointsSha256 || joinedContextPoints !== join.joinedContextPoints) throw new Error("9D joined-context content mismatch");
  const absent = [...population.byContext].filter(([key]) => !joinedSetups.has(key));
  if (absent.length !== join.missingContextPoints.length) throw new Error("9D missing-context count mismatch");
  for (const [, rows] of absent) for (const row of rows) {
    add(row, "BASELINE", "ALL", null);
    for (const name of registeredFeatureNames) {
      add(row, name, "QUALITY:MISSING_CONTEXT", null);
      const counts = featureQuality.get(name) ?? new Map<string, number>();
      counts.set("MISSING_CONTEXT", (counts.get("MISSING_CONTEXT") ?? 0) + 1);
      featureQuality.set(name, counts);
    }
  }
  const results = [...groups.values()].map((row) => {
    const baseline = row.feature === "BASELINE" && row.foldId !== "ALL_FOLDS"
      ? population.frozenDrawdown.get(`${row.strategy}|${row.partition}|${row.foldId}`) ?? null : null;
    return summarizeClosedTradeGroup(row, population.baselineClosed.get(`${row.strategy}|${row.partition}`) ?? 0, baseline);
  }).sort((a, b) => a.strategy.localeCompare(b.strategy) || a.partition.localeCompare(b.partition) ||
    a.foldId.localeCompare(b.foldId) || a.feature.localeCompare(b.feature) || a.bin.localeCompare(b.bin));
  const baselineByKey = new Map(results.filter((row) => row.feature === "BASELINE").map((row) =>
    [`${row.strategy}|${row.partition}|${row.foldId}`, row]));
  const bySlice = new Map<string, typeof results>();
  const byIdentity = new Map<string, typeof results[number]>();
  const sliceKey = (strategy: string, partition: string, feature: string, bin: string) =>
    JSON.stringify([strategy, partition, feature, bin]);
  for (const row of results) {
    const key = sliceKey(row.strategy, row.partition, row.feature, row.bin);
    const list = bySlice.get(key) ?? [];
    list.push(row);
    bySlice.set(key, list);
    byIdentity.set(JSON.stringify([key, row.foldId]), row);
  }
  const contrasts = results.filter((row) => row.foldId === "ALL_FOLDS" && row.feature !== "BASELINE").map((row) => {
    const baseline = baselineByKey.get(`${row.strategy}|${row.partition}|ALL_FOLDS`)!;
    const effect = effectVsComplement(row, baseline);
    const byFold = (bySlice.get(sliceKey(row.strategy, row.partition, row.feature, row.bin)) ?? [])
      .filter((candidate) => candidate.foldId !== "ALL_FOLDS");
    const foldEffects = byFold.map((item) => ({ foldId: item.foldId, closedTrades: item.closedTrades,
      ...effectVsComplement(item, baselineByKey.get(`${item.strategy}|${item.partition}|${item.foldId}`)!) }));
    return { strategy: row.strategy, partition: row.partition, feature: row.feature, bin: row.bin,
      sampleStatus: row.sampleStatus, ...effect,
      foldEffects, positiveEffectFolds: foldEffects.filter((item) => (item.expectancyDifference ?? 0) > 0).length,
      negativeEffectFolds: foldEffects.filter((item) => (item.expectancyDifference ?? 0) < 0).length };
  });
  const contrastByIdentity = new Map(contrasts.map((row) =>
    [sliceKey(row.strategy, row.partition, row.feature, row.bin), row]));
  const evidence = contrasts.filter((row) => row.partition === "TRAIN").map((train) => {
    const validation = contrastByIdentity.get(sliceKey(train.strategy, "VALIDATION", train.feature, train.bin));
    const activity = population.baselineClosed.get(`${train.strategy}|TRAIN`) ?? 0;
    const trainGroup = byIdentity.get(JSON.stringify([sliceKey(train.strategy, "TRAIN", train.feature, train.bin), "ALL_FOLDS"]));
    const concentrationPasses = [trainGroup?.concentration.fold.largestTradeShare,
      trainGroup?.concentration.instrument.largestTradeShare,
      trainGroup?.concentration.sector.largestTradeShare].every((share) => share !== null && share !== undefined && share <= 0.5);
    const status = activity === 0 ? "NO_ACTIVITY_FOR_ABLATION" :
      train.sampleStatus !== "SUFFICIENT_SAMPLE" || validation?.sampleStatus !== "SUFFICIENT_SAMPLE" ? "INSUFFICIENT_SAMPLE" :
      (train.expectancyDifference ?? 0) * (validation.expectancyDifference ?? 0) < 0 ? "INCONSISTENT_CONTEXT_SIGNAL" :
      train.expectancyDifference === 0 && validation.expectancyDifference === 0 ? "NO_OBSERVED_SEPARATION" :
      (train.expectancyDifference ?? 0) > 0 && (validation.expectancyDifference ?? 0) > 0 && concentrationPasses
        ? "PROMISING_CONTEXT_SIGNAL" : "INCONSISTENT_CONTEXT_SIGNAL";
    return { strategy: train.strategy, feature: train.feature, bin: train.bin, status, concentrationPasses,
      trainClosedTrades: trainGroup?.closedTrades ?? 0,
      validationClosedTrades: byIdentity.get(JSON.stringify([sliceKey(train.strategy, "VALIDATION", train.feature, train.bin), "ALL_FOLDS"]))?.closedTrades ?? 0,
      trainEffect: train.expectancyDifference, validationEffect: validation?.expectancyDifference ?? null,
      testUsedForSelection: false };
  });
  const featureFamilies = Object.entries(featureAblationSpec.families).map(([family, names]) => {
    const available = names.reduce((sum, name) => sum + (featureQuality.get(name)?.get("AVAILABLE") ?? 0), 0);
    const related = evidence.filter((item) => names.includes(item.feature));
    return { family, availableSetupFeatures: available,
      disposition: available === 0 ? "LOW_INFORMATION_IN_CURRENT_SAMPLE" :
        related.some((item) => item.status === "PROMISING_CONTEXT_SIGNAL") ? "RETAIN_FOR_FUTURE_RESEARCH" :
          related.some((item) => item.status === "NO_OBSERVED_SEPARATION") ? "LOW_INFORMATION_IN_CURRENT_SAMPLE" : "INSUFFICIENT_EVIDENCE" };
  });
  const redundancy = correlations.map(({ pair, values }) => ({ features: pair, ...values.finish() }));
  const familyOf = (name: string) => Object.entries(featureAblationSpec.families).find(([, names]) => (names as readonly string[]).includes(name))?.[0] ?? "interactionSupport";
  const catalog = registeredFeatureNames.map((name) => ({ name, version: featureAblationSpec.version,
    sourceFamily: familyOf(name), units: name.includes("Pct") || name.includes("return") || name.includes("Vs") ? "percentage points" :
      name === "instrument.minutesSinceOpen" ? "minutes" : "category",
    availability: Object.fromEntries([...(featureQuality.get(name) ?? new Map()).entries()].sort(([a], [b]) => a.localeCompare(b))),
    qualitySemantics: "Use only AVAILABLE numeric values; categorical UNCERTAIN/UNKNOWN retain explicit quality; no fabricated values",
    pointInTime: "Completed replay 1m candle close; never later than decisionAvailableAt",
    knownRedundancy: redundancy.filter((item) => (item.features as readonly string[]).includes(name)).map((item) => ({
      with: item.features[0] === name ? item.features[1] : item.features[0], pearsonR: item.pearsonR })),
    limitation: name === "market.indexVwap.UNSUPPORTED_ZERO_VOLUME" ? "Not available: Kite index volume is zero" :
      "Current 25-stock sector membership is backcast; feature/outcome sample is small and fold-overlapping" }));
  const stable = {
    format: "9D-FEATURE-ABLATION-RESULT-1", specHash: featureAblationSpecHash,
    phase8RunId: featureAblationSpec.sources.phase8Baseline.runId, joinId: join.joinId,
    sourceFileHashes: {
      phase8Evidence: featureAblationSpec.sources.phase8Evidence.fileSha256,
      phase8Baseline: featureAblationSpec.sources.phase8Baseline.fileSha256,
      phase9Context: featureAblationSpec.sources.phase9Context.fileSha256,
      phase9Regime: featureAblationSpec.sources.phase9Regime.fileSha256
    },
    executionIdentityDifferences: join.executionIdentityDifferences,
    population: { setupEvaluations: population.setupEvaluations, distinctSetups: population.distinctSetups,
      closedTrades: population.closedTrades, joinedContextPoints, missingContextPoints: absent.length,
      overlappingFoldsAreNotIndependent: true },
    featureQuality: Object.fromEntries([...featureQuality].sort(([a], [b]) => a.localeCompare(b)).map(([name, values]) =>
      [name, Object.fromEntries([...values].sort(([a], [b]) => a.localeCompare(b)))])),
    groups: results, contrasts, evidence, featureFamilies, redundancy, featureCatalog: catalog,
    multipleComparisons: { preRegisteredDescriptiveContrasts: contrasts.length,
      primaryInferentialHypotheses: 0, exploratoryInteractionContrasts: contrasts.filter((row) => row.feature.startsWith("INTERACTION:")).length,
      statisticalTests: 0, correction: "No p-values or significance claims; all slices reported, no winner selection" },
    testPolicy: "TEST results are retrospective audit only; evidence statuses use TRAIN and VALIDATION, never TEST",
    limitations: ["Tiny closed-trade sample despite many setup evaluations", "Overlapping walk-forward folds are not independent",
      "Current 25-stock universe and sector membership are backcast", "Two index provider gaps remain unfilled",
      "Index VWAP unavailable because index volume is zero", "Conditioned max drawdown cannot be reconstructed from selected trade outcomes"]
  };
  const contentHash = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
  const result = { ...stable, contentHash, resultId: contentHash.slice(0, 24) };
  const resultPath = await writeImmutableArtifact(`feature-ablation-${result.resultId}.json`, `${JSON.stringify(result, null, 2)}\n`);
  return { result, resultPath };
}
