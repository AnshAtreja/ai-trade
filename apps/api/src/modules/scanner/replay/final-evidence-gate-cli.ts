import { createHash } from "node:crypto";
import { existsSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import path from "node:path";
import { atomicResearchJson } from "./robustness-durability";
import { researchContentHash } from "./robustness";
import { buildFinalGateSpec, FINAL_GATE_SOURCES, FINAL_GATE_STRATEGIES, synthesizeFinalGate, type ArtifactInputs, type FinalGateSpec, type SourceName } from "./final-evidence-gate";

const root = path.resolve(__dirname, "../../../../../..");
const artifactRoot = path.join(root, "apps/artifacts/phase8f");
const name = "phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1";
const specPath = path.join(artifactRoot, `${name}.spec.json`);
const specMarkdownPath = path.join(artifactRoot, `${name}.spec.md`);
const resultPath = path.join(artifactRoot, `${name}.json`);
const markdownPath = path.join(artifactRoot, `${name}.md`);

function loadInputs(): ArtifactInputs {
  return Object.fromEntries((Object.keys(FINAL_GATE_SOURCES) as SourceName[]).map((key) => {
    const file = path.join(root, FINAL_GATE_SOURCES[key].path);
    const buffer = readFileSync(file);
    return [key, { sha256: createHash("sha256").update(buffer).digest("hex"), data: JSON.parse(buffer.toString("utf8")) }];
  })) as ArtifactInputs;
}

function atomicMarkdown(file: string, content: string) {
  const temporary = `${file}.${process.pid}.tmp`;
  writeFileSync(temporary, content, { mode: 0o600 });
  renameSync(temporary, file);
}

function frozenSpec(): { spec: FinalGateSpec; specHash: string } {
  const spec = buildFinalGateSpec();
  const specHash = researchContentHash(spec);
  if (!existsSync(specPath)) throw new Error("Freeze the Phase 8F.4 gate spec before applying it: run the spec command.");
  const persisted = JSON.parse(readFileSync(specPath, "utf8")) as FinalGateSpec & { specHash: string };
  const { specHash: embedded, ...payload } = persisted;
  if (embedded !== specHash || researchContentHash(payload) !== specHash) throw new Error("Frozen Phase 8F.4 gate spec does not match the current implementation.");
  return { spec: payload as FinalGateSpec, specHash };
}

function freezeSpec() {
  const spec = buildFinalGateSpec();
  const specHash = researchContentHash(spec);
  // Freeze only after all file identities are confirmed; the gate is applied by a separate command.
  const inputs = loadInputs();
  for (const name of Object.keys(FINAL_GATE_SOURCES) as SourceName[]) {
    if (inputs[name].sha256 !== FINAL_GATE_SOURCES[name].sha256) throw new Error(`Source ${name} changed before gate freeze.`);
  }
  if (existsSync(specPath)) frozenSpec();
  else atomicResearchJson(specPath, { ...spec, specHash });
  const text = ["# Phase 8F.4 Final Baseline Strategy Evidence Gate", "", `Spec: \`${spec.version}\``, `Spec SHA-256: \`${specHash}\``, "", "## Sources", "", ...Object.entries(spec.sources).map(([key, value]) => `- ${key}: \`${value.path}\` (SHA-256 \`${value.sha256}\`)`), "", "## Frozen Rules", "", "```json", JSON.stringify(spec.rules, null, 2), "```", "", "The gate reads existing artifacts only. Phase 8F.4 performs zero historical replay, parameter search, or optimized TEST executions.", ""].join("\n");
  if (existsSync(specMarkdownPath) && readFileSync(specMarkdownPath, "utf8") !== text) throw new Error("Frozen Phase 8F.4 Markdown spec differs from the current rules.");
  if (!existsSync(specMarkdownPath)) atomicMarkdown(specMarkdownPath, text);
  return { specHash, specPath, specMarkdownPath };
}

function markdown(result: ReturnType<typeof synthesizeFinalGate>) {
  const rows = result.strategyEvidenceMatrix.map((item) => `| ${item.strategy} | ${item.walkForward.testTrades} | ${item.walkForward.netPnl.toFixed(2)} | ${item.walkForward.positiveExpectancyFolds}/${item.walkForward.negativeExpectancyFolds} | ${item.robustness.locallySensitiveGroups}/${item.robustness.parameterGroups} | ${item.optimization.trainCandidatesEvaluated}/${item.optimization.trainCandidatesSurviving}/${item.optimization.frozenShortlistCount} | ${item.standaloneEvidenceStatus} | ${item.nextResearchAction} |`);
  return [
    "# Phase 8F.4 Final Baseline Strategy Evidence Gate", "", "**Phase 8:** COMPLETE", "**Phase 9:** PENDING", "", `Frozen spec: \`${result.specHash}\``, `Research content: \`${result.researchContentSha256}\``, `Baseline run: \`${result.baselineRunId}\``, "",
    "## Evidence Matrix", "", "| Strategy | TEST trades | TEST net P&L | Positive/negative TEST folds | Sensitive parameter groups | TRAIN evaluated/passed/shortlisted | Evidence status | Next research action |", "| --- | ---: | ---: | ---: | ---: | ---: | --- | --- |", ...rows, "",
    "All four v1 strategies remain frozen research baselines. Validated successors: 0. Standalone deployment evidence: insufficient for all four. No strategy v2 was created.", "",
    "## Cost And Validation Evidence", "",
    ...result.strategyEvidenceMatrix.flatMap((item) => [`### ${item.strategy}`, "", `- 8F.1 baseline status: \`${item.frozenBaselineValidation.status}\``, `- TEST expectancy: ${item.walkForward.expectancy ?? "unavailable"}; profit factor: ${item.walkForward.profitFactor ?? "unavailable"}; max drawdown: ${item.walkForward.maxDrawdown.toFixed(2)}`, `- Cost scenario net P&L: ${item.robustness.costScenarios.map((scenario) => `${scenario.scenario} ${scenario.netPnl.toFixed(2)}`).join(", ")}`, `- 8F.3 outcome: \`${item.optimization.outcome}\`; VALIDATION failure reasons: ${JSON.stringify(item.optimization.validationFailureReasons)}`, `- Deployment evidence reasons: ${item.deploymentEvidenceReasons.join(", ")}`, ""]),
    "## Phase 9 Handoff", "", ...result.phase9Handoff.allowedAssumptions.map((item) => `- Allowed: ${item}`), ...result.phase9Handoff.prohibitedAssumptions.map((item) => `- Not established: ${item}`), "", `Versioning: ${result.phase9Handoff.strategyVersioningRule}`, "", `Ablation: ${result.phase9Handoff.ablationRule}`, "",
    "## Limitations", "", ...result.limitations.map((item) => `- ${item}`), "",
    "## Execution Audit", "", `- Historical replay executions during 8F.4: ${result.noLeakageAudit.historicalReplayExecutionsThisGate}`, `- Parameter search executions during 8F.4: ${result.noLeakageAudit.parameterSearchExecutionsThisGate}`, `- Optimized TEST executions during 8F.4: ${result.noLeakageAudit.optimizedTestExecutionsThisGate}`, "",
    "Source paths, SHA-256 values, exact fold metrics, and the frozen gate rules are in the JSON artifact.", ""
  ].join("\n");
}

function verify() {
  const { spec } = frozenSpec();
  const expected = synthesizeFinalGate(spec, loadInputs());
  const actual = JSON.parse(readFileSync(resultPath, "utf8"));
  if (actual.researchContentSha256 !== expected.researchContentSha256 || researchContentHash(actual) !== researchContentHash(expected) || !existsSync(markdownPath) || readFileSync(markdownPath, "utf8") !== markdown(expected)) throw new Error("Final Phase 8F.4 artifacts differ from the validated frozen sources.");
  return { status: "VERIFIED", resultPath, markdownPath, specHash: expected.specHash, researchContentSha256: expected.researchContentSha256, counts: expected.counts, noLeakageAudit: expected.noLeakageAudit };
}

function run() {
  const { spec } = frozenSpec();
  const result = synthesizeFinalGate(spec, loadInputs());
  if (existsSync(resultPath)) {
    const prior = JSON.parse(readFileSync(resultPath, "utf8"));
    if (prior.researchContentSha256 !== result.researchContentSha256) throw new Error("Final Phase 8F.4 result identity changed.");
  }
  atomicResearchJson(resultPath, result);
  atomicMarkdown(markdownPath, markdown(result));
  return verify();
}

const command = process.argv[2] ?? "verify";
if (command === "spec") console.log(JSON.stringify(freezeSpec(), null, 2));
else if (command === "run") console.log(JSON.stringify(run(), null, 2));
else if (command === "verify") console.log(JSON.stringify(verify(), null, 2));
else throw new Error("Usage: final-evidence-gate-cli.ts [spec|run|verify]");
