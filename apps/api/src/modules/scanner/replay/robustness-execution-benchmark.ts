import { createHash } from "node:crypto";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import { researchUniverseInstruments } from "../../historical-market-data/research-universe";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import { disconnectPrisma } from "../../../db/prisma";
import { buildRobustnessSpec, robustnessSpecHash, runSharedParameterBatch } from "./robustness";
import { atomicResearchJson } from "./robustness-durability";
import { benchmarkExecution } from "./execution-benchmark";

async function main() {
  const spec = buildRobustnessSpec();
  const tokens = researchUniverseInstruments.map(instrument => instrument.instrumentToken);
  const from = "2026-09-07T03:45:00.000Z", to = "2026-09-10T03:45:00.000Z";
  const service = getHistoricalMarketDataService();
  const candles: Awaited<ReturnType<typeof service.getResearchCandles>>["candles"] = [];
  const exclusions = [];
  for (const instrumentToken of tokens) {
    const view = await service.getResearchCandles({ instrumentToken, from, to, interval: "1m", requireCompleteSession: true });
    candles.push(...view.candles);
    exclusions.push(...view.rejectedSessions);
  }
  if (candles.length < 25000) throw new Error("Real-data benchmark has insufficient persisted candles.");
  const variants = spec.parameterVariants.filter(variant => variant.strategy === "opening-momentum:v1" && variant.level !== 0).sort((a, b) => a.variantId.localeCompare(b.variantId)).slice(0, 8);
  const input = { candles, tokens, from, to, interval: "1m" as const, strategyId: "opening-momentum:v1", variants, sessionPolicy: new NseCashInstrumentSessionPolicy() };
  const runs = [];
  for (const indexPendingOrders of [false, true]) {
    const started = performance.now();
    const batch = await runSharedParameterBatch({ ...input, indexPendingOrders });
    const elapsedMs = performance.now() - started;
    const logical = [...batch].map(([id, result]) => ({ id, execution: result.execution, analytics: result.analytics, replay: { request: result.replay.request, summary: result.replay.summary, events: result.replay.events, validationIssues: result.replay.validationIssues, limitations: result.replay.limitations } }));
    const digest = createHash("sha256").update(JSON.stringify(logical)).digest("hex");
    const run = { indexPendingOrders, elapsedMs, digest, orders: logical.map(row => row.execution.orders.length), fills: logical.map(row => row.execution.fills.length), peakRssKiB: process.resourceUsage().maxRSS };
    runs.push(run);
    console.log(JSON.stringify(run));
  }
  if (runs[0]!.digest !== runs[1]!.digest) throw new Error("Real-data legacy/indexed result mismatch.");
  const legacyStress = benchmarkExecution(false), indexedStress = benchmarkExecution(true);
  if (legacyStress.digest !== indexedStress.digest) throw new Error("Stress result mismatch.");
  const report = { specHash: robustnessSpecHash(spec), from, to, instruments: tokens.length, candles: candles.length, variants: variants.map(v => v.variantId), exclusions, runs, realSpeedup: runs[0]!.elapsedMs / runs[1]!.elapsedMs, legacyStress, indexedStress, equivalence: "PASS" };
  const file = path.resolve(__dirname, "../../../../../../apps/artifacts/phase8f/execution-index-equivalence-2026-09-22.json");
  atomicResearchJson(file, report);
  console.log(JSON.stringify({ equivalence: "PASS", report: file, realSpeedup: report.realSpeedup }));
}
void main().then(disconnectPrisma).catch(async error => { console.error(error); await disconnectPrisma(); process.exitCode = 1; });
