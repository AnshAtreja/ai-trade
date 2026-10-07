import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getHeapStatistics } from "node:v8";
import { disconnectPrisma } from "../../../db/prisma";
import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import { researchUniverseInstruments } from "../../historical-market-data/research-universe";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import { buildRobustnessSpec, durableClassificationMetrics, robustnessSpecHash, runSharedParameterBatch, type ParameterVariant } from "./robustness";

interface WorkerRequest { specPath: string; outputPath: string; specHash: string; baselineRunId: string; strategy: string; foldId: string; partition: "TRAIN" | "VALIDATION" | "TEST"; from: string; to: string; interval: "1m" | "5m"; variantIds: string[]; batchSize: number; }

async function main() {
  const request = JSON.parse(readFileSync(required("--request"), "utf8")) as WorkerRequest;
  const workerId = path.basename(request.outputPath, ".json");
  const started = Date.now();
  let latest = { candlesProcessed: 0, totalCandles: 0, scannerEvaluations: 0, strategyEvaluations: 0, replayTimestamp: request.from, lastProgressAt: new Date().toISOString() };
  const emit = (stage: string, extra: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ type: "phase8f2_heartbeat", pid: process.pid, workerId, strategy: request.strategy, fold: request.foldId, partition: request.partition, batchSize: request.batchSize, variantCount: request.variantIds.length, stage, elapsedMs: Date.now() - started, cpuMs: (process.cpuUsage().user + process.cpuUsage().system) / 1000, ...latest, ...memory(), ...extra })}\n`);
  const heartbeat = setInterval(() => emit("HEARTBEAT"), 30_000);
  heartbeat.unref();
  emit("STARTING");
  const specFile = JSON.parse(readFileSync(request.specPath, "utf8")) as ReturnType<typeof buildRobustnessSpec> & { specHash: string };
  emit("VALIDATING_REQUEST");
  const expectedHash = robustnessSpecHash(buildRobustnessSpec());
  if (specFile.specHash !== request.specHash || expectedHash !== request.specHash) throw new Error("Worker refused a changed Phase 8F.2 specification.");
  if (request.partition === "TEST") throw new Error("Perturbed Phase 8F.2 worker execution on TEST is forbidden.");
  const variants = specFile.parameterVariants.filter((variant) => request.variantIds.includes(variant.variantId));
  if (variants.length !== request.variantIds.length || variants.some((variant) => variant.strategy !== request.strategy)) throw new Error("Worker variant identity mismatch.");
  const tokens = researchUniverseInstruments.map((instrument) => instrument.instrumentToken);
  const service = getHistoricalMarketDataService();
  emit("ASSEMBLING_RESEARCH_VIEW");
  // Keep database pressure below the Prisma pool limit while still allowing
  // bounded overlap between independent instrument reads.
  const views = await mapWithConcurrency(tokens, 4, (instrumentToken) => service.getResearchCandles({ instrumentToken, interval: request.interval, from: request.from, to: request.to, requireCompleteSession: true }));
  const candles = views.flatMap((view) => view.candles);
  latest.totalCandles = candles.length;
  emit("INITIALIZING_VARIANTS");
  emit("REPLAYING");
  const result = await runSharedParameterBatch({ candles, tokens, from: request.from, to: request.to, interval: request.interval, strategyId: request.strategy, variants: variants as ParameterVariant[], sessionPolicy: new NseCashInstrumentSessionPolicy(), onProgress: (progress) => { latest = { ...latest, candlesProcessed: progress.processedCandles, totalCandles: progress.totalCandles, scannerEvaluations: progress.scannerEvaluations, strategyEvaluations: progress.strategyEvaluations, replayTimestamp: progress.replayTimestamp, lastProgressAt: new Date().toISOString() }; emit("REPLAY_PROGRESS"); } });
  clearInterval(heartbeat);
  latest = { ...latest, candlesProcessed: candles.length, scannerEvaluations: candles.length };
  emit("FINALIZING_ANALYTICS");
  const compact = [...result.entries()].map(([variantId, value]) => ({
    variantId,
    strategy: request.strategy,
    foldId: request.foldId,
    partition: request.partition,
    metrics: value.execution.summary,
    classificationMetrics: durableClassificationMetrics(value.execution.summary, value.analytics.drawdown.maxDrawdownAmount),
    dataGapEvents: value.replay.summary.dataGapEvents
  }));
  const output = { format: "8F2-SHARED-WORKER-1", specHash: request.specHash, baselineRunId: request.baselineRunId, strategy: request.strategy, foldId: request.foldId, partition: request.partition, batchSize: request.batchSize, variantIds: request.variantIds, candles: candles.length, scannerEvaluations: candles.length, variantStrategyEvaluations: candles.length * variants.length, elapsedMs: Date.now() - started, memory: memory(), results: compact };
  emit("WRITING_RESULT");
  mkdirSync(path.dirname(request.outputPath), { recursive: true });
  const temporary = `${request.outputPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(output, null, 2), { mode: 0o600 });
  renameSync(temporary, request.outputPath);
  const verified = JSON.parse(readFileSync(request.outputPath, "utf8")) as typeof output;
  if (verified.specHash !== request.specHash || verified.variantIds.join(",") !== request.variantIds.join(",")) throw new Error("Worker result verification failed.");
  emit("VERIFYING_RESULT");
  process.stdout.write(JSON.stringify({ type: "worker_complete", ...output, outputPath: request.outputPath }) + "\n");
  emit("COMPLETE");
}

function memory() { const usage = process.memoryUsage(); const heapSizeLimit = getHeapStatistics().heap_size_limit; return { heapUsed: usage.heapUsed, heapTotal: usage.heapTotal, rss: usage.rss, heapSizeLimit, heapUtilization: heapSizeLimit ? usage.heapUsed / heapSizeLimit : 0 }; }
async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  async function worker() {
    while (true) {
      const index = next++;
      if (index >= items.length) return;
      results[index] = await mapper(items[index]);
    }
  }
  await Promise.all(Array.from({ length: Math.min(concurrency, items.length) }, () => worker()));
  return results;
}
function required(name: string) { const index = process.argv.indexOf(name); const value = process.argv[index + 1]; if (!value) throw new Error(`Missing ${name}.`); return value; }
void main().then(disconnectPrisma).catch(async (error) => { console.error(error instanceof Error ? error.message : error); await disconnectPrisma(); process.exitCode = 1; });
