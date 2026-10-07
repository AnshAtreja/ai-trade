import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import { generateWalkForwardFolds } from "./walk-forward";
import { adaptPhase8F2ClassificationMetrics, buildRobustnessSpec, executionConfigForScenario, parameterStatus, researchContentHash, robustnessSpecHash, type CostScenario, type ParameterVariant, type RobustnessSpec } from "./robustness";
import { loadFrozenBaselinePartitions, frozenBaselineArtifactPath } from "./robustness";
import { RESEARCH_PERIOD, researchUniverseInstruments } from "../../historical-market-data/research-universe";
import { RobustnessRuntime } from "./robustness-runtime";
import { verifyWorkerResult, type BatchIdentity } from "./robustness-durability";

let runtime: RobustnessRuntime | undefined;
const root = path.resolve(__dirname, "../../../../../..");
const apiRoot = path.join(root, "apps/api");

const STRATEGIES = ["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"] as const;
const PARAMETER_PARTITIONS = ["TRAIN", "VALIDATION"] as const;
const COST_SCENARIOS = ["C1", "C2", "S1", "S2", "CS1"] as const;
type ParameterPartition = typeof PARAMETER_PARTITIONS[number];

async function main() {
  const started = Date.now();
  const artifactRoot = path.resolve(root, "apps/artifacts/phase8f");
  const specPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as RobustnessSpec & { specHash: string };
  const computedHash = robustnessSpecHash(buildRobustnessSpec());
  if (spec.specHash !== computedHash || computedHash !== "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445") throw new Error("Frozen Phase 8F.2 spec hash mismatch.");
  const baselinePath = frozenBaselineArtifactPath(root);
  const baseline = JSON.parse(readFileSync(baselinePath, "utf8")) as { runId: string };
  if (baseline.runId !== "1fd46d5ef1f0e98f") throw new Error("Frozen Phase 8E run identity mismatch.");
  const checkpointRoot = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-checkpoints");
  const resultRoot = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-worker-results");
  mkdirSync(checkpointRoot, { recursive: true }); mkdirSync(resultRoot, { recursive: true });
  runtime = new RobustnessRuntime(path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.runtime.json"), spec.specHash, spec.baseline.runId);
  const folds = generateWalkForwardFolds(new Date(RESEARCH_PERIOD.from), new Date(RESEARCH_PERIOD.to));
  const tokens = researchUniverseInstruments.map((instrument) => instrument.instrumentToken);
  const nonBaseline = spec.parameterVariants.filter((variant) => variant.level !== 0).sort((a, b) => a.variantId.localeCompare(b.variantId));
  const parameterPlan = STRATEGIES.flatMap((strategy) => folds.flatMap((fold) => PARAMETER_PARTITIONS.flatMap((partition) => {
    const variants = nonBaseline.filter((variant) => variant.strategy === strategy);
    return chunk(variants, 8).map((batch, index) => ({ kind: "PARAMETER" as const, strategy, fold, partition, batch, ordinal: index + 1 }));
  })));
  const costPlan = STRATEGIES.flatMap((strategy) => folds.flatMap((fold) => COST_SCENARIOS.map((scenario) => ({ kind: "COST" as const, strategy, fold, scenario }))));
  const parameterStart = Date.now();
  const parameterResults: string[] = [];
  const maxWorkers = 2;
  let parameterWorkersLaunched = 0;
  let parameterWorkersCompleted = 0;
  const completedParameterResults = await runConcurrent(parameterPlan, maxWorkers, async (item) => {
    const batchIds = item.batch.map((variant) => variant.variantId);
    const existing = findCompletedCheckpoint(checkpointRoot, spec.specHash, item.strategy, item.fold.foldId, item.partition, batchIds, "PARAMETER");
    if (existing) { process.stdout.write(JSON.stringify({ type: "phase8f2_resume", category: "PARAMETER", strategy: item.strategy, fold: item.fold.foldId, partition: item.partition, variantIds: batchIds, resultPath: existing.resultPath }) + "\n"); return existing.resultPath; }
    parameterWorkersLaunched += 1;
    const batchKey = shortHash(batchIds.join("\0"));
    const outputPath = path.join(resultRoot, `parameter-${slug(item.strategy)}-${item.fold.foldId}-${item.partition}-${batchKey}.json`);
    const requestPath = path.join(resultRoot, `parameter-request-${slug(item.strategy)}-${item.fold.foldId}-${item.partition}-${batchKey}.json`);
    const request = { specPath, outputPath, specHash: spec.specHash, baselineRunId: spec.baseline.runId, strategy: item.strategy, foldId: item.fold.foldId, partition: item.partition, from: item.fold[item.partition.toLowerCase() as "train" | "validation"].from, to: item.fold[item.partition.toLowerCase() as "train" | "validation"].to, interval: "1m", variantIds: batchIds, batchSize: item.batch.length };
    writeFileSync(requestPath, JSON.stringify(request, null, 2), { mode: 0o600 });
    const identity: BatchIdentity = { specHash: spec.specHash, baselineRunId: spec.baseline.runId, category: "PARAMETER", strategy: item.strategy, foldId: item.fold.foldId, partition: item.partition, variantIds: batchIds };
    if (isValidOrphan(outputPath, identity)) {
      process.stdout.write(JSON.stringify({ type: "phase8f2_recovered_result", ...identity, outputPath }) + "\n");
    } else {
      await runtime!.runChild("src/modules/scanner/replay/robustness-worker.ts", requestPath, { category: "PARAMETER", strategy: item.strategy, fold: item.fold.foldId, partition: item.partition, variantIds: batchIds }, apiRoot);
    }
    const resultSha256 = verifyWorkerResult(outputPath, identity);
    const checkpointPath = path.join(checkpointRoot, `parameter-${slug(item.strategy)}-${item.fold.foldId}-${item.partition}-${batchKey}.checkpoint.json`);
    const checkpoint = { format: "8F2-FULL-PARAMETER-1", ...identity, resultPath: outputPath, resultSha256 };
    atomicJson(checkpointPath, checkpoint);
    verifyCheckpoint(checkpointPath, spec.specHash, batchIds, outputPath);
    parameterWorkersCompleted += 1;
    process.stdout.write(JSON.stringify({ type: "phase8f2_complete", category: "PARAMETER", strategy: item.strategy, fold: item.fold.foldId, partition: item.partition, variantIds: batchIds, checkpointPath, resultPath: outputPath }) + "\n");
    return outputPath;
  });
  parameterResults.push(...completedParameterResults);
  const parameterRuntimeMs = Date.now() - parameterStart;
  const costStart = Date.now();
  const costResults: Array<{ strategy: string; scenario: string; resultPath: string }> = [];
  let costWorkersLaunched = 0;
  let costWorkersCompleted = 0;
  const frozen = loadFrozenBaselinePartitions(baselinePath);
  const completedCostResults = await runConcurrent(costPlan, maxWorkers, async (item) => {
    const existing = findCompletedCheckpoint(checkpointRoot, spec.specHash, item.strategy, item.fold.foldId, "TEST", [item.scenario], "COST");
    if (existing) { process.stdout.write(JSON.stringify({ type: "phase8f2_resume", category: "COST", strategy: item.strategy, fold: item.fold.foldId, scenario: item.scenario, resultPath: existing.resultPath }) + "\n"); return { strategy: item.strategy, scenario: item.scenario, resultPath: existing.resultPath }; }
    costWorkersLaunched += 1;
    const outputPath = path.join(resultRoot, `cost-${slug(item.strategy)}-${item.fold.foldId}-${item.scenario}.json`);
    const requestPath = path.join(resultRoot, `cost-request-${slug(item.strategy)}-${item.fold.foldId}-${item.scenario}.json`);
    const request = { specPath, outputPath, specHash: spec.specHash, baselineRunId: spec.baseline.runId, strategy: item.strategy, scenario: item.scenario, from: item.fold.test.from, to: item.fold.test.to, interval: "1m" };
    writeFileSync(requestPath, JSON.stringify(request, null, 2), { mode: 0o600 });
    const identity: BatchIdentity = { specHash: spec.specHash, baselineRunId: spec.baseline.runId, category: "COST", strategy: item.strategy, foldId: item.fold.foldId, partition: "TEST", scenario: item.scenario, from: item.fold.test.from, to: item.fold.test.to };
    if (!isValidOrphan(outputPath, identity)) await runtime!.runChild("src/modules/scanner/replay/robustness-cost-worker.ts", requestPath, { category: "COST", strategy: item.strategy, fold: item.fold.foldId, scenario: item.scenario }, apiRoot);
    const resultSha256 = verifyWorkerResult(outputPath, identity);
    const checkpointPath = path.join(checkpointRoot, `cost-${slug(item.strategy)}-${item.fold.foldId}-${item.scenario}.full.checkpoint.json`);
    const checkpoint = { format: "8F2-FULL-COST-1", ...identity, resultPath: outputPath, resultSha256 };
    atomicJson(checkpointPath, checkpoint); verifyCheckpoint(checkpointPath, spec.specHash, [item.scenario], outputPath);
    costWorkersCompleted += 1;
    process.stdout.write(JSON.stringify({ type: "phase8f2_complete", category: "COST", strategy: item.strategy, fold: item.fold.foldId, scenario: item.scenario, checkpointPath, resultPath: outputPath }) + "\n");
    return { strategy: item.strategy, scenario: item.scenario, resultPath: outputPath };
  });
  costResults.push(...completedCostResults);
  const costRuntimeMs = Date.now() - costStart;
  const final = buildFinalArtifact({ spec, specPath, baselinePath, baseline, parameterResults, costResults, frozen, parameterPlan, costPlan, parameterRuntimeMs, costRuntimeMs, parameterWorkersLaunched, parameterWorkersCompleted, costWorkersLaunched, costWorkersCompleted, totalRuntimeMs: Date.now() - started, tokens });
  if (final.json.counts.parameterLogicalResults !== 768 || final.json.counts.costScenarioPartitions !== 96 || final.json.counts.perturbedTestExecutions !== 0) throw new Error("Final robustness completeness/leakage gate failed.");
  const jsonPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.json");
  atomicJson(jsonPath, final.json);
  const mdPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.md");
  const temporary = `${mdPath}.tmp`; writeFileSync(temporary, final.markdown, { mode: 0o600 }); renameSync(temporary, mdPath);
  process.stdout.write(JSON.stringify({ status: "COMPLETE", jsonPath, mdPath, parameterResults: final.json.parameterResults.length, costResults: final.json.costResults.length, parameterWorkers: parameterPlan.length, costWorkers: costPlan.length, specHash: spec.specHash }, null, 2) + "\n");
}

function chunk<T>(items: T[], size: number) { const batches: T[][] = []; for (let i = 0; i < items.length; i += size) batches.push(items.slice(i, i + size)); return batches; }
async function runConcurrent<T, R>(items: T[], concurrency: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: unknown;
  async function worker() {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try { results[index] = await task(items[index]); }
      catch (error) { failure = error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failure) throw failure;
  return results;
}
function slug(value: string) { return value.replace(/:/g, "-"); }
function shortHash(value: string) { return createHash("sha256").update(value).digest("hex").slice(0, 16); }
function atomicJson(filePath: string, value: unknown) { mkdirSync(path.dirname(filePath), { recursive: true }); const temporary = `${filePath}.tmp`; writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 }); renameSync(temporary, filePath); }
function verifyCheckpoint(filePath: string, specHash: string, ids: string[], resultPath: string) { const checkpoint = JSON.parse(readFileSync(filePath, "utf8")) as { specHash?: string; variantIds?: string[]; scenario?: string; resultPath?: string }; if (checkpoint.specHash !== specHash || !existsSync(resultPath) || checkpoint.resultPath !== resultPath || !ids.every((id) => (checkpoint.variantIds ?? [checkpoint.scenario]).includes(id))) throw new Error(`Checkpoint verification failed: ${filePath}`); }
function findCompletedCheckpoint(root: string, specHash: string, strategy: string, foldId: string, partition: string, ids: string[], category: "PARAMETER" | "COST") {
  for (const name of readdirSync(root).filter((item) => item.endsWith(".json") && !item.endsWith(".tmp"))) {
    try {
      const filePath = path.join(root, name); const checkpoint = JSON.parse(readFileSync(filePath, "utf8")) as { specHash?: string; baselineRunId?: string; category?: string; strategy?: string; foldId?: string; partition?: string; variantIds?: string[]; completedVariantIds?: string[]; scenario?: string; resultPath?: string };
      const completed = checkpoint.variantIds ?? checkpoint.completedVariantIds ?? (checkpoint.scenario ? [checkpoint.scenario] : []);
      if (checkpoint.specHash !== specHash || checkpoint.baselineRunId !== "1fd46d5ef1f0e98f" || checkpoint.category && checkpoint.category !== category || checkpoint.strategy !== strategy || checkpoint.foldId !== foldId || checkpoint.partition !== partition || completed.length !== ids.length || !ids.every((id) => completed.includes(id)) || !checkpoint.resultPath || !existsSync(checkpoint.resultPath)) continue;
      const fold = generateWalkForwardFolds(new Date(RESEARCH_PERIOD.from), new Date(RESEARCH_PERIOD.to)).find(item => item.foldId === foldId)!;
      verifyWorkerResult(checkpoint.resultPath, { specHash, baselineRunId: checkpoint.baselineRunId, category, strategy, foldId, partition, variantIds: ids, scenario: ids[0], from: fold.test.from, to: fold.test.to });
      return { resultPath: checkpoint.resultPath };
    } catch { /* ignore unrelated or incomplete artifacts */ }
  }
  return null;
}
function isValidOrphan(file: string, identity: BatchIdentity) {
  if (!existsSync(file)) return false;
  try { verifyWorkerResult(file, identity); return true; }
  catch (error) { process.stderr.write(`${String(error)}; result will be recomputed.\n`); return false; }
}

function buildFinalArtifact(input: { spec: RobustnessSpec & { specHash: string }; specPath: string; baselinePath: string; baseline: { runId: string }; parameterResults: string[]; costResults: Array<{ strategy: string; scenario: string; resultPath: string }>; frozen: ReturnType<typeof loadFrozenBaselinePartitions>; parameterPlan: unknown[]; costPlan: unknown[]; parameterRuntimeMs: number; costRuntimeMs: number; parameterWorkersLaunched: number; parameterWorkersCompleted: number; costWorkersLaunched: number; costWorkersCompleted: number; totalRuntimeMs: number; tokens: string[] }) {
  const variantMap = new Map(input.spec.parameterVariants.map((variant) => [variant.variantId, variant]));
  const parameterResults = input.parameterResults.flatMap((filePath) => { const result = JSON.parse(readFileSync(filePath, "utf8")) as { format: string; variantIds: string[]; strategy: string; foldId: string; partition: string; candles: number; scannerEvaluations: number; variantStrategyEvaluations: number; elapsedMs: number; results: Array<{ variantId: string; metrics: unknown; dataGapEvents: number }> }; return result.results.map((row) => ({ ...row, variant: variantMap.get(row.variantId), sourcePath: filePath, candles: result.candles, scannerEvaluations: result.scannerEvaluations, variantFrameEvaluations: result.variantStrategyEvaluations, workerElapsedMs: result.elapsedMs })); });
  const c0 = input.frozen.filter((row) => row.partition === "TEST").map((row) => ({ strategy: row.strategy, scenario: "C0", foldId: row.foldId, partition: row.partition, metrics: row.metrics, source: "BASELINE_REUSED_FROM_PHASE_8E" }));
  const costResults = [...c0, ...input.costResults.flatMap(({ strategy, scenario, resultPath }) => { const result = JSON.parse(readFileSync(resultPath, "utf8")) as { partitions: Array<{ foldId: string; partition: string; metrics: unknown; diagnostics: unknown }> }; return result.partitions.map((partition) => ({ strategy, scenario, foldId: partition.foldId, partition: partition.partition, metrics: partition.metrics, diagnostics: partition.diagnostics, source: resultPath })); })];
  const parameterTestExecutions = parameterResults.filter((row) => (row as { partition?: string }).partition === "TEST").length;
  const combinedExperiments = 0;
  const parameterClassifications = input.spec.parameters.map((parameter) => {
    const sourceRows = parameterResults.filter((row) => row.variant?.parameter === parameter.name && row.variant?.strategy === strategyVersion(parameter.strategy));
    try {
      const rows = sourceRows.map((row) => ({ metrics: adaptPhase8F2ClassificationMetrics((row as { classificationMetrics?: unknown }).classificationMetrics) }));
      return { strategy: strategyVersion(parameter.strategy), parameter: parameter.name, status: parameterStatus(rows), reason: null };
    } catch (error) {
      return { strategy: strategyVersion(parameter.strategy), parameter: parameter.name, status: "INVALID_CLASSIFICATION_INPUT_SCHEMA", reason: error instanceof Error ? error.message : String(error) };
    }
  });
  const researchContent = { format: "8F2-ROBUSTNESS-RESEARCH-CONTENT-2", specVersion: input.spec.version, specHash: input.spec.specHash, baselineRunId: input.baseline.runId, baselineResultSha256: input.spec.baseline.resultSha256, frozenIdentity: input.spec.baseline, parameterResults, costResults, parameterClassifications, counts: { parameterLogicalResults: parameterResults.length, expectedParameterLogicalResults: 768, costScenarioPartitions: costResults.length, expectedCostScenarioPartitions: 96, parameterTestExecutions, combinedParameterCostExperiments: combinedExperiments, perturbedTestExecutions: parameterTestExecutions }, limitations: ["Worker-level DB query counters are not emitted by the existing service instrumentation.", "Parameter robustness is descriptive sensitivity evidence, not optimization or selection."], noLeakageAudit: { perturbedTestExecutions: parameterTestExecutions, parameterCostCombinations: combinedExperiments, costScenariosUseFrozenParameters: true }, artifacts: { specPath: input.specPath, baselinePath: input.baselinePath } };
  const json = { ...researchContent, researchContentSha256: researchContentHash(researchContent), operationalTelemetry: { finalAssemblyRuntimeMs: input.totalRuntimeMs, parameterAssemblyRuntimeMs: input.parameterRuntimeMs, costAssemblyRuntimeMs: input.costRuntimeMs, workersPlanned: { parameter: input.parameterPlan.length, cost: input.costPlan.length }, workersLaunchedThisInvocation: { parameter: input.parameterWorkersLaunched, cost: input.costWorkersLaunched }, workersCompletedThisInvocation: { parameter: input.parameterWorkersCompleted, cost: input.costWorkersCompleted }, resumeCountThisInvocation: input.parameterPlan.length - input.parameterWorkersLaunched, cumulativeWallTime: "CUMULATIVE_WALL_TIME_NOT_RELIABLY_RECONSTRUCTABLE" } };
  const markdown = renderMarkdown(json);
  return { json, markdown };
}
function strategyVersion(strategy: string) { return strategy === "openingMomentum" ? "opening-momentum:v1" : `${strategy}:v1`; }
function renderMarkdown(json: any) { const lines: string[] = [`# Phase 8F.2 Robustness & Sensitivity Experiment`, ``, `**Status:** COMPLETE`, ``, `- Spec: \`${json.specVersion}\``, `- Spec hash: \`${json.specHash}\``, `- Baseline run: \`${json.baselineRunId}\``, `- Research-content SHA-256: \`${json.researchContentSha256}\``, `- Parameter logical results: ${json.counts.parameterLogicalResults}/${json.counts.expectedParameterLogicalResults}`, `- Cost scenario partitions: ${json.counts.costScenarioPartitions}/${json.counts.expectedCostScenarioPartitions}`, `- Perturbed TEST executions: ${json.counts.perturbedTestExecutions}`, `- Parameter × cost combinations: ${json.counts.combinedParameterCostExperiments}`, ``, `## Frozen identity`, ``, `- Universe: \`${json.frozenIdentity.universeManifestId}\``, `- Calendar: \`${json.frozenIdentity.calendarVersion}\``, `- CAS: \`${json.frozenIdentity.casEligibilityVersion}\``, `- 1m dataset: \`${json.frozenIdentity.datasetIds["1m"]}\``, `- 5m dataset: \`${json.frozenIdentity.datasetIds["5m"]}\``, `- Execution: \`${json.frozenIdentity.executionVersion}\``, ``, `## Parameter classifications`, ``]; for (const row of json.parameterClassifications) lines.push(`- ${row.strategy} / ${row.parameter}: **${row.status}**${row.reason ? ` — ${row.reason}` : ""}`); lines.push(``, `## Cost results`, ``, `Raw cost rows are retained in the JSON artifact in frozen scenario order (C0, C1, C2, S1, S2, CS1). No strategy is ranked or selected.`, ``, `## Final assembly telemetry`, ``, `- Final assembly runtime: ${json.operationalTelemetry.finalAssemblyRuntimeMs} ms`, `- Workers launched this invocation: parameter ${json.operationalTelemetry.workersLaunchedThisInvocation.parameter}, cost ${json.operationalTelemetry.workersLaunchedThisInvocation.cost}`, `- Cumulative wall time: ${json.operationalTelemetry.cumulativeWallTime}`, ``, `## Limitations`, ``, ...json.limitations.map((item: string) => `- ${item}`)); return lines.join("\n") + "\n"; }
void main().then(() => runtime?.finish()).catch((error) => { runtime?.finish(error); console.error(error instanceof Error ? error.message : error); process.exitCode = 1; });
