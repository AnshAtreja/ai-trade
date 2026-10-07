import { describe, expect, it } from "vitest";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { atomicResearchJson, verifyWorkerResult, type BatchIdentity } from "./robustness-durability";
import { generateWalkForwardFolds, runWalkForward, selectWalkForwardFolds } from "./walk-forward";
import { RESEARCH_PERIOD } from "../../historical-market-data/research-universe";
import type { HistoricalMarketDataService } from "../../historical-market-data/service";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";

describe("Robustness result durability", () => {
  it("recovers a completed orphan and rejects corrupted, missing, duplicated or mismatched results", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "8f2-orphan-"));
    const file = path.join(directory, "result.json");
    const identity: BatchIdentity = { category: "PARAMETER", specHash: "hash", baselineRunId: "baseline", strategy: "opening-momentum:v1", foldId: "fold-01", partition: "TRAIN", variantIds: ["a", "b"] };
    const result = { ...identity, format: "8F2-SHARED-WORKER-1", batchSize: 2, candles: 1000, scannerEvaluations: 1000, results: ["a", "b"].map(variantId => ({ ...identity, variantId, metrics: { candlesProcessed: 1000, instrumentCount: 25, netPnl: 0 } })) };
    try {
      atomicResearchJson(file, result);
      const bytes = readFileSync(file, "utf8");
      expect(verifyWorkerResult(file, identity)).toHaveLength(64);
      expect(readFileSync(file, "utf8")).toBe(bytes);
      for (const mutation of [{ specHash: "other" }, { baselineRunId: "other" }, { foldId: "fold-02" }, { partition: "TEST" }, { results: [] }, { results: [result.results[0], result.results[0]] }, { candles: 0 }, { variantIds: ["a", "c"] }]) {
        atomicResearchJson(file, { ...result, ...mutation });
        expect(() => verifyWorkerResult(file, identity)).toThrow();
      }
      writeFileSync(file, "{");
      expect(() => verifyWorkerResult(file, identity)).toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("rejects an empty cost result instead of calling it a completed scenario", () => {
    const directory = mkdtempSync(path.join(tmpdir(), "8f2-cost-"));
    const file = path.join(directory, "result.json");
    const identity: BatchIdentity = { category: "COST", specHash: "hash", baselineRunId: "baseline", strategy: "momentum:v1", foldId: "fold-01", partition: "TEST", scenario: "C1", from: "a", to: "b" };
    try {
      const result = { ...identity, format: "8F2-COST-WORKER-1", interval: "1m", partitions: [] as any[] };
      atomicResearchJson(file, result);
      expect(() => verifyWorkerResult(file, identity)).toThrow();
      result.partitions = [{ foldId: "fold-01", partition: "TEST", range: { from: "a", to: "b" }, tradingSessions: 21, metrics: { netPnl: 0 } }];
      atomicResearchJson(file, result);
      expect(verifyWorkerResult(file, identity)).toHaveLength(64);
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });

  it("selects a frozen fold and requests only its TEST data instead of generating folds inside TEST", async () => {
    const folds = generateWalkForwardFolds(new Date(RESEARCH_PERIOD.from), new Date(RESEARCH_PERIOD.to));
    expect(folds).toHaveLength(4);
    expect(generateWalkForwardFolds(new Date(folds[0]!.test.from), new Date(folds[0]!.test.to))).toEqual([]);
    expect(selectWalkForwardFolds(folds, ["fold-02"])).toEqual([folds[1]]);
    expect(() => selectWalkForwardFolds(folds, ["fold-99"])).toThrow();
    const reads: any[] = [];
    const service = { getHistoricalSessionPolicy: () => new NseCashInstrumentSessionPolicy(), getResearchCandles: async (request: any) => { reads.push(request); return { candles: [], eligibility: [], rejectedSessions: [] }; } } as unknown as HistoricalMarketDataService;
    const result = await runWalkForward({ foldIds: ["fold-02"], allowedPartitions: ["TEST"], strategies: ["momentum:v1"], tokens: ["738561"], service });
    expect(result.partitions).toHaveLength(1);
    expect(result.partitions[0]).toMatchObject({ foldId: "fold-02", partition: "TEST", range: folds[1]!.test });
    expect(reads).toEqual([{ instrumentToken: "738561", interval: "1m", from: folds[1]!.test.from, to: folds[1]!.test.to, requireCompleteSession: true }]);
  });
});
