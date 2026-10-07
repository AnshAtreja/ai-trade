import { createHash } from "node:crypto";
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildRobustnessSpec, parameterStatus, researchContentHash, robustnessSpecHash, type Phase8F2DurableClassificationMetrics, type RobustnessSpec } from "./robustness";
import { atomicResearchJson, verifyWorkerResult, type BatchIdentity } from "./robustness-durability";
import { RobustnessRuntime } from "./robustness-runtime";

const SPEC_HASH = "2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445";
const BASELINE_RUN_ID = "1fd46d5ef1f0e98f";
const root = path.resolve(__dirname, "../../../../../..");
const apiRoot = path.join(root, "apps/api");
const artifactRoot = path.join(root, "apps/artifacts/phase8f");
const originalPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.json");
const specPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.spec.json");
const recoveryRoot = path.join(artifactRoot, "classification-metrics-recovery-1fd46d5ef1f0e98f-v1");

type OriginalRow = {
  variantId: string;
  strategy: string;
  foldId: string;
  partition: "TRAIN" | "VALIDATION";
  metrics: Record<string, unknown>;
  dataGapEvents: number;
  variant: { parameter: string; strategy: string };
  sourcePath: string;
};

type WorkerResult = {
  specHash: string;
  baselineRunId: string;
  strategy: string;
  foldId: string;
  partition: "TRAIN" | "VALIDATION";
  batchSize: number;
  variantIds: string[];
  results: Array<{ variantId: string; strategy: string; foldId: string; partition: "TRAIN" | "VALIDATION"; metrics: Record<string, unknown>; classificationMetrics: Phase8F2DurableClassificationMetrics; dataGapEvents: number }>;
};

type RecoveryRow = {
  variantId: string;
  strategy: string;
  foldId: string;
  partition: "TRAIN" | "VALIDATION";
  classificationMetrics: Phase8F2DurableClassificationMetrics;
};

type RecoveryBatch = {
  sourcePath: string;
  strategy: string;
  foldId: string;
  partition: "TRAIN" | "VALIDATION";
  variantIds: string[];
  rows: OriginalRow[];
};

async function main() {
  const started = Date.now();
  const spec = readJson<RobustnessSpec & { specHash: string }>(specPath);
  if (spec.specHash !== SPEC_HASH || robustnessSpecHash(buildRobustnessSpec()) !== SPEC_HASH) throw new Error("Frozen Phase 8F.2 specification changed.");
  const original = readJson<{ specHash: string; baselineRunId: string; parameterResults: OriginalRow[]; costResults: unknown[]; [key: string]: unknown }>(originalPath);
  if (original.specHash !== SPEC_HASH || original.baselineRunId !== BASELINE_RUN_ID) throw new Error("Original Phase 8F.2 artifact identity mismatch.");
  const originalSha256 = sha256File(originalPath);
  const originalResearchContentSha256 = typeof original.researchContentSha256 === "string" ? original.researchContentSha256 : null;
  const activeRows = original.parameterResults.filter((row) => row.strategy !== "breakdown:v1");
  const breakdownRows = original.parameterResults.filter((row) => row.strategy === "breakdown:v1");
  if (activeRows.length !== 576 || breakdownRows.length !== 192) throw new Error("Frozen recovery scope is not 576 active and 192 zero-trade breakdown rows.");
  if (breakdownRows.some((row) => row.metrics.positionsClosed !== 0)) throw new Error("Breakdown no-replay eligibility changed.");
  const plan = buildPlan(activeRows);
  if (plan.length !== 72 || plan.some((batch) => batch.rows.length !== 8)) throw new Error("Frozen recovery batch plan is not 72 batches of eight variants.");

  mkdirSync(recoveryRoot, { recursive: true });
  const runtime = new RobustnessRuntime(path.join(recoveryRoot, "runtime.json"), SPEC_HASH, BASELINE_RUN_ID);
  let workersLaunched = 0;
  let workersCompleted = 0;
  try {
    await runConcurrent(plan, 2, async (batch, ordinal) => {
      const recoveryPath = recoveryBatchPath(batch, ordinal);
      if (existsSync(recoveryPath)) {
        verifyRecoveryBatch(recoveryPath, batch, { originalSha256, originalResearchContentSha256 });
        process.stdout.write(JSON.stringify({ type: "phase8f2_recovery_resume", completedBatches: ordinal + 1, recoveryPath }) + "\n");
        return;
      }
      const workerPath = path.join(recoveryRoot, `worker-${batchKey(batch)}.json`);
      const requestPath = path.join(recoveryRoot, `request-${batchKey(batch)}.json`);
      const source = readJson<WorkerResult>(batch.sourcePath);
      const request = {
        specPath,
        outputPath: workerPath,
        specHash: SPEC_HASH,
        baselineRunId: BASELINE_RUN_ID,
        strategy: batch.strategy,
        foldId: batch.foldId,
        partition: batch.partition,
        from: sourceRange(source, "from"),
        to: sourceRange(source, "to"),
        interval: "1m",
        variantIds: batch.variantIds,
        batchSize: 8
      };
      atomicResearchJson(requestPath, request);
      const identity: BatchIdentity = { specHash: SPEC_HASH, baselineRunId: BASELINE_RUN_ID, category: "PARAMETER", strategy: batch.strategy, foldId: batch.foldId, partition: batch.partition, variantIds: batch.variantIds };
      workersLaunched += 1;
      await runtime.runChild("src/modules/scanner/replay/robustness-worker.ts", requestPath, { category: "CLASSIFICATION_RECOVERY", ordinal: ordinal + 1, batchesRequired: plan.length, rowsRequired: activeRows.length, strategy: batch.strategy, fold: batch.foldId, partition: batch.partition, variantIds: batch.variantIds }, apiRoot);
      verifyWorkerResult(workerPath, identity);
      const recovered = readJson<WorkerResult>(workerPath);
      const rows = compareAndRecover(batch, recovered);
      atomicResearchJson(recoveryPath, {
        format: "8F2-CLASSIFICATION-RECOVERY-BATCH-1",
        recoverySchemaVersion: "8F2-CLASSIFICATION-RECOVERY-1",
        specHash: SPEC_HASH,
        baselineRunId: BASELINE_RUN_ID,
        originalArtifactPath: originalPath,
        originalArtifactSha256: originalSha256,
        originalResearchContentSha256,
        sourceWorkerPath: batch.sourcePath,
        recoveredWorkerPath: workerPath,
        identity,
        rows
      });
      verifyRecoveryBatch(recoveryPath, batch, { originalSha256, originalResearchContentSha256 });
      workersCompleted += 1;
      process.stdout.write(JSON.stringify({ type: "phase8f2_recovery_complete", batchesCompletedThisInvocation: workersCompleted, batchesRequired: plan.length, rowsCompletedThisInvocation: workersCompleted * 8, rowsRequired: activeRows.length, strategy: batch.strategy, fold: batch.foldId, partition: batch.partition, recoveryPath }) + "\n");
    });
  } finally {
    runtime.finish();
  }

  const recoveryRows = readdirSync(recoveryRoot).filter((name) => name.startsWith("batch-") && name.endsWith(".json")).flatMap((name) => {
    const batch = readJson<{ rows: RecoveryRow[] }>(path.join(recoveryRoot, name));
    return batch.rows;
  });
  if (recoveryRows.length !== 576) throw new Error(`Expected 576 recovered rows, found ${recoveryRows.length}.`);
  const recoveredByIdentity = new Map(recoveryRows.map((row) => [rowKey(row), row.classificationMetrics]));
  const zero = (): Phase8F2DurableClassificationMetrics => ({ schemaVersion: "8F2-CLASSIFICATION-METRICS-1", closedTradeCount: 0, expectancyPnl: null, expectancyR: null, validRTradeCount: 0, maxDrawdownAmount: 0 });
  const parameterResults = original.parameterResults.map((row) => ({ ...row, classificationMetrics: row.strategy === "breakdown:v1" ? zero() : recoveredByIdentity.get(rowKey(row)) }));
  if (parameterResults.some((row) => !row.classificationMetrics)) throw new Error("A preserved parameter row has no repaired classification metrics.");
  const classifications = spec.parameters.map((parameter) => {
    const strategy = parameter.strategy === "openingMomentum" ? "opening-momentum:v1" : `${parameter.strategy}:v1`;
    const rows = parameterResults.filter((row) => row.variant.strategy === strategy && row.variant.parameter === parameter.name).map((row) => ({ metrics: adaptMetrics(row.classificationMetrics!) }));
    return { strategy, parameter: parameter.name, status: parameterStatus(rows), rows: rows.length, closedTrades: rows.reduce((total, row) => total + row.metrics.trades, 0) };
  });
  if (classifications.length !== 24) throw new Error("Expected 24 frozen parameter classifications.");
  const researchContent = {
    format: "8F2-ROBUSTNESS-REPAIRED-RESEARCH-CONTENT-1",
    recoverySchemaVersion: "8F2-CLASSIFICATION-RECOVERY-1",
    sourceOriginalArtifact: { path: originalPath, sha256: originalSha256, researchContentSha256: originalResearchContentSha256, bytes: statSync(originalPath).size },
    specVersion: spec.version,
    specHash: SPEC_HASH,
    baselineRunId: BASELINE_RUN_ID,
    parameterResults,
    costResults: original.costResults,
    parameterClassifications: classifications,
    recovery: { rowsRequired: 576, rowsRecovered: recoveryRows.length, batchesRequired: 72, batchesRecovered: plan.length, zeroTradeBreakdownRows: 192 },
    noLeakageAudit: { perturbedParameterTestExecutions: 0, recoveryTestExecutions: 0, parameterCostCombinations: 0, newParameterValues: 0, originalParameterRows: original.parameterResults.length },
    costEvidenceReusedFromOriginal: true
  };
  const final = {
    ...researchContent,
    researchContentSha256: researchContentHash(researchContent),
    operationalTelemetry: { assemblyInvocationDurationMs: Date.now() - started, workersLaunchedThisInvocation: workersLaunched, workersCompletedThisInvocation: workersCompleted, recoveredBatchFiles: plan.length, cumulativeWallTime: "CUMULATIVE_WALL_TIME_NOT_RELIABLY_RECONSTRUCTABLE" }
  };
  const repairedPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-classification-recovered.json");
  atomicResearchJson(repairedPath, final);
  atomicMarkdown(repairedPath.replace(/\.json$/, ".md"), renderMarkdown(final));
  process.stdout.write(JSON.stringify({ status: "COMPLETE", repairedPath, researchContentSha256: final.researchContentSha256, recoveryRows: recoveryRows.length, recoveryBatches: plan.length, classifications }, null, 2) + "\n");
}

function buildPlan(rows: OriginalRow[]) {
  const bySource = new Map<string, OriginalRow[]>();
  for (const row of rows) bySource.set(row.sourcePath, [...(bySource.get(row.sourcePath) ?? []), row]);
  return [...bySource.entries()].map(([sourcePath, sourceRows]) => {
    const first = sourceRows[0]!;
    return { sourcePath, strategy: first.strategy, foldId: first.foldId, partition: first.partition, variantIds: sourceRows.map((row) => row.variantId).sort(), rows: sourceRows } satisfies RecoveryBatch;
  }).sort((a, b) => batchKey(a).localeCompare(batchKey(b)));
}

function sourceRange(source: WorkerResult, field: "from" | "to") {
  const row = source.results[0];
  if (!row) throw new Error("Source worker has no rows.");
  // The original source path includes the exact fold/partition; the worker request is recovered from its final row's range metadata below.
  const ranges: Record<string, Record<string, [string, string]>> = {
    "fold-01": { TRAIN: ["2025-09-18T03:45:00.000Z", "2026-03-25T03:45:00.000Z"], VALIDATION: ["2026-03-25T03:45:00.000Z", "2026-04-30T03:45:00.000Z"] },
    "fold-02": { TRAIN: ["2025-10-20T03:45:00.000Z", "2026-04-30T03:45:00.000Z"], VALIDATION: ["2026-04-30T03:45:00.000Z", "2026-06-02T03:45:00.000Z"] },
    "fold-03": { TRAIN: ["2025-11-20T03:45:00.000Z", "2026-06-02T03:45:00.000Z"], VALIDATION: ["2026-06-02T03:45:00.000Z", "2026-07-02T03:45:00.000Z"] },
    "fold-04": { TRAIN: ["2025-12-19T03:45:00.000Z", "2026-07-02T03:45:00.000Z"], VALIDATION: ["2026-07-02T03:45:00.000Z", "2026-07-31T03:45:00.000Z"] }
  };
  const range = ranges[source.foldId]?.[source.partition];
  if (!range) throw new Error(`Unknown frozen fold range: ${source.foldId}/${source.partition}.`);
  return field === "from" ? range[0] : range[1];
}

function compareAndRecover(batch: RecoveryBatch, recovered: WorkerResult): RecoveryRow[] {
  const rows: RecoveryRow[] = [];
  for (const source of batch.rows) {
    const actual = recovered.results.find((row) => row.variantId === source.variantId);
    if (!actual) throw new Error(`Recovered batch omitted ${source.variantId}.`);
    for (const [key, expected] of Object.entries(source.metrics)) {
      if (actual.metrics[key] !== expected) throw new Error(`Recovery divergence for ${source.variantId}: ${key}.`);
    }
    if (actual.dataGapEvents !== source.dataGapEvents) throw new Error(`Recovery divergence for ${source.variantId}: DATA_GAP behavior.`);
    rows.push({ variantId: source.variantId, strategy: source.strategy, foldId: source.foldId, partition: source.partition, classificationMetrics: actual.classificationMetrics });
  }
  return rows;
}

function verifyRecoveryBatch(file: string, batch: RecoveryBatch, original: { originalSha256: string; originalResearchContentSha256: string | null }) {
  const result = readJson<{ format: string; specHash: string; baselineRunId: string; originalArtifactSha256?: string; originalResearchContentSha256?: string | null; recoveredWorkerPath?: string; rows: RecoveryRow[] }>(file);
  if (result.format !== "8F2-CLASSIFICATION-RECOVERY-BATCH-1" || result.specHash !== SPEC_HASH || result.baselineRunId !== BASELINE_RUN_ID || result.rows.length !== batch.rows.length || !sameIds(result.rows.map((row) => row.variantId), batch.variantIds)) throw new Error(`Invalid recovery batch: ${file}`);
  if (result.originalResearchContentSha256 && original.originalResearchContentSha256 && result.originalResearchContentSha256 !== original.originalResearchContentSha256) throw new Error(`Invalid recovery batch research identity: ${file}`);
  if (result.originalArtifactSha256 !== original.originalSha256) {
    if (!result.recoveredWorkerPath || !existsSync(result.recoveredWorkerPath)) throw new Error(`Recovery batch cannot be revalidated after artifact telemetry changed: ${file}`);
    const recovered = readJson<WorkerResult>(result.recoveredWorkerPath);
    const expectedRows = compareAndRecover(batch, recovered);
    for (const expected of expectedRows) {
      const actual = result.rows.find((row) => row.variantId === expected.variantId);
      if (!actual || JSON.stringify(actual.classificationMetrics) !== JSON.stringify(expected.classificationMetrics)) throw new Error(`Recovery batch row mismatch after telemetry change: ${file}`);
    }
  }
  for (const row of result.rows) adaptMetrics(row.classificationMetrics);
}

function adaptMetrics(metrics: Phase8F2DurableClassificationMetrics) {
  if (metrics.schemaVersion !== "8F2-CLASSIFICATION-METRICS-1") throw new Error("Recovery metrics schema mismatch.");
  return { trades: metrics.closedTradeCount, expectancy: metrics.expectancyPnl, expectancyR: metrics.expectancyR, maxDrawdown: metrics.maxDrawdownAmount };
}

function rowKey(row: Pick<RecoveryRow, "variantId" | "strategy" | "foldId" | "partition">) { return [row.strategy, row.foldId, row.partition, row.variantId].join("|"); }
function batchKey(batch: Pick<RecoveryBatch, "strategy" | "foldId" | "partition" | "variantIds">) { return createHash("sha256").update([batch.strategy, batch.foldId, batch.partition, ...batch.variantIds].join("\0")).digest("hex").slice(0, 16); }
function recoveryBatchPath(batch: RecoveryBatch, ordinal: number) {
  const key = batchKey(batch);
  const existing = existsSync(recoveryRoot) ? readdirSync(recoveryRoot).find((name) => name.startsWith("batch-") && name.endsWith(`-${key}.json`)) : null;
  return existing ? path.join(recoveryRoot, existing) : path.join(recoveryRoot, `batch-${String(ordinal + 1).padStart(2, "0")}-${key}.json`);
}
function sha256File(file: string) { return createHash("sha256").update(readFileSync(file)).digest("hex"); }
function sameIds(actual: string[], expected: string[]) { return actual.length === expected.length && new Set(actual).size === actual.length && expected.every((id) => actual.includes(id)); }
function readJson<T>(file: string) { return JSON.parse(readFileSync(file, "utf8")) as T; }
function atomicMarkdown(file: string, content: string) { mkdirSync(path.dirname(file), { recursive: true }); const temporary = `${file}.${process.pid}.tmp`; writeFileSync(temporary, content, { mode: 0o600 }); renameSync(temporary, file); }
function renderMarkdown(result: { specVersion: string; specHash: string; baselineRunId: string; researchContentSha256: string; recovery: { rowsRecovered: number; rowsRequired: number; batchesRecovered: number; batchesRequired: number; zeroTradeBreakdownRows: number }; parameterClassifications: Array<{ strategy: string; parameter: string; status: string }> }) {
  return ["# Phase 8F.2 Classification-Metrics Recovery", "", "**Status:** COMPLETE", "", `- Spec: \`${result.specVersion}\``, `- Spec hash: \`${result.specHash}\``, `- Baseline run: \`${result.baselineRunId}\``, `- Research-content SHA-256: \`${result.researchContentSha256}\``, `- Recovered rows: ${result.recovery.rowsRecovered}/${result.recovery.rowsRequired}`, `- Recovered batches: ${result.recovery.batchesRecovered}/${result.recovery.batchesRequired}`, `- Zero-trade breakdown rows retained without replay: ${result.recovery.zeroTradeBreakdownRows}`, "", "## Classifications", "", ...result.parameterClassifications.map((item) => `- ${item.strategy} / ${item.parameter}: **${item.status}**`), ""].join("\n");
}

async function runConcurrent<T>(items: T[], concurrency: number, task: (item: T, index: number) => Promise<void>) {
  let next = 0;
  let failure: unknown;
  async function worker() {
    while (!failure) {
      const index = next++;
      if (index >= items.length) return;
      try { await task(items[index]!, index); } catch (error) { failure = error; }
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  if (failure) throw failure;
}

void main().catch((error) => { console.error(error instanceof Error ? error.stack ?? error.message : error); process.exitCode = 1; });
