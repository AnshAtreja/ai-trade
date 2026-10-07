import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import { researchUniverseInstruments, RESEARCH_PERIOD } from "../../historical-market-data/research-universe";
import { disconnectPrisma } from "../../../db/prisma";
import { buildRobustnessSpec, executionConfigForScenario, robustnessSpecHash, type CostScenario } from "./robustness";
import { runWalkForward, DEFAULT_WALK_FORWARD_CONFIG, generateWalkForwardFolds } from "./walk-forward";

interface CostWorkerRequest {
  specPath: string;
  outputPath: string;
  specHash: string;
  baselineRunId: string;
  strategy: "breakout:v1" | "breakdown:v1" | "momentum:v1" | "opening-momentum:v1";
  scenario: Exclude<CostScenario, "C0">;
  from: string;
  to: string;
  interval: "1m" | "5m";
}

async function main() {
  const request = JSON.parse(readFileSync(required("--request"), "utf8")) as CostWorkerRequest;
  const started = Date.now();
  const emit = (stage: string, extra: Record<string, unknown> = {}) => process.stdout.write(`${JSON.stringify({ type: "phase8f2_cost_heartbeat", strategy: request.strategy, scenario: request.scenario, stage, elapsedMs: Date.now() - started, ...extra })}\n`);
  emit("STARTING");
  const spec = JSON.parse(readFileSync(request.specPath, "utf8")) as ReturnType<typeof buildRobustnessSpec> & { specHash: string };
  const expectedHash = robustnessSpecHash(buildRobustnessSpec());
  if (spec.specHash !== request.specHash || expectedHash !== request.specHash) throw new Error("Cost worker refused a changed Phase 8F.2 specification.");
  emit("VALIDATING_REQUEST");
  const service = getHistoricalMarketDataService();
  const tokens = researchUniverseInstruments.map((instrument) => instrument.instrumentToken);
  emit("REPLAYING", { instrumentCount: tokens.length });
  const fold = generateWalkForwardFolds(new Date(RESEARCH_PERIOD.from), new Date(RESEARCH_PERIOD.to)).find(item => item.test.from === request.from && item.test.to === request.to);
  if (!fold) throw new Error("Cost request does not match a frozen TEST fold.");
  const result = await runWalkForward({
    from: RESEARCH_PERIOD.from,
    to: RESEARCH_PERIOD.to,
    foldIds: [fold.foldId],
    researchVariantId: `COST:${request.strategy}:${request.scenario}:${fold.foldId}`,
    interval: request.interval,
    config: DEFAULT_WALK_FORWARD_CONFIG,
    strategies: [request.strategy],
    tokens,
    startingCapital: 100000,
    service,
    optimized: true,
    allowedPartitions: ["TEST"],
    executionConfig: executionConfigForScenario(request.scenario),
    onProgress: (progress) => emit("REPLAY_PROGRESS", progress)
  });
  if (result.partitions.length !== 1 || result.partitions[0]?.foldId !== fold.foldId || result.partitions[0]?.partition !== "TEST") throw new Error("Cost worker did not evaluate exactly one frozen TEST partition.");
  const output = {
    format: "8F2-COST-WORKER-1",
    specHash: request.specHash,
    baselineRunId: request.baselineRunId,
    strategy: request.strategy,
    scenario: request.scenario,
    from: request.from,
    to: request.to,
    interval: request.interval,
    elapsedMs: Date.now() - started,
    partitions: result.partitions.map((partition) => ({
      foldId: partition.foldId,
      partition: partition.partition,
      range: partition.range,
      tradingSessions: partition.tradingSessions,
      eligibleInstrumentSessions: partition.eligibleInstrumentSessions,
      excludedSessions: partition.excludedSessions,
      metrics: partition.metrics,
      diagnostics: {
        replay: result.performance,
        setups: partition.metrics.setups,
        orders: partition.metrics.orders,
        fills: partition.metrics.fills,
        closedTrades: partition.metrics.closedTrades,
        incompleteTrades: partition.metrics.incompleteTrades
      }
    }))
  };
  emit("WRITING_RESULT");
  mkdirSync(path.dirname(request.outputPath), { recursive: true });
  const temporary = `${request.outputPath}.tmp`;
  writeFileSync(temporary, JSON.stringify(output, null, 2), { mode: 0o600 });
  renameSync(temporary, request.outputPath);
  const verified = JSON.parse(readFileSync(request.outputPath, "utf8")) as typeof output;
  if (verified.specHash !== request.specHash || verified.strategy !== request.strategy || verified.scenario !== request.scenario) throw new Error("Cost result verification failed.");
  emit("COMPLETE", { outputPath: request.outputPath, partitions: output.partitions.length });
}

function required(name: string) { const index = process.argv.indexOf(name); const value = process.argv[index + 1]; if (!value) throw new Error(`Missing ${name}.`); return value; }
void main().then(disconnectPrisma).catch(async (error) => { console.error(error instanceof Error ? error.message : error); await disconnectPrisma(); process.exitCode = 1; });
