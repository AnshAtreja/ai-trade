import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import path from "node:path";
import { generateWalkForwardFolds } from "./walk-forward";
import { buildRobustnessSpec, robustnessSpecHash } from "./robustness";
import { RESEARCH_PERIOD } from "../../historical-market-data/research-universe";

async function main() {
  const root = path.resolve(process.cwd(), "../../");
  const artifactRoot = path.resolve(root, "apps/artifacts/phase8f");
  const specPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.spec.json");
  const spec = JSON.parse(readFileSync(specPath, "utf8")) as ReturnType<typeof buildRobustnessSpec> & { specHash: string };
  const hash = robustnessSpecHash(buildRobustnessSpec());
  if (spec.specHash !== hash) throw new Error("Frozen Phase 8F.2 spec hash mismatch.");
  const batchSize = number("--batch-size", 8);
  if (!Number.isInteger(batchSize) || batchSize < 1) throw new Error("--batch-size must be a positive integer.");
  const folds = generateWalkForwardFolds(new Date(RESEARCH_PERIOD.from), new Date(RESEARCH_PERIOD.to));
  const fold = folds[0]!;
  const variants = spec.parameterVariants.filter((variant) => variant.strategy === "momentum:v1" && variant.level !== 0).sort((a, b) => a.variantId.localeCompare(b.variantId));
  const selected = variants.slice(0, number("--variants", batchSize));
  const batch = selected.slice(0, batchSize);
  const smoke = process.argv.includes("--smoke");
  const checkpointRoot = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-checkpoints");
  const resultRoot = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-worker-results");
  mkdirSync(checkpointRoot, { recursive: true }); mkdirSync(resultRoot, { recursive: true });
  const checkpointPath = path.join(checkpointRoot, `${smoke ? "smoke-" : ""}momentum-${fold.foldId}-TRAIN-batch.json`);
  if (existsCheckpoint(checkpointPath, hash, selected.map((variant) => variant.variantId))) { console.log(JSON.stringify({ status: "ALREADY_COMPLETE", checkpointPath, variantIds: selected.map((variant) => variant.variantId) }, null, 2)); return; }
  const requestPath = path.join(resultRoot, "current-request.json");
  const batchKey = createHash("sha256").update(batch.map((variant) => variant.variantId).join("\0")).digest("hex").slice(0, 16);
  const outputPath = path.join(resultRoot, `${smoke ? "smoke-" : ""}momentum-${fold.foldId}-TRAIN-${batchKey}.json`);
  const request = { specPath, outputPath, specHash: hash, baselineRunId: spec.baseline.runId, strategy: "momentum:v1", foldId: fold.foldId, partition: "TRAIN", from: smoke ? "2026-08-03T03:45:00.000Z" : fold.train.from, to: smoke ? "2026-08-04T03:45:00.000Z" : fold.train.to, interval: "1m", variantIds: batch.map((variant) => variant.variantId), batchSize };
  writeFileSync(requestPath, JSON.stringify(request, null, 2), { mode: 0o600 });
  await runWorker(requestPath);
  const checkpoint = { format: "8F2-COORDINATOR-1", specHash: hash, baselineRunId: spec.baseline.runId, strategy: request.strategy, foldId: request.foldId, partition: request.partition, batchSize, completedVariantIds: request.variantIds, resultPath: outputPath };
  const temporary = `${checkpointPath}.tmp`; writeFileSync(temporary, JSON.stringify(checkpoint, null, 2), { mode: 0o600 }); renameSync(temporary, checkpointPath);
  const verified = JSON.parse(readFileSync(checkpointPath, "utf8")) as typeof checkpoint;
  if (verified.specHash !== hash || verified.completedVariantIds.length !== batch.length) throw new Error("Coordinator checkpoint verification failed.");
  console.log(JSON.stringify({ status: "COMPLETE", checkpointPath, resultPath: outputPath, specHash: hash, fold: fold.foldId, partition: "TRAIN", batchSize, variantIds: batch.map((variant) => variant.variantId) }, null, 2));
}
function existsCheckpoint(filePath: string, hash: string, variantIds: string[]) {
  try {
    const checkpoint = JSON.parse(readFileSync(filePath, "utf8")) as { specHash?: string; completedVariantIds?: string[] };
    const completed = new Set(checkpoint.completedVariantIds ?? []);
    return checkpoint.specHash === hash && variantIds.every((variantId) => completed.has(variantId));
  } catch { return false; }
}
function runWorker(requestPath: string) { return new Promise<void>((resolve, reject) => { const worker = spawn("npx", ["tsx", "src/modules/scanner/replay/robustness-worker.ts", "--request", requestPath], { cwd: process.cwd(), stdio: ["ignore", "pipe", "inherit"], env: process.env }); let lastHeartbeat = Date.now(); let lastProgress = Date.now(); let lastProgressCount = 0; const stallTimer = setInterval(() => { const silentMs = Date.now() - lastHeartbeat; if (silentMs > 90_000) process.stderr.write(`${JSON.stringify({ type: "phase8f2_warning", code: "NO_HEARTBEAT", silentMs })}\n`); else if (Date.now() - lastProgress > 120_000) process.stderr.write(`${JSON.stringify({ type: "phase8f2_warning", code: "HEARTBEAT_BUT_NO_PROGRESS", stalledMs: Date.now() - lastProgress })}\n`); }, 30_000); worker.stdout?.on("data", (chunk: Buffer) => { for (const line of chunk.toString().split("\n").filter(Boolean)) { try { const event = JSON.parse(line) as { type?: string; candlesProcessed?: number }; if (event.type === "phase8f2_heartbeat") { lastHeartbeat = Date.now(); if ((event.candlesProcessed ?? 0) > lastProgressCount) { lastProgressCount = event.candlesProcessed ?? 0; lastProgress = Date.now(); } } process.stdout.write(`${line}\n`); } catch { process.stdout.write(`${line}\n`); } } }); worker.once("error", (error) => { clearInterval(stallTimer); reject(error); }); worker.once("exit", (code) => { clearInterval(stallTimer); code === 0 ? resolve() : reject(new Error(`Phase 8F.2 worker exited with ${code}.`)); }); }); }
function number(name: string, fallback: number) { const value = process.argv[process.argv.indexOf(name) + 1]; const parsed = Number(value); return Number.isFinite(parsed) ? parsed : fallback; }
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
