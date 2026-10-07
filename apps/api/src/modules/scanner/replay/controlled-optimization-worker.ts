import { readFileSync } from "node:fs";
import { getHeapStatistics } from "node:v8";
import { disconnectPrisma } from "../../../db/prisma";
import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import { researchUniverseInstruments } from "../../historical-market-data/research-universe";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import { runSharedParameterBatch } from "./robustness";
import { atomicResearchJson } from "./robustness-durability";
import { assertOptimizationPartition, buildControlledOptimizationSpec, controlledOptimizationSpecHash, type Candidate, type CandidateFoldMetrics, type OptimizationSpec, type OptimizationStrategy } from "./controlled-optimization";

export interface OptimizationWorkerRequest {
  specPath: string;
  outputPath: string;
  specHash: string;
  stage: "SEARCH" | "SELECTION";
  strategy: OptimizationStrategy;
  foldId: string;
  partition: "TRAIN" | "VALIDATION" | "TEST";
  from: string;
  to: string;
  interval: "1m";
  candidateIds: string[];
  proof?: { tokens: string[] };
}

export function verifyOptimizationCheckpoint(checkpoint: unknown, request: OptimizationWorkerRequest, resultSha256: string) {
  const value = checkpoint as { format?: string; specHash?: string; stage?: string; strategy?: string; foldId?: string; partition?: string; candidateIds?: string[]; resultSha256?: string };
  if (!value || value.format !== "8F3-BATCH-CHECKPOINT-1" || value.specHash !== request.specHash || value.stage !== request.stage || value.strategy !== request.strategy || value.foldId !== request.foldId || value.partition !== request.partition || value.resultSha256 !== resultSha256 || value.candidateIds?.join("|") !== request.candidateIds.join("|")) throw new Error("Phase 8F.3 checkpoint identity mismatch.");
  return value;
}

function memory() {
  const usage = process.memoryUsage();
  return { heapUsed: usage.heapUsed, rss: usage.rss, heapUtilization: usage.heapUsed / getHeapStatistics().heap_size_limit };
}

export function verifyOptimizationWorkerResult(result: any, request: OptimizationWorkerRequest) {
  assertOptimizationPartition(request.stage, request.partition);
  const ids = request.candidateIds;
  if (result?.format !== "8F3-CANDIDATE-WORKER-1" || result.specHash !== request.specHash || result.stage !== request.stage || result.strategy !== request.strategy || result.foldId !== request.foldId || result.partition !== request.partition || result.from !== request.from || result.to !== request.to || result.proof !== Boolean(request.proof) || !Array.isArray(result.rows) || result.rows.length !== ids.length || !Array.isArray(result.candidateIds) || result.candidateIds.join("|") !== ids.join("|") || new Set(ids).size !== ids.length || ids.some((id) => !result.rows.some((row: any) => row.candidateId === id))) throw new Error("Phase 8F.3 worker result identity mismatch.");
  for (const row of result.rows) {
    if (row.partition !== request.partition || row.foldId !== request.foldId || row.strategy !== request.strategy || !Number.isFinite(row.netPnl) || !Number.isFinite(row.maxDrawdown) || row.closedTrades < 0 || row.incompleteTrades < 0) throw new Error("Phase 8F.3 worker metrics are invalid.");
  }
  return result;
}

export async function evaluateOptimizationRequest(request: OptimizationWorkerRequest, spec: OptimizationSpec, hooks: { progress?: (event: Record<string, unknown>) => void } = {}) {
  assertOptimizationPartition(request.stage, request.partition);
  const { specHash: persistedHash, ...content } = spec as OptimizationSpec & { specHash?: string };
  if (persistedHash && persistedHash !== request.specHash || request.specHash !== controlledOptimizationSpecHash(content as OptimizationSpec) || request.interval !== "1m" || request.candidateIds.length < 1 || request.candidateIds.length > spec.design.batchSize || new Set(request.candidateIds).size !== request.candidateIds.length) throw new Error("Phase 8F.3 worker request does not match frozen specification.");
  const candidates = request.candidateIds.map((id) => spec.candidates.find((candidate) => candidate.variantId === id));
  if (candidates.some((candidate) => !candidate || candidate.strategy !== request.strategy)) throw new Error("Phase 8F.3 candidate identity mismatch.");
  const tokens = request.proof?.tokens ?? researchUniverseInstruments.map((instrument) => instrument.instrumentToken);
  if (request.proof && (tokens.length < 1 || tokens.some((token) => !researchUniverseInstruments.some((item) => item.instrumentToken === token)))) throw new Error("Proof instruments must come from the frozen research universe.");
  const service = getHistoricalMarketDataService();
  const views = await mapWithConcurrency(tokens, 4, (instrumentToken) => service.getResearchCandles({ instrumentToken, interval: request.interval, from: request.from, to: request.to, requireCompleteSession: true }));
  const candles = views.flatMap((view) => view.candles);
  if (!candles.length) throw new Error("Phase 8F.3 worker found no eligible candles.");
  hooks.progress?.({ stage: "REPLAYING", candlesProcessed: 0, totalCandles: candles.length });
  const results = await runSharedParameterBatch({
    candles, tokens, from: request.from, to: request.to, interval: request.interval,
    strategyId: request.strategy, variants: candidates as Candidate[], sessionPolicy: new NseCashInstrumentSessionPolicy(),
    onProgress: (progress) => hooks.progress?.({ stage: "REPLAYING", candlesProcessed: progress.processedCandles, totalCandles: progress.totalCandles, scannerEvaluations: progress.scannerEvaluations, strategyEvaluations: progress.strategyEvaluations, replayTimestamp: progress.replayTimestamp })
  });
  const rows = request.candidateIds.map((candidateId): CandidateFoldMetrics & { candidateHash: string; setups: number; orders: number; fills: number; byInstrument: unknown[]; byDirection: unknown[]; dailyReturns: unknown[]; sharpe: number | null; sortino: number | null; timeOfDay: Array<{ hourIst: number; trades: number }> } => {
    const value = results.get(candidateId)!;
    const { execution, analytics, replay } = value;
    const closedTrades = analytics.metadata.closedTradeCount;
    const hourCounts = new Map<number, number>();
    for (const trade of execution.trades.filter((trade) => trade.status === "CLOSED")) {
      const hourIst = (new Date(trade.entryTimestamp).getUTCHours() + 5 + Math.floor((new Date(trade.entryTimestamp).getUTCMinutes() + 30) / 60)) % 24;
      hourCounts.set(hourIst, (hourCounts.get(hourIst) ?? 0) + 1);
    }
    return {
      candidateId, candidateHash: candidates.find((candidate) => candidate!.variantId === candidateId)!.candidateHash,
      strategy: request.strategy, foldId: request.foldId, partition: request.partition as "TRAIN" | "VALIDATION",
      closedTrades, grossPnl: analytics.pnl.grossPnl, grossProfit: analytics.pnl.grossProfit, grossLoss: analytics.pnl.grossLoss,
      charges: analytics.pnl.totalCharges, netPnl: analytics.pnl.netPnl, expectancy: analytics.pnl.expectancy,
      expectancyR: analytics.pnl.averageR, profitFactor: analytics.pnl.profitFactor, maxDrawdown: analytics.drawdown.maxDrawdownAmount,
      incompleteTrades: analytics.metadata.incompleteTradeCount, dataGapEvents: replay.summary.dataGapEvents,
      setups: execution.summary.setupsDetected, orders: execution.summary.ordersCreated, fills: execution.summary.ordersFilled,
      byInstrument: analytics.byInstrument, byDirection: analytics.byDirection, dailyReturns: analytics.dailyReturns,
      sharpe: analytics.riskAdjusted.sharpeRatio, sortino: analytics.riskAdjusted.sortinoRatio,
      timeOfDay: [...hourCounts.entries()].sort(([a], [b]) => a - b).map(([hourIst, trades]) => ({ hourIst, trades }))
    };
  });
  return verifyOptimizationWorkerResult({ format: "8F3-CANDIDATE-WORKER-1", specHash: request.specHash, stage: request.stage, strategy: request.strategy, foldId: request.foldId, partition: request.partition, from: request.from, to: request.to, proof: Boolean(request.proof), candidateIds: request.candidateIds, candles: candles.length, scannerEvaluations: candles.length, rows }, request);
}

async function mapWithConcurrency<T, R>(items: T[], concurrency: number, mapper: (item: T) => Promise<R>) {
  const results = new Array<R>(items.length);
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(items.length, concurrency) }, async () => {
    while (next < items.length) { const index = next++; results[index] = await mapper(items[index]!); }
  }));
  return results;
}

async function main() {
  const requestIndex = process.argv.indexOf("--request");
  if (requestIndex < 0 || !process.argv[requestIndex + 1]) throw new Error("Missing --request.");
  const request = JSON.parse(readFileSync(process.argv[requestIndex + 1]!, "utf8")) as OptimizationWorkerRequest;
  const spec = JSON.parse(readFileSync(request.specPath, "utf8")) as OptimizationSpec & { specHash: string };
  if (spec.specHash !== request.specHash || controlledOptimizationSpecHash(buildControlledOptimizationSpec()) !== request.specHash) throw new Error("Frozen Phase 8F.3 specification mismatch.");
  let latest: Record<string, unknown> = { stage: "STARTING", candlesProcessed: 0, totalCandles: 0 };
  const started = Date.now();
  const emit = () => process.stdout.write(JSON.stringify({ type: "phase8f3_heartbeat", pid: process.pid, strategy: request.strategy, fold: request.foldId, partition: request.partition, candidateIds: request.candidateIds, elapsedMs: Date.now() - started, ...latest, ...memory() }) + "\n");
  const timer = setInterval(emit, 30_000); timer.unref(); emit();
  const result = await evaluateOptimizationRequest(request, spec, { progress: (progress) => { latest = progress; emit(); } });
  latest = { stage: "WRITING_RESULT", candlesProcessed: result.candles, totalCandles: result.candles }; emit();
  atomicResearchJson(request.outputPath, result);
  verifyOptimizationWorkerResult(JSON.parse(readFileSync(request.outputPath, "utf8")), request);
  clearInterval(timer);
  latest = { ...latest, stage: "COMPLETE" }; emit();
}

if (process.argv[1]?.endsWith("controlled-optimization-worker.ts")) {
  void main().then(disconnectPrisma).catch(async (error) => { console.error(error instanceof Error ? error.message : error); await disconnectPrisma(); process.exitCode = 1; });
}
