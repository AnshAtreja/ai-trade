import { describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { adaptPhase8F2ClassificationMetrics, assertParameterResearchPartition, buildRobustnessSpec, durableClassificationMetrics, executionConfigForScenario, loadSharedBatchCheckpoint, parameterStatus, researchContentHash, robustnessSpecHash, runSharedParameterBatch, writeSharedBatchCheckpoint } from "./robustness";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";

describe("Phase 8F.2 robustness specification", () => {
  it("creates a deterministic one-at-a-time grid without parameter/cost combinations", () => {
    const first = buildRobustnessSpec();
    const second = buildRobustnessSpec();
    expect(first).toEqual(second);
    expect(first.parameters).toHaveLength(24);
    expect(first.parameterVariants).toHaveLength(120);
    expect(first.workload.newParameterVariants).toBe(96);
    expect(first.workload.trainValidationEvaluations).toBe(768);
    expect(first.workload.costStressEvaluations).toBe(96);
    expect(new Set(first.parameterVariants.map((item) => `${item.strategy}|${item.parameter}|${item.level}`)).size).toBe(120);
  });

  it("freezes the spec identity and preserves the predefined cost order", () => {
    const spec = buildRobustnessSpec();
    expect(robustnessSpecHash(spec)).toBe(robustnessSpecHash(buildRobustnessSpec()));
    expect(spec.costScenarios.map((item) => item.id)).toEqual(["C0", "C1", "C2", "S1", "S2", "CS1"]);
    expect(executionConfigForScenario("C1")).toMatchObject({ chargeRateBps: 4.5, slippagePolicy: "NONE" });
    expect(executionConfigForScenario("S2")).toMatchObject({ chargeRateBps: 3, slippagePolicy: "BPS", slippageBps: 4 });
  });

  it("classifies activity descriptively without selecting a winner", () => {
    expect(parameterStatus([])).toBe("NO_VALID_PERTURBATION");
    expect(parameterStatus([{ metrics: { trades: 0, expectancy: null, expectancyR: null, maxDrawdown: 0 } }])).toBe("INSUFFICIENT_ACTIVITY");
    expect(parameterStatus([{ metrics: { trades: 2, expectancy: 1, expectancyR: 1, maxDrawdown: 1 } }, { metrics: { trades: 2, expectancy: -1, expectancyR: -1, maxDrawdown: 2 } }])).toBe("LOCALLY_SENSITIVE");
  });

  it("adapts only the explicit durable classification schema", () => {
    expect(() => adaptPhase8F2ClassificationMetrics({ positionsClosed: 1, netPnl: 10 })).toThrow(/incompatible schema/);
    expect(adaptPhase8F2ClassificationMetrics({ schemaVersion: "8F2-CLASSIFICATION-METRICS-1", closedTradeCount: 2, expectancyPnl: 10, expectancyR: 0.5, validRTradeCount: 2, maxDrawdownAmount: 4 }))
      .toEqual({ trades: 2, expectancy: 10, expectancyR: 0.5, maxDrawdown: 4 });
    expect(adaptPhase8F2ClassificationMetrics({ schemaVersion: "8F2-CLASSIFICATION-METRICS-1", closedTradeCount: 0, expectancyPnl: null, expectancyR: null, validRTradeCount: 0, maxDrawdownAmount: 0 }))
      .toEqual({ trades: 0, expectancy: null, expectancyR: null, maxDrawdown: 0 });
    expect(() => durableClassificationMetrics({ classificationMetrics: { closedTradeCount: 1, sumNetPnl: 10, expectancyPnl: null, validRTradeCount: 1, sumR: 1, expectancyR: 1 } } as any, 0)).toThrow(/monetary expectancy/);
  });

  it("hashes research content independently from operational telemetry", () => {
    const content = { spec: "frozen", rows: [{ variant: "a", netPnl: 10 }], counts: { rows: 1 } };
    const first = researchContentHash(content);
    const second = researchContentHash({ counts: { rows: 1 }, rows: [{ netPnl: 10, variant: "a" }], spec: "frozen" });
    expect(first).toBe(second);
    expect(first).not.toBe(researchContentHash({ ...content, rows: [{ variant: "a", netPnl: 11 }] }));
  });

  it("fans one bounded replay into isolated variant runtimes", async () => {
    const spec = buildRobustnessSpec();
    const variants = spec.parameterVariants.filter((item) => item.strategy === "breakout:v1" && item.level !== 0).slice(0, 2);
    const result = await runSharedParameterBatch({ candles: [], tokens: ["738561"], from: "2026-09-15T03:45:00.000Z", to: "2026-09-15T04:00:00.000Z", interval: "1m", strategyId: "breakout:v1", variants, sessionPolicy: new NseCashInstrumentSessionPolicy() });
    expect([...result.keys()]).toEqual(variants.map((item) => item.variantId));
    expect(result.get(variants[0]!.variantId)!.execution).not.toBe(result.get(variants[1]!.variantId)!.execution);
  });

  it("keeps shared results independent of deterministic batch size", async () => {
    const spec = buildRobustnessSpec();
    const variants = spec.parameterVariants.filter((item) => item.strategy === "breakout:v1" && item.level !== 0).slice(0, 2);
    const input = { candles: [], tokens: ["738561"], from: "2026-09-15T03:45:00.000Z", to: "2026-09-15T04:00:00.000Z", interval: "1m" as const, strategyId: "breakout:v1", sessionPolicy: new NseCashInstrumentSessionPolicy() };
    const one = await Promise.all(variants.map((variant) => runSharedParameterBatch({ ...input, variants: [variant] })));
    const all = await runSharedParameterBatch({ ...input, variants });
    expect(one.map((batch) => [...batch.values()][0]!.execution.summary)).toEqual([...all.values()].map((item) => item.execution.summary));
  });

  it("writes and resumes variant-specific checkpoints without permitting TEST parameters", () => {
    const directory = mkdtempSync(join(tmpdir(), "tradepilot-8f2-shared-"));
    const file = join(directory, "batch.json");
    try {
      const spec = buildRobustnessSpec();
      const hash = robustnessSpecHash(spec);
      writeSharedBatchCheckpoint(file, { format: "8F2-SHARED-BATCH-1", specHash: hash, baselineRunId: spec.baseline.runId, strategy: "momentum:v1", completedVariantIds: ["b", "a"] });
      expect(loadSharedBatchCheckpoint(file, hash, spec.baseline.runId).completedVariantIds).toEqual(["a", "b"]);
      expect(() => loadSharedBatchCheckpoint(file, "changed", spec.baseline.runId)).toThrow(/identity mismatch/);
      expect(() => assertParameterResearchPartition("TEST")).toThrow(/forbidden/);
      expect(() => assertParameterResearchPartition("TRAIN")).not.toThrow();
    } finally { rmSync(directory, { recursive: true, force: true }); }
  });
});
