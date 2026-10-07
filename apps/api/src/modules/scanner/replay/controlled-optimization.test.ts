import { describe, expect, it } from "vitest";
import { ACTIVE_STRATEGIES, aggregateCandidate, assertOptimizationPartition, buildControlledOptimizationSpec, controlledOptimizationSpecHash, paretoShortlist, trainEligibility, validationEligibility, type CandidateFoldMetrics } from "./controlled-optimization";
import { evaluateOptimizationRequest, verifyOptimizationCheckpoint, verifyOptimizationWorkerResult, type OptimizationWorkerRequest } from "./controlled-optimization-worker";

function row(candidateId: string, fold: number, partition: "TRAIN" | "VALIDATION", overrides: Partial<CandidateFoldMetrics> = {}): CandidateFoldMetrics {
  return { candidateId, strategy: "momentum:v1", foldId: `fold-0${fold}`, partition, closedTrades: 5, grossPnl: 500, grossProfit: 600, grossLoss: -200, charges: 100, netPnl: 400, expectancy: 80, expectancyR: 0.4, profitFactor: 3, maxDrawdown: 1000, incompleteTrades: 0, dataGapEvents: 0, ...overrides };
}

describe("Phase 8F.3 controlled optimization", () => {
  it("freezes a bounded deterministic multivariate design and excludes baseline configs", () => {
    const first = buildControlledOptimizationSpec();
    const second = buildControlledOptimizationSpec();
    expect(controlledOptimizationSpecHash(first)).toBe(controlledOptimizationSpecHash(second));
    expect(first.candidates).toHaveLength(200);
    expect(new Set(first.candidates.map((item) => item.variantId)).size).toBe(200);
    for (const strategy of ACTIVE_STRATEGIES) expect(first.candidates.filter((item) => item.strategy === strategy)).toHaveLength(64);
    expect(first.candidates.filter((item) => item.strategy === "breakdown:v1")).toHaveLength(8);
    for (const candidate of first.candidates) {
      expect(candidate.variantId).toContain(":v2-candidate-");
      expect(candidate.candidateHash).toHaveLength(16);
      expect(Object.keys(candidate.values)).toHaveLength(6);
      expect(Object.entries(candidate.values).every(([name, value]) => first.bounds.some((bound) => bound.strategy === candidate.strategy && bound.parameter === name && value >= bound.min && value <= bound.max))).toBe(true);
    }
  });

  it("rejects any TEST execution at both stages", () => {
    expect(() => assertOptimizationPartition("SEARCH", "TEST")).toThrow();
    expect(() => assertOptimizationPartition("SELECTION", "TEST")).toThrow();
    expect(() => assertOptimizationPartition("SEARCH", "VALIDATION")).toThrow();
    expect(() => assertOptimizationPartition("SELECTION", "TRAIN")).toThrow();
    expect(() => assertOptimizationPartition("SEARCH", "TRAIN")).not.toThrow();
    expect(() => assertOptimizationPartition("SELECTION", "VALIDATION")).not.toThrow();
  });

  it("gates TRAIN on activity, fold coverage, drawdown, execution validity and finite metrics", () => {
    const spec = buildControlledOptimizationSpec();
    const baseline = [1, 2, 3, 4].map((fold) => row("baseline", fold, "TRAIN"));
    const healthy = [1, 2, 3, 4].map((fold) => row("candidate", fold, "TRAIN"));
    expect(trainEligibility(healthy, baseline, spec).eligible).toBe(true);
    expect(trainEligibility(healthy.map((item) => ({ ...item, closedTrades: 1 })), baseline, spec).reasons).toContain("INSUFFICIENT_ACTIVITY");
    expect(trainEligibility(healthy.map((item, index) => ({ ...item, closedTrades: index ? 0 : 20 })), baseline, spec).reasons).toContain("INSUFFICIENT_FOLD_COVERAGE");
    expect(trainEligibility(healthy.map((item) => ({ ...item, maxDrawdown: 60000 })), baseline, spec).reasons).toContain("DRAWDOWN_LIMIT");
    expect(trainEligibility(healthy.map((item) => ({ ...item, incompleteTrades: 1 })), baseline, spec).reasons).toContain("EXECUTION_INVALID");
    expect(trainEligibility(healthy.map((item) => ({ ...item, expectancyR: null })), baseline, spec).reasons).toContain("INVALID_METRICS");
  });

  it("uses canonical aggregate P&L inputs and applies the frozen VALIDATION gate", () => {
    const spec = buildControlledOptimizationSpec();
    const baseline = [1, 2, 3, 4].map((fold) => row("baseline", fold, "VALIDATION"));
    const candidate = [1, 2, 3, 4].map((fold) => row("candidate", fold, "VALIDATION"));
    expect(aggregateCandidate(candidate)).toMatchObject({ closedTrades: 20, netPnl: 1600, profitFactor: 3, activeFolds: 4 });
    expect(validationEligibility(candidate, baseline, spec).eligible).toBe(true);
    expect(validationEligibility(candidate.map((item) => ({ ...item, expectancy: -80 })), baseline, spec).reasons).toContain("FOLD_INCONSISTENCY");
    expect(validationEligibility(candidate.map((item) => ({ ...item, closedTrades: 0, expectancy: null, expectancyR: null })), baseline, spec).reasons).toContain("ACTIVITY_COLLAPSE");
  });

  it("keeps only nondominated candidates with a deterministic tie break", () => {
    const metrics = aggregateCandidate([1, 2, 3, 4].map((fold) => row("x", fold, "TRAIN")));
    const frontier = paretoShortlist([
      { candidateId: "b", metrics },
      { candidateId: "a", metrics: { ...metrics, netPnl: metrics.netPnl + 1 } },
      { candidateId: "c", metrics: { ...metrics, expectancyR: metrics.expectancyR! + 1, maxDrawdown: metrics.maxDrawdown + 1 } }
    ], 5);
    expect(frontier.map((item) => item.candidateId)).toEqual(["a", "c"]);
  });

  it("rejects mismatched checkpoint worker data and TEST artifacts", () => {
    const request: OptimizationWorkerRequest = { specPath: "spec.json", outputPath: "result.json", specHash: "hash", stage: "SEARCH", strategy: "momentum:v1", foldId: "fold-01", partition: "TRAIN", from: "2025-09-18T03:45:00.000Z", to: "2026-03-25T03:45:00.000Z", interval: "1m", candidateIds: ["a"] };
    const result = { format: "8F3-CANDIDATE-WORKER-1", specHash: "hash", stage: "SEARCH", strategy: "momentum:v1", foldId: "fold-01", partition: "TRAIN", from: request.from, to: request.to, proof: false, candidateIds: ["a"], rows: [row("a", 1, "TRAIN")] };
    expect(verifyOptimizationWorkerResult(result, request)).toEqual(result);
    expect(() => verifyOptimizationWorkerResult({ ...result, candidateIds: ["b"] }, request)).toThrow();
    expect(() => verifyOptimizationWorkerResult(result, { ...request, partition: "TEST" })).toThrow();
    const checkpoint = { format: "8F3-BATCH-CHECKPOINT-1", specHash: "hash", stage: "SEARCH", strategy: "momentum:v1", foldId: "fold-01", partition: "TRAIN", candidateIds: ["a"], resultSha256: "content-hash" };
    expect(verifyOptimizationCheckpoint(checkpoint, request, "content-hash")).toEqual(checkpoint);
    expect(() => verifyOptimizationCheckpoint(checkpoint, request, "changed-content")).toThrow();
  });

  it("validates the persisted spec without hashing its embedded hash field", async () => {
    const spec = buildControlledOptimizationSpec();
    const hash = controlledOptimizationSpecHash(spec);
    const request: OptimizationWorkerRequest = { specPath: "spec.json", outputPath: "result.json", specHash: hash, stage: "SEARCH", strategy: "momentum:v1", foldId: "fold-01", partition: "TRAIN", from: "2025-09-18T03:45:00.000Z", to: "2026-03-25T03:45:00.000Z", interval: "1m", candidateIds: ["unknown"] };
    await expect(evaluateOptimizationRequest(request, { ...spec, specHash: hash } as typeof spec)).rejects.toThrow(/candidate identity mismatch/);
    await expect(evaluateOptimizationRequest({ ...request, specHash: "changed" }, { ...spec, specHash: hash } as typeof spec)).rejects.toThrow(/frozen specification/);
  });
});
