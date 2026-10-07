import { readFile, mkdir, rename, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { KiteHistoricalMarketDataProvider } from "../historical-market-data/kite-historical-provider";
import { benchmarkRegistry, contextUniverseId } from "./context-universe";
import { buildIndexContextManifest, INDEX_CONTEXT_FROM, INDEX_CONTEXT_TO } from "./context-dataset";
import { analyzeRealContext, stableRegimeArtifact } from "./context-regime-analysis";
import { regimeDefinitionHash } from "./regime-definition";

function artifactDirectory() {
  return resolve(process.cwd(), process.cwd().endsWith("/apps/api") ? "../artifacts/phase9c" : "apps/artifacts/phase9c");
}

async function writeStableArtifact(name: string, data: unknown) {
  const directory = artifactDirectory();
  await mkdir(directory, { recursive: true });
  const path = resolve(directory, name);
  const payload = `${JSON.stringify(data, null, 2)}\n`;
  try {
    const existing = await readFile(path, "utf8");
    if (existing !== payload) throw new Error(`Existing artifact differs: ${path}`);
    return path;
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
  const temporary = `${path}.tmp-${process.pid}`;
  await writeFile(temporary, payload, { flag: "wx" });
  await rename(temporary, path);
  return path;
}

async function main() {
  const command = process.argv[2];
  if (command !== "manifest" && command !== "analyze") {
    throw new Error("Usage: context-cli.ts manifest|analyze");
  }
  const provider = new KiteHistoricalMarketDataProvider(kiteBrokerAdapter);
  const manifest = await buildIndexContextManifest((benchmark) => provider.getStoredCandles({
    instrumentToken: benchmark.instrumentToken, tradingSymbol: benchmark.symbol, exchange: "NSE",
    interval: "1m", from: new Date(INDEX_CONTEXT_FROM), to: new Date(INDEX_CONTEXT_TO)
  }));
  const manifestPath = await writeStableArtifact(`index-context-${manifest.datasetId}-manifest.json`, manifest);
  console.log(JSON.stringify({ event: "manifest_complete", path: manifestPath, version: manifest.version,
    registryId: contextUniverseId, datasetId: manifest.datasetId, contentHash: manifest.contentHash,
    expected: manifest.totalExpectedCandles, policyValid: manifest.totalPolicyValidCandles,
    missing: manifest.totalMissingCandles, outOfPolicy: manifest.totalOutOfPolicyRows,
    benchmarkCounts: manifest.benchmarkCoverage.map((row) => ({ id: row.benchmarkId, raw: row.rawCandles,
      policyValid: row.policyValidCandles, missing: row.missingCandles, gaps: row.gaps.length })) }));
  if (command === "manifest") return;
  const result = await analyzeRealContext(manifest, (date, completed, total) => {
    console.log(JSON.stringify({ event: "analysis_progress", date, completed, total, percent: completed / total * 100 }));
  });
  const { elapsedMs, peakObservedRssBytes } = result.activity;
  const stableResult = stableRegimeArtifact(result);
  const resultPath = await writeStableArtifact(`regime-analysis-${result.analysisId}-stable.json`, stableResult);
  console.log(JSON.stringify({ event: "analysis_complete", path: resultPath, analysisId: result.analysisId,
    contextDatasetId: manifest.datasetId, regimeDefinitionHash, benchmarkCount: benchmarkRegistry.length,
    marketUpdates: result.activity.marketRegimeUpdates, trend: result.market.trendCounts,
    volatility: result.market.volatilityCounts, elapsedMs, peakRssBytes: peakObservedRssBytes }));
}

void main().catch((error) => {
  console.error(JSON.stringify({ event: "fatal", message: error instanceof Error ? error.message : String(error) }));
  process.exitCode = 1;
});
