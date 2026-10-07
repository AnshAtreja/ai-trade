import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { disconnectPrisma } from "../../../db/prisma";
import { researchUniverseInstruments, RESEARCH_PERIOD } from "../../historical-market-data/research-universe";
import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import { generateWalkForwardFolds } from "./walk-forward";
import { frozenBaselineArtifactPath, researchContentHash, runSharedParameterBatch, type ParameterVariant } from "./robustness";
import { atomicResearchJson } from "./robustness-durability";
import { RobustnessRuntime } from "./robustness-runtime";
import { evaluateOptimizationRequest, verifyOptimizationCheckpoint, verifyOptimizationWorkerResult, type OptimizationWorkerRequest } from "./controlled-optimization-worker";
import { ACTIVE_STRATEGIES, RECOVERED_8F2_SHA256, aggregateCandidate, assertOptimizationPartition, buildControlledOptimizationSpec, controlledOptimizationSpecHash, paretoShortlist, trainEligibility, validationEligibility, type Candidate, type CandidateFoldMetrics, type OptimizationSpec, type OptimizationStrategy } from "./controlled-optimization";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import { diagnoseBreakdownTrain } from "./controlled-optimization-diagnostic";

const root = path.resolve(__dirname, "../../../../../..");
const apiRoot = path.join(root, "apps/api");
const artifactRoot = path.join(root, "apps/artifacts/phase8f");
const name = "controlled-optimization-1fd46d5ef1f0e98f-v1";
const specPath = path.join(artifactRoot, `${name}.spec.json`);
const sourcePath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-classification-recovered.json");
const baselinePath = frozenBaselineArtifactPath(root);
const folds = generateWalkForwardFolds(new Date(RESEARCH_PERIOD.from), new Date(RESEARCH_PERIOD.to));

type ResultRow = CandidateFoldMetrics & { candidateHash?: string; setups?: number; orders?: number; fills?: number; byInstrument?: unknown[]; byDirection?: unknown[]; dailyReturns?: unknown[]; sharpe?: number | null; sortino?: number | null; timeOfDay?: unknown[] };
type BaselinePartition = { strategy: string; foldId: string; partition: string; metrics: Record<string, number | null>; analytics: { pnl: { grossProfit: number; grossLoss: number }; drawdown: { maxDrawdownAmount: number } } };

function sha256(file: string) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function readJson<T>(file: string): T { return JSON.parse(readFileSync(file, "utf8")) as T; }
function identity() {
  if (sha256(sourcePath) !== RECOVERED_8F2_SHA256) throw new Error("Recovered Phase 8F.2 artifact has changed.");
  const baseline = readJson<{ runId: string; metadata: { datasetIds: Record<string, string>; calendarVersion: string; casEligibilityVersion: string; universeManifestId: string }; partitions: BaselinePartition[] }>(baselinePath);
  const spec = buildControlledOptimizationSpec();
  if (baseline.runId !== spec.source.baselineRunId || sha256(baselinePath) !== spec.source.frozenIdentity.resultSha256 || baseline.metadata.datasetIds["1m"] !== spec.source.frozenIdentity.datasetIds["1m"] || baseline.metadata.calendarVersion !== spec.source.frozenIdentity.calendarVersion || baseline.metadata.casEligibilityVersion !== spec.source.frozenIdentity.casEligibilityVersion || baseline.metadata.universeManifestId !== spec.source.frozenIdentity.universeManifestId) throw new Error("Frozen Phase 8E identity mismatch.");
  return { spec, baseline };
}

function freezeSpec() {
  const { spec } = identity();
  const specHash = controlledOptimizationSpecHash(spec);
  if (existsSync(specPath)) {
    const persisted = readJson<OptimizationSpec & { specHash: string }>(specPath);
    if (persisted.specHash !== specHash || controlledOptimizationSpecHash(stripHash(persisted)) !== specHash) throw new Error("Phase 8F.3 spec is already frozen with different content.");
  } else {
    atomicResearchJson(specPath, { ...spec, specHash });
  }
  const markdownPath = specPath.replace(/\.json$/, ".md");
  if (!existsSync(markdownPath)) {
    const markdown = [`# Phase 8F.3 Controlled Optimization V1`, ``, `Spec hash: \`${specHash}\``, `Source Phase 8F.2 SHA-256: \`${spec.source.recoveredArtifactSha256}\``, `Baseline run: \`${spec.source.baselineRunId}\``, ``, `64 Halton-designed multivariate candidates per active strategy; 8 breakdown activity candidates. All four TRAIN folds precede a frozen shortlist of at most five per strategy. The shortlist receives one VALIDATION pass. Optimized TEST executions are forbidden.`, ``, `TRAIN eligibility: ${JSON.stringify(spec.rules.train)}`, ``, `VALIDATION eligibility: ${JSON.stringify(spec.rules.validation)}`, ``, `Pareto and tie break: ${JSON.stringify(spec.rules.pareto)}`, ``, `No parameter or execution change is deployed by this research.`].join("\n") + "\n";
    writeFileSync(`${markdownPath}.${process.pid}.tmp`, markdown, { mode: 0o600 });
    renameSync(`${markdownPath}.${process.pid}.tmp`, markdownPath);
  }
  return { spec, specHash };
}

function stripHash(value: OptimizationSpec & { specHash: string }): OptimizationSpec { const { specHash: _, ...spec } = value; return spec; }

function loadSpec() {
  const { spec: current } = identity();
  const persisted = readJson<OptimizationSpec & { specHash: string }>(specPath);
  if (persisted.specHash !== controlledOptimizationSpecHash(current) || persisted.specHash !== controlledOptimizationSpecHash(stripHash(persisted))) throw new Error("Frozen Phase 8F.3 specification mismatch.");
  return { spec: stripHash(persisted), specHash: persisted.specHash };
}

function baselineRows(partitions: BaselinePartition[], strategy: OptimizationStrategy, partition: "TRAIN" | "VALIDATION"): CandidateFoldMetrics[] {
  return partitions.filter((item) => item.strategy === strategy && item.partition === partition).map((item) => ({
    candidateId: `${strategy}:frozen-v1`, strategy, foldId: item.foldId, partition,
    closedTrades: item.metrics.closedTrades ?? 0, grossPnl: item.metrics.grossPnl ?? 0,
    grossProfit: item.analytics.pnl.grossProfit, grossLoss: item.analytics.pnl.grossLoss,
    charges: item.metrics.charges ?? 0, netPnl: item.metrics.netPnl ?? 0,
    expectancy: item.metrics.expectancy ?? null, expectancyR: item.metrics.expectancyR ?? null,
    profitFactor: item.metrics.profitFactor ?? null, maxDrawdown: item.analytics.drawdown.maxDrawdownAmount,
    incompleteTrades: item.metrics.incompleteTrades ?? 0, dataGapEvents: 0
  }));
}

function planFor(stage: "SEARCH" | "SELECTION", candidates: Candidate[], spec: OptimizationSpec) {
  const partition: "TRAIN" | "VALIDATION" = stage === "SEARCH" ? "TRAIN" : "VALIDATION";
  return [...ACTIVE_STRATEGIES, "breakdown:v1"].flatMap((strategy) => folds.flatMap((fold) => {
    const selected = candidates.filter((candidate) => candidate.strategy === strategy);
    const batches: Candidate[][] = [];
    for (let index = 0; index < selected.length; index += spec.design.batchSize) batches.push(selected.slice(index, index + spec.design.batchSize));
    return batches.map((batch) => ({ strategy: strategy as OptimizationStrategy, fold, partition, batch }));
  }));
}

function paths(request: OptimizationWorkerRequest) {
  const key = researchContentHash({ specHash: request.specHash, stage: request.stage, strategy: request.strategy, foldId: request.foldId, partition: request.partition, from: request.from, to: request.to, candidateIds: request.candidateIds }).slice(0, 16);
  const prefix = `${request.stage.toLowerCase()}-${request.strategy.replace(":", "-")}-${request.foldId}-${key}`;
  return { result: path.join(artifactRoot, `${name}-workers`, `${prefix}.json`), checkpoint: path.join(artifactRoot, `${name}-checkpoints`, `${prefix}.checkpoint.json`), request: path.join(artifactRoot, `${name}-requests`, `${prefix}.json`) };
}

function verifiedResult(request: OptimizationWorkerRequest) {
  const output = paths(request);
  if (!existsSync(output.result)) return null;
  const result = verifyOptimizationWorkerResult(readJson(output.result), request);
  if (existsSync(output.checkpoint)) {
    verifyOptimizationCheckpoint(readJson(output.checkpoint), request, sha256(output.result));
  }
  return { result, output };
}

async function runStage(stage: "SEARCH" | "SELECTION", candidates: Candidate[], spec: OptimizationSpec, specHash: string, runtime: RobustnessRuntime) {
  const plan = planFor(stage, candidates, spec);
  let launched = 0, resumed = 0;
  const outputs = await runConcurrent(plan, spec.design.maxWorkers, async (item) => {
    assertOptimizationPartition(stage, item.partition);
    const range = item.partition === "TRAIN" ? item.fold.train : item.fold.validation;
    const request: OptimizationWorkerRequest = { specPath, outputPath: "", specHash, stage, strategy: item.strategy, foldId: item.fold.foldId, partition: item.partition, from: range.from, to: range.to, interval: "1m", candidateIds: item.batch.map((candidate) => candidate.variantId) };
    const output = paths(request); request.outputPath = output.result;
    let existing = verifiedResult(request);
    if (!existing) {
      atomicResearchJson(output.request, request);
      launched++;
      await runtime.runChild("src/modules/scanner/replay/controlled-optimization-worker.ts", output.request, { stage, strategy: request.strategy, fold: request.foldId, partition: request.partition, candidateIds: request.candidateIds }, apiRoot);
      existing = verifiedResult(request);
      if (!existing) throw new Error(`Worker did not write a valid result: ${output.result}`);
    } else resumed++;
    if (!existsSync(output.checkpoint)) atomicResearchJson(output.checkpoint, { format: "8F3-BATCH-CHECKPOINT-1", specHash, stage, strategy: request.strategy, foldId: request.foldId, partition: request.partition, candidateIds: request.candidateIds, resultPath: output.result, resultSha256: sha256(output.result) });
    if (!verifiedResult(request)) throw new Error("Checkpoint verification failed.");
    process.stdout.write(JSON.stringify({ type: "phase8f3_batch_complete", stage, strategy: request.strategy, fold: request.foldId, candidates: request.candidateIds.length, resumed, launched, planned: plan.length }) + "\n");
    return existing.result;
  });
  const rows = outputs.flatMap((output) => output.rows as ResultRow[]);
  if (new Set(rows.map((row) => `${row.partition}|${row.foldId}|${row.candidateId}`)).size !== rows.length || rows.length !== plan.reduce((total, item) => total + item.batch.length, 0)) throw new Error(`Incomplete ${stage} result matrix.`);
  return { rows, launched, resumed, planned: plan.length };
}

async function runConcurrent<T, R>(items: T[], limit: number, task: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  let failure: unknown;
  await Promise.all(Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (!failure && next < items.length) {
      const index = next++;
      try { results[index] = await task(items[index]!); } catch (error) { failure = error; }
    }
  }));
  if (failure) throw failure;
  return results;
}

function freezeTrain(spec: OptimizationSpec, specHash: string, train: Awaited<ReturnType<typeof runStage>>, baseline: BaselinePartition[]) {
  const trainPath = path.join(artifactRoot, `${name}.train.json`);
  const content = { format: "8F3-TRAIN-1", specHash, source8f2Sha256: RECOVERED_8F2_SHA256, rows: train.rows, counts: { executions: train.rows.length, candidates: spec.candidates.length, folds: folds.length } };
  const researchContentSha256 = researchContentHash(content);
  if (existsSync(trainPath) && readJson<{ researchContentSha256: string }>(trainPath).researchContentSha256 !== researchContentSha256) throw new Error("TRAIN artifact differs from frozen result.");
  if (!existsSync(trainPath)) atomicResearchJson(trainPath, { ...content, researchContentSha256 });
  const decisions = spec.candidates.map((candidate) => {
    const rows = train.rows.filter((row) => row.candidateId === candidate.variantId);
    const frozen = baselineRows(baseline, candidate.strategy as OptimizationStrategy, "TRAIN");
    const eligibility = candidate.kind === "ACTIVITY_RECOVERY"
      ? { eligible: aggregateCandidate(rows).closedTrades >= spec.rules.breakdown.minimumClosedTrades && aggregateCandidate(rows).activeFolds >= spec.rules.breakdown.minimumActiveFolds, reasons: ["ACTIVITY_DIAGNOSTIC"], metrics: aggregateCandidate(rows) }
      : trainEligibility(rows, frozen, spec);
    return { candidateId: candidate.variantId, candidateHash: candidate.candidateHash, strategy: candidate.strategy, values: candidate.values, ...eligibility };
  });
  const shortlist = [...ACTIVE_STRATEGIES, "breakdown:v1"].flatMap((strategy) => {
    const eligible = decisions.filter((decision) => decision.strategy === strategy && decision.eligible);
    return strategy === "breakdown:v1" ? eligible.slice(0, 2) : paretoShortlist(eligible, spec.rules.train.maximumShortlistPerStrategy);
  });
  const shortlistPath = path.join(artifactRoot, `${name}.shortlist.json`);
  const frozenContent = { format: "8F3-FROZEN-SHORTLIST-1", specHash, trainResearchContentSha256: researchContentSha256, decisions, shortlist, baselineComparison: "FROZEN_V1_REFERENCE_ONLY" };
  const shortlistHash = researchContentHash(frozenContent);
  if (existsSync(shortlistPath) && readJson<{ researchContentSha256: string }>(shortlistPath).researchContentSha256 !== shortlistHash) throw new Error("Frozen shortlist differs from current TRAIN evidence.");
  if (!existsSync(shortlistPath)) atomicResearchJson(shortlistPath, { ...frozenContent, researchContentSha256: shortlistHash });
  return { trainPath, shortlistPath, shortlist, decisions, trainHash: researchContentSha256, shortlistHash };
}

async function proof() {
  const { spec, specHash } = loadSpec();
  const variants = spec.candidates.filter((candidate) => candidate.strategy === "breakout:v1").slice(0, 2);
  const from = "2026-09-15T03:45:00.000Z", to = "2026-09-16T03:45:00.000Z";
  const tokens = researchUniverseInstruments.slice(0, 2).map((item) => item.instrumentToken);
  const request: OptimizationWorkerRequest = { specPath, outputPath: "", specHash, stage: "SEARCH", strategy: "breakout:v1", foldId: "proof", partition: "TRAIN", from, to, interval: "1m", candidateIds: variants.map((candidate) => candidate.variantId), proof: { tokens } };
  const together = await evaluateOptimizationRequest(request, spec);
  const separate = await Promise.all(variants.map((candidate) => evaluateOptimizationRequest({ ...request, candidateIds: [candidate.variantId] }, spec)));
  const rowsEqual = together.rows.every((row: ResultRow, index: number) => researchContentHash(row) === researchContentHash(separate[index]!.rows[0]));
  if (!rowsEqual) throw new Error("Shared and isolated candidate results differ on bounded proof.");
  const service = getHistoricalMarketDataService();
  const views = await Promise.all(tokens.map((instrumentToken) => service.getResearchCandles({ instrumentToken, interval: "1m", from, to, requireCompleteSession: true })));
  const baseline = { variantId: "baseline-proof", strategy: "breakout:v1", parameter: "BASELINE", level: 0, value: 0, config: {} } as ParameterVariant;
  const original = await runSharedParameterBatch({ candles: views.flatMap((view) => view.candles), tokens, from, to, interval: "1m", strategyId: "breakout:v1", variants: [baseline], sessionPolicy: new NseCashInstrumentSessionPolicy() });
  if (!original.get(baseline.variantId)?.execution.summary.classificationMetrics) throw new Error("Baseline proof lacks canonical classification metrics.");
  assertOptimizationPartition("SEARCH", "TRAIN");
  assertOptimizationPartition("SELECTION", "VALIDATION");
  let rejected = false; try { assertOptimizationPartition("SEARCH", "TEST"); } catch { rejected = true; }
  if (!rejected) throw new Error("TEST partition assertion failed.");
  const proofContent = { format: "8F3-BOUNDED-PROOF-1", specHash, candles: together.candles, candidateIds: request.candidateIds, sharedVsIsolated: "PASS", baselineMetricsPresent: true, hardTestRejection: true, source8f2Sha256: RECOVERED_8F2_SHA256 };
  const proofPath = path.join(artifactRoot, `${name}.proof.json`);
  atomicResearchJson(proofPath, { ...proofContent, researchContentSha256: researchContentHash(proofContent) });
  process.stdout.write(JSON.stringify({ status: "PROOF_PASS", proofPath, ...proofContent }, null, 2) + "\n");
}

async function diagnose() {
  const { specHash } = loadSpec();
  const funnel = await diagnoseBreakdownTrain("2025-09-18T03:45:00.000Z", "2025-09-19T03:45:00.000Z");
  const content = { format: "8F3-BREAKDOWN-TRAIN-DIAGNOSTIC-1", specHash, funnel };
  const diagnosticPath = path.join(artifactRoot, `${name}.breakdown-diagnostic.json`);
  atomicResearchJson(diagnosticPath, { ...content, researchContentSha256: researchContentHash(content) });
  process.stdout.write(JSON.stringify({ status: "DIAGNOSTIC_COMPLETE", diagnosticPath, funnel }, null, 2) + "\n");
}

async function run() {
  const { spec, specHash } = loadSpec();
  const proofPath = path.join(artifactRoot, `${name}.proof.json`);
  const diagnosticPath = path.join(artifactRoot, `${name}.breakdown-diagnostic.json`);
  if (!existsSync(proofPath) || readJson<{ specHash: string; sharedVsIsolated: string }>(proofPath).specHash !== specHash || readJson<{ sharedVsIsolated: string }>(proofPath).sharedVsIsolated !== "PASS") throw new Error("Bounded 8F.3 proof must pass before the full experiment.");
  if (!existsSync(diagnosticPath) || readJson<{ specHash: string }>(diagnosticPath).specHash !== specHash) throw new Error("TRAIN-only breakdown funnel diagnostic must complete before the full experiment.");
  const { baseline } = identity();
  const runtime = new RobustnessRuntime(path.join(artifactRoot, `${name}.runtime.json`), specHash, spec.source.baselineRunId, "8F3");
  try {
    const train = await runStage("SEARCH", spec.candidates, spec, specHash, runtime);
    const frozen = freezeTrain(spec, specHash, train, baseline.partitions);
    const selected = frozen.shortlist.map((entry) => spec.candidates.find((candidate) => candidate.variantId === entry.candidateId)!);
    const validation = await runStage("SELECTION", selected, spec, specHash, runtime);
    const validationPath = path.join(artifactRoot, `${name}.validation.json`);
    const validationContent = { format: "8F3-VALIDATION-1", specHash, shortlistHash: frozen.shortlistHash, rows: validation.rows, counts: { executions: validation.rows.length, shortlistedCandidates: selected.length } };
    const validationHash = researchContentHash(validationContent);
    if (existsSync(validationPath) && readJson<{ researchContentSha256: string }>(validationPath).researchContentSha256 !== validationHash) throw new Error("VALIDATION artifact differs from frozen result.");
    if (!existsSync(validationPath)) atomicResearchJson(validationPath, { ...validationContent, researchContentSha256: validationHash });
    const decisions = [...ACTIVE_STRATEGIES, "breakdown:v1"].map((strategy) => {
      const candidates = selected.filter((candidate) => candidate.strategy === strategy);
      const eligible = candidates.map((candidate) => {
        const rows = validation.rows.filter((row) => row.candidateId === candidate.variantId);
        const trainRows = train.rows.filter((row) => row.candidateId === candidate.variantId);
        const basis = baselineRows(baseline.partitions, strategy as OptimizationStrategy, "VALIDATION");
        const selection = validationEligibility(rows, basis, spec);
        const trainMetrics = aggregateCandidate(trainRows);
        return { candidateId: candidate.variantId, candidateHash: candidate.candidateHash, values: candidate.values, train: trainMetrics, validation: selection.metrics, generalizationDelta: { expectancy: selection.metrics.expectancy != null && trainMetrics.expectancy != null ? selection.metrics.expectancy - trainMetrics.expectancy : null, expectancyR: selection.metrics.expectancyR != null && trainMetrics.expectancyR != null ? selection.metrics.expectancyR - trainMetrics.expectancyR : null, profitFactor: selection.metrics.profitFactor != null && trainMetrics.profitFactor != null ? selection.metrics.profitFactor - trainMetrics.profitFactor : null, netPnl: selection.metrics.netPnl - trainMetrics.netPnl, drawdown: selection.metrics.maxDrawdown - trainMetrics.maxDrawdown, closedTrades: selection.metrics.closedTrades - trainMetrics.closedTrades }, eligible: selection.eligible, reasons: selection.reasons, concentration: rows.map((row) => ({ foldId: row.foldId, byInstrument: row.byInstrument, byDirection: row.byDirection, timeOfDay: row.timeOfDay })) };
      });
      const accepted = strategy === "breakdown:v1" ? eligible.filter((item) => item.validation.closedTrades >= spec.rules.breakdown.minimumClosedTrades && item.validation.activeFolds >= spec.rules.breakdown.minimumActiveFolds) : eligible.filter((item) => item.eligible);
      const frontier = paretoShortlist(accepted.map((item) => ({ candidateId: item.candidateId, metrics: item.validation, item })), spec.rules.train.maximumShortlistPerStrategy).map((item) => item.item);
      const status = strategy === "breakdown:v1" && candidates.length === 0 ? "BREAKDOWN_NO_VIABLE_ACTIVITY" : candidates.length === 0 ? "NO_TRAIN_CANDIDATE" : frontier.length ? "CANDIDATE_SELECTED_FOR_FINAL_GATE" : "NO_ACCEPTABLE_CANDIDATE";
      return { strategy, status, trainCandidatesEvaluated: spec.candidates.filter((candidate) => candidate.strategy === strategy).length, trainCandidatesSurviving: frozen.decisions.filter((item) => item.strategy === strategy && item.eligible).length, frozenShortlist: candidates.map((candidate) => candidate.variantId), validation: eligible, selectedForFinalGate: frontier.map((item) => item.candidateId), baselineTrain: aggregateCandidate(baselineRows(baseline.partitions, strategy as OptimizationStrategy, "TRAIN")), baselineValidation: aggregateCandidate(baselineRows(baseline.partitions, strategy as OptimizationStrategy, "VALIDATION")) };
    });
    const report = { format: "8F3-CONTROLLED-OPTIMIZATION-RESULT-1", specHash, source8f2Sha256: RECOVERED_8F2_SHA256, baselineRunId: spec.source.baselineRunId, trainHash: frozen.trainHash, shortlistHash: frozen.shortlistHash, validationHash, breakdownFunnel: readJson<{ funnel: unknown }>(diagnosticPath).funnel, counts: { optimizationTrainExecutions: train.rows.length, selectionValidationExecutions: validation.rows.length, optimizedCandidateTestExecutions: 0, trainWorkersPlanned: train.planned, validationWorkersPlanned: validation.planned }, decisions, noTestAudit: { optimizedCandidateTestExecutions: 0, sourcePhase8f2TestDataUsedForSelection: false } };
    const resultPath = path.join(artifactRoot, `${name}.result.json`);
    const final = { ...report, researchContentSha256: researchContentHash(report), operationalTelemetry: { trainWorkersLaunchedThisInvocation: train.launched, trainWorkersResumedThisInvocation: train.resumed, validationWorkersLaunchedThisInvocation: validation.launched, validationWorkersResumedThisInvocation: validation.resumed, cumulativeWallTime: "NOT_RELIABLY_RECONSTRUCTABLE" } };
    if (existsSync(resultPath) && readJson<{ researchContentSha256: string }>(resultPath).researchContentSha256 !== final.researchContentSha256) throw new Error("Final 8F.3 research content differs from prior result.");
    atomicResearchJson(resultPath, final);
    const reportPath = path.join(artifactRoot, `${name}.result.md`);
    const lines = [`# Phase 8F.3 Controlled Optimization`, ``, `Status: COMPLETE`, ``, `Spec: \`${specHash}\``, `Research content: \`${final.researchContentSha256}\``, `TRAIN evaluations: ${report.counts.optimizationTrainExecutions}`, `VALIDATION evaluations: ${report.counts.selectionValidationExecutions}`, `Optimized TEST evaluations: 0`, ``, `## Strategy outcomes`, ``];
    for (const decision of decisions) lines.push(`- ${decision.strategy}: ${decision.status}; ${decision.trainCandidatesEvaluated} TRAIN candidates, ${decision.trainCandidatesSurviving} survived, ${decision.frozenShortlist.length} frozen for VALIDATION, ${decision.selectedForFinalGate.length} sent to the final gate.`);
    lines.push(``, `Detailed metrics, generalization deltas, concentration diagnostics and the breakdown funnel are in the JSON artifact. No candidate was deployed or run on TEST.`, ``);
    writeFileSync(`${reportPath}.${process.pid}.tmp`, lines.join("\n"), { mode: 0o600 });
    renameSync(`${reportPath}.${process.pid}.tmp`, reportPath);
    process.stdout.write(JSON.stringify({ status: "COMPLETE", resultPath, counts: report.counts, decisions: decisions.map((item) => ({ strategy: item.strategy, status: item.status, selectedForFinalGate: item.selectedForFinalGate })) }, null, 2) + "\n");
    runtime.finish();
  } catch (error) { runtime.finish(error); throw error; }
}

async function main() {
  const command = process.argv[2];
  if (command === "spec") { const frozen = freezeSpec(); process.stdout.write(JSON.stringify({ specPath, specHash: frozen.specHash, candidates: frozen.spec.candidates.length }, null, 2) + "\n"); return; }
  if (command === "proof") { await proof(); return; }
  if (command === "diagnose") { await diagnose(); return; }
  if (command === "run") { await run(); return; }
  throw new Error("Usage: backtest:controlled-optimization -- spec|proof|diagnose|run");
}

void main().then(disconnectPrisma).catch(async (error) => { console.error(error instanceof Error ? error.message : error); await disconnectPrisma(); process.exitCode = 1; });
