import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { DEFAULT_WALK_FORWARD_CONFIG, generateWalkForwardFolds, loadWalkForwardCheckpoint, migrateLegacyWalkForwardCheckpoint, pendingStrategiesForPartition, resolveWalkForwardArtifactPath, validateWalkForwardArtifactStorage, WALK_FORWARD_CHECKPOINT_FORMAT_VERSION, walkForwardRunId, writeWalkForwardCheckpoint } from "./walk-forward";

describe("walk-forward infrastructure", () => {
  it("generates deterministic chronological non-overlapping folds from trading dates", () => {
    const from = new Date("2025-09-18T03:45:00.000Z");
    const to = new Date("2026-09-18T03:45:00.000Z");
    const first = generateWalkForwardFolds(from, to);
    const second = generateWalkForwardFolds(from, to);
    expect(first).toEqual(second);
    expect(first.length).toBe(4);
    for (const fold of first) {
      expect(fold.train.to <= fold.validation.from).toBe(true);
      expect(fold.validation.to <= fold.test.from).toBe(true);
      expect(new Set([...fold.trainTradingDates, ...fold.validationTradingDates, ...fold.testTradingDates]).size).toBe(168);
    }
    expect(first[0]).toMatchObject({ foldId: "fold-01", trainTradingDates: { length: 126 }, validationTradingDates: { length: 21 }, testTradingDates: { length: 21 } });
  });

  it("uses explicit configuration and changes identity when methodology changes", () => {
    const metadata = { walkForwardVersion: "8E.1", universe: "U", universeManifestId: "M", datasetIds: { "1m": "A", "5m": "B" }, calendarVersion: "C", casEligibilityVersion: "CAS", interval: "1m" as const, completenessRequirement: "COMPLETE_SESSIONS" as const, parameterMode: "FROZEN_PARAMETERS" as const, strategyVersions: ["breakout:v1"], analyticsVersion: "8D.1", executionAssumptionsVersion: "8C-PAPER-EXECUTION-V1", startingCapital: 100000, config: DEFAULT_WALK_FORWARD_CONFIG, researchRange: { from: "2025-09-18T03:45:00.000Z", to: "2026-09-18T03:45:00.000Z" } };
    expect(walkForwardRunId(metadata)).not.toBe(walkForwardRunId({ ...metadata, config: { ...DEFAULT_WALK_FORWARD_CONFIG, testSessions: 20 } }));
    expect(walkForwardRunId(metadata)).not.toBe(walkForwardRunId({ ...metadata, datasetIds: { "1m": "CHANGED", "5m": "B" } }));
    expect(walkForwardRunId(metadata)).not.toBe(walkForwardRunId({ ...metadata, executionAssumptionsVersion: "CHANGED" }));
  });

  it("refuses checkpoint reuse when the research identity changes and restores counters", () => {
    const directory = mkdtempSync(join(tmpdir(), "tradepilot-8e-checkpoint-"));
    const path = join(directory, "checkpoint.json");
    try {
      writeFileSync(path, JSON.stringify({ runId: "run-a", partitions: [], performance: { optimized: true, databaseQueries: 3 } }));
      expect(loadWalkForwardCheckpoint(path, "run-a").performance).toMatchObject({ databaseQueries: 3 });
      expect(() => loadWalkForwardCheckpoint(path, "run-b")).toThrow(/identity mismatch/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resolves artifact paths independently of the application working directory and round-trips a real checkpoint", () => {
    const directory = mkdtempSync(join(tmpdir(), "tradepilot-8e-storage-"));
    const checkpoint = join(directory, "nested", "checkpoint.json");
    const metadata = { walkForwardVersion: "8E.1", universe: "U", universeManifestId: "M", datasetIds: { "1m": "A", "5m": "B" }, calendarVersion: "C", casEligibilityVersion: "CAS", interval: "1m" as const, completenessRequirement: "COMPLETE_SESSIONS" as const, parameterMode: "FROZEN_PARAMETERS" as const, strategyVersions: ["breakout:v1"], analyticsVersion: "8D.1", executionAssumptionsVersion: "8C-PAPER-EXECUTION-V1", startingCapital: 100000, config: DEFAULT_WALK_FORWARD_CONFIG, researchRange: { from: "2025-09-18T03:45:00.000Z", to: "2026-09-18T03:45:00.000Z" } };
    try {
      expect(resolveWalkForwardArtifactPath(checkpoint)).toBe(checkpoint);
      expect(validateWalkForwardArtifactStorage(checkpoint).checkpointPath).toBe(checkpoint);
      const runId = walkForwardRunId(metadata);
      writeWalkForwardCheckpoint(checkpoint, metadata, runId, [], [], { optimized: true, databaseQueries: 2 } as never);
      expect(loadWalkForwardCheckpoint(checkpoint, runId)).toMatchObject({ runId, performance: { databaseQueries: 2 } });
      expect(() => loadWalkForwardCheckpoint(checkpoint, `${runId}-changed`)).toThrow(/identity mismatch/);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("changes identity for every research-defining checkpoint dimension", () => {
    const metadata = { walkForwardVersion: "8E.1", universe: "U", universeManifestId: "M", datasetIds: { "1m": "A", "5m": "B" }, calendarVersion: "C", casEligibilityVersion: "CAS", interval: "1m" as const, completenessRequirement: "COMPLETE_SESSIONS" as const, parameterMode: "FROZEN_PARAMETERS" as const, strategyVersions: ["breakout:v1"], analyticsVersion: "8D.1", executionAssumptionsVersion: "E", startingCapital: 100000, config: DEFAULT_WALK_FORWARD_CONFIG, researchRange: { from: "2025-09-18T03:45:00.000Z", to: "2026-09-18T03:45:00.000Z" } };
    const variants = [
      { ...metadata, universeManifestId: "M2" },
      { ...metadata, calendarVersion: "C2" },
      { ...metadata, casEligibilityVersion: "CAS2" },
      { ...metadata, strategyVersions: ["momentum:v1"] }
    ];
    for (const variant of variants) expect(walkForwardRunId(metadata)).not.toBe(walkForwardRunId(variant));
  });

  it("migrates legacy per-candle result history one partition at a time without changing durable analytics", async () => {
    const directory = mkdtempSync(join(tmpdir(), "tradepilot-8e-migration-"));
    const legacy = join(directory, "legacy.json");
    const compact = join(directory, "compact.json");
    const metadata = { walkForwardVersion: "8E.1", universe: "U", universeManifestId: "M", datasetIds: { "1m": "A", "5m": "B" }, calendarVersion: "C", casEligibilityVersion: "CAS", interval: "1m" as const, completenessRequirement: "COMPLETE_SESSIONS" as const, parameterMode: "FROZEN_PARAMETERS" as const, strategyVersions: ["breakout:v1"], analyticsVersion: "8D.1", executionAssumptionsVersion: "8C-PAPER-EXECUTION-V1", startingCapital: 100000, config: DEFAULT_WALK_FORWARD_CONFIG, researchRange: { from: "2025-09-18T03:45:00.000Z", to: "2026-09-18T03:45:00.000Z" } };
    const runId = walkForwardRunId(metadata);
    const partition = { strategy: "breakout:v1", foldId: "fold-01", partition: "TRAIN", range: { from: metadata.researchRange.from, to: metadata.researchRange.to }, tradingSessions: 1, eligibleInstrumentSessions: 1, excludedSessions: [], metrics: { setups: 1, orders: 1, fills: 1, trades: 1, closedTrades: 1, incompleteTrades: 0, grossPnl: 5, charges: 1, netPnl: 4, winRate: 1, profitFactor: null, expectancy: 4, expectancyR: 1, averageR: 1, medianR: 1, maxDrawdown: 2, sharpe: null, sortino: null, averageHoldingMs: 60_000, longTrades: 1, shortTrades: 0 }, analytics: { equityCurve: [{ timestamp: metadata.researchRange.from, cash: 100000, realisedPnl: 0, unrealisedPnl: 0, equity: 100000, exposure: 0 }], drawdown: { maxDrawdownAmount: 2, maxDrawdownPercent: 0.002, maxDrawdownPeakTimestamp: metadata.researchRange.from, maxDrawdownTroughTimestamp: metadata.researchRange.to, recoveryTimestamp: null, points: [{ timestamp: metadata.researchRange.from, runningPeak: 100000, drawdownAmount: 0, drawdownPercent: 0 }] }, dailyReturns: [], metadata: {}, pnl: {}, trades: {}, returns: {}, holdingTime: {}, riskAdjusted: {}, byStrategy: [], byInstrument: [], byDirection: [], byExitReason: [], diagnostics: [] } } as any;
    try {
      writeFileSync(legacy, JSON.stringify({ runId, metadata, folds: [], partitions: [partition], performance: { optimized: true } }));
      const migration = await migrateLegacyWalkForwardCheckpoint(legacy, compact, runId);
      const restored = loadWalkForwardCheckpoint(compact, runId);
      expect(migration.migratedPartitions).toEqual([{ strategy: "breakout:v1", foldId: "fold-01", partition: "TRAIN", equityPointsRemoved: 1, drawdownPointsRemoved: 1 }]);
      expect(restored.checkpointFormatVersion).toBe(WALK_FORWARD_CHECKPOINT_FORMAT_VERSION);
      expect(restored.partitions[0]!.analytics.equityCurve).toEqual([]);
      expect(restored.partitions[0]!.analytics.drawdown.points).toEqual([]);
      expect(restored.partitions[0]!.metrics).toEqual(partition.metrics);
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });

  it("resumes a compact checkpoint by skipping only completed strategy work", () => {
    const strategies = ["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"];
    const completed = strategies.slice(0, 3).map((strategy) => ({ strategy, foldId: "fold-01", partition: "TRAIN" as const }));
    expect(pendingStrategiesForPartition(strategies, completed, "fold-01", "TRAIN")).toEqual(["opening-momentum:v1"]);
    expect(pendingStrategiesForPartition(strategies, completed, "fold-01", "VALIDATION")).toEqual(strategies);
  });
});
