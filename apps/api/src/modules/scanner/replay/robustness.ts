import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getStrategyConfig, type StrategyConfig } from "../../strategies/config";
import { getPaperExecutionConfig, type PaperExecutionConfig } from "../../paper-trading/execution/config";
import { runWalkForward, type WalkForwardConfig, type WalkForwardPartitionResult, type WalkForwardResult } from "./walk-forward";
import { HistoricalReplayRunner } from "./historical-replay-runner";
import { HistoricalPaperExecutionEngine } from "./historical-paper-execution";
import { BacktestAnalyticsAccumulator } from "./backtest-analytics";
import type { HistoricalCandleIntervalCode } from "../../../db/domain";
import type { NormalizedHistoricalCandle } from "../../historical-market-data/types";
import type { InstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import type { HistoricalPaperExecutionResult } from "./historical-paper-execution";

export const ROBUSTNESS_VERSION = "PHASE_8F2_ROBUSTNESS_V1";
export const ROBUSTNESS_BASELINE_RUN_ID = "1fd46d5ef1f0e98f";
export const ROBUSTNESS_BASELINE_SHA256 = "8070a2f7e6e1c23aafc9cf801d385b2aa064cd004cdfb298e9214594de23c852";
export const ROBUSTNESS_VARIATION_LEVELS = [-0.2, -0.1, 0, 0.1, 0.2] as const;
export const COST_SCENARIOS = ["C0", "C1", "C2", "S1", "S2", "CS1"] as const;
export type CostScenario = typeof COST_SCENARIOS[number];

type StrategyId = "breakout" | "breakdown" | "momentum" | "openingMomentum";
type StrategyVersion = "breakout:v1" | "breakdown:v1" | "momentum:v1" | "opening-momentum:v1";
export interface ParameterDefinition { strategy: StrategyId; name: string; baseline: number; kind: "tunable numeric" | "integer/lookback" | "bounded ratio/threshold"; perturbable: true; }
export interface ParameterVariant { variantId: string; strategy: StrategyVersion; parameter: string; level: number; value: number; config: Partial<StrategyConfig>; }
export interface RobustnessSpec {
  version: string;
  baseline: { runId: string; resultSha256: string; universeManifestId: string; datasetIds: { "1m": string; "5m": string }; calendarVersion: string; casEligibilityVersion: string; executionVersion: string };
  methodology: { parameterLevels: readonly number[]; oneAtATime: true; parameterPartitions: ["TRAIN", "VALIDATION"]; costPartitions: ["TEST"]; noParameterCostCombinations: true };
  parameters: ParameterDefinition[];
  parameterVariants: ParameterVariant[];
  costScenarios: Array<{ id: CostScenario; chargeMultiplier: number; slippageMultiplier: number; slippagePolicy: "NONE" | "BPS" }>;
  metrics: string[];
  aggregation: { parameterRows: "strategy × parameter × value × fold × partition"; costRows: "strategy × scenario × fold" };
  workload: { strategies: number; tunableParameters: number; parameterVariants: number; newParameterVariants: number; trainValidationEvaluations: number; costStressEvaluations: number };
}

const strategyFields: Record<StrategyId, Array<{ name: string; kind: ParameterDefinition["kind"] }>> = {
  breakout: ["minVolume", "proximityPercent", "confirmationTicks", "stopBufferPercent", "targetRewardRisk", "minMomentumPercent"].map((name) => ({ name, kind: name === "confirmationTicks" ? "integer/lookback" : name === "minVolume" ? "tunable numeric" : "bounded ratio/threshold" })),
  breakdown: ["minVolume", "proximityPercent", "confirmationTicks", "stopBufferPercent", "targetRewardRisk", "minMomentumPercent"].map((name) => ({ name, kind: name === "confirmationTicks" ? "integer/lookback" : name === "minVolume" ? "tunable numeric" : "bounded ratio/threshold" })),
  momentum: ["minVolume", "minMovePercent", "maxExtensionPercent", "minSustainedCandles", "stopBufferPercent", "targetRewardRisk"].map((name) => ({ name, kind: ["minSustainedCandles"].includes(name) ? "integer/lookback" : name === "minVolume" ? "tunable numeric" : "bounded ratio/threshold" })),
  openingMomentum: ["minVolume", "openingRangeMinutes", "breakBufferPercent", "stopBufferPercent", "targetRewardRisk", "minMomentumPercent"].map((name) => ({ name, kind: ["openingRangeMinutes"].includes(name) ? "integer/lookback" : name === "minVolume" ? "tunable numeric" : "bounded ratio/threshold" }))
};

export function buildRobustnessSpec(): RobustnessSpec {
  const baseline = getStrategyConfig();
  const parameters: ParameterDefinition[] = [];
  const parameterVariants: ParameterVariant[] = [];
  for (const strategy of Object.keys(strategyFields) as StrategyId[]) {
    for (const field of strategyFields[strategy]) {
      const base = (baseline[strategy] as Record<string, number>)[field.name]!;
      const definition: ParameterDefinition = { strategy, name: field.name, baseline: base, kind: field.kind, perturbable: true };
      parameters.push(definition);
      for (const level of ROBUSTNESS_VARIATION_LEVELS) {
        const value = field.kind === "integer/lookback" ? Math.max(1, Math.round(base * (1 + level))) : Math.max(Number.EPSILON, base * (1 + level));
        const variantId = `${strategy}.${field.name}.${level === 0 ? "BASE" : level > 0 ? `P${Math.round(level * 100)}` : `M${Math.abs(Math.round(level * 100))}`}`;
        const strategyVersion = strategy === "openingMomentum" ? "opening-momentum:v1" : `${strategy}:v1` as StrategyVersion;
        parameterVariants.push({ variantId, strategy: strategyVersion, parameter: field.name, level, value, config: { [strategy]: { [field.name]: value } } as Partial<StrategyConfig> });
      }
    }
  }
  return {
    version: ROBUSTNESS_VERSION,
    baseline: { runId: ROBUSTNESS_BASELINE_RUN_ID, resultSha256: ROBUSTNESS_BASELINE_SHA256, universeManifestId: "feaabc0198432edc", datasetIds: { "1m": "505dca3f27301e72", "5m": "535e2347e56143d9" }, calendarVersion: "NSE_CASH_2025_2026_V2", casEligibilityVersion: "NSE_CAS_ELIGIBILITY_2026_V2", executionVersion: "8C-PAPER-EXECUTION-V1" },
    methodology: { parameterLevels: ROBUSTNESS_VARIATION_LEVELS, oneAtATime: true, parameterPartitions: ["TRAIN", "VALIDATION"], costPartitions: ["TEST"], noParameterCostCombinations: true },
    parameters, parameterVariants,
    costScenarios: COST_SCENARIOS.map((id) => ({ id, chargeMultiplier: id === "C1" || id === "CS1" ? 1.5 : id === "C2" ? 2 : 1, slippageMultiplier: id === "S1" ? 1.5 : id === "S2" ? 2 : id === "CS1" ? 1.5 : 1, slippagePolicy: id === "C0" || id === "C1" || id === "C2" ? "NONE" : "BPS" })),
    metrics: ["trades", "wins", "losses", "winRate", "grossPnl", "charges", "netPnl", "profitFactor", "expectancy", "averageR", "medianR", "maxDrawdown", "sharpe", "sortino", "setups", "orders", "fills", "closedTrades", "incompleteTrades"],
    aggregation: { parameterRows: "strategy × parameter × value × fold × partition", costRows: "strategy × scenario × fold" },
    workload: { strategies: 4, tunableParameters: parameters.length, parameterVariants: parameterVariants.length, newParameterVariants: parameterVariants.length - parameters.length, trainValidationEvaluations: (parameterVariants.length - parameters.length) * 4 * 2, costStressEvaluations: COST_SCENARIOS.length * 4 * 4 }
  };
}

export function robustnessSpecHash(spec: RobustnessSpec) { return createHash("sha256").update(JSON.stringify(spec)).digest("hex"); }

/** Durable, versioned inputs required by the frozen Phase 8F.2 classifier. */
export interface Phase8F2DurableClassificationMetrics {
  schemaVersion: "8F2-CLASSIFICATION-METRICS-1";
  closedTradeCount: number;
  expectancyPnl: number | null;
  expectancyR: number | null;
  validRTradeCount: number;
  maxDrawdownAmount: number;
}

export interface Phase8F2ClassificationMetrics {
  trades: number;
  expectancy: number | null;
  expectancyR: number | null;
  maxDrawdown: number;
}

export function durableClassificationMetrics(
  summary: HistoricalPaperExecutionResult["summary"],
  maxDrawdownAmount: number
): Phase8F2DurableClassificationMetrics {
  const metrics = summary.classificationMetrics;
  if (!metrics) throw new Error("Phase 8F.2 classification metrics are missing.");
  const { closedTradeCount, expectancyPnl, expectancyR, validRTradeCount } = metrics;
  if (!Number.isInteger(closedTradeCount) || closedTradeCount < 0 || !Number.isInteger(validRTradeCount) || validRTradeCount < 0 || !Number.isFinite(maxDrawdownAmount)) {
    throw new Error("Phase 8F.2 classification metrics are invalid.");
  }
  if (closedTradeCount === 0 && (expectancyPnl != null || expectancyR != null || validRTradeCount !== 0)) {
    throw new Error("Zero-trade classification metrics must not contain expectancy values.");
  }
  if (closedTradeCount > 0 && !Number.isFinite(expectancyPnl)) {
    throw new Error("Closed-trade classification metrics require monetary expectancy.");
  }
  if (validRTradeCount === 0 && expectancyR != null) {
    throw new Error("Classification expectancy R requires at least one valid-risk trade.");
  }
  if (validRTradeCount > 0 && !Number.isFinite(expectancyR)) {
    throw new Error("Valid-risk trades require expectancy R.");
  }
  return {
    schemaVersion: "8F2-CLASSIFICATION-METRICS-1",
    closedTradeCount,
    expectancyPnl,
    expectancyR,
    validRTradeCount,
    maxDrawdownAmount
  };
}

/** Reject old execution summaries instead of silently treating absent inputs as zero. */
export function adaptPhase8F2ClassificationMetrics(value: unknown): Phase8F2ClassificationMetrics {
  if (!value || typeof value !== "object") throw new Error("Phase 8F.2 classification metrics are missing.");
  const metrics = value as Partial<Phase8F2DurableClassificationMetrics>;
  const { closedTradeCount, expectancyPnl, expectancyR, validRTradeCount, maxDrawdownAmount } = metrics;
  if (metrics.schemaVersion !== "8F2-CLASSIFICATION-METRICS-1" || typeof closedTradeCount !== "number" || !Number.isInteger(closedTradeCount) || closedTradeCount < 0 || typeof maxDrawdownAmount !== "number" || !Number.isFinite(maxDrawdownAmount) || typeof validRTradeCount !== "number" || !Number.isInteger(validRTradeCount) || validRTradeCount < 0 || expectancyPnl === undefined || expectancyR === undefined) {
    throw new Error("Phase 8F.2 classification metrics use an incompatible schema.");
  }
  if (closedTradeCount === 0) {
    if (expectancyPnl != null || expectancyR != null || validRTradeCount !== 0) throw new Error("Zero-trade classification metrics are inconsistent.");
  } else if (!Number.isFinite(expectancyPnl)) {
    throw new Error("Phase 8F.2 monetary expectancy is missing.");
  }
  if (validRTradeCount === 0) {
    if (expectancyR != null) throw new Error("Phase 8F.2 expectancy R is inconsistent.");
  } else if (!Number.isFinite(expectancyR)) {
    throw new Error("Phase 8F.2 expectancy R is missing.");
  }
  return { trades: closedTradeCount, expectancy: expectancyPnl ?? null, expectancyR: expectancyR ?? null, maxDrawdown: maxDrawdownAmount };
}

/** Stable research content hashing excludes operational assembly telemetry. */
export function researchContentHash(content: unknown) {
  return createHash("sha256").update(stableJson(content)).digest("hex");
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(",")}]`;
  if (value && typeof value === "object") {
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b));
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stableJson(item)}`).join(",")}}`;
  }
  return JSON.stringify(value);
}

export function parameterStatus(rows: Array<{ metrics: { trades: number; expectancy: number | null; expectancyR: number | null; maxDrawdown: number } }>): "LOCALLY_STABLE" | "LOCALLY_SENSITIVE" | "MIXED" | "INSUFFICIENT_ACTIVITY" | "NO_VALID_PERTURBATION" {
  if (!rows.length) return "NO_VALID_PERTURBATION";
  if (rows.every((row) => row.metrics.trades === 0)) return "INSUFFICIENT_ACTIVITY";
  const signs = new Set(rows.filter((row) => row.metrics.expectancy != null && row.metrics.expectancy !== 0).map((row) => Math.sign(row.metrics.expectancy!)));
  const active = rows.filter((row) => row.metrics.trades > 0);
  if (signs.size > 1) return "LOCALLY_SENSITIVE";
  if (active.length < Math.ceil(rows.length / 2)) return "INSUFFICIENT_ACTIVITY";
  const values = active.map((row) => row.metrics.expectancyR ?? 0);
  const spread = Math.max(...values) - Math.min(...values);
  return spread === 0 ? "LOCALLY_STABLE" : "MIXED";
}

export function executionConfigForScenario(id: CostScenario): Partial<PaperExecutionConfig> {
  const base = getPaperExecutionConfig();
  const scenario = COST_SCENARIOS.includes(id) ? id : "C0";
  const chargeMultiplier = scenario === "C1" || scenario === "CS1" ? 1.5 : scenario === "C2" ? 2 : 1;
  const slippageMultiplier = scenario === "S1" ? 1.5 : scenario === "S2" ? 2 : scenario === "CS1" ? 1.5 : 1;
  return { chargeRateBps: base.chargeRateBps * chargeMultiplier, slippagePolicy: scenario === "C0" || scenario === "C1" || scenario === "C2" ? "NONE" : "BPS", slippageBps: base.slippageBps * slippageMultiplier };
}

export function compactRobustnessRows(result: WalkForwardResult, variantId: string, category: "PARAMETER" | "COST") {
  return result.partitions.map((partition) => ({ category, variantId, strategy: partition.strategy, foldId: partition.foldId, partition: partition.partition, range: partition.range, excludedSessions: partition.excludedSessions, metrics: partition.metrics, diagnostics: { setups: partition.metrics.setups, orders: partition.metrics.orders, fills: partition.metrics.fills, closedTrades: partition.metrics.closedTrades, incompleteTrades: partition.metrics.incompleteTrades } }));
}

export function loadFrozenBaselinePartitions(filePath: string): WalkForwardPartitionResult[] {
  if (!existsSync(filePath)) throw new Error(`Frozen Phase 8E artifact not found: ${filePath}`);
  const parsed = JSON.parse(readFileSync(filePath, "utf8")) as { runId: string; partitions: WalkForwardPartitionResult[] };
  if (parsed.runId !== ROBUSTNESS_BASELINE_RUN_ID) throw new Error("Frozen baseline artifact run ID mismatch.");
  return parsed.partitions;
}

export function frozenBaselineArtifactPath(root: string) { return path.resolve(root, "apps/artifacts/phase8e/frozen-baseline-2026-09-19-final.compact.result.json"); }

export interface SharedBatchCheckpoint { format: "8F2-SHARED-BATCH-1"; specHash: string; baselineRunId: string; strategy: string; completedVariantIds: string[]; }

export function writeSharedBatchCheckpoint(filePath: string, checkpoint: SharedBatchCheckpoint) {
  const temporary = `${filePath}.tmp`;
  writeFileSync(temporary, JSON.stringify({ ...checkpoint, completedVariantIds: [...checkpoint.completedVariantIds].sort() }, null, 2), { mode: 0o600 });
  renameSync(temporary, filePath);
}

export function loadSharedBatchCheckpoint(filePath: string, specHash: string, baselineRunId: string) {
  const checkpoint = JSON.parse(readFileSync(filePath, "utf8")) as SharedBatchCheckpoint;
  if (checkpoint.format !== "8F2-SHARED-BATCH-1" || checkpoint.specHash !== specHash || checkpoint.baselineRunId !== baselineRunId) throw new Error("Phase 8F.2 shared checkpoint identity mismatch.");
  return checkpoint;
}

export function assertParameterResearchPartition(partition: "TRAIN" | "VALIDATION" | "TEST") {
  if (partition === "TEST") throw new Error("Phase 8F.2 perturbed parameters are forbidden on TEST partitions.");
}

export interface SharedParameterBatchInput {
  candles: NormalizedHistoricalCandle[];
  tokens: string[];
  from: string;
  to: string;
  interval: HistoricalCandleIntervalCode;
  strategyId: string;
  variants: ParameterVariant[];
  sessionPolicy: InstrumentSessionPolicy;
  startingCapital?: number;
  indexPendingOrders?: boolean;
  onProgress?: (progress: { replayTimestamp: string; processedCandles: number; totalCandles: number; scannerEvaluations: number; strategyEvaluations: number; elapsedMs: number }) => void;
}

/** One immutable scanner/replay pass fan-outs into isolated variant runtimes. */
export async function runSharedParameterBatch(input: SharedParameterBatchInput) {
  const executions = new Map(input.variants.map((variant) => [variant.variantId, new HistoricalPaperExecutionEngine({ startingCapital: input.startingCapital, indexPendingOrders: input.indexPendingOrders, collectSnapshots: false, collectEquityCurve: false })]));
  const analytics = new Map(input.variants.map((variant) => [variant.variantId, new BacktestAnalyticsAccumulator()]));
  const runner = new HistoricalReplayRunner({
    loadCandles: async () => input.candles,
    sessionPolicy: input.sessionPolicy,
    incrementalScanner: true,
    optimizedContext: true,
    collectEvents: false,
    variantStrategyConfigs: input.variants.map((variant) => ({ variantId: variant.variantId, strategyId: input.strategyId.replace(/:v\d+$/, ""), config: variant.config })),
    onProgress: input.onProgress,
    onVariantEvent: ({ variantId, event }) => {
      const execution = executions.get(variantId)!;
      execution.processEvent(event);
      const account = execution.snapshot();
      analytics.get(variantId)!.observe({ timestamp: event.replayTimestamp, cash: account.cash, realisedPnl: account.realisedPnl, unrealisedPnl: account.unrealisedPnl, equity: account.equity, exposure: account.capitalExposure });
    }
  });
  const replay = await runner.run({ tokens: input.tokens, from: input.from, to: input.to, interval: input.interval, strategyIds: [input.strategyId.replace(/:v\d+$/, "")] });
  return new Map(input.variants.map((variant) => {
    const execution = executions.get(variant.variantId)!;
    const result = execution.complete(replay.summary);
    return [variant.variantId, { execution: result, analytics: analytics.get(variant.variantId)!.complete(result), replay }];
  }));
}

export type RobustnessRunConfig = { from: string; to: string; interval: "1m" | "5m"; walkForward: WalkForwardConfig; tokens?: string[]; startingCapital?: number; smoke?: boolean; onCheckpoint?: (checkpoint: { foldId: string; partition: "TRAIN" | "VALIDATION" | "TEST"; strategy: string; path: string; completedResultCount: number }) => void };

export async function runParameterVariant(config: RobustnessRunConfig, variant: ParameterVariant, checkpointPath?: string) {
  assertParameterResearchPartition("TRAIN");
  assertParameterResearchPartition("VALIDATION");
  return runWalkForward({ ...config, strategies: [variant.strategy], allowedPartitions: ["TRAIN", "VALIDATION"], strategyConfig: variant.config, researchVariantId: `PARAMETER:${variant.variantId}`, checkpointPath, onCheckpoint: config.onCheckpoint });
}

export async function runCostScenario(config: RobustnessRunConfig, strategy: StrategyVersion, scenario: CostScenario, checkpointPath?: string) {
  return runWalkForward({ ...config, strategies: [strategy], allowedPartitions: ["TEST"], executionConfig: executionConfigForScenario(scenario), researchVariantId: `COST:${strategy}:${scenario}`, checkpointPath, onCheckpoint: config.onCheckpoint });
}
