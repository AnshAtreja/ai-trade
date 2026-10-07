import { getStrategyConfig, type StrategyConfig } from "../../strategies/config";
import { buildRobustnessSpec, researchContentHash, type ParameterVariant } from "./robustness";

export const CONTROLLED_OPTIMIZATION_VERSION = "PHASE_8F3_CONTROLLED_OPTIMIZATION_V1";
export const RECOVERED_8F2_SHA256 = "6b505345eec692f1d8b04eb5873cf8220b6ec49c0fc5974dccb38113962999e9";
export const ACTIVE_STRATEGIES = ["breakout:v1", "momentum:v1", "opening-momentum:v1"] as const;
export type OptimizationStage = "TRAIN" | "VALIDATION" | "TEST";
export type OptimizationStrategy = typeof ACTIVE_STRATEGIES[number] | "breakdown:v1";

export interface Candidate extends ParameterVariant {
  candidateHash: string;
  kind: "MULTIVARIATE" | "ACTIVITY_RECOVERY";
  values: Record<string, number>;
}

export interface OptimizationSpec {
  version: typeof CONTROLLED_OPTIMIZATION_VERSION;
  source: { robustnessVersion: string; robustnessSpecHash: string; recoveredArtifactSha256: string; baselineRunId: string; frozenIdentity: ReturnType<typeof buildRobustnessSpec>["baseline"] };
  design: { algorithm: "HALTON_V1"; deterministicSeed: number; activeCandidateCount: 64; breakdownActivityCandidateCount: 8; batchSize: 8; maxWorkers: 2; partitions: { search: "TRAIN"; selection: "VALIDATION"; optimizedTestExecutions: 0 }; baselineIsCandidate: false };
  bounds: Array<{ strategy: OptimizationStrategy; parameter: string; baseline: number; min: number; max: number; integer: boolean }>;
  candidates: Candidate[];
  rules: {
    train: { minimumClosedTrades: 8; baselineActivityFraction: 0.5; minimumActiveFolds: 2; maximumDrawdownMultiple: 2; minimumDrawdownAllowance: 50000; requireFiniteExpectancy: true; requireFiniteExpectancyR: true; maximumShortlistPerStrategy: 5 };
    validation: { baselineActivityFraction: 0.5; minimumActiveFolds: 2; maximumDrawdownMultiple: 2; minimumDrawdownAllowance: 50000; requireFiniteExpectancy: true; requireFiniteExpectancyR: true; maximumNegativeExpectancyFolds: 2; requireNoWorseThanBaselineOnAtLeastTwoOf: ["expectancy", "expectancyR", "profitFactor", "netPnl", "maxDrawdown"]; onePass: true };
    breakdown: { minimumClosedTrades: 8; minimumActiveFolds: 2; objective: "ACTIVITY_ONLY"; validateOnlyAfterTrainActivity: true };
    pareto: { maximize: ["expectancy", "expectancyR", "profitFactor", "netPnl", "closedTrades", "activeFolds"]; minimize: ["maxDrawdown"]; tieBreak: "candidateId_ASC" };
    concentration: { hardGate: false; dimensions: ["instrument", "sector", "fold", "direction", "timeOfDay"] };
    execution: { canonicalCostModel: "8C-PAPER-EXECUTION-V1"; extraStress: false; requireCompleteSession: true };
  };
}

const keyFor: Record<OptimizationStrategy, keyof StrategyConfig> = {
  "breakout:v1": "breakout", "breakdown:v1": "breakdown", "momentum:v1": "momentum", "opening-momentum:v1": "openingMomentum"
};
const primes = [2, 3, 5, 7, 11, 13];

function radicalInverse(index: number, base: number) {
  let value = 0, factor = 1 / base, remaining = index;
  while (remaining > 0) { value += factor * (remaining % base); remaining = Math.floor(remaining / base); factor /= base; }
  return value;
}

function candidateFor(strategy: OptimizationStrategy, values: Record<string, number>, kind: Candidate["kind"]): Candidate {
  const configKey = keyFor[strategy];
  const candidateHash = researchContentHash({ version: CONTROLLED_OPTIMIZATION_VERSION, strategy, values }).slice(0, 16);
  return {
    variantId: `${strategy.replace(":v1", ":v2-candidate-")}${candidateHash}`,
    candidateHash, kind, strategy, parameter: "MULTIVARIATE", level: 0, value: 0,
    values, config: { [configKey]: values } as Partial<StrategyConfig>
  };
}

export function buildControlledOptimizationSpec(): OptimizationSpec {
  const robustness = buildRobustnessSpec();
  const baseline = getStrategyConfig();
  const bounds: OptimizationSpec["bounds"] = [];
  for (const strategy of [...ACTIVE_STRATEGIES, "breakdown:v1"] as OptimizationStrategy[]) {
    const key = keyFor[strategy];
    for (const definition of robustness.parameters.filter((item) => item.strategy === key)) {
      const integer = definition.kind === "integer/lookback";
      const min = integer ? Math.max(1, Math.floor(definition.baseline * 0.7)) : Number((definition.baseline * 0.7).toPrecision(12));
      const max = integer ? Math.max(min + 1, Math.ceil(definition.baseline * 1.3)) : Number((definition.baseline * 1.3).toPrecision(12));
      bounds.push({ strategy, parameter: definition.name, baseline: definition.baseline, min, max, integer });
    }
  }
  const candidates: Candidate[] = [];
  for (const strategy of ACTIVE_STRATEGIES) {
    const dimensions = bounds.filter((bound) => bound.strategy === strategy);
    for (let index = 1; index <= 64; index++) {
      const values = Object.fromEntries(dimensions.map((bound, dimension) => {
        const sample = radicalInverse(index + 17, primes[dimension]!);
        const raw = bound.min + sample * (bound.max - bound.min);
        return [bound.parameter, bound.integer ? Math.round(raw) : Number(raw.toPrecision(12))];
      }));
      candidates.push(candidateFor(strategy, values, "MULTIVARIATE"));
    }
  }
  // This small diagnostic design asks whether semantically valid bearish setups can trade.
  const breakdown = bounds.filter((bound) => bound.strategy === "breakdown:v1");
  for (let index = 0; index < 8; index++) {
    const values = Object.fromEntries(breakdown.map((bound) => [bound.parameter, index & (1 << (breakdown.indexOf(bound) % 3)) ? bound.max : bound.min]));
    candidates.push(candidateFor("breakdown:v1", values, "ACTIVITY_RECOVERY"));
  }
  if (new Set(candidates.map((candidate) => candidate.variantId)).size !== candidates.length) throw new Error("Controlled optimization candidate identities are not unique.");
  return {
    version: CONTROLLED_OPTIMIZATION_VERSION,
    source: { robustnessVersion: robustness.version, robustnessSpecHash: "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445", recoveredArtifactSha256: RECOVERED_8F2_SHA256, baselineRunId: robustness.baseline.runId, frozenIdentity: robustness.baseline },
    design: { algorithm: "HALTON_V1", deterministicSeed: 17, activeCandidateCount: 64, breakdownActivityCandidateCount: 8, batchSize: 8, maxWorkers: 2, partitions: { search: "TRAIN", selection: "VALIDATION", optimizedTestExecutions: 0 }, baselineIsCandidate: false },
    bounds, candidates,
    rules: {
      train: { minimumClosedTrades: 8, baselineActivityFraction: 0.5, minimumActiveFolds: 2, maximumDrawdownMultiple: 2, minimumDrawdownAllowance: 50000, requireFiniteExpectancy: true, requireFiniteExpectancyR: true, maximumShortlistPerStrategy: 5 },
      validation: { baselineActivityFraction: 0.5, minimumActiveFolds: 2, maximumDrawdownMultiple: 2, minimumDrawdownAllowance: 50000, requireFiniteExpectancy: true, requireFiniteExpectancyR: true, maximumNegativeExpectancyFolds: 2, requireNoWorseThanBaselineOnAtLeastTwoOf: ["expectancy", "expectancyR", "profitFactor", "netPnl", "maxDrawdown"], onePass: true },
      breakdown: { minimumClosedTrades: 8, minimumActiveFolds: 2, objective: "ACTIVITY_ONLY", validateOnlyAfterTrainActivity: true },
      pareto: { maximize: ["expectancy", "expectancyR", "profitFactor", "netPnl", "closedTrades", "activeFolds"], minimize: ["maxDrawdown"], tieBreak: "candidateId_ASC" },
      concentration: { hardGate: false, dimensions: ["instrument", "sector", "fold", "direction", "timeOfDay"] },
      execution: { canonicalCostModel: "8C-PAPER-EXECUTION-V1", extraStress: false, requireCompleteSession: true }
    }
  };
}

export function controlledOptimizationSpecHash(spec: OptimizationSpec) { return researchContentHash(spec); }
export function assertOptimizationPartition(stage: "SEARCH" | "SELECTION", partition: OptimizationStage) {
  if ((stage === "SEARCH" && partition !== "TRAIN") || (stage === "SELECTION" && partition !== "VALIDATION")) throw new Error(`Phase 8F.3 ${stage} cannot execute on ${partition}.`);
}

export interface CandidateFoldMetrics {
  candidateId: string;
  strategy: OptimizationStrategy;
  foldId: string;
  partition: "TRAIN" | "VALIDATION";
  closedTrades: number;
  grossPnl: number;
  grossProfit: number;
  grossLoss: number;
  charges: number;
  netPnl: number;
  expectancy: number | null;
  expectancyR: number | null;
  profitFactor: number | null;
  maxDrawdown: number;
  incompleteTrades: number;
  dataGapEvents: number;
}

export function aggregateCandidate(rows: CandidateFoldMetrics[]) {
  const closedTrades = rows.reduce((sum, row) => sum + row.closedTrades, 0);
  const netPnl = rows.reduce((sum, row) => sum + row.netPnl, 0);
  const weighted = (field: "expectancy" | "expectancyR") => closedTrades && rows.every((row) => row.closedTrades === 0 || row[field] != null && Number.isFinite(row[field]))
    ? rows.reduce((sum, row) => sum + (row[field] ?? 0) * row.closedTrades, 0) / closedTrades : null;
  const grossProfit = rows.reduce((sum, row) => sum + row.grossProfit, 0);
  const grossLoss = rows.reduce((sum, row) => sum + row.grossLoss, 0);
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? null : 0;
  return { closedTrades, activeFolds: rows.filter((row) => row.closedTrades > 0).length, grossPnl: rows.reduce((sum, row) => sum + row.grossPnl, 0), grossProfit, grossLoss, charges: rows.reduce((sum, row) => sum + row.charges, 0), netPnl, expectancy: weighted("expectancy"), expectancyR: weighted("expectancyR"), profitFactor, maxDrawdown: Math.max(0, ...rows.map((row) => row.maxDrawdown)), negativeExpectancyFolds: rows.filter((row) => row.expectancy != null && row.expectancy < 0).length };
}

export function trainEligibility(rows: CandidateFoldMetrics[], baseline: CandidateFoldMetrics[], spec: OptimizationSpec) {
  const reasons: string[] = [];
  const a = aggregateCandidate(rows), b = aggregateCandidate(baseline), rules = spec.rules.train;
  if (rows.length !== 4 || rows.some((row) => row.partition !== "TRAIN")) reasons.push("INCOMPLETE_TRAIN_FOLDS");
  if (a.closedTrades < Math.max(rules.minimumClosedTrades, Math.ceil(b.closedTrades * rules.baselineActivityFraction))) reasons.push("INSUFFICIENT_ACTIVITY");
  if (a.activeFolds < rules.minimumActiveFolds) reasons.push("INSUFFICIENT_FOLD_COVERAGE");
  if (a.maxDrawdown > Math.max(rules.minimumDrawdownAllowance, b.maxDrawdown * rules.maximumDrawdownMultiple)) reasons.push("DRAWDOWN_LIMIT");
  if (rows.some((row) => row.incompleteTrades > 0 || !Number.isFinite(row.netPnl))) reasons.push("EXECUTION_INVALID");
  if (a.expectancy == null || a.expectancyR == null || a.profitFactor == null) reasons.push("INVALID_METRICS");
  return { eligible: reasons.length === 0, reasons, metrics: a };
}

export function validationEligibility(rows: CandidateFoldMetrics[], baseline: CandidateFoldMetrics[], spec: OptimizationSpec) {
  const reasons: string[] = [];
  const a = aggregateCandidate(rows), b = aggregateCandidate(baseline), rules = spec.rules.validation;
  if (rows.length !== 4 || rows.some((row) => row.partition !== "VALIDATION")) reasons.push("INCOMPLETE_VALIDATION_FOLDS");
  if (a.closedTrades < Math.ceil(b.closedTrades * rules.baselineActivityFraction) || a.activeFolds < rules.minimumActiveFolds) reasons.push("ACTIVITY_COLLAPSE");
  if (a.maxDrawdown > Math.max(rules.minimumDrawdownAllowance, b.maxDrawdown * rules.maximumDrawdownMultiple)) reasons.push("DRAWDOWN_LIMIT");
  if (a.negativeExpectancyFolds > rules.maximumNegativeExpectancyFolds) reasons.push("FOLD_INCONSISTENCY");
  if (rows.some((row) => row.incompleteTrades > 0 || !Number.isFinite(row.netPnl))) reasons.push("EXECUTION_INVALID");
  if (a.expectancy == null || a.expectancyR == null || a.profitFactor == null) reasons.push("INVALID_METRICS");
  const noWorse = [a.expectancy != null && b.expectancy != null && a.expectancy >= b.expectancy, a.expectancyR != null && b.expectancyR != null && a.expectancyR >= b.expectancyR, a.profitFactor != null && b.profitFactor != null && a.profitFactor >= b.profitFactor, a.netPnl >= b.netPnl, a.maxDrawdown <= b.maxDrawdown].filter(Boolean).length;
  if (noWorse < 2) reasons.push("BASELINE_COMPARISON");
  return { eligible: reasons.length === 0, reasons, metrics: a, noWorseDimensions: noWorse };
}

export function paretoShortlist<T extends { candidateId: string; metrics: ReturnType<typeof aggregateCandidate> }>(items: T[], limit: number) {
  const dominates = (a: T, b: T) => {
    const fields = ["expectancy", "expectancyR", "profitFactor", "netPnl", "closedTrades", "activeFolds"] as const;
    const noWorse = fields.every((field) => (a.metrics[field] ?? -Infinity) >= (b.metrics[field] ?? -Infinity)) && a.metrics.maxDrawdown <= b.metrics.maxDrawdown;
    const better = fields.some((field) => (a.metrics[field] ?? -Infinity) > (b.metrics[field] ?? -Infinity)) || a.metrics.maxDrawdown < b.metrics.maxDrawdown;
    return noWorse && better;
  };
  const frontier = items.filter((item) => !items.some((other) => other !== item && dominates(other, item))).sort((a, b) => a.candidateId.localeCompare(b.candidateId));
  return frontier.slice(0, limit);
}
