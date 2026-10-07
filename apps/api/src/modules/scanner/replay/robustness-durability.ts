import { createHash } from "node:crypto";
import { mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";

export interface BatchIdentity {
  specHash: string;
  baselineRunId: string;
  category: "PARAMETER" | "COST";
  strategy: string;
  foldId: string;
  partition: string;
  variantIds?: string[];
  scenario?: string;
  from?: string;
  to?: string;
}

export function atomicResearchJson(file: string, value: unknown) {
  mkdirSync(path.dirname(file), { recursive: true });
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, JSON.stringify(value, null, 2), { mode: 0o600 });
  renameSync(temporary, file);
}

/** Validate content, not just file existence, including completed orphan results. */
export function verifyWorkerResult(file: string, expected: BatchIdentity) {
  const raw = readFileSync(file, "utf8");
  const result = JSON.parse(raw);
  const fail = () => { throw new Error(`Worker result identity/completeness mismatch: ${file}`); };
  if (result.specHash !== expected.specHash || result.baselineRunId !== expected.baselineRunId || result.strategy !== expected.strategy) fail();
  if (expected.category === "PARAMETER") {
    const ids = expected.variantIds ?? [];
    if (expected.partition === "TEST" || !ids.length || new Set(ids).size !== ids.length || result.format !== "8F2-SHARED-WORKER-1" || result.foldId !== expected.foldId || result.partition !== expected.partition || result.batchSize !== ids.length || !sameIds(result.variantIds, ids) || !Array.isArray(result.results) || !sameIds(result.results.map((row: any) => row.variantId), ids) || !(result.candles > 0) || result.scannerEvaluations !== result.candles) fail();
    for (const row of result.results) {
      if (row.strategy !== expected.strategy || row.foldId !== expected.foldId || row.partition !== expected.partition || row.metrics?.candlesProcessed !== result.candles || row.metrics?.instrumentCount !== 25 || !Number.isFinite(row.metrics?.netPnl)) fail();
    }
  } else {
    if (result.format !== "8F2-COST-WORKER-1" || result.scenario !== expected.scenario || result.from !== expected.from || result.to !== expected.to || result.interval !== "1m" || !Array.isArray(result.partitions) || result.partitions.length !== 1) fail();
    const row = result.partitions[0];
    if (row.foldId !== expected.foldId || row.partition !== "TEST" || row.range?.from !== expected.from || row.range?.to !== expected.to || !(row.tradingSessions > 0) || !Number.isFinite(row.metrics?.netPnl)) fail();
  }
  return createHash("sha256").update(raw).digest("hex");
}

function sameIds(actual: unknown, expected: string[]) {
  return Array.isArray(actual) && actual.length === expected.length && new Set(actual).size === actual.length && expected.every(id => actual.includes(id));
}
