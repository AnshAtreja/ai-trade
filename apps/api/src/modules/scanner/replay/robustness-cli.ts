import { mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { researchUniverseInstruments, RESEARCH_PERIOD } from "../../historical-market-data/research-universe";
import { buildRobustnessSpec, compactRobustnessRows, frozenBaselineArtifactPath, loadFrozenBaselinePartitions, robustnessSpecHash, runCostScenario, runParameterVariant, type RobustnessRunConfig } from "./robustness";

async function main() {
  const root = path.resolve(process.cwd(), "../../");
  const artifactRoot = path.resolve(root, "apps/artifacts/phase8f");
  const specPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.spec.json");
  const loaded = JSON.parse(readFileSync(specPath, "utf8")) as ReturnType<typeof buildRobustnessSpec> & { specHash: string };
  const spec = buildRobustnessSpec();
  const specHash = robustnessSpecHash(spec);
  if (loaded.specHash !== specHash) throw new Error(`Frozen Phase 8F.2 spec hash mismatch: expected ${loaded.specHash}, computed ${specHash}.`);
  mkdirSync(artifactRoot, { recursive: true });
  const checkpointRoot = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1-checkpoints");
  mkdirSync(checkpointRoot, { recursive: true });
  const specMarkdownPath = path.join(artifactRoot, "robustness-1fd46d5ef1f0e98f-v1.md");
  writeFileSync(specMarkdownPath, `# Phase 8F.2 Robustness Specification\n\n- Version: ${spec.version}\n- Spec hash: ${specHash}\n- Baseline run: ${spec.baseline.runId}\n- Dataset IDs: 1m ${spec.baseline.datasetIds["1m"]}, 5m ${spec.baseline.datasetIds["5m"]}\n- Parameters: ${spec.parameters.length}\n- Non-baseline OAT variants: ${spec.workload.newParameterVariants}\n- TRAIN/VALIDATION evaluations: ${spec.workload.trainValidationEvaluations}\n- TEST cost-stress evaluations: ${spec.workload.costStressEvaluations}\n\nParameter variants are TRAIN/VALIDATION-only. Cost scenarios are TEST-only with frozen parameters. This specification does not select or optimize a strategy.\n`);

  const summary = { version: spec.version, specHash, specPath, workload: spec.workload, parameters: spec.parameters, costScenarios: spec.costScenarios, frozenBaselineArtifact: frozenBaselineArtifactPath(root), execution: "No experiment launched. Use --smoke or --run explicitly." };
  if (!process.argv.includes("--run") && !process.argv.includes("--smoke")) { console.log(JSON.stringify(summary, null, 2)); return; }

  const runConfig: RobustnessRunConfig = { from: value("--from") ?? RESEARCH_PERIOD.from, to: value("--to") ?? RESEARCH_PERIOD.to, interval: (value("--interval") ?? "1m") as "1m" | "5m", walkForward: { trainSessions: number("--train-sessions", 126), validationSessions: number("--validation-sessions", 21), testSessions: number("--test-sessions", 21), stepSessions: number("--step-sessions", 21) }, tokens: values("--tokens").flatMap((item) => item.split(",")).filter(Boolean), startingCapital: number("--starting-capital", 100000), smoke: process.argv.includes("--smoke") };
  if (!runConfig.tokens?.length) runConfig.tokens = researchUniverseInstruments.map((item) => item.instrumentToken);
  runConfig.onCheckpoint = (checkpoint) => process.stderr.write(`${JSON.stringify({ type: "phase8f2_checkpoint", ...checkpoint, specHash })}\n`);
  const nonBaselineVariants = spec.parameterVariants.filter((variant) => variant.level !== 0);
  const variants = process.argv.includes("--smoke") ? nonBaselineVariants.slice(0, 1) : nonBaselineVariants;
  const results: unknown[] = [];
  for (const variant of variants) {
    const checkpoint = path.join(checkpointRoot, `parameter-${variant.variantId}.checkpoint.json`);
    const result = await runParameterVariant(runConfig, variant, checkpoint);
    results.push({ variantId: variant.variantId, rows: result.partitions.length, partitions: compactRobustnessRows(result, variant.variantId, "PARAMETER") });
  }
  const frozen = loadFrozenBaselinePartitions(frozenBaselineArtifactPath(root));
  const costResults: unknown[] = [{ strategy: "ALL", scenario: "C0", status: "BASELINE_REUSED_FROM_PHASE_8E", partitions: frozen.filter((row) => row.partition === "TEST").map((row) => ({ strategy: row.strategy, foldId: row.foldId, partition: row.partition, metrics: row.metrics })) }];
  const strategies = ["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"] as const;
  const scenarios = process.argv.includes("--smoke") ? (["C1"] as const) : spec.costScenarios.map((item) => item.id).filter((item) => item !== "C0");
  for (const strategy of strategies) for (const scenario of scenarios) {
    const checkpoint = path.join(checkpointRoot, `cost-${strategy.replace(":", "-")}-${scenario}.checkpoint.json`);
    const result = await runCostScenario(runConfig, strategy, scenario, checkpoint);
    costResults.push({ strategy, scenario, rows: result.partitions.length, partitions: result.partitions.map((row) => ({ foldId: row.foldId, metrics: row.metrics })) });
  }
  const output = { ...summary, results, costResults };
  const outputPath = path.join(artifactRoot, `robustness-1fd46d5ef1f0e98f-v1${process.argv.includes("--smoke") ? ".smoke" : ""}.json`);
  writeFileSync(outputPath, JSON.stringify(output, null, 2));
  console.log(JSON.stringify({ ...summary, outputPath, parameterRuns: results.length, costRuns: costResults.length }, null, 2));
}
function values(name: string) { const out: string[] = []; for (let i = 0; i < process.argv.length; i += 1) if (process.argv[i] === name && process.argv[i + 1]) out.push(process.argv[i + 1]!); return out; }
function value(name: string) { return values(name)[0] ?? null; }
function number(name: string, fallback: number) { const parsed = Number(value(name)); return Number.isFinite(parsed) ? parsed : fallback; }
void main().catch((error) => { console.error(error instanceof Error ? error.message : error); process.exit(1); });
