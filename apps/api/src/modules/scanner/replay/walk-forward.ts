import { createHash } from "node:crypto";
import { closeSync, createReadStream, existsSync, mkdirSync, mkdtempSync, openSync, readFileSync, renameSync, rmSync, statSync, writeFileSync, writeSync } from "node:fs";
import { getTradingDate } from "../../../common/utils/trading-date";
import path from "node:path";
import { randomUUID } from "node:crypto";
import type { HistoricalCandleIntervalCode } from "../../../db/domain";
import { researchUniverseInstruments, researchUniverseManifestId, RESEARCH_PERIOD } from "../../historical-market-data/research-universe";
import { nseCashCalendar } from "../../historical-market-data/calendar";
import { getHistoricalMarketDataService, type HistoricalMarketDataService } from "../../historical-market-data/service";
import type { ResearchSessionEligibility } from "../../historical-market-data/eligibility";
import { executeHistoricalPaperReplay, HistoricalPaperExecutionEngine, type HistoricalPaperExecutionResult } from "./historical-paper-execution";
import { analyzeBacktest, BacktestAnalyticsAccumulator, BACKTEST_ANALYTICS_VERSION, type BacktestAnalyticsResult } from "./backtest-analytics";
import { deterministicReplayId, HistoricalReplayRunner, type HistoricalReplayRunnerDependencies } from "./historical-replay-runner";
import type { StrategyConfig } from "../../strategies/config";
import type { StrategyEvaluation } from "../../strategies/engine-types";
import type { PaperExecutionConfig } from "../../paper-trading/execution/config";
import type { HistoricalReplayResult, ReplayCandleEvent, ReplayEvent } from "./types";

export const WALK_FORWARD_VERSION = "8E.1";
export const WALK_FORWARD_CHECKPOINT_FORMAT_VERSION = "8E-COMPACT-2";
export const EXECUTION_ASSUMPTIONS_VERSION = "8C-PAPER-EXECUTION-V1";
export const FROZEN_BASELINE_STRATEGIES = ["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"] as const;
export const WALK_FORWARD_REPOSITORY_ROOT = path.resolve(__dirname, "../../../../../");
export type WalkForwardPartition = "TRAIN" | "VALIDATION" | "TEST";

export interface WalkForwardConfig {
  trainSessions: number;
  validationSessions: number;
  testSessions: number;
  stepSessions: number;
}

export const DEFAULT_WALK_FORWARD_CONFIG: WalkForwardConfig = { trainSessions: 126, validationSessions: 21, testSessions: 21, stepSessions: 21 };

export interface WalkForwardFold {
  foldId: string;
  index: number;
  train: DateRange;
  validation: DateRange;
  test: DateRange;
  trainTradingDates: string[];
  validationTradingDates: string[];
  testTradingDates: string[];
}

export interface DateRange { from: string; to: string; }

export interface WalkForwardPartitionResult {
  strategy: string;
  foldId: string;
  partition: WalkForwardPartition;
  range: DateRange;
  tradingSessions: number;
  eligibleInstrumentSessions: number;
  excludedSessions: Array<ResearchSessionEligibility & { instrumentToken: string }>;
  metrics: {
    setups: number;
    orders: number;
    fills: number;
    trades: number;
    closedTrades: number;
    incompleteTrades: number;
    grossPnl: number;
    charges: number;
    netPnl: number;
    winRate: number | null;
    profitFactor: number | null;
    expectancy: number | null;
    expectancyR: number | null;
    averageR: number | null;
    medianR: number | null;
    maxDrawdown: number;
    sharpe: number | null;
    sortino: number | null;
    averageHoldingMs: number | null;
    longTrades: number;
    shortTrades: number;
  };
  analytics: BacktestAnalyticsResult;
}

export interface WalkForwardResult {
  runId: string;
  metadata: {
    walkForwardVersion: string;
    universe: string;
    universeManifestId: string;
    datasetIds: { "1m": string; "5m": string };
    calendarVersion: string;
    casEligibilityVersion: string;
    interval: HistoricalCandleIntervalCode;
    completenessRequirement: "COMPLETE_SESSIONS";
    parameterMode: "FROZEN_PARAMETERS";
    strategyVersions: string[];
    analyticsVersion: string;
    executionAssumptionsVersion: string;
    researchVariantId?: string;
    startingCapital: number;
    config: WalkForwardConfig;
    researchRange: DateRange;
  };
  folds: WalkForwardFold[];
  partitions: WalkForwardPartitionResult[];
  testAggregates: Array<{ strategy: string; testFolds: number; testTrades: number; netPnl: number; expectancy: number | null; expectancyR: number | null; profitFactor: number | null; maxDrawdown: number; winRate: number | null; positiveExpectancyFolds: number; negativeExpectancyFolds: number; perFold: Array<{ foldId: string; expectancy: number | null; expectancyR: number | null; profitFactor: number | null; maxDrawdown: number; tradeCount: number }> }>;
  instrumentBreakdown: Array<{ strategy: string; partition: "TEST"; instrumentToken: string; tradingSymbol: string; sector: string | null; tradeCount: number; netPnl: number; expectancy: number | null; expectancyR: number | null; winRate: number | null }>;
  sectorBreakdown: Array<{ strategy: string; partition: "TEST"; sector: string; tradeCount: number; netPnl: number; expectancy: number | null; expectancyR: number | null; winRate: number | null }>;
  diagnostics: Array<{ code: "INSUFFICIENT_TRADES" | "INSUFFICIENT_TEST_FOLDS" | "INSUFFICIENT_DAILY_RETURNS"; strategy: string; partition: "TEST"; count: number }>;
  performance: WalkForwardPerformance;
}

export interface WalkForwardCheckpointMigration {
  sourcePath: string;
  destinationPath: string;
  sourceSha256: string;
  sourceBytes: number;
  destinationBytes: number;
  runId: string;
  migratedPartitions: Array<{ strategy: string; foldId: string; partition: WalkForwardPartition; equityPointsRemoved: number; drawdownPointsRemoved: number }>;
}

export interface WalkForwardPerformance { optimized: boolean; databaseQueries: number; cacheHits: number; cacheMisses: number; candleLoads: number; candlesLoaded: number; replayRuns: number; scannerEvaluations: number; strategyEvaluations: number; executionRuns: number; replayProfile: { totalReplayNs: number; marketStateUpdateNs: number; scannerNs: number; strategyNs: number; strategyRegistryNs: number; strategyDispatchNs: number; strategyRuleNs: number; contextAccessNs: number; universeLoadNs: number; observationNs: number; featureNs: number; filterNs: number; scoreNs: number; rankingNs: number; instrumentsConsidered: number; featureCalculations: number; candidatesConstructed: number; }; }

export interface WalkForwardResearchCapture {
  onSetup?: (meta: { foldId: string; partition: WalkForwardPartition; strategy: string; replayTimestamp: string }, setup: StrategyEvaluation) => void;
  onExecution?: (meta: { foldId: string; partition: WalkForwardPartition; strategy: string }, execution: HistoricalPaperExecutionResult, partitionResult: WalkForwardPartitionResult) => void;
}

export function generateWalkForwardFolds(from: Date, to: Date, config: WalkForwardConfig = DEFAULT_WALK_FORWARD_CONFIG): WalkForwardFold[] {
  validateConfig(config);
  const dates = tradingDates(from, to);
  const folds: WalkForwardFold[] = [];
  for (let start = 0, index = 1; start + config.trainSessions + config.validationSessions + config.testSessions <= dates.length; start += config.stepSessions, index += 1) {
    const trainDates = dates.slice(start, start + config.trainSessions);
    const validationStart = start + config.trainSessions;
    const validationDates = dates.slice(validationStart, validationStart + config.validationSessions);
    const testStart = validationStart + config.validationSessions;
    const testDates = dates.slice(testStart, testStart + config.testSessions);
    const foldId = `fold-${String(index).padStart(2, "0")}`;
    folds.push({ foldId, index, train: rangeFor(trainDates, validationDates[0]!), validation: rangeFor(validationDates, testDates[0]!), test: rangeFor(testDates, nextDateExclusive(testDates.at(-1)!)), trainTradingDates: trainDates, validationTradingDates: validationDates, testTradingDates: testDates });
  }
  return folds;
}

export function walkForwardRunId(metadata: Omit<WalkForwardResult["metadata"], "researchRange"> & { researchRange: DateRange }) {
  return createHash("sha256").update(JSON.stringify(metadata)).digest("hex").slice(0, 16);
}

export function resolveWalkForwardArtifactPath(value: string) {
  return path.isAbsolute(value) ? path.normalize(value) : path.resolve(WALK_FORWARD_REPOSITORY_ROOT, value);
}

export function validateWalkForwardArtifactStorage(checkpointPath: string) {
  const resolved = resolveWalkForwardArtifactPath(checkpointPath);
  const directory = path.dirname(resolved);
  mkdirSync(directory, { recursive: true });
  const probeDirectory = mkdtempSync(path.join(directory, ".phase8e-storage-probe-"));
  const probe = path.join(probeDirectory, "probe.json");
  const renamed = path.join(probeDirectory, "probe-renamed.json");
  const identity = `probe-${randomUUID()}`;
  try {
    writeFileSync(probe, JSON.stringify({ identity }), { encoding: "utf8", flag: "wx" });
    const readBack = JSON.parse(readFileSync(probe, "utf8")) as { identity?: string };
    if (readBack.identity !== identity) throw new Error("Storage probe read-back identity mismatch.");
    renameSync(probe, renamed);
    const renamedBack = JSON.parse(readFileSync(renamed, "utf8")) as { identity?: string };
    if (renamedBack.identity !== identity) throw new Error("Storage probe rename identity mismatch.");
  } catch (error) {
    throw new Error(`Phase 8E artifact storage is not writable at ${directory}: ${error instanceof Error ? error.message : String(error)}`);
  } finally {
    rmSync(probeDirectory, { recursive: true, force: true });
  }
  return { root: directory, checkpointPath: resolved };
}

export async function runWalkForward(input: { foldIds?: readonly string[]; from?: string | Date; to?: string | Date; interval?: HistoricalCandleIntervalCode; config?: WalkForwardConfig; strategies?: readonly string[]; tokens?: string[]; startingCapital?: number; smoke?: boolean; optimized?: boolean; checkpointPath?: string; service?: HistoricalMarketDataService; strategyConfig?: Partial<StrategyConfig>; executionConfig?: Partial<PaperExecutionConfig>; allowedPartitions?: readonly WalkForwardPartition[]; researchVariantId?: string; researchCapture?: WalkForwardResearchCapture; onProgress?: (progress: { foldId: string; partition: WalkForwardPartition; replayTimestamp: string; processedCandles: number; totalCandles: number; scannerEvaluations: number; strategyEvaluations: number; elapsedMs: number; stage?: "ASSEMBLING_RESEARCH_VIEW" | "REPLAYING"; loadedInstruments?: number; totalInstruments?: number }) => void; onCheckpoint?: (checkpoint: { foldId: string; partition: WalkForwardPartition; strategy: string; path: string; completedResultCount: number }) => void; onPartitionCleanup?: (partition: { foldId: string; partition: WalkForwardPartition; completedResultCount: number }) => void }): Promise<WalkForwardResult> {
  const from = new Date(input.from ?? RESEARCH_PERIOD.from); const to = new Date(input.to ?? RESEARCH_PERIOD.to); const interval = input.interval ?? "1m";
  const config = input.config ?? DEFAULT_WALK_FORWARD_CONFIG;
  const folds = generateWalkForwardFolds(from, to, config);
  const strategies = [...(input.strategies ?? FROZEN_BASELINE_STRATEGIES)];
  assertFrozenStrategies(strategies);
  const tokens = input.tokens?.length ? input.tokens : researchUniverseInstruments.map((instrument) => instrument.instrumentToken);
  const service = input.service ?? getHistoricalMarketDataService();
  const selectedFolds = selectWalkForwardFolds(input.smoke ? folds.slice(0, 1) : folds, input.foldIds);
  if (input.researchCapture && input.optimized === false) throw new Error("Research capture requires the shared optimized replay path.");
  const startingCapital = input.startingCapital ?? 100000;
  const metadata = { walkForwardVersion: WALK_FORWARD_VERSION, universe: "NSE_EQ_RESEARCH_UNIVERSE_2026_V1", universeManifestId: researchUniverseManifestId, datasetIds: { "1m": "505dca3f27301e72", "5m": "535e2347e56143d9" }, calendarVersion: nseCashCalendar.version, casEligibilityVersion: "NSE_CAS_ELIGIBILITY_2026_V2", interval, completenessRequirement: "COMPLETE_SESSIONS" as const, parameterMode: "FROZEN_PARAMETERS" as const, strategyVersions: strategies, analyticsVersion: BACKTEST_ANALYTICS_VERSION, executionAssumptionsVersion: EXECUTION_ASSUMPTIONS_VERSION, ...(input.researchVariantId ? { researchVariantId: input.researchVariantId } : {}), startingCapital, config, researchRange: { from: from.toISOString(), to: to.toISOString() } };
  const checkpointPath = input.checkpointPath ? validateWalkForwardArtifactStorage(input.checkpointPath).checkpointPath : undefined;
  if (input.foldIds && checkpointPath) throw new Error("Fold-selected research uses independent worker checkpoints.");
  const checkpoint = checkpointPath && existsSync(checkpointPath) ? loadWalkForwardCheckpoint(checkpointPath, walkForwardRunId(metadata)) : undefined;
  const partitions: WalkForwardPartitionResult[] = checkpoint?.partitions ?? [];
  const performance: WalkForwardPerformance = checkpoint?.performance ?? createWalkForwardPerformance(input.optimized !== false);
  performance.replayProfile ??= createWalkForwardPerformance(performance.optimized).replayProfile;
  const partitionCache = new Map<string, PartitionData>();
  for (const fold of selectedFolds) {
    for (const partition of (["TRAIN", "VALIDATION", "TEST"] as const).filter((item) => !input.allowedPartitions || input.allowedPartitions.includes(item))) {
      const range = fold[partition.toLowerCase() as "train" | "validation" | "test"];
      const pendingStrategies = pendingStrategiesForPartition(strategies, partitions, fold.foldId, partition);
      if (pendingStrategies.length === 0) continue;
      const data = input.optimized === false ? null : await loadPartitionData({ service, tokens, interval, range, cache: partitionCache, performance, onProgress: (loadedInstruments) => input.onProgress?.({ foldId: fold.foldId, partition, replayTimestamp: range.from, processedCandles: 0, totalCandles: 0, scannerEvaluations: 0, strategyEvaluations: 0, elapsedMs: 0, stage: "ASSEMBLING_RESEARCH_VIEW", loadedInstruments, totalInstruments: tokens.length }) });
      if (data) {
        const replay = await runSharedReplay({ data, tokens, strategies: pendingStrategies, range, interval, service, performance, startingCapital, strategyConfig: input.strategyConfig, executionConfig: input.executionConfig, onSetup: (strategy, replayTimestamp, setup) => input.researchCapture?.onSetup?.({ foldId: fold.foldId, partition, strategy, replayTimestamp }, setup), onProgress: (progress) => input.onProgress?.({ foldId: fold.foldId, partition, stage: "REPLAYING", ...progress }) });
        for (const strategy of pendingStrategies) { const execution = replay.executions.get(strategy)!; const result = await finishPartition({ execution, analytics: replay.analytics.get(strategy)!, data, strategy, fold, partition, range, startingCapital, performance }); input.researchCapture?.onExecution?.({ foldId: fold.foldId, partition, strategy }, execution, result); partitions.push(result); writeWalkForwardCheckpoint(checkpointPath, metadata, walkForwardRunId(metadata), selectedFolds, partitions, performance); if (checkpointPath) { const verified = loadWalkForwardCheckpoint(checkpointPath, walkForwardRunId(metadata)); if (verified.partitions.length !== partitions.length) throw new Error(`Checkpoint result count mismatch after ${fold.foldId}/${partition}/${strategy}.`); input.onCheckpoint?.({ foldId: fold.foldId, partition, strategy, path: checkpointPath, completedResultCount: partitions.length }); } }
        // A completed partition has its compact research result in `partitions`.
        // Do not retain its full candle view while the next partition is built.
        partitionCache.clear();
        input.onPartitionCleanup?.({ foldId: fold.foldId, partition, completedResultCount: partitions.length });
      } else {
        for (const strategy of pendingStrategies) { partitions.push(await runPartition({ service, tokens, strategy, fold, partition, interval, startingCapital, performance, strategyConfig: input.strategyConfig, executionConfig: input.executionConfig })); writeWalkForwardCheckpoint(checkpointPath, metadata, walkForwardRunId(metadata), selectedFolds, partitions, performance); if (checkpointPath) { const verified = loadWalkForwardCheckpoint(checkpointPath, walkForwardRunId(metadata)); if (verified.partitions.length !== partitions.length) throw new Error(`Checkpoint result count mismatch after ${fold.foldId}/${partition}/${strategy}.`); input.onCheckpoint?.({ foldId: fold.foldId, partition, strategy, path: checkpointPath, completedResultCount: partitions.length }); } }
      }
    }
  }
  const result: WalkForwardResult = { runId: walkForwardRunId(metadata), metadata, folds: selectedFolds, partitions, testAggregates: aggregateTests(partitions), instrumentBreakdown: breakdownByInstrument(partitions), sectorBreakdown: breakdownBySector(partitions), diagnostics: diagnostics(partitions), performance };
  return result;
}

export function selectWalkForwardFolds(folds: WalkForwardFold[], ids?: readonly string[]) {
  if (!ids) return folds;
  if (!ids.length || new Set(ids).size !== ids.length || ids.some(id => !folds.some(fold => fold.foldId === id))) throw new Error("Unknown or duplicate walk-forward fold selection.");
  return folds.filter(fold => ids.includes(fold.foldId));
}

/** Shared by the runner and resume verification: completed strategy work is never replayed. */
export function pendingStrategiesForPartition(strategies: readonly string[], partitions: readonly Pick<WalkForwardPartitionResult, "foldId" | "partition" | "strategy">[], foldId: string, partition: WalkForwardPartition) {
  return strategies.filter((strategy) => !partitions.some((item) => item.foldId === foldId && item.partition === partition && item.strategy === strategy));
}

interface PartitionData { candles: import("../../historical-market-data/types").NormalizedHistoricalCandle[]; excludedSessions: Array<ResearchSessionEligibility & { instrumentToken: string }>; eligibleInstrumentSessions: number; }

async function loadPartitionData(input: { service: HistoricalMarketDataService; tokens: string[]; interval: HistoricalCandleIntervalCode; range: DateRange; cache: Map<string, PartitionData>; performance: WalkForwardPerformance; onProgress?: (loadedInstruments: number) => void }): Promise<PartitionData> {
  const datasetId = input.interval === "1m" ? "505dca3f27301e72" : "535e2347e56143d9";
  const cacheKey = `${input.tokens.slice().sort().join(",")}|${input.interval}|${input.range.from}|${input.range.to}|${datasetId}|COMPLETE_SESSIONS|${nseCashCalendar.version}|NSE_CAS_ELIGIBILITY_2026_V2`;
  const cached = input.cache.get(cacheKey);
  if (cached) { input.performance.cacheHits += 1; return cached; }
  input.performance.cacheMisses += 1; const candles: PartitionData["candles"] = []; const excludedSessions: PartitionData["excludedSessions"] = []; let eligibleInstrumentSessions = 0;
  const tokens = input.tokens.slice().sort();
  let loadedInstruments = 0;
  input.onProgress?.(loadedInstruments);
  for (const token of tokens) {
    input.performance.databaseQueries += 1;
    input.performance.candleLoads += 1;
    const view = await input.service.getResearchCandles({ instrumentToken: token, interval: input.interval, from: input.range.from, to: input.range.to, requireCompleteSession: true });
    loadedInstruments += 1;
    input.onProgress?.(loadedInstruments);
    candles.push(...view.candles);
    eligibleInstrumentSessions += view.eligibility.filter((item) => item.eligible).length;
    excludedSessions.push(...view.rejectedSessions.map((item) => ({ ...item, instrumentToken: token })));
  }
  input.performance.candlesLoaded += candles.length; const result = { candles, excludedSessions, eligibleInstrumentSessions }; input.cache.set(cacheKey, result); return result;
}

async function runSharedReplay(input: { data: PartitionData; tokens: string[]; strategies: string[]; range: DateRange; interval: HistoricalCandleIntervalCode; service: HistoricalMarketDataService; performance: WalkForwardPerformance; startingCapital: number; strategyConfig?: Partial<StrategyConfig>; executionConfig?: Partial<PaperExecutionConfig>; onSetup?: (strategy: string, replayTimestamp: string, setup: StrategyEvaluation) => void; onProgress?: HistoricalReplayRunnerDependencies["onProgress"] }) {
  const analytics = new Map(input.strategies.map((strategy) => [strategy, new BacktestAnalyticsAccumulator()]));
  const engines = new Map(input.strategies.map((strategy) => [strategy, new HistoricalPaperExecutionEngine({ startingCapital: input.startingCapital, executionConfig: input.executionConfig, collectSnapshots: false, collectEquityCurve: false, onEquityPoint: (point) => analytics.get(strategy)!.observe(point) })]));
  const counts = new Map(input.strategies.map((strategy) => [strategy, { strategyEvaluations: 0, setupsDetected: 0, invalidSetups: 0, unavailableEvents: 0 }]));
  const ids = new Map(input.strategies.map((strategy) => [strategy, strategy.replace(/:v\d+$/, "")]));
  const runner = new HistoricalReplayRunner({
    loadCandles: async () => input.data.candles,
    sessionPolicy: input.service.getHistoricalSessionPolicy(),
    incrementalScanner: true,
    optimizedContext: true,
    strategyConfig: input.strategyConfig,
    collectEvents: false,
    onEvent: (event) => {
      for (const strategy of input.strategies) {
        const id = ids.get(strategy)!;
        const filtered = event.type === "CANDLE"
          ? { ...event, strategy: { ...event.strategy, evaluationCount: event.strategy.evaluations.filter((evaluation) => evaluation.strategyId === id).length, setupCount: event.strategy.evaluations.filter((evaluation) => evaluation.strategyId === id && evaluation.status === "SETUP_DETECTED").length, statuses: Object.fromEntries(Object.entries(event.strategy.statuses).map(([status, count]) => [status, status === "NO_SETUP" || status === "SETUP_DETECTED" || status === "SETUP_INVALID" || status === "DATA_UNAVAILABLE" ? event.strategy.evaluations.filter((evaluation) => evaluation.strategyId === id && evaluation.status === status).length : count])) as typeof event.strategy.statuses, evaluations: event.strategy.evaluations.filter((evaluation) => evaluation.strategyId === id) } }
          : event;
        if (filtered.type === "CANDLE") {
          const count = counts.get(strategy)!;
          count.strategyEvaluations += filtered.strategy.evaluationCount;
          count.setupsDetected += filtered.strategy.setupCount;
          count.invalidSetups += filtered.strategy.statuses.SETUP_INVALID;
          count.unavailableEvents += filtered.strategy.statuses.DATA_UNAVAILABLE;
          if (input.onSetup) for (const evaluation of filtered.strategy.evaluations) {
            if (evaluation.status === "SETUP_DETECTED") input.onSetup(strategy, filtered.replayTimestamp, evaluation);
          }
        }
        engines.get(strategy)!.processEvent(filtered);
      }
    },
    onProgress: input.onProgress
  });
  input.performance.replayRuns += 1; const replay = await runner.run({ tokens: input.tokens, from: input.range.from, to: input.range.to, interval: input.interval, strategyIds: input.strategies.map((strategy) => strategy.replace(/:v\d+$/, "")) }); mergeReplayProfile(input.performance, replay);
  input.performance.scannerEvaluations += replay.summary.scannerEvaluations; input.performance.strategyEvaluations += replay.summary.strategyEvaluations;
  const executions = new Map(input.strategies.map((strategy) => {
    const count = counts.get(strategy)!;
    return [strategy, engines.get(strategy)!.complete({ ...replay.summary, deterministicRunId: `${replay.summary.deterministicRunId}:${strategy}`, strategyEvaluations: count.strategyEvaluations, setupsDetected: count.setupsDetected, invalidSetups: count.invalidSetups, unavailableEvents: count.unavailableEvents })];
  }));
  const completedAnalytics = new Map(input.strategies.map((strategy) => [strategy, analytics.get(strategy)!.complete(executions.get(strategy)!)]));
  return { replay, executions, analytics: completedAnalytics };
}

async function finishPartition(input: { execution: HistoricalPaperExecutionResult; analytics: BacktestAnalyticsResult; data: PartitionData; strategy: string; fold: WalkForwardFold; partition: WalkForwardPartition; range: DateRange; startingCapital: number; performance: WalkForwardPerformance }): Promise<WalkForwardPartitionResult> {
  input.performance.executionRuns += 1; const execution = input.execution; const analytics = input.analytics;
  return { strategy: input.strategy, foldId: input.fold.foldId, partition: input.partition, range: input.range, tradingSessions: input.fold[`${input.partition.toLowerCase()}TradingDates` as "trainTradingDates" | "validationTradingDates" | "testTradingDates"].length, eligibleInstrumentSessions: input.data.eligibleInstrumentSessions, excludedSessions: input.data.excludedSessions, metrics: metrics(analytics, execution), analytics };
}

async function runPartition(input: { service: HistoricalMarketDataService; tokens: string[]; strategy: string; fold: WalkForwardFold; partition: WalkForwardPartition; interval: HistoricalCandleIntervalCode; startingCapital: number; performance: WalkForwardPerformance; strategyConfig?: Partial<StrategyConfig>; executionConfig?: Partial<PaperExecutionConfig> }): Promise<WalkForwardPartitionResult> {
  const range = input.fold[input.partition.toLowerCase() as "train" | "validation" | "test"];
  const candles: import("../../historical-market-data/types").NormalizedHistoricalCandle[] = [];
  const excludedSessions: Array<ResearchSessionEligibility & { instrumentToken: string }> = [];
  let eligibleInstrumentSessions = 0;
  for (const token of input.tokens) {
    input.performance.databaseQueries += 1; input.performance.candleLoads += 1; const view = await input.service.getResearchCandles({ instrumentToken: token, interval: input.interval, from: range.from, to: range.to, requireCompleteSession: true });
    candles.push(...view.candles); eligibleInstrumentSessions += view.eligibility.filter((item) => item.eligible).length; excludedSessions.push(...view.rejectedSessions.map((item) => ({ ...item, instrumentToken: token })));
  }
  const runner = new HistoricalReplayRunner({ loadCandles: async () => candles, sessionPolicy: input.service.getHistoricalSessionPolicy(), strategyConfig: input.strategyConfig });
  input.performance.candlesLoaded += candles.length; input.performance.replayRuns += 1; const replay = await runner.run({ tokens: input.tokens, from: range.from, to: range.to, interval: input.interval, strategyIds: [input.strategy.replace(/:v\d+$/, "")] }); mergeReplayProfile(input.performance, replay); input.performance.scannerEvaluations += replay.summary.scannerEvaluations; input.performance.strategyEvaluations += replay.summary.strategyEvaluations;
  input.performance.executionRuns += 1; const execution = executeHistoricalPaperReplay(replay, { startingCapital: input.startingCapital, executionConfig: input.executionConfig });
  const analytics = analyzeBacktest(execution);
  return { strategy: input.strategy, foldId: input.fold.foldId, partition: input.partition, range, tradingSessions: input.fold[`${input.partition.toLowerCase()}TradingDates` as "trainTradingDates" | "validationTradingDates" | "testTradingDates"].length, eligibleInstrumentSessions, excludedSessions, metrics: metrics(analytics, execution), analytics };
}

function filterReplayForStrategy(replay: HistoricalReplayResult, strategy: string): HistoricalReplayResult {
  const id = strategy.replace(/:v\d+$/, "");
  const events = replay.events.map((event): ReplayEvent => {
    if (event.type !== "CANDLE") return event;
    const evaluations = event.strategy.evaluations.filter((evaluation) => evaluation.strategyId === id);
    const statuses = { NO_SETUP: 0, SETUP_DETECTED: 0, SETUP_INVALID: 0, DATA_UNAVAILABLE: 0 };
    for (const evaluation of evaluations) statuses[evaluation.status] += 1;
    return { ...event, strategy: { evaluationCount: evaluations.length, setupCount: evaluations.filter((evaluation) => evaluation.status === "SETUP_DETECTED").length, statuses, evaluations } };
  });
  const request = { ...replay.request, strategyIds: [id] };
  const deterministicRunId = deterministicReplayId(request, events);
  return { ...replay, request, events, summary: { ...replay.summary, deterministicRunId, strategyEvaluations: events.reduce((sum, event) => sum + (event.type === "CANDLE" ? event.strategy.evaluationCount : 0), 0), setupsDetected: events.reduce((sum, event) => sum + (event.type === "CANDLE" ? event.strategy.setupCount : 0), 0) } };
}

export function writeWalkForwardCheckpoint(filePath: string | undefined, metadata: WalkForwardResult["metadata"], runId: string, folds: WalkForwardFold[], partitions: WalkForwardPartitionResult[], performance: WalkForwardPerformance) {
  if (!filePath) return;
  mkdirSync(path.dirname(filePath), { recursive: true });
  const temporary = `${filePath}.tmp`;
  writeJsonFile(temporary, { checkpointFormatVersion: WALK_FORWARD_CHECKPOINT_FORMAT_VERSION, runId, metadata, folds, partitions: partitions.map(compactDurablePartition), performance });
  renameSync(temporary, filePath);
}

/** Removes Phase 8E-unneeded intraday series without changing any analytics fact. */
export function compactDurablePartition(partition: WalkForwardPartitionResult): WalkForwardPartitionResult {
  return {
    ...partition,
    analytics: {
      ...partition.analytics,
      equityCurve: [],
      drawdown: { ...partition.analytics.drawdown, points: [] }
    }
  };
}

export function writeJsonFile(filePath: string, value: unknown) {
  const fd = openSync(filePath, "w", 0o600);
  try { writeJsonValue(fd, value); } finally { closeSync(fd); }
}

function writeJsonValue(fd: number, value: unknown) {
  if (value === null || typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    writeSync(fd, JSON.stringify(value));
    return;
  }
  if (Array.isArray(value)) {
    writeSync(fd, "[");
    value.forEach((item, index) => { if (index) writeSync(fd, ","); writeJsonValue(fd, item === undefined ? null : item); });
    writeSync(fd, "]");
    return;
  }
  if (typeof value === "object") {
    writeSync(fd, "{");
    let first = true;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      if (!first) writeSync(fd, ",");
      first = false;
      writeSync(fd, JSON.stringify(key));
      writeSync(fd, ":");
      writeJsonValue(fd, item);
    }
    writeSync(fd, "}");
    return;
  }
  writeSync(fd, "null");
}

export function loadWalkForwardCheckpoint(path: string, expectedRunId: string): { checkpointFormatVersion: string; runId: string; partitions: WalkForwardPartitionResult[]; performance?: WalkForwardPerformance } {
  const checkpoint = JSON.parse(readFileSync(path, "utf8")) as { checkpointFormatVersion?: string; runId?: string; partitions?: WalkForwardPartitionResult[]; performance?: WalkForwardPerformance };
  if (checkpoint.runId !== expectedRunId) throw new Error(`Checkpoint identity mismatch for ${path}; refusing to reuse it.`);
  return { checkpointFormatVersion: checkpoint.checkpointFormatVersion ?? "8E-LEGACY-1", runId: checkpoint.runId, partitions: checkpoint.partitions ?? [], performance: checkpoint.performance };
}

/**
 * Converts a legacy checkpoint one partition at a time. The old file is never
 * mutated: each huge partition is parsed, compacted, compared, then released.
 */
export async function migrateLegacyWalkForwardCheckpoint(sourcePath: string, destinationPath: string, expectedRunId: string): Promise<WalkForwardCheckpointMigration> {
  const source = resolveWalkForwardArtifactPath(sourcePath);
  const destination = resolveWalkForwardArtifactPath(destinationPath);
  if (existsSync(destination)) throw new Error(`Refusing to overwrite existing migrated checkpoint: ${destination}`);
  const sourceSha256 = await sha256File(source);
  const sourceBytes = statSync(source).size;
  const migratedPartitions: WalkForwardCheckpointMigration["migratedPartitions"] = [];
  const compactPartitions: WalkForwardPartitionResult[] = [];
  const { header, suffix } = await streamLegacyCheckpointPartitions(source, (header) => {
    if (header.runId !== expectedRunId) throw new Error(`Checkpoint identity mismatch for ${source}; refusing to migrate it.`);
  }, (legacyPartitionJson) => {
    const { partition: compact, equityPointsRemoved, drawdownPointsRemoved } = compactLegacyPartitionJson(legacyPartitionJson);
    compactPartitions.push(compact);
    migratedPartitions.push({ strategy: compact.strategy, foldId: compact.foldId, partition: compact.partition, equityPointsRemoved, drawdownPointsRemoved });
  });
  if (!header.runId || !header.metadata || !header.folds) throw new Error(`Legacy checkpoint is missing required metadata: ${source}`);
  const performance = suffix.performance as WalkForwardPerformance | undefined;
  writeWalkForwardCheckpoint(destination, header.metadata as WalkForwardResult["metadata"], header.runId, header.folds as WalkForwardFold[], compactPartitions, performance ?? createWalkForwardPerformance(true));
  const reloaded = loadWalkForwardCheckpoint(destination, expectedRunId);
  if (reloaded.checkpointFormatVersion !== WALK_FORWARD_CHECKPOINT_FORMAT_VERSION || reloaded.partitions.length !== compactPartitions.length) throw new Error("Migrated checkpoint verification failed.");
  return { sourcePath: source, destinationPath: destination, sourceSha256, sourceBytes, destinationBytes: statSync(destination).size, runId: header.runId, migratedPartitions };
}

export function compactLegacyPartitionJson(legacyPartitionJson: string): { partition: WalkForwardPartitionResult; equityPointsRemoved: number; drawdownPointsRemoved: number } {
  const equity = locateJsonArray(legacyPartitionJson, '"equityCurve":[');
  const drawdown = locateJsonArray(legacyPartitionJson, '"points":[', equity.end);
  const compactJson = `${legacyPartitionJson.slice(0, equity.start)}"equityCurve":[]${legacyPartitionJson.slice(equity.end, drawdown.start)}"points":[]${legacyPartitionJson.slice(drawdown.end)}`;
  const partition = JSON.parse(compactJson) as WalkForwardPartitionResult;
  if (partition.analytics.equityCurve.length || partition.analytics.drawdown.points.length) throw new Error("Legacy partition compaction did not remove intraday series.");
  return { partition, equityPointsRemoved: jsonArrayItemCount(legacyPartitionJson, equity.open, equity.close), drawdownPointsRemoved: jsonArrayItemCount(legacyPartitionJson, drawdown.open, drawdown.close) };
}

function locateJsonArray(source: string, key: string, from = 0) {
  const keyIndex = source.indexOf(key, from);
  if (keyIndex < 0) throw new Error(`Expected legacy intraday series ${key} was not found.`);
  const open = keyIndex + key.length - 1;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open; index < source.length; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "[") depth += 1;
    else if (char === "]" && --depth === 0) return { start: keyIndex, open, close: index, end: index + 1 };
  }
  throw new Error(`Legacy intraday series ${key} is not a complete JSON array.`);
}

function jsonArrayItemCount(source: string, open: number, close: number) {
  let count = 0;
  let depth = 0;
  let inString = false;
  let escaped = false;
  for (let index = open + 1; index < close; index += 1) {
    const char = source[index]!;
    if (inString) {
      if (escaped) escaped = false;
      else if (char === "\\") escaped = true;
      else if (char === '"') inString = false;
      continue;
    }
    if (char === '"') inString = true;
    else if (char === "{") { if (depth === 0) count += 1; depth += 1; }
    else if (char === "}") depth -= 1;
  }
  return count;
}

async function sha256File(filePath: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(filePath)) hash.update(chunk);
  return hash.digest("hex");
}

async function streamLegacyCheckpointPartitions(filePath: string, onHeader: (header: { runId?: string; metadata?: unknown; folds?: unknown }) => void, onPartition: (partitionJson: string) => void): Promise<{ header: { runId?: string; metadata?: unknown; folds?: unknown }; suffix: Record<string, unknown> }> {
  const marker = '"partitions":[';
  let headerBuffer = "";
  let body = "";
  let foundMarker = false;
  let complete = false;
  let entryParts: string[] = [];
  let depth = 0;
  let inString = false;
  let escaped = false;
  let suffix = "";
  for await (const chunk of createReadStream(filePath, { encoding: "utf8", highWaterMark: 1024 * 1024 })) {
    if (!foundMarker) {
      headerBuffer += chunk;
      const index = headerBuffer.indexOf(marker);
      if (index < 0) continue;
      const prefix = headerBuffer.slice(0, index).replace(/,$/, "");
      const header = JSON.parse(`${prefix}}`) as { runId?: string; metadata?: unknown; folds?: unknown };
      onHeader(header);
      foundMarker = true;
      body = headerBuffer.slice(index + marker.length);
      headerBuffer = JSON.stringify(header);
    } else body += chunk;
    if (complete) { suffix += body; body = ""; continue; }
    let index = 0;
    let segmentStart = 0;
    while (index < body.length) {
      const char = body[index++]!;
      if (depth === 0) {
        if (char === "{" ) { entryParts = [char]; depth = 1; inString = false; escaped = false; segmentStart = index; }
        else if (char === "]") { complete = true; suffix += body.slice(index); body = ""; break; }
        continue;
      }
      if (inString) {
        if (escaped) escaped = false;
        else if (char === "\\") escaped = true;
        else if (char === '"') inString = false;
        continue;
      }
      if (char === '"') inString = true;
      else if (char === "{") depth += 1;
      else if (char === "}") {
        depth -= 1;
        if (depth === 0) {
          entryParts.push(body.slice(segmentStart, index));
          onPartition(entryParts.join(""));
          entryParts = [];
          segmentStart = index;
        }
      }
    }
    if (!complete) {
      if (depth > 0 && segmentStart < body.length) entryParts.push(body.slice(segmentStart));
      body = "";
    }
  }
  if (!foundMarker || !complete || depth !== 0) throw new Error(`Could not stream legacy checkpoint partitions from ${filePath}.`);
  const header = JSON.parse(headerBuffer) as { runId?: string; metadata?: unknown; folds?: unknown };
  const suffixObject = JSON.parse(`{${suffix.trim().replace(/^,/, "")}`) as Record<string, unknown>;
  return { header, suffix: suffixObject };
}

function createWalkForwardPerformance(optimized: boolean): WalkForwardPerformance {
  return { optimized, databaseQueries: 0, cacheHits: 0, cacheMisses: 0, candleLoads: 0, candlesLoaded: 0, replayRuns: 0, scannerEvaluations: 0, strategyEvaluations: 0, executionRuns: 0, replayProfile: { totalReplayNs: 0, marketStateUpdateNs: 0, scannerNs: 0, strategyNs: 0, strategyRegistryNs: 0, strategyDispatchNs: 0, strategyRuleNs: 0, contextAccessNs: 0, universeLoadNs: 0, observationNs: 0, featureNs: 0, filterNs: 0, scoreNs: 0, rankingNs: 0, instrumentsConsidered: 0, featureCalculations: 0, candidatesConstructed: 0 } };
}

function mergeReplayProfile(performance: WalkForwardPerformance, replay: HistoricalReplayResult) {
  const profile = replay.performance;
  if (!profile) return;
  const target = performance.replayProfile;
  target.totalReplayNs += profile.totalReplayNs;
  target.marketStateUpdateNs += profile.marketStateUpdateNs;
  target.scannerNs += profile.scannerNs;
  target.strategyNs += profile.strategyNs;
  target.strategyRegistryNs += profile.strategyRegistryNs;
  target.strategyDispatchNs += profile.strategyDispatchNs;
  target.strategyRuleNs += profile.strategyRuleNs;
  target.contextAccessNs += profile.contextAccessNs;
  target.universeLoadNs += profile.scanner.universeLoadNs;
  target.observationNs += profile.scanner.observationNs;
  target.featureNs += profile.scanner.featureNs;
  target.filterNs += profile.scanner.filterNs;
  target.scoreNs += profile.scanner.scoreNs;
  target.rankingNs += profile.scanner.rankingNs;
  target.instrumentsConsidered += profile.scanner.instrumentsConsidered;
  target.featureCalculations += profile.scanner.featureCalculations;
  target.candidatesConstructed += profile.scanner.candidatesConstructed;
}

function metrics(analytics: BacktestAnalyticsResult, execution: HistoricalPaperExecutionResult) { return { setups: analytics.metadata.setupCount, orders: analytics.metadata.orderCount, fills: analytics.metadata.fillCount, trades: execution.trades.length, closedTrades: analytics.metadata.closedTradeCount, incompleteTrades: analytics.metadata.incompleteTradeCount, grossPnl: analytics.pnl.grossPnl, charges: analytics.pnl.totalCharges, netPnl: analytics.pnl.netPnl, winRate: analytics.trades.winRate, profitFactor: analytics.pnl.profitFactor, expectancy: analytics.pnl.expectancy, expectancyR: analytics.pnl.averageR, averageR: analytics.pnl.averageR, medianR: analytics.pnl.medianR, maxDrawdown: analytics.drawdown.maxDrawdownAmount, sharpe: analytics.riskAdjusted.sharpeRatio, sortino: analytics.riskAdjusted.sortinoRatio, averageHoldingMs: analytics.holdingTime.averageMs, longTrades: execution.trades.filter((trade) => trade.direction === "LONG").length, shortTrades: execution.trades.filter((trade) => trade.direction === "SHORT").length }; }

function aggregateTests(partitions: WalkForwardPartitionResult[]) {
  return [...new Set(partitions.map((item) => item.strategy))].sort().map((strategy) => { const rows = partitions.filter((item) => item.strategy === strategy && item.partition === "TEST"); const trades = rows.reduce((sum, row) => sum + row.metrics.closedTrades, 0); const pnl = rows.reduce((sum, row) => sum + row.metrics.netPnl, 0); const positive = rows.filter((row) => (row.metrics.expectancy ?? 0) > 0).length; return { strategy, testFolds: rows.length, testTrades: trades, netPnl: pnl, expectancy: trades ? pnl / trades : null, expectancyR: average(rows.map((row) => row.metrics.expectancyR)), profitFactor: combinedProfitFactor(rows), maxDrawdown: Math.max(0, ...rows.map((row) => row.metrics.maxDrawdown)), winRate: weightedWinRate(rows), positiveExpectancyFolds: positive, negativeExpectancyFolds: rows.filter((row) => (row.metrics.expectancy ?? 0) < 0).length, perFold: rows.map((row) => ({ foldId: row.foldId, expectancy: row.metrics.expectancy, expectancyR: row.metrics.expectancyR, profitFactor: row.metrics.profitFactor, maxDrawdown: row.metrics.maxDrawdown, tradeCount: row.metrics.closedTrades })) }; });
}

function breakdownByInstrument(partitions: WalkForwardPartitionResult[]) {
  const sectors = new Map(researchUniverseInstruments.map((item) => [item.instrumentToken, item.sector]));
  return partitions.filter((row) => row.partition === "TEST").flatMap((row) => row.analytics.byInstrument.map((item) => ({ strategy: row.strategy, partition: "TEST" as const, instrumentToken: item.instrumentToken, tradingSymbol: item.tradingSymbol, sector: sectors.get(item.instrumentToken) ?? null, tradeCount: item.closedTradeCount, netPnl: item.netPnl, expectancy: item.averageTradePnl, expectancyR: item.averageR, winRate: item.winRate })));
}
function breakdownBySector(partitions: WalkForwardPartitionResult[]) {
  const instruments = breakdownByInstrument(partitions); const groups = new Map<string, typeof instruments>();
  for (const item of instruments) { const key = `${item.strategy}|${item.sector ?? "UNKNOWN"}`; groups.set(key, [...(groups.get(key) ?? []), item]); }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([key, rows]) => { const [strategy, sector] = key.split("|"); const tradeCount = rows.reduce((sum, row) => sum + row.tradeCount, 0); return { strategy, partition: "TEST" as const, sector: sector!, tradeCount, netPnl: rows.reduce((sum, row) => sum + row.netPnl, 0), expectancy: tradeCount ? rows.reduce((sum, row) => sum + (row.expectancy ?? 0) * row.tradeCount, 0) / tradeCount : null, expectancyR: average(rows.map((row) => row.expectancyR)), winRate: tradeCount ? rows.reduce((sum, row) => sum + (row.winRate ?? 0) * row.tradeCount, 0) / tradeCount : null }; });
}
function diagnostics(partitions: WalkForwardPartitionResult[]) { return [...new Set(partitions.filter((row) => row.partition === "TEST").map((row) => row.strategy))].flatMap((strategy) => { const rows = partitions.filter((row) => row.strategy === strategy && row.partition === "TEST"); const out: WalkForwardResult["diagnostics"] = []; if (rows.length < 2) out.push({ code: "INSUFFICIENT_TEST_FOLDS", strategy, partition: "TEST", count: rows.length }); const trades = rows.reduce((sum, row) => sum + row.metrics.closedTrades, 0); if (trades < 30) out.push({ code: "INSUFFICIENT_TRADES", strategy, partition: "TEST", count: trades }); const daily = rows.reduce((sum, row) => sum + row.analytics.dailyReturns.length, 0); if (daily < 2) out.push({ code: "INSUFFICIENT_DAILY_RETURNS", strategy, partition: "TEST", count: daily }); return out; }); }
function combinedProfitFactor(rows: WalkForwardPartitionResult[]) { const grossProfit = rows.reduce((sum, row) => sum + row.analytics.pnl.grossProfit, 0); const grossLoss = rows.reduce((sum, row) => sum + row.analytics.pnl.grossLoss, 0); return grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? null : 0; }
function weightedWinRate(rows: WalkForwardPartitionResult[]) { const total = rows.reduce((sum, row) => sum + row.metrics.closedTrades, 0); return total ? rows.reduce((sum, row) => sum + (row.metrics.winRate ?? 0) * row.metrics.closedTrades, 0) / total : null; }
function average(values: Array<number | null>) { const usable = values.filter((value): value is number => value != null); return usable.length ? usable.reduce((sum, value) => sum + value, 0) / usable.length : null; }
function assertFrozenStrategies(strategies: string[]) { for (const strategy of strategies) if (!(FROZEN_BASELINE_STRATEGIES as readonly string[]).includes(strategy)) throw new Error(`Phase 8E only permits frozen baseline strategies: ${FROZEN_BASELINE_STRATEGIES.join(", ")}`); }
function validateConfig(config: WalkForwardConfig) { if (![config.trainSessions, config.validationSessions, config.testSessions, config.stepSessions].every((value) => Number.isInteger(value) && value > 0)) throw new Error("Walk-forward session counts must be positive integers."); }
function tradingDates(from: Date, to: Date) { const out: string[] = []; for (let cursor = new Date(from); cursor < to; cursor = new Date(cursor.getTime() + 86_400_000)) { const date = getTradingDate(cursor); if (nseCashCalendar.isTradingDay(date) && !out.includes(date)) out.push(date); } return out; }
function rangeFor(dates: string[], exclusiveEndDate: string): DateRange { return { from: sessionBoundary(dates[0]!, "open"), to: sessionBoundary(exclusiveEndDate, "open") }; }
function nextDateExclusive(date: string) { const at = new Date(`${date}T12:00:00+05:30`); return new Date(at.getTime() + 86_400_000).toISOString().slice(0, 10); }
function sessionBoundary(date: string, side: "open") { void side; return new Date(`${date}T09:15:00+05:30`).toISOString(); }
