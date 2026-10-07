import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it } from "vitest";
import { researchContentHash } from "./robustness";
import { buildFinalGateSpec, classifyStrategy, FINAL_GATE_SOURCES, synthesizeFinalGate, validateFinalGateSources, type ArtifactInputs, type SourceName } from "./final-evidence-gate";

const root = path.resolve(__dirname, "../../../../../..");
let inputs: ArtifactInputs;

beforeAll(() => {
  inputs = Object.fromEntries((Object.keys(FINAL_GATE_SOURCES) as SourceName[]).map((name) => {
    const bytes = readFileSync(path.join(root, FINAL_GATE_SOURCES[name].path));
    return [name, { sha256: createHash("sha256").update(bytes).digest("hex"), data: JSON.parse(bytes.toString("utf8")) }];
  })) as ArtifactInputs;
});

describe("Phase 8F.4 final evidence gate", () => {
  it("validates every frozen source identity, matrix and no-TEST audit", () => {
    const spec = buildFinalGateSpec();
    expect(validateFinalGateSources(spec, inputs)).toBe(true);
    const report = synthesizeFinalGate(spec, inputs);
    expect(report.counts).toEqual({ retainedResearchBaselines: 4, validatedSuccessors: 0, strategiesRequiringRedesign: 1, strategiesWithInsufficientDeploymentEvidence: 4 });
    expect(report.strategyEvidenceMatrix.map((row) => [row.strategy, row.standaloneEvidenceStatus, row.nextResearchAction])).toEqual([
      ["breakout:v1", "NEGATIVE_OR_INCONSISTENT_BASELINE_EVIDENCE", "PRESERVE_AS_COMPARATOR_ONLY"],
      ["breakdown:v1", "NO_ACTIVITY_EVIDENCE", "STRATEGY_REDESIGN_REQUIRED"],
      ["momentum:v1", "EVIDENCE_SUPPORTS_FURTHER_RESEARCH", "CONTEXT_FEATURE_RESEARCH"],
      ["opening-momentum:v1", "NEGATIVE_OR_INCONSISTENT_BASELINE_EVIDENCE", "PRESERVE_AS_COMPARATOR_ONLY"]
    ]);
    expect(report.noLeakageAudit).toEqual({ historicalReplayExecutionsThisGate: 0, parameterSearchExecutionsThisGate: 0, optimizedTestExecutionsThisGate: 0, source8f2PerturbedTestExecutions: 0, source8f3OptimizedTestExecutions: 0 });
    expect(report.phase8Status).toBe("COMPLETE");
    expect(report.phase9Status).toBe("PENDING");
    expect(report.strategyEvidenceMatrix.every((row) => !row.deploymentEvidenceReasons.includes("NO_VALIDATED_SUCCESSOR"))).toBe(true);
  });

  it("rejects changed source bytes and changed research content", () => {
    const spec = buildFinalGateSpec();
    expect(() => validateFinalGateSources(spec, { ...inputs, optimization8f3: { ...inputs.optimization8f3, sha256: "changed" } })).toThrow(/file SHA-256 mismatch/);
    const original = inputs.optimization8f3.data;
    const changed = { ...original, counts: { ...original.counts, optimizedCandidateTestExecutions: 1 } };
    expect(() => validateFinalGateSources(spec, { ...inputs, optimization8f3: { ...inputs.optimization8f3, data: changed } })).toThrow(/research content hash/);
    expect(() => validateFinalGateSources({ ...spec, rules: { ...spec.rules, noNewResearch: { ...spec.rules.noNewResearch, optimizedTestExecutions: 1 as 0 } } }, inputs)).toThrow(/frozen gate spec changed/);
  });

  it("applies the frozen dispositions by evidence, not strategy name", () => {
    const rules = buildFinalGateSpec().rules;
    const example: any = {
      walkForward: { testTrades: 16, netPnl: 100, negativeExpectancyFolds: 3 },
      frozenBaselineValidation: { status: "POSITIVE_OOS_BUT_LOW_SAMPLE_AND_MIXED_FOLD_EVIDENCE" },
      robustness: { locallySensitiveGroups: 6, costScenarios: [{ netPnl: 90 }] },
      optimization: { outcome: "NO_ACCEPTABLE_CANDIDATE", selectedSuccessors: 0 }
    };
    expect(classifyStrategy(example, rules).standaloneEvidenceStatus).toBe("EVIDENCE_SUPPORTS_FURTHER_RESEARCH");
    expect(classifyStrategy({ ...example, robustness: { ...example.robustness, costScenarios: [{ netPnl: -1 }] } }, rules).standaloneEvidenceStatus).toBe("NEGATIVE_OR_INCONSISTENT_BASELINE_EVIDENCE");
    expect(classifyStrategy({ ...example, walkForward: { ...example.walkForward, testTrades: 0, netPnl: 0 }, optimization: { outcome: "BREAKDOWN_NO_VIABLE_ACTIVITY", selectedSuccessors: 0 } }, rules).nextResearchAction).toBe("STRATEGY_REDESIGN_REQUIRED");
  });

  it("produces an identical content hash on repeated synthesis", () => {
    const spec = buildFinalGateSpec();
    const first = synthesizeFinalGate(spec, inputs);
    const second = synthesizeFinalGate(spec, inputs);
    expect(first).toEqual(second);
    const { researchContentSha256, ...content } = first;
    expect(researchContentHash(content)).toBe(researchContentSha256);
    expect(researchContentHash({ ...content, phase9Status: "COMPLETE" })).not.toBe(researchContentSha256);
  });
});
