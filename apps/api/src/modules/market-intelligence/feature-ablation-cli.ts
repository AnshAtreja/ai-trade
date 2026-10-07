import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { assertFeatureAblationSources, FEATURE_ABLATION_ROOT, featureAblationSpec, featureAblationSpecHash } from "./feature-ablation-spec";
import { captureAllFrozenPartitions, captureFrozenPartition } from "./feature-ablation-capture";

export const FEATURE_ABLATION_ARTIFACT_DIR = path.join(FEATURE_ABLATION_ROOT, "apps/artifacts/phase9d");

export async function writeImmutableArtifact(name: string, payload: string) {
  await mkdir(FEATURE_ABLATION_ARTIFACT_DIR, { recursive: true });
  const destination = path.join(FEATURE_ABLATION_ARTIFACT_DIR, name);
  let existing: string | null = null;
  try { existing = await readFile(destination, "utf8"); }
  catch (error) { if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error; }
  if (existing !== null) {
    if (existing !== payload) throw new Error(`Immutable artifact mismatch: ${destination}`);
    return destination;
  }
  const temporary = `${destination}.tmp-${process.pid}`;
  await writeFile(temporary, payload, { flag: "wx" });
  await rename(temporary, destination);
  return destination;
}

function specMarkdown() {
  return `# ${featureAblationSpec.version}\n\n` +
    `Spec SHA-256: \`${featureAblationSpecHash}\`. Frozen before any Phase 9D setup/context join or outcome analysis.\n\n` +
    `## Source identity\n\n` +
    `- Phase 8 final evidence research hash: \`${featureAblationSpec.sources.phase8Evidence.researchContentSha256}\`.\n` +
    `- Frozen baseline run: \`${featureAblationSpec.sources.phase8Baseline.runId}\`.\n` +
    `- Phase 9 context dataset: \`${featureAblationSpec.contextDatasetId}\`.\n` +
    `- Phase 9 regime definition: \`${featureAblationSpec.regimeDefinitionHash}\`.\n\n` +
    `## Population and access\n\n` +
    `All four frozen v1 strategies, four original folds and TRAIN/VALIDATION/TEST partitions. Capture SETUP_DETECTED evaluations and existing historical-paper trade outcomes; no new strategy rule or execution assumption. ` +
    `Decision-time context is from completed bars no later than the replay candle close. Preserve the replay/setup timestamp separately. TRAIN is primary; VALIDATION is a separate consistency check; previously examined TEST is retrospective audit only. ` +
    `Fold overlaps retain provenance and are never treated as independent samples.\n\n` +
    `## Pre-registered views\n\n` +
    `${featureAblationSpec.views.join(", ")}. These are descriptions of the unchanged baseline, not trading filters.\n\n` +
    `## Bins and sample gate\n\n` +
    `Signed returns/distances: negative, exactly zero, positive. ATR percent: zero, (0,0.5), [0.5,1), [1,2), [2,infinity). Breadth percent: below 40, 40-60 inclusive, above 60. Session-high/low distance: <=0.5 versus >0.5 percent. ` +
    `Policy-session progress is split into five equal-duration buckets, including special sessions. No outcome-dependent quantile boundaries. ` +
    `A sufficient slice needs >=30 closed trades from >=2 folds with >=5 closed trades each. Otherwise label LOW_SAMPLE or NO_SAMPLE; a zero-trade strategy has NO_ACTIVITY_FOR_FEATURE_ABLATION.\n\n` +
    `## Comparison policy\n\n` +
    `Only the four specified two-way interactions are allowed. Count every attempted comparison. No p-values, significance claims, winner search, optimization or parameter changes. ` +
    `The evidence statuses in JSON are descriptive and cannot mean TRADE, DO_NOT_TRADE, PROFITABLE or DEPLOYABLE. ` +
    `Missing/stale/gapped/insufficient context remains an explicit quality category. NIFTY/sector index VWAP is unsupported because all observed index volumes are zero.\n\n` +
    `## Reproducibility and safety\n\n` +
    `The JSON is the complete normative specification, including all feature families, metrics, interactions, source file hashes, evidence rules and no-mutation assertions. ` +
    `Capture must reproduce each Phase 8E partition's frozen metrics exactly before Phase 9 context is joined. No live/paper order path, ML, Kronos or 9E work.\n`;
}

export async function writeFeatureAblationSpec() {
  assertFeatureAblationSources();
  const json = await writeImmutableArtifact(`${featureAblationSpec.version}-${featureAblationSpecHash}.spec.json`, `${JSON.stringify({ ...featureAblationSpec, specHash: featureAblationSpecHash }, null, 2)}\n`);
  const markdown = await writeImmutableArtifact(`${featureAblationSpec.version}-${featureAblationSpecHash}.spec.md`, specMarkdown());
  return { json, markdown, specHash: featureAblationSpecHash };
}

async function main() {
  const command = process.argv[2];
  if (command === "spec") console.log(JSON.stringify({ event: "phase9d_spec_frozen", ...await writeFeatureAblationSpec() }));
  else if (command === "capture") await captureAllFrozenPartitions();
  else if (command === "capture-worker") {
    const foldId = process.argv[3];
    const partition = process.argv[4];
    if (!foldId || (partition !== "TRAIN" && partition !== "VALIDATION" && partition !== "TEST")) throw new Error("Usage: capture-worker fold-ID TRAIN|VALIDATION|TEST");
    const result = await captureFrozenPartition(foldId, partition);
    console.log(JSON.stringify({ event: "phase9d_capture_complete", foldId, partition, path: result.path,
      contentHash: result.capture.contentHash, reused: result.reused,
      setups: result.capture.strategies.reduce((sum, row) => sum + row.setups.length, 0),
      trades: result.capture.strategies.reduce((sum, row) => sum + row.trades.length, 0),
      executionIdentityDifferences: result.capture.executionIdentityDifferences ?? [] }));
  } else throw new Error("Usage: feature-ablation-cli.ts spec|capture|capture-worker");
}

if (process.argv[1]?.endsWith("feature-ablation-cli.ts")) void main().catch((error) => {
  console.error(JSON.stringify({ event: "fatal", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
