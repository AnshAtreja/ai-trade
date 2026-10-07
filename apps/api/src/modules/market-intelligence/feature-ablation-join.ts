import { createHash } from "node:crypto";
import { createReadStream, createWriteStream, readFileSync } from "node:fs";
import { mkdir, rename, rm } from "node:fs/promises";
import { once } from "node:events";
import path from "node:path";
import { getHistoricalMarketDataService } from "../historical-market-data/service";
import { researchUniverseInstruments } from "../historical-market-data/research-universe";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import { getTradingDate } from "../../common/utils/trading-date";
import { KiteHistoricalMarketDataProvider } from "../historical-market-data/kite-historical-provider";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { fromHistoricalCandle, MarketFeatureEngine, resolveNseFeatureSession } from "./feature-engine";
import { fromHistoricalBenchmarkCandle, MarketContextEngine } from "./context-engine";
import { benchmarkRegistry, resolveSectorMembership } from "./context-universe";
import { MarketRegimeEngine } from "./regime-engine";
import { buildIndexContextManifest, INDEX_CONTEXT_FROM, INDEX_CONTEXT_TO, indexSessionBounds,
  type IndexContextDatasetManifest } from "./context-dataset";
import { featureAblationSpec, featureAblationSpecHash, assertFeatureAblationSources, FEATURE_ABLATION_ROOT } from "./feature-ablation-spec";
import { captureFileName, readCapture } from "./feature-ablation-capture";
import { extractResearchFeatures, registeredFeatureNames, type ResearchValue } from "./feature-ablation-values";
import { FEATURE_ABLATION_ARTIFACT_DIR, writeImmutableArtifact } from "./feature-ablation-cli";

const EQUITY_SOURCE_ID = "505dca3f27301e72";

export interface JoinedContextPoint {
  replayTimestamp: string;
  decisionAvailableAt: string;
  instrumentToken: string;
  featureValues: ResearchValue[];
  featureQualities: string[];
  featureSnapshotId: string;
  contextSnapshotId: string;
  marketRegimeSnapshotId: string;
  sectorRegimeSnapshotId: string | null;
}

export interface JoinManifest {
  format: "9D-SETUP-CONTEXT-JOIN-1";
  specHash: string;
  phase8RunId: string;
  contextDatasetId: string;
  regimeDefinitionHash: string;
  range: { from: string; to: string };
  featureNames: readonly string[];
  captureFiles: Array<{ file: string; contentHash: string }>;
  executionIdentityDifferences: Array<{ foldId: string; partition: string; strategy: string;
    frozenExecutionRunId: string; observedExecutionRunId: string; replayRunId: string; classification: "EXECUTION_ID_ONLY" }>;
  setupEvaluations: number;
  distinctSetups: number;
  requestedContextPoints: number;
  joinedContextPoints: number;
  missingContextPoints: Array<{ replayTimestamp: string; instrumentToken: string; reason: "MISSING_EQUITY_CONTEXT" }>;
  pointsSha256: string;
  streamParity: { benchmarkObservations: number; equityObservations: number; marketRegimeUpdates: number;
    sectorRegimeUpdates: number; trendCounts: Record<string, number>; volatilityCounts: Record<string, number> };
  contentHash: string;
  joinId: string;
}

export function setupJoinKey(replayTimestamp: string, instrumentToken: string) {
  return `${replayTimestamp}|${instrumentToken}`;
}

export function distinctCapturedSetups(setups: readonly { setupId: string; setupTimestamp: string; replayTimestamp: string; instrumentToken: string; direction: string }[]) {
  const seen = new Map<string, typeof setups[number]>();
  for (const setup of setups) {
    const key = `${setup.setupId}|${setup.setupTimestamp}`;
    const previous = seen.get(key);
    if (previous && (previous.replayTimestamp !== setup.replayTimestamp || previous.instrumentToken !== setup.instrumentToken || previous.direction !== setup.direction)) {
      throw new Error(`Conflicting repeated setup identity ${key}`);
    }
    seen.set(key, setup);
  }
  return [...seen.values()];
}

function requestedContext() {
  const byTimestamp = new Map<string, Set<string>>();
  const captureFiles: JoinManifest["captureFiles"] = [];
  const executionIdentityDifferences: JoinManifest["executionIdentityDifferences"] = [];
  let setupEvaluations = 0;
  let distinctSetups = 0;
  for (const foldId of featureAblationSpec.population.folds) for (const partition of featureAblationSpec.population.partitions as Array<"TRAIN" | "VALIDATION" | "TEST">) {
    const capture = readCapture(foldId, partition);
    if (!capture) throw new Error(`Missing frozen 9D capture ${foldId}/${partition}`);
    captureFiles.push({ file: captureFileName(foldId, partition), contentHash: capture.contentHash });
    for (const difference of capture.executionIdentityDifferences ?? []) {
      executionIdentityDifferences.push({ foldId, partition, ...difference });
    }
    for (const strategy of capture.strategies) {
      setupEvaluations += strategy.setups.length;
      const unique = distinctCapturedSetups(strategy.setups);
      distinctSetups += unique.length;
      for (const setup of unique) {
        const tokens = byTimestamp.get(setup.replayTimestamp) ?? new Set<string>();
        tokens.add(setup.instrumentToken);
        byTimestamp.set(setup.replayTimestamp, tokens);
      }
    }
  }
  return { byTimestamp, captureFiles, executionIdentityDifferences, setupEvaluations, distinctSetups,
    requestedPoints: [...byTimestamp.values()].reduce((sum, tokens) => sum + tokens.size, 0) };
}

async function fileSha256(file: string) {
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function joinFrozenSetupsToContext(progress: (completed: number, total: number, date: string) => void = () => {}) {
  assertFeatureAblationSources();
  const provider = new KiteHistoricalMarketDataProvider(kiteBrokerAdapter);
  const frozenIndexManifest = JSON.parse(readFileSync(path.resolve(FEATURE_ABLATION_ROOT,
    featureAblationSpec.sources.phase9Context.path), "utf8")) as IndexContextDatasetManifest;
  const currentIndexManifest = await buildIndexContextManifest((definition) => provider.getStoredCandles({
    instrumentToken: definition.instrumentToken, exchange: "NSE", tradingSymbol: definition.symbol, interval: "1m",
    from: new Date(INDEX_CONTEXT_FROM), to: new Date(INDEX_CONTEXT_TO)
  }));
  if (currentIndexManifest.datasetId !== featureAblationSpec.contextDatasetId ||
      currentIndexManifest.contentHash !== frozenIndexManifest.contentHash) {
    throw new Error("Stored index candles no longer match frozen Phase 9C context dataset");
  }
  const request = requestedContext();
  await mkdir(FEATURE_ABLATION_ARTIFACT_DIR, { recursive: true });
  const tempPath = path.join(FEATURE_ABLATION_ARTIFACT_DIR, `join-points-${featureAblationSpecHash.slice(0, 16)}.tmp-${process.pid}.ndjson`);
  const output = createWriteStream(tempPath, { flags: "wx" });
  const pointsHash = createHash("sha256");
  const features = new MarketFeatureEngine();
  const context = new MarketContextEngine({ allowBackcastCurrentMembership: true });
  const regime = new MarketRegimeEngine();
  const service = getHistoricalMarketDataService();
  const indexPreviousClose = new Map<string, number | null>();
  const equityPreviousClose = new Map<string, number | null>();
  const observedKeys = new Set<string>();
  const streamParity: JoinManifest["streamParity"] = { benchmarkObservations: 0, equityObservations: 0,
    marketRegimeUpdates: 0, sectorRegimeUpdates: 0, trendCounts: {}, volatilityCounts: {} };
  let joinedContextPoints = 0;
  const dates: string[] = [];
  for (let atMs = Date.parse(INDEX_CONTEXT_FROM); atMs < Date.parse(INDEX_CONTEXT_TO); atMs += 86_400_000) {
    const date = getTradingDate(new Date(atMs), "Asia/Kolkata");
    if (indexSessionBounds(date)) dates.push(date);
  }
  try {
    for (const [dateIndex, date] of dates.entries()) {
      const bounds = indexSessionBounds(date)!;
      const from = new Date(bounds.fromMs);
      const to = new Date(bounds.toMs);
      const indexDay = await Promise.all(benchmarkRegistry.map(async (definition) => ({ definition,
        candles: await provider.getStoredCandles({ instrumentToken: definition.instrumentToken, exchange: "NSE",
          tradingSymbol: definition.symbol, interval: "1m", from, to }) })));
      const equityDay = await Promise.all(researchUniverseInstruments.map(async (instrument) => ({ instrument,
        result: await service.getResearchCandles({ instrumentToken: instrument.instrumentToken, interval: "1m",
          from, to, requireCompleteSession: true }) })));
      const byTime = new Map<number, { indexes: Array<{ id: string; candle: NormalizedHistoricalCandle }>;
        equities: Array<{ candle: NormalizedHistoricalCandle; previousClose: number | null }> }>();
      const frame = (atMs: number) => {
        const value = byTime.get(atMs) ?? { indexes: [], equities: [] };
        byTime.set(atMs, value);
        return value;
      };
      for (const { definition, candles } of indexDay) for (const candle of candles) {
        frame(candle.timestamp.getTime()).indexes.push({ id: definition.id, candle });
      }
      for (const { instrument, result } of equityDay) {
        const previousClose = equityPreviousClose.get(instrument.instrumentToken) ?? null;
        for (const candle of result.candles) frame(candle.timestamp.getTime()).equities.push({ candle, previousClose });
      }
      for (const [atMs, group] of [...byTime.entries()].sort((a, b) => a[0] - b[0])) {
        const replayTimestamp = new Date(atMs).toISOString();
        const wanted = request.byTimestamp.get(replayTimestamp);
        const featureAtFrame = new Map<string, { snapshot: ReturnType<MarketFeatureEngine["ingest"]>;
          session: ReturnType<typeof resolveNseFeatureSession> }>();
        const sectorTokens = new Map<string, string>();
        for (const { id, candle } of group.indexes) {
          context.ingestBenchmark(fromHistoricalBenchmarkCandle(candle, id, featureAblationSpec.contextDatasetId,
            indexPreviousClose.get(id) ?? null));
          streamParity.benchmarkObservations += 1;
        }
        for (const { candle, previousClose } of group.equities) {
          const session = resolveNseFeatureSession(candle, candle.timestamp);
          const snapshot = features.ingest(fromHistoricalCandle(candle, session, EQUITY_SOURCE_ID, previousClose));
          context.ingestEquity({ feature: snapshot, previousSessionClose: previousClose });
          streamParity.equityObservations += 1;
          const membership = resolveSectorMembership(candle.instrumentToken, date, { allowBackcastCurrentMembership: true });
          if (membership) sectorTokens.set(membership.sectorId, candle.instrumentToken);
          if (wanted?.has(candle.instrumentToken)) featureAtFrame.set(candle.instrumentToken, { snapshot, session });
        }
        const asOf = new Date(atMs + 60_000).toISOString();
        let emittedMarket = false;
        for (const token of sectorTokens.values()) {
          const snapshot = regime.observe(context.getContext(token, new Date(asOf)));
          if (!emittedMarket) {
            streamParity.marketRegimeUpdates += 1;
            streamParity.trendCounts[snapshot.market.trend.state] = (streamParity.trendCounts[snapshot.market.trend.state] ?? 0) + 1;
            streamParity.volatilityCounts[snapshot.market.volatility.state] = (streamParity.volatilityCounts[snapshot.market.volatility.state] ?? 0) + 1;
            emittedMarket = true;
          }
          if (snapshot.sector) streamParity.sectorRegimeUpdates += 1;
        }
        if (!wanted) continue;
        for (const token of [...wanted].sort()) {
          const current = featureAtFrame.get(token);
          if (!current) continue;
          const instrumentContext = context.getContext(token, new Date(asOf));
          const snapshot = regime.observe(instrumentContext);
          const extracted = extractResearchFeatures({ asOf, session: current.session, instrument: current.snapshot,
            context: instrumentContext, regime: snapshot });
          const point: JoinedContextPoint = {
            replayTimestamp, decisionAvailableAt: asOf, instrumentToken: token,
            featureValues: registeredFeatureNames.map((name) => extracted[name]!.value),
            featureQualities: registeredFeatureNames.map((name) => extracted[name]!.quality),
            featureSnapshotId: current.snapshot.id, contextSnapshotId: instrumentContext.id,
            marketRegimeSnapshotId: snapshot.market.id, sectorRegimeSnapshotId: snapshot.sector?.id ?? null
          };
          const line = `${JSON.stringify(point)}\n`;
          if (!output.write(line)) await once(output, "drain");
          pointsHash.update(line);
          observedKeys.add(setupJoinKey(replayTimestamp, token));
          joinedContextPoints += 1;
        }
      }
      for (const { definition, candles } of indexDay) {
        const expected = (bounds.toMs - bounds.fromMs) / 60_000;
        indexPreviousClose.set(definition.id, candles.length === expected ? candles.at(-1)!.close : null);
      }
      for (const { instrument, result } of equityDay) {
        equityPreviousClose.set(instrument.instrumentToken, result.rejectedSessions.length ? null : result.candles.at(-1)?.close ?? null);
      }
      if ((dateIndex + 1) % 10 === 0 || dateIndex + 1 === dates.length) progress(dateIndex + 1, dates.length, date);
    }
    output.end();
    await once(output, "finish");
    const frozenRegime = JSON.parse(readFileSync(path.resolve(FEATURE_ABLATION_ROOT,
      featureAblationSpec.sources.phase9Regime.path), "utf8")) as {
      activity: Omit<JoinManifest["streamParity"], "trendCounts" | "volatilityCounts">;
      market: { trendCounts: Record<string, number>; volatilityCounts: Record<string, number> };
    };
    const sameCounts = (left: Record<string, number>, right: Record<string, number>) =>
      Object.keys(left).length === Object.keys(right).length && Object.entries(left).every(([key, value]) => right[key] === value);
    if (streamParity.benchmarkObservations !== frozenRegime.activity.benchmarkObservations ||
        streamParity.equityObservations !== frozenRegime.activity.equityObservations ||
        streamParity.marketRegimeUpdates !== frozenRegime.activity.marketRegimeUpdates ||
        streamParity.sectorRegimeUpdates !== frozenRegime.activity.sectorRegimeUpdates ||
        !sameCounts(streamParity.trendCounts, frozenRegime.market.trendCounts) ||
        !sameCounts(streamParity.volatilityCounts, frozenRegime.market.volatilityCounts)) {
      throw new Error("Phase 9D context stream differs from frozen Phase 9C history");
    }
    const missingContextPoints: JoinManifest["missingContextPoints"] = [];
    for (const [replayTimestamp, tokens] of request.byTimestamp) for (const instrumentToken of tokens) {
      if (!observedKeys.has(setupJoinKey(replayTimestamp, instrumentToken))) {
        missingContextPoints.push({ replayTimestamp, instrumentToken, reason: "MISSING_EQUITY_CONTEXT" });
      }
    }
    missingContextPoints.sort((a, b) => a.replayTimestamp.localeCompare(b.replayTimestamp) || a.instrumentToken.localeCompare(b.instrumentToken));
    const pointsSha256 = pointsHash.digest("hex");
    const stable = {
      format: "9D-SETUP-CONTEXT-JOIN-1" as const, specHash: featureAblationSpecHash,
      phase8RunId: featureAblationSpec.sources.phase8Baseline.runId,
      contextDatasetId: featureAblationSpec.contextDatasetId, regimeDefinitionHash: featureAblationSpec.regimeDefinitionHash,
      range: featureAblationSpec.range, featureNames: registeredFeatureNames,
      captureFiles: request.captureFiles, executionIdentityDifferences: request.executionIdentityDifferences,
      setupEvaluations: request.setupEvaluations,
      distinctSetups: request.distinctSetups, requestedContextPoints: request.requestedPoints,
      joinedContextPoints, missingContextPoints, pointsSha256, streamParity
    };
    const contentHash = createHash("sha256").update(JSON.stringify(stable)).digest("hex");
    const joinId = contentHash.slice(0, 24);
    const manifest: JoinManifest = { ...stable, contentHash, joinId };
    const target = path.join(FEATURE_ABLATION_ARTIFACT_DIR, `join-points-${joinId}.ndjson`);
    try {
      const existing = await fileSha256(target);
      if (existing !== pointsSha256) throw new Error(`Existing 9D context points differ: ${target}`);
      await rm(tempPath);
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
      await rename(tempPath, target);
    }
    const manifestPath = await writeImmutableArtifact(`join-${joinId}.json`, `${JSON.stringify(manifest, null, 2)}\n`);
    return { manifest, manifestPath, pointsPath: target };
  } catch (error) {
    output.destroy();
    await rm(tempPath, { force: true });
    throw error;
  }
}
