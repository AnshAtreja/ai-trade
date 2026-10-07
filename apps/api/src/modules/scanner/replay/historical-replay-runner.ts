import { createHash } from "node:crypto";
import { candleIntervalMs } from "../../../common/utils/candle-buckets";
import { getTradingDate } from "../../../common/utils/trading-date";
import { createMemoryRepositories } from "../../../db/repositories/memory-repositories";
import type { HistoricalCandleIntervalCode } from "../../../db/domain";
import type { HistoricalMarketDataService } from "../../historical-market-data/service";
import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import type { NormalizedHistoricalCandle, ValidationIssue } from "../../historical-market-data/types";
import { validateHistoricalCandles } from "../../historical-market-data/validation";
import { nseCashCalendar } from "../../historical-market-data/calendar";
import { legacyGlobalSessionPolicy, NseCashInstrumentSessionPolicy, type InstrumentIdentity, type InstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import type { InstrumentUniverseService } from "../../market-data/universe-service";
import { StrategyEngineService, type StrategyEvaluationProfile } from "../../strategies/engine-service";
import type { StrategyConfig } from "../../strategies/config";
import type { StrategyStatus } from "../../strategies/engine-types";
import { ProductionScannerService, type ScannerRunProfile } from "../production-service";
import { HistoricalReplayClock, type ReplayClockEvent } from "./clock";
import { HistoricalMarketStateAdapter } from "./historical-market-state";
import type {
  HistoricalReplayInstrumentInput,
  HistoricalReplayRequest,
  HistoricalReplayResult,
  LoadedReplayCandle,
  ReplayCandleEvent,
  ReplayCandleSnapshot,
  ReplayEvent,
  ReplayPerformanceProfile,
  ReplayScannerOutput,
  ReplayStrategyOutput
} from "./types";

export interface HistoricalReplayRunnerDependencies {
  historicalService?: HistoricalMarketDataService;
  loadCandles?: (request: HistoricalReplayRequest) => Promise<NormalizedHistoricalCandle[]>;
  sessionPolicy?: InstrumentSessionPolicy;
  /** Uses the production scanner's incremental replay-safe execution mode. */
  incrementalScanner?: boolean;
  optimizedContext?: boolean;
  /** Research-only frozen configuration override. */
  strategyConfig?: Partial<StrategyConfig>;
  /** Research-only fan-out. The replay/scanner frame is shared; each variant is isolated. */
  variantStrategyConfigs?: Array<{ variantId: string; strategyId: string; config: Partial<StrategyConfig> }>;
  onVariantEvent?: (input: { variantId: string; event: ReplayEvent }) => void;
  collectEvents?: boolean;
  onEvent?: (event: ReplayEvent) => void;
  onProgress?: (progress: { replayTimestamp: string; processedCandles: number; totalCandles: number; scannerEvaluations: number; strategyEvaluations: number; elapsedMs: number }) => void;
}

export class HistoricalReplayRunner {
  constructor(private readonly deps: HistoricalReplayRunnerDependencies = {}) {}

  async run(input: {
    token?: string;
    tokens?: string[];
    instruments?: HistoricalReplayInstrumentInput[];
    from: string | Date;
    to: string | Date;
    interval?: HistoricalCandleIntervalCode;
    strategyIds?: string[];
  }): Promise<HistoricalReplayResult> {
    const baseRequest = normalizeRequest(input);
    const loaded = await this.load(baseRequest);
    const service = this.deps.historicalService ?? getHistoricalMarketDataService();
    const sessionPolicy = this.deps.sessionPolicy ?? (this.deps.loadCandles ? new NseCashInstrumentSessionPolicy() : service.getHistoricalSessionPolicy());
    const request = {
      ...baseRequest,
      instruments: await enrichSessionIdentities(enrichInstruments(baseRequest.instruments, loaded), loaded, this.deps.loadCandles ? null : service)
    };
    const validationIssues = validateLoaded(request, loaded, sessionPolicy);
    const clockInput = this.deps.optimizedContext === true
      ? buildCompactClockInput(request, loaded, sessionPolicy)
      : null;
    const clock = clockInput
      ? HistoricalReplayClock.fromCandleReferences(clockInput.candles, clockInput.sparseEvents)
      : new HistoricalReplayClock(buildClockEvents(request, loaded, sessionPolicy));
    const state = new HistoricalMarketStateAdapter(Number.MAX_SAFE_INTEGER, 240, this.deps.optimizedContext, this.deps.optimizedContext === true);
    const replayRepos = createMemoryRepositories();
    let now = request.from;

    const scanner = new ProductionScannerService({
      resolveRepos: () => replayRepos,
      universe: new ReplayUniverse(request.instruments) as unknown as InstrumentUniverseService,
      getLatestStore: () => state.store,
      now: () => now,
      ignoreMarketSession: true,
      persist: false,
      suppressDiagnostics: true,
      config: { minScore: 0, minVolume: 0, maxCandidates: 5000 }
    });
    const strategy = new StrategyEngineService({
      resolveRepos: () => replayRepos,
      now: () => now,
      persist: false,
      ignoreMarketSession: true,
      config: this.deps.strategyConfig,
      freezeRegistry: true
    });
    const variantStrategies = (this.deps.variantStrategyConfigs ?? []).map((variant) => ({
      ...variant,
      engine: new StrategyEngineService({ resolveRepos: () => replayRepos, now: () => now, persist: false, ignoreMarketSession: true, config: variant.config, freezeRegistry: true })
    }));

    const collectEvents = this.deps.collectEvents !== false;
    const events: ReplayEvent[] = [];
    const requestForIdentity = { instruments: request.instruments, from: request.from.toISOString(), to: request.to.toISOString(), interval: request.interval, strategyIds: request.strategyIds ?? null };
    const identityHash = createHash("sha256");
    identityHash.update('{"request":');
    updateHashJson(identityHash, requestForIdentity);
    identityHash.update(',"events":[');
    const replayStats = { emittedEvents: 0, candleCount: 0, strategyEvaluations: 0, setupsDetected: 0, invalidSetups: 0, unavailableEvents: 0, dataGapEvents: 0, duplicateCandleEvents: 0 };
    const emit = (event: ReplayEvent) => {
      if (replayStats.emittedEvents > 0) identityHash.update(",");
      updateHashJson(identityHash, event);
      replayStats.emittedEvents += 1;
      if (event.type === "CANDLE") {
        replayStats.candleCount += 1;
        replayStats.strategyEvaluations += event.strategy.evaluationCount;
        replayStats.setupsDetected += event.strategy.setupCount;
        replayStats.invalidSetups += event.strategy.statuses.SETUP_INVALID;
        replayStats.unavailableEvents += event.strategy.statuses.DATA_UNAVAILABLE;
      } else if (event.type === "DATA_GAP") replayStats.dataGapEvents += 1;
      else replayStats.duplicateCandleEvents += 1;
      if (collectEvents) events.push(event);
      this.deps.onEvent?.(event);
    };
    const startedMs = request.from.getTime();
    const performance = createReplayPerformanceProfile();
    const replayStarted = process.hrtime.bigint();
    let processedCandles = 0;
    let strategyEvaluations = 0;

    await clock.run(async (event) => {
      now = event.timestamp;
      if (event.type === "DATA_GAP") {
        emit({
          type: "DATA_GAP",
          replayTimestamp: event.timestamp.toISOString(),
          instrumentToken: event.instrumentToken,
          expectedTimestamp: event.timestamp.toISOString(),
          reason: event.reason
        });
        return;
      }

      if (event.type === "DUPLICATE_CANDLE") {
        emit({
          type: "DUPLICATE_CANDLE",
          replayTimestamp: event.timestamp.toISOString(),
          instrumentToken: event.instrumentToken,
          candle: snapshotCandle(event.candle),
          reason: event.reason
        });
        return;
      }

      const stateStarted = process.hrtime.bigint();
      const tick = state.applyCandle(event.candle);
      performance.marketStateUpdateNs += elapsedNs(stateStarted);
      const scannerStarted = process.hrtime.bigint();
      const scannerRun = await scanner.runOnce({ force: true, profile: performance.scanner, incrementalDirtyInstrumentToken: this.deps.incrementalScanner ? event.candle.instrumentToken : undefined });
      performance.scannerNs += elapsedNs(scannerStarted);
      const contextStarted = process.hrtime.bigint();
      const contexts = state.getContexts(scannerRun.candidates, now);
      performance.contextAccessNs += elapsedNs(contextStarted);
      const strategyStarted = process.hrtime.bigint();
      const strategyProfile: StrategyEvaluationProfile = { registryNs: 0, dispatchNs: 0, ruleNs: 0, evaluations: 0 };
      const variantRuns = [] as Array<{ variantId: string; run: Awaited<ReturnType<StrategyEngineService["evaluate"]>> }>;
      for (const variant of variantStrategies) {
        variantRuns.push({ variantId: variant.variantId, run: await variant.engine.evaluate({ contexts, strategyIds: [variant.strategyId], force: true }) });
      }
      const strategyRun = variantRuns[0]?.run ?? await strategy.evaluate({ contexts, strategyIds: request.strategyIds, force: true, profile: strategyProfile });
      performance.strategyNs += elapsedNs(strategyStarted);
      performance.strategyRegistryNs += strategyProfile.registryNs;
      performance.strategyDispatchNs += strategyProfile.dispatchNs;
      performance.strategyRuleNs += strategyProfile.ruleNs;
      processedCandles += 1;
      strategyEvaluations += variantRuns.length ? variantRuns.reduce((sum, variant) => sum + variant.run.evaluations.length, 0) : strategyRun.evaluations.length;

      const replayEvent: ReplayCandleEvent = {
        type: "CANDLE",
        replayTimestamp: event.timestamp.toISOString(),
        instrumentToken: event.instrumentToken,
        candle: snapshotCandle(event.candle),
        tick,
        marketState: state.snapshot(event.instrumentToken, now),
        scanner: {
          status: scannerRun.status,
          stats: scannerRun.stats,
          candidates: scannerRun.candidates
        },
        strategy: summarizeStrategy(strategyRun.evaluations)
      };
      emit(replayEvent);
      for (const variant of variantRuns) {
        this.deps.onVariantEvent?.({ variantId: variant.variantId, event: { ...replayEvent, strategy: summarizeStrategy(variant.run.evaluations) } });
      }
      if (processedCandles % 5_000 === 0 || processedCandles === loaded.length) {
        this.deps.onProgress?.({ replayTimestamp: event.timestamp.toISOString(), processedCandles, totalCandles: loaded.length, scannerEvaluations: processedCandles, strategyEvaluations, elapsedMs: Math.round(elapsedNs(replayStarted) / 1_000_000) });
        // Yield to heartbeat timers and pipe I/O; simulated market time is unchanged.
        await new Promise<void>((resolve) => setImmediate(resolve));
      }
    });

    const summary = summarizeResult({
      request,
      events,
      identity: finishReplayIdentity(identityHash),
      stats: replayStats,
      validationIssues,
      replayDurationMs: Math.max(0, request.to.getTime() - startedMs)
    });
    performance.totalReplayNs = elapsedNs(replayStarted);

    return {
      request: {
        instruments: request.instruments,
        from: request.from.toISOString(),
        to: request.to.toISOString(),
        interval: request.interval,
        strategyIds: request.strategyIds ?? null
      },
      summary,
      performance,
      validationIssues,
      events,
      limitations: [
        "Replay uses stored candles only and does not fabricate missing data.",
        "Replay session gaps use the versioned calendar and instrument session policy when instrument identity is available; unknown eligibility remains unresolved.",
        "Phase 8B does not persist backtest trades/orders/portfolio state and does not calculate P&L."
      ]
    };
  }

  private async load(request: HistoricalReplayRequest): Promise<LoadedReplayCandle[]> {
    const raw = this.deps.loadCandles
      ? await this.deps.loadCandles(request)
      : await loadFromHistoricalService(this.deps.historicalService ?? getHistoricalMarketDataService(), request);

    if (this.deps.optimizedContext === true) return raw as LoadedReplayCandle[];
    return raw.map((candle, loadIndex) => ({ ...candle, loadIndex }));
  }
}

function createReplayPerformanceProfile(): ReplayPerformanceProfile {
  return {
    totalReplayNs: 0,
    marketStateUpdateNs: 0,
    scannerNs: 0,
    strategyNs: 0,
    strategyRegistryNs: 0,
    strategyDispatchNs: 0,
    strategyRuleNs: 0,
    contextAccessNs: 0,
    scanner: {
      universeLoadNs: 0,
      observationNs: 0,
      featureNs: 0,
      filterNs: 0,
      scoreNs: 0,
      rankingNs: 0,
      instrumentsConsidered: 0,
      featureCalculations: 0,
      candidatesConstructed: 0
    }
  };
}

function elapsedNs(started: bigint) {
  return Number(process.hrtime.bigint() - started);
}

/** Writes JSON semantics directly into the digest to avoid materializing a large event string. */
function updateHashJson(hash: ReturnType<typeof createHash>, value: unknown) {
  if (value === null) { hash.update("null"); return; }
  if (typeof value === "string") { hash.update(JSON.stringify(value)); return; }
  if (typeof value === "number" || typeof value === "boolean") { hash.update(JSON.stringify(value)); return; }
  if (Array.isArray(value)) {
    hash.update("[");
    value.forEach((item, index) => { if (index) hash.update(","); updateHashJson(hash, item === undefined ? null : item); });
    hash.update("]");
    return;
  }
  if (typeof value === "object") {
    hash.update("{");
    let first = true;
    for (const [key, item] of Object.entries(value as Record<string, unknown>)) {
      if (item === undefined) continue;
      if (!first) hash.update(",");
      first = false;
      hash.update(JSON.stringify(key));
      hash.update(":");
      updateHashJson(hash, item);
    }
    hash.update("}");
    return;
  }
  hash.update("null");
}

class ReplayUniverse {
  constructor(private readonly instruments: HistoricalReplayInstrumentInput[]) {}

  async getTradableEquities() {
    return this.instruments.map((instrument) => ({
      id: `historical-${instrument.instrumentToken}`,
      tradingSymbol: instrument.tradingSymbol ?? instrument.instrumentToken,
      exchange: instrument.exchange ?? "NSE",
      name: instrument.tradingSymbol ?? instrument.instrumentToken,
      instrumentToken: instrument.instrumentToken,
      exchangeToken: null,
      segment: "NSE",
      instrumentType: "EQ",
      expiry: null,
      strike: null,
      tickSize: 0.05,
      lotSize: 1,
      isActive: true
    }));
  }
}

async function loadFromHistoricalService(
  service: HistoricalMarketDataService,
  request: HistoricalReplayRequest
): Promise<NormalizedHistoricalCandle[]> {
  const candlesByToken = await Promise.all(
    request.instruments.map((instrument) =>
      service.getCandles({
        instrumentToken: instrument.instrumentToken,
        interval: request.interval,
        from: request.from,
        to: request.to
      })
    )
  );
  return candlesByToken.flat();
}

function normalizeRequest(input: {
  token?: string;
  tokens?: string[];
  instruments?: HistoricalReplayInstrumentInput[];
  from: string | Date;
  to: string | Date;
  interval?: HistoricalCandleIntervalCode;
  strategyIds?: string[];
}): HistoricalReplayRequest {
  const from = asDate(input.from, "from");
  const to = asDate(input.to, "to");
  if (!(from < to)) {
    throw new Error("Replay range must satisfy from < to ([from, to) half-open).");
  }

  const instruments: HistoricalReplayInstrumentInput[] = [
    ...(input.instruments ?? []),
    ...(input.tokens ?? []).map((instrumentToken): HistoricalReplayInstrumentInput => ({ instrumentToken })),
    ...(input.token ? [{ instrumentToken: input.token }] : [])
  ];
  const unique = new Map<string, HistoricalReplayInstrumentInput>();
  for (const item of instruments) {
    unique.set(item.instrumentToken, {
      instrumentToken: item.instrumentToken,
      tradingSymbol: item.tradingSymbol,
      exchange: item.exchange,
      casEligibility: item.casEligibility,
      eligibilitySource: item.eligibilitySource
    });
  }
  if (unique.size === 0) {
    throw new Error("Replay requires at least one instrument token.");
  }

  return {
    instruments: [...unique.values()].sort((a, b) => a.instrumentToken.localeCompare(b.instrumentToken)),
    from,
    to,
    interval: input.interval ?? "1m",
    strategyIds: input.strategyIds
  };
}

function validateLoaded(request: HistoricalReplayRequest, candles: LoadedReplayCandle[], sessionPolicy: InstrumentSessionPolicy) {
  const issues: ValidationIssue[] = [];
  for (const instrument of request.instruments) {
    const series = candles
      .filter((candle) => candle.instrumentToken === instrument.instrumentToken)
      .sort((a, b) => (a.loadIndex ?? 0) - (b.loadIndex ?? 0));
    const report = validateHistoricalCandles({
      instrumentToken: instrument.instrumentToken,
      interval: request.interval,
      from: request.from,
      to: request.to,
      candles: series,
      instrument: {
        instrumentToken: instrument.instrumentToken,
        tradingSymbol: instrument.tradingSymbol ?? instrument.instrumentToken,
        exchange: instrument.exchange ?? "NSE",
        eligibility: instrument.casEligibility ?? "UNKNOWN",
        eligibilitySource: instrument.eligibilitySource ?? "No session identity supplied"
      },
      sessionPolicy
    });
    issues.push(...report.issues);
  }
  return issues;
}

function enrichInstruments(
  instruments: HistoricalReplayInstrumentInput[],
  candles: LoadedReplayCandle[]
): HistoricalReplayInstrumentInput[] {
  const firstByToken = new Map<string, LoadedReplayCandle>();
  for (const candle of candles) {
    if (!firstByToken.has(candle.instrumentToken)) {
      firstByToken.set(candle.instrumentToken, candle);
    }
  }

  return instruments.map((instrument) => {
    const candle = firstByToken.get(instrument.instrumentToken);
    return {
      instrumentToken: instrument.instrumentToken,
      tradingSymbol: instrument.tradingSymbol ?? candle?.tradingSymbol,
      exchange: instrument.exchange ?? candle?.exchange,
      casEligibility: instrument.casEligibility,
      eligibilitySource: instrument.eligibilitySource
    };
  });
}

async function enrichSessionIdentities(instruments: HistoricalReplayInstrumentInput[], candles: LoadedReplayCandle[], service: HistoricalMarketDataService | null) {
  if (!service) return instruments;
  return Promise.all(instruments.map(async (instrument) => {
    const identity = await service.resolveHistoricalSessionIdentity(instrument.instrumentToken, instrument.tradingSymbol ?? candles.find((candle) => candle.instrumentToken === instrument.instrumentToken)?.tradingSymbol);
    return { ...instrument, tradingSymbol: instrument.tradingSymbol ?? identity.tradingSymbol, exchange: instrument.exchange ?? identity.exchange, casEligibility: identity.eligibility, eligibilitySource: identity.eligibilitySource };
  }));
}

function buildClockEvents(request: HistoricalReplayRequest, candles: LoadedReplayCandle[], sessionPolicy: InstrumentSessionPolicy): ReplayClockEvent[] {
  const events: ReplayClockEvent[] = [];
  const byToken = new Map<string, LoadedReplayCandle[]>();
  for (const candle of candles) {
    if (candle.interval !== request.interval) {
      continue;
    }
    if (candle.timestamp.getTime() < request.from.getTime() || candle.timestamp.getTime() >= request.to.getTime()) {
      continue;
    }
    const list = byToken.get(candle.instrumentToken) ?? [];
    list.push(candle);
    byToken.set(candle.instrumentToken, list);
  }

  for (const instrument of request.instruments) {
    const sorted = (byToken.get(instrument.instrumentToken) ?? []).sort(
      (a, b) => a.timestamp.getTime() - b.timestamp.getTime() || (a.loadIndex ?? 0) - (b.loadIndex ?? 0)
    );
    const seen = new Set<number>();
    const unique: LoadedReplayCandle[] = [];
    for (const candle of sorted) {
      const timestamp = candle.timestamp.getTime();
      if (seen.has(timestamp)) {
        events.push({
          type: "DUPLICATE_CANDLE",
          timestamp: candle.timestamp,
          instrumentToken: candle.instrumentToken,
          candle,
          reason: "Duplicate historical candle timestamp skipped during replay."
        });
        continue;
      }
      seen.add(timestamp);
      unique.push(candle);
      events.push({
        type: "CANDLE",
        timestamp: candle.timestamp,
        instrumentToken: candle.instrumentToken,
        candle
      });
    }
    events.push(...gapEvents(request, instrument, unique, sessionPolicy));
  }

  return events;
}

function buildCompactClockInput(request: HistoricalReplayRequest, candles: LoadedReplayCandle[], sessionPolicy: InstrumentSessionPolicy) {
  const from = request.from.getTime();
  const to = request.to.getTime();
  const ordered = candles.filter((candle) => candle.interval === request.interval && candle.timestamp.getTime() >= from && candle.timestamp.getTime() < to);
  ordered.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime() || a.instrumentToken.localeCompare(b.instrumentToken));

  const unique: LoadedReplayCandle[] = [];
  const sparseEvents: ReplayClockEvent[] = [];
  const byToken = new Map<string, LoadedReplayCandle[]>();
  let previousToken = "";
  let previousTimestamp = -1;
  for (const candle of ordered) {
    const timestamp = candle.timestamp.getTime();
    const duplicate = candle.instrumentToken === previousToken && timestamp === previousTimestamp;
    if (duplicate) {
      sparseEvents.push({ type: "DUPLICATE_CANDLE", timestamp: candle.timestamp, instrumentToken: candle.instrumentToken, candle, reason: "Duplicate historical candle timestamp skipped during replay." });
    } else {
      unique.push(candle);
      const series = byToken.get(candle.instrumentToken) ?? [];
      series.push(candle);
      byToken.set(candle.instrumentToken, series);
      previousToken = candle.instrumentToken;
      previousTimestamp = timestamp;
    }
  }
  for (const instrument of request.instruments) sparseEvents.push(...gapEvents(request, instrument, byToken.get(instrument.instrumentToken) ?? [], sessionPolicy));
  return { candles: unique, sparseEvents };
}

function gapEvents(
  request: HistoricalReplayRequest,
  instrument: HistoricalReplayInstrumentInput,
  candles: LoadedReplayCandle[],
  sessionPolicy: InstrumentSessionPolicy
): ReplayClockEvent[] {
  const step = candleIntervalMs(request.interval);
  const present = new Set(candles.map((candle) => candle.timestamp.getTime()));
  const events: ReplayClockEvent[] = [];
  if (instrument.casEligibility === "UNKNOWN") return events;
  const policy = instrument.casEligibility ? sessionPolicy : legacyGlobalSessionPolicy;
  const identity: InstrumentIdentity = {
    instrumentToken: instrument.instrumentToken,
    tradingSymbol: instrument.tradingSymbol ?? instrument.instrumentToken,
    exchange: instrument.exchange ?? "NSE",
    eligibility: instrument.casEligibility ?? "UNKNOWN",
    eligibilitySource: instrument.eligibilitySource ?? "No session identity supplied"
  };
  for (let dayCursor = dayStart(request.from); dayCursor < request.to.getTime(); dayCursor += 86_400_000) {
    const date = getTradingDate(new Date(dayCursor));
    const calendarDay = nseCashCalendar.getDay(date);
    if (!calendarDay.session) continue;
    const session = policy.getSession(identity, date).continuousSession;
    if (!session) continue;
    const start = Math.max(request.from.getTime(), new Date(`${date}T${session.openTimeIst}:00+05:30`).getTime());
    const end = Math.min(request.to.getTime(), new Date(`${date}T${session.closeTimeIst}:00+05:30`).getTime());
    for (let cursor = start; cursor < end; cursor += step) {
      if (present.has(cursor)) continue;
      events.push({ type: "DATA_GAP", timestamp: new Date(cursor), instrumentToken: instrument.instrumentToken, reason: `Missing ${request.interval} candle during continuous session; no forward-fill was applied.` });
    }
  }
  return events;
}

function dayStart(at: Date) {
  return new Date(`${getTradingDate(at)}T00:00:00+05:30`).getTime();
}

function snapshotCandle(candle: NormalizedHistoricalCandle): ReplayCandleSnapshot {
  return {
    timestamp: candle.timestamp.toISOString(),
    interval: candle.interval,
    open: candle.open,
    high: candle.high,
    low: candle.low,
    close: candle.close,
    volume: candle.volume,
    openInterest: candle.openInterest
  };
}

function summarizeStrategy(evaluations: ReplayStrategyOutput["evaluations"]): ReplayStrategyOutput {
  const statuses: Record<StrategyStatus, number> = {
    NO_SETUP: 0,
    SETUP_DETECTED: 0,
    SETUP_INVALID: 0,
    DATA_UNAVAILABLE: 0
  };
  for (const evaluation of evaluations) {
    statuses[evaluation.status] += 1;
  }
  return {
    evaluationCount: evaluations.length,
    setupCount: statuses.SETUP_DETECTED,
    statuses,
    evaluations
  };
}

function summarizeResult(input: {
  request: HistoricalReplayRequest;
  events: ReplayEvent[];
  identity: string;
  stats: { candleCount: number; strategyEvaluations: number; setupsDetected: number; invalidSetups: number; unavailableEvents: number; dataGapEvents: number; duplicateCandleEvents: number };
  validationIssues: ValidationIssue[];
  replayDurationMs: number;
}) {
  return {
    deterministicRunId: input.identity,
    instrumentCount: input.request.instruments.length,
    candleCountProcessed: input.stats.candleCount,
    replayStart: input.request.from.toISOString(),
    replayEnd: input.request.to.toISOString(),
    replayDurationMs: input.replayDurationMs,
    scannerEvaluations: input.stats.candleCount,
    strategyEvaluations: input.stats.strategyEvaluations,
    setupsDetected: input.stats.setupsDetected,
    invalidSetups: input.stats.invalidSetups,
    unavailableEvents: input.stats.unavailableEvents,
    dataGapEvents: input.stats.dataGapEvents,
    duplicateCandleEvents: input.stats.duplicateCandleEvents
  };
}

function finishReplayIdentity(hash: ReturnType<typeof createHash>) {
  hash.update("]}");
  return hash.digest("hex").slice(0, 16);
}

/** Hashes the exact JSON representation without allocating one monolithic replay string. */
export function deterministicReplayId(request: unknown, events: readonly ReplayEvent[]) {
  const hash = createHash("sha256");
  hash.update('{"request":');
  hash.update(JSON.stringify(request));
  hash.update(',"events":[');
  for (let index = 0; index < events.length; index += 1) {
    if (index > 0) hash.update(",");
    hash.update(JSON.stringify(events[index]));
  }
  hash.update("]}");
  return hash.digest("hex").slice(0, 16);
}

function asDate(value: string | Date, name: string) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new Error(`Invalid ${name} timestamp: ${String(value)}`);
  }
  return date;
}
