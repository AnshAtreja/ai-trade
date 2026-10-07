import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import path from "node:path";
import assert from "node:assert/strict";
import { runWalkForward, FROZEN_BASELINE_STRATEGIES, type WalkForwardPartition, type WalkForwardPartitionResult, type WalkForwardResearchCapture } from "../scanner/replay/walk-forward";
import type { HistoricalPaperTrade } from "../scanner/replay/historical-paper-execution";
import { FEATURE_ABLATION_ARTIFACT_DIR, writeImmutableArtifact } from "./feature-ablation-cli";
import { assertFeatureAblationSources, FEATURE_ABLATION_ROOT, featureAblationSpec, featureAblationSpecHash } from "./feature-ablation-spec";

export interface CapturedSetup {
  setupId: string;
  instrumentToken: string;
  tradingSymbol: string;
  direction: string;
  replayTimestamp: string;
  setupTimestamp: string;
  decisionAvailableAt: string;
}

export interface CapturedStrategy {
  strategy: string;
  setups: CapturedSetup[];
  trades: HistoricalPaperTrade[];
  metrics: WalkForwardPartitionResult["metrics"];
}

export interface FeatureAblationCapture {
  format: "9D-FROZEN-PARTITION-CAPTURE-1";
  specHash: string;
  baselineRunId: string;
  foldId: string;
  partition: WalkForwardPartition;
  range: { from: string; to: string };
  strategies: CapturedStrategy[];
  executionIdentityDifferences?: Array<{ strategy: string; frozenExecutionRunId: string;
    observedExecutionRunId: string; replayRunId: string; classification: "EXECUTION_ID_ONLY" }>;
  contentHash: string;
}

export function compareFrozenAnalytics(actual: WalkForwardPartitionResult["analytics"],
  frozen: WalkForwardPartitionResult["analytics"]) {
  const actualRunId = actual.metadata.runId;
  const frozenRunId = frozen.metadata.runId;
  assert.deepStrictEqual({ ...actual, metadata: { ...actual.metadata, runId: null } },
    { ...frozen, metadata: { ...frozen.metadata, runId: null } });
  return actualRunId === frozenRunId ? null : { frozenExecutionRunId: frozenRunId, observedExecutionRunId: actualRunId };
}

export function captureFileName(foldId: string, partition: WalkForwardPartition) {
  return `capture-${featureAblationSpecHash.slice(0, 16)}-${foldId}-${partition}.json`;
}

export function validateCapture(value: FeatureAblationCapture, foldId: string, partition: WalkForwardPartition) {
  if (value.format !== "9D-FROZEN-PARTITION-CAPTURE-1" || value.specHash !== featureAblationSpecHash ||
      value.baselineRunId !== featureAblationSpec.sources.phase8Baseline.runId || value.foldId !== foldId || value.partition !== partition ||
      JSON.stringify(value.strategies.map((item) => item.strategy)) !== JSON.stringify(FROZEN_BASELINE_STRATEGIES)) {
    throw new Error(`Incompatible 9D capture ${foldId}/${partition}`);
  }
  const { contentHash, ...core } = value;
  if (createHash("sha256").update(JSON.stringify(core)).digest("hex") !== contentHash) throw new Error(`Corrupt 9D capture ${foldId}/${partition}`);
  return value;
}

export function readCapture(foldId: string, partition: WalkForwardPartition): FeatureAblationCapture | null {
  const target = path.join(FEATURE_ABLATION_ARTIFACT_DIR, captureFileName(foldId, partition));
  try { return validateCapture(JSON.parse(readFileSync(target, "utf8")) as FeatureAblationCapture, foldId, partition); }
  catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return null;
    throw error;
  }
}

export async function captureFrozenPartition(foldId: string, partition: WalkForwardPartition) {
  assertFeatureAblationSources();
  const existing = readCapture(foldId, partition);
  if (existing) return { path: path.join(FEATURE_ABLATION_ARTIFACT_DIR, captureFileName(foldId, partition)), capture: existing, reused: true };
  const baseline = JSON.parse(readFileSync(path.resolve(FEATURE_ABLATION_ROOT, featureAblationSpec.sources.phase8Baseline.path), "utf8")) as {
    runId: string; partitions: WalkForwardPartitionResult[];
  };
  assert.equal(baseline.runId, featureAblationSpec.sources.phase8Baseline.runId);
  const setups = new Map<string, CapturedSetup[]>(FROZEN_BASELINE_STRATEGIES.map((strategy) => [strategy, []]));
  const trades = new Map<string, HistoricalPaperTrade[]>();
  const executionIdentityDifferences: NonNullable<FeatureAblationCapture["executionIdentityDifferences"]> = [];
  const capture: WalkForwardResearchCapture = {
    onSetup: (meta, setup) => {
      if (meta.foldId !== foldId || meta.partition !== partition) throw new Error("Unexpected 9D setup partition");
      const atMs = Date.parse(meta.replayTimestamp);
      setups.get(meta.strategy)!.push({
        setupId: setup.setupIdentity, instrumentToken: setup.instrumentToken,
        tradingSymbol: setup.tradingSymbol, direction: setup.direction,
        replayTimestamp: meta.replayTimestamp, setupTimestamp: setup.timestamp,
        decisionAvailableAt: new Date(atMs + 60_000).toISOString()
      });
    },
    onExecution: (meta, execution, result) => {
      if (meta.foldId !== foldId || meta.partition !== partition) throw new Error("Unexpected 9D execution partition");
      const frozen = baseline.partitions.find((row) => row.foldId === foldId && row.partition === partition && row.strategy === meta.strategy);
      if (!frozen) throw new Error(`Missing frozen baseline result for ${foldId}/${partition}/${meta.strategy}`);
      assert.deepStrictEqual(result.metrics, frozen.metrics, `Phase 8E metrics changed for ${foldId}/${partition}/${meta.strategy}`);
      try {
        const difference = compareFrozenAnalytics(result.analytics, frozen.analytics);
        if (difference) executionIdentityDifferences.push({ strategy: meta.strategy, ...difference,
          replayRunId: execution.replayRunId, classification: "EXECUTION_ID_ONLY" });
      } catch (error) {
        const detail = error instanceof Error ? error.message : String(error);
        console.error(JSON.stringify({ event: "phase9d_analytics_mismatch", foldId, partition, strategy: meta.strategy,
          detail: detail.slice(0, 4_000) }));
        throw new Error(`Phase 8E analytics changed for ${foldId}/${partition}/${meta.strategy}`);
      }
      if (setups.get(meta.strategy)!.length !== frozen.metrics.setups) throw new Error(`Setup capture count differs from Phase 8E for ${meta.strategy}`);
      trades.set(meta.strategy, execution.trades);
    }
  };
  const run = await runWalkForward({ foldIds: [foldId], allowedPartitions: [partition], strategies: FROZEN_BASELINE_STRATEGIES,
    optimized: true, researchCapture: capture, onProgress: (progress) => {
      if (progress.stage === "REPLAYING" && progress.processedCandles % 5000 === 0) {
        console.log(JSON.stringify({ event: "phase9d_capture_progress", foldId, partition, processedCandles: progress.processedCandles,
          totalCandles: progress.totalCandles, elapsedMs: progress.elapsedMs }));
      }
    }
  });
  if (run.runId !== baseline.runId || run.partitions.length !== FROZEN_BASELINE_STRATEGIES.length) {
    throw new Error(`Phase 8E run identity/partition count mismatch for ${foldId}/${partition}`);
  }
  const rows = FROZEN_BASELINE_STRATEGIES.map((strategy): CapturedStrategy => {
    const result = run.partitions.find((row) => row.strategy === strategy)!;
    if (!trades.has(strategy)) throw new Error(`No execution capture for ${strategy}`);
    return { strategy, setups: setups.get(strategy)!, trades: trades.get(strategy)!, metrics: result.metrics };
  });
  const core = { format: "9D-FROZEN-PARTITION-CAPTURE-1" as const, specHash: featureAblationSpecHash,
    baselineRunId: baseline.runId, foldId, partition, range: run.partitions[0]!.range, strategies: rows,
    ...(executionIdentityDifferences.length ? { executionIdentityDifferences } : {}) };
  const contentHash = createHash("sha256").update(JSON.stringify(core)).digest("hex");
  const value = { ...core, contentHash };
  const target = await writeImmutableArtifact(captureFileName(foldId, partition), `${JSON.stringify(value)}\n`);
  return { path: target, capture: value, reused: false };
}

export async function captureAllFrozenPartitions() {
  assertFeatureAblationSources();
  for (const foldId of featureAblationSpec.population.folds) {
    for (const partition of featureAblationSpec.population.partitions as WalkForwardPartition[]) {
      const existing = readCapture(foldId, partition);
      if (existing) {
        console.log(JSON.stringify({ event: "phase9d_capture_reused", foldId, partition, contentHash: existing.contentHash }));
        continue;
      }
      await new Promise<void>((resolve, reject) => {
        const child = spawn(process.execPath, ["--import", "tsx", path.resolve(__dirname, "feature-ablation-cli.ts"), "capture-worker", foldId, partition],
          { cwd: path.resolve(FEATURE_ABLATION_ROOT, "apps/api"), stdio: "inherit" });
        child.once("error", reject);
        child.once("exit", (code, signal) => code === 0 ? resolve() : reject(new Error(`9D capture worker ${foldId}/${partition} exited ${code ?? signal}`)));
      });
      if (!readCapture(foldId, partition)) throw new Error(`9D worker did not write ${foldId}/${partition}`);
    }
  }
}
