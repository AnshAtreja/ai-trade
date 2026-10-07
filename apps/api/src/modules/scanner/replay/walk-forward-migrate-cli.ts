import { getHeapStatistics } from "node:v8";
import { createMemoryTelemetry } from "./memory-telemetry";
import { migrateLegacyWalkForwardCheckpoint } from "./walk-forward";

function memory() {
  const usage = process.memoryUsage();
  return createMemoryTelemetry(usage, { heapSizeLimit: getHeapStatistics().heap_size_limit });
}

async function main() {
  const source = value("--source");
  const destination = value("--destination");
  const runId = value("--run-id");
  if (!source || !destination || !runId) throw new Error("Usage: backtest:walk-forward-migrate --source <legacy> --destination <compact> --run-id <id>");
  console.error(JSON.stringify({ type: "walk_forward_checkpoint_migration_start", memory: memory() }));
  const result = await migrateLegacyWalkForwardCheckpoint(source, destination, runId);
  console.log(JSON.stringify({ ...result, memoryAfter: memory() }, null, 2));
}

function value(name: string) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] ?? null : null;
}

void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
