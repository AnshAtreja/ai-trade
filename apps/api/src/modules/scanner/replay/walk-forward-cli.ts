import { mkdirSync, renameSync, statSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import path from "node:path";
import { runWalkForward, DEFAULT_WALK_FORWARD_CONFIG, resolveWalkForwardArtifactPath, validateWalkForwardArtifactStorage, writeJsonFile } from "./walk-forward";
import { createMemoryTelemetry } from "./memory-telemetry";

function memorySample() {
  const usage = process.memoryUsage();
  const heap = getHeapStatistics();
  return createMemoryTelemetry(usage, { heapSizeLimit: heap.heap_size_limit });
}

async function main() {
  const tokens = values("--tokens").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const strategies = values("--strategies").flatMap((value) => value.split(",")).map((value) => value.trim()).filter(Boolean);
  const config = { trainSessions: number("--train-sessions", DEFAULT_WALK_FORWARD_CONFIG.trainSessions), validationSessions: number("--validation-sessions", DEFAULT_WALK_FORWARD_CONFIG.validationSessions), testSessions: number("--test-sessions", DEFAULT_WALK_FORWARD_CONFIG.testSessions), stepSessions: number("--step-sessions", DEFAULT_WALK_FORWARD_CONFIG.stepSessions) };
  const output = value("--output");
  if (output) validateWalkForwardArtifactStorage(output);
  process.stderr.write(`${JSON.stringify({ type: "walk_forward_start", executionHistoryMode: "COMPACT_EQUITY_POINTS", collectSnapshots: false, optimized: !process.argv.includes("--legacy"), boundedHistoricalMarketState: true, compactClockBorrowedCanonicalCandles: true, partitionCacheEviction: true, streamingCheckpointWriter: true, streamingArtifactWriter: true, memory: memorySample() })}\n`);
  const result = await runWalkForward({ from: value("--from") ?? undefined, to: value("--to") ?? undefined, interval: (value("--interval") ?? "1m") as "1m" | "5m", config, strategies: strategies.length ? strategies : undefined, tokens: tokens.length ? tokens : undefined, startingCapital: number("--starting-capital", 100000), smoke: process.argv.includes("--smoke"), optimized: !process.argv.includes("--legacy"), checkpointPath: value("--checkpoint") ?? undefined, onProgress: (progress) => process.stderr.write(`${JSON.stringify({ type: "walk_forward_progress", ...progress, memory: memorySample() })}\n`), onCheckpoint: (checkpoint) => process.stderr.write(`${JSON.stringify({ type: "walk_forward_checkpoint", ...checkpoint, checkpointBytes: statSync(checkpoint.path).size, memory: memorySample() })}\n`), onPartitionCleanup: (partition) => process.stderr.write(`${JSON.stringify({ type: "walk_forward_partition_cleanup", ...partition, memory: memorySample() })}\n`) });
  if (output) { const outputPath = resolveWalkForwardArtifactPath(output); mkdirSync(path.dirname(outputPath), { recursive: true }); const temporary = `${outputPath}.tmp`; writeJsonFile(temporary, result); renameSync(temporary, outputPath); }
  console.log(JSON.stringify({ runId: result.runId, folds: result.folds, testAggregates: result.testAggregates, diagnostics: result.diagnostics, performance: result.performance, output: output ? resolveWalkForwardArtifactPath(output) : null }, null, 2));
}
function values(name: string) { const out: string[] = []; for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]!); return out; }
function value(name: string) { return values(name)[0] ?? null; }
function number(name: string, fallback: number) { const raw = value(name); if (raw == null) return fallback; const parsed = Number(raw); return Number.isFinite(parsed) ? parsed : fallback; }
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
