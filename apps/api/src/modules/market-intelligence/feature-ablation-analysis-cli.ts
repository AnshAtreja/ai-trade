import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { analyzeFeatureAblation } from "./feature-ablation-analysis";
import { FEATURE_ABLATION_ARTIFACT_DIR, writeImmutableArtifact } from "./feature-ablation-cli";
import { featureAblationSpecHash } from "./feature-ablation-spec";
import type { JoinManifest } from "./feature-ablation-join";

function reportMarkdown(result: Awaited<ReturnType<typeof analyzeFeatureAblation>>["result"]) {
  const baseline = result.groups.filter((row) => row.feature === "BASELINE" && row.foldId !== "ALL_FOLDS");
  const headlineFeatures = ["market.trend", "market.volatility", "market.breadth.confirmation",
    "sector.relativeToMarket", "instrumentVsMarket.15m", "instrumentVsSector.15m", "sessionProgressFifth"];
  const headline = result.groups.filter((row) => row.foldId === "ALL_FOLDS" && headlineFeatures.includes(row.feature));
  const lines = [
    "# Phase 9D - Historical Feature Validation and Ablation",
    "",
    `Result ID: \`${result.resultId}\`; spec SHA-256: \`${result.specHash}\`; Phase 8 baseline: \`${result.phase8RunId}\`.`,
    "",
    "This is a retrospective descriptive analysis of unchanged frozen strategies. TEST is an audit partition, not fresh selection data. No strategy or regime threshold was changed.",
    "",
    "## Population",
    "",
    `- Setup evaluations: ${result.population.setupEvaluations}; distinct fold-specific setup identities: ${result.population.distinctSetups}.`,
    `- Closed trades: ${result.population.closedTrades}; joined unique instrument/time context points: ${result.population.joinedContextPoints}; missing points: ${result.population.missingContextPoints}.`,
    `- Child execution-ID-only differences versus the old compact baseline: ${result.executionIdentityDifferences.length}. All substantive partition analytics remain exact; see JSON for each ID pair.`,
    "- Overlapping folds are not independent observations. A repeated setup evaluation does not multiply its associated trade outcome.",
    "",
    "## Frozen baseline by fold",
    "",
    "| Strategy | Fold | Partition | Setup evaluations | Closed trades | Net P&L |",
    "| --- | --- | --- | ---: | ---: | ---: |",
    ...baseline.map((row) => `| ${row.strategy} | ${row.foldId} | ${row.partition} | ${row.setupEvaluations} | ${row.closedTrades} | ${row.netPnl.toFixed(2)} |`),
    "",
    "## Context quality",
    "",
    "| Feature | Available | Missing or limited quality |",
    "| --- | ---: | --- |",
    ...Object.entries(result.featureQuality).map(([name, counts]) => `| ${name} | ${counts.AVAILABLE ?? 0} | ${Object.entries(counts)
      .filter(([quality]) => quality !== "AVAILABLE").map(([quality, count]) => `${quality}: ${count}`).join(", ") || "none"} |`),
    "",
    "## Feature-family disposition",
    "",
    "| Family | Available setup-feature observations | Disposition |",
    "| --- | ---: | --- |",
    ...result.featureFamilies.map((item) => `| ${item.family} | ${item.availableSetupFeatures} | ${item.disposition} |`),
    "",
    "## Pre-registered context slices",
    "",
    "| Strategy | Partition | Feature | Bin | Distinct setups | Closed trades | Net P&L | Expectancy | Sample |",
    "| --- | --- | --- | --- | ---: | ---: | ---: | ---: | --- |",
    ...headline.map((row) => `| ${row.strategy} | ${row.partition} | ${row.feature} | ${row.bin} | ${row.distinctSetups} | ${row.closedTrades} | ${row.netPnl.toFixed(2)} | ${row.expectancy?.toFixed(2) ?? "n/a"} | ${row.sampleStatus} |`),
    "",
    "## Feature redundancy",
    "",
    "| Feature pair | Paired observations | Pearson r |",
    "| --- | ---: | ---: |",
    ...result.redundancy.map((row) => `| ${row.features.join(" / ")} | ${row.observations} | ${row.pearsonR?.toFixed(4) ?? "n/a"} |`),
    "",
    "## Evidence guardrails",
    "",
    `- Sample gate: at least 30 closed trades in at least two folds with at least five trades each. Across TRAIN/VALIDATION/TEST, the frozen baselines have ${result.population.closedTrades} closed strategy-partition trade records.`,
    `- Pre-registered descriptive contrasts reported: ${result.multipleComparisons.preRegisteredDescriptiveContrasts}; interaction contrasts: ${result.multipleComparisons.exploratoryInteractionContrasts}; inferential tests: 0.`,
    "- Each group retains setup/trade sample size, fold provenance, quality, concentration and complement effect sizes in the machine-readable JSON.",
    "- Conditioned max drawdown is deliberately null: selected trade outcomes do not reconstruct an execution equity path.",
    "- Index VWAP is unavailable because every observed Kite index volume is zero. The two index provider gaps remain missing.",
    "- Phase 9D does not establish deployability or a new strategy. Phase 9E remains pending.",
    ""
  ];
  return lines.join("\n");
}

async function main() {
  const candidates: Array<{ path: string; manifest: JoinManifest }> = [];
  for (const name of await readdir(FEATURE_ABLATION_ARTIFACT_DIR)) {
    if (!/^join-[0-9a-f]{24}\.json$/.test(name)) continue;
    const location = path.join(FEATURE_ABLATION_ARTIFACT_DIR, name);
    const manifest = JSON.parse(await readFile(location, "utf8")) as JoinManifest;
    if (manifest.specHash === featureAblationSpecHash) candidates.push({ path: location, manifest });
  }
  if (candidates.length !== 1) throw new Error(`Expected one current 9D join manifest, found ${candidates.length}`);
  const { path: joinManifestPath, manifest } = candidates[0]!;
  const pointsPath = path.join(FEATURE_ABLATION_ARTIFACT_DIR, `join-points-${manifest.joinId}.ndjson`);
  const { result, resultPath } = await analyzeFeatureAblation({ joinManifestPath, pointsPath });
  const reportPath = await writeImmutableArtifact(`feature-ablation-${result.resultId}.md`, reportMarkdown(result));
  console.log(JSON.stringify({ event: "phase9d_analysis_complete", resultPath, reportPath, resultId: result.resultId,
    specHash: result.specHash, population: result.population, comparisons: result.multipleComparisons }));
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: "fatal", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
