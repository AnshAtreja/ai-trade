import { getMarketSessionState, isScannerTradingSession } from "../../common/utils/market-session";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import { env } from "../../config/env";
import { getMarketStreamService } from "../market-data/stream/service";
import type { LatestMarketStateStore } from "../market-data/stream/latest-state-store";
import type { MarketTick } from "../market-data/stream/types";
import { getProductionScannerService } from "../scanner/production-service";
import type { ScannerCandidate } from "../scanner/production-types";
import { getStrategyConfig, type StrategyConfig } from "./config";
import type { StrategyContext, StrategyEngineStatus, StrategyEvaluation } from "./engine-types";
import { StrategyError } from "./errors";
import {
  getStrategyMarketContextFeed,
  type StrategyMarketContextFeed
} from "./market-context-feed";
import { persistStrategySetups, listPersistedStrategySetups } from "./persistence";
import { StrategyRegistry } from "./registry";

export interface StrategyEngineDependencies {
  resolveRepos?: () => AppRepositories;
  getLatestStore?: () => LatestMarketStateStore;
  getFeed?: () => StrategyMarketContextFeed;
  getCandidates?: () => ScannerCandidate[];
  config?: Partial<StrategyConfig>;
  now?: () => Date;
  persist?: boolean;
  ignoreMarketSession?: boolean;
  registry?: StrategyRegistry;
  /** Research replay freezes the registry/config for the lifetime of a partition. */
  freezeRegistry?: boolean;
}

export interface StrategyEvaluationProfile {
  registryNs: number;
  dispatchNs: number;
  ruleNs: number;
  evaluations: number;
}

export interface StrategyEvaluateRequest {
  instrumentTokens?: string[];
  strategyIds?: string[];
  /** Optional explicit contexts for backtests / unit tests. */
  contexts?: StrategyContext[];
  force?: boolean;
  profile?: StrategyEvaluationProfile;
}

export interface StrategyEvaluateResult {
  evaluatedAt: string;
  marketSession: ReturnType<typeof getMarketSessionState>;
  candidateCount: number;
  evaluationCount: number;
  setupCount: number;
  evaluations: StrategyEvaluation[];
  persisted: { count: number; mode: string } | null;
}

export class StrategyEngineService {
  private lifecycle: StrategyEngineStatus["lifecycle"] = "IDLE";
  private schedulerRunning = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runPromise: Promise<StrategyEvaluateResult> | null = null;
  private lastEvaluations: StrategyEvaluation[] = [];
  private readonly resolveRepos: () => AppRepositories;
  private readonly getLatestStore: () => LatestMarketStateStore;
  private readonly getFeed: () => StrategyMarketContextFeed;
  private readonly getCandidates: () => ScannerCandidate[];
  private readonly configOverrides: Partial<StrategyConfig>;
  private readonly now: () => Date;
  private readonly shouldPersist: boolean;
  private readonly ignoreMarketSession: boolean;
  private registry: StrategyRegistry;
  private readonly freezeRegistry: boolean;
  private attached = false;

  constructor(deps: StrategyEngineDependencies = {}) {
    this.resolveRepos = deps.resolveRepos ?? getRepositories;
    this.getLatestStore = deps.getLatestStore ?? (() => getMarketStreamService().store);
    this.getFeed = deps.getFeed ?? getStrategyMarketContextFeed;
    this.getCandidates =
      deps.getCandidates ??
      (() => getProductionScannerService().getStatus().lastRun?.candidates ?? []);
    this.configOverrides = deps.config ?? {};
    this.now = deps.now ?? (() => new Date());
    this.shouldPersist = deps.persist !== false;
    this.ignoreMarketSession = deps.ignoreMarketSession ?? false;
    this.registry = deps.registry ?? StrategyRegistry.createDefault(getStrategyConfig(this.configOverrides));
    this.freezeRegistry = deps.freezeRegistry ?? false;
  }

  ensureMarketFeedAttached() {
    if (this.attached) {
      return;
    }
    const feed = this.getFeed();
    const stream = getMarketStreamService();
    // Prefer every applied tick from the store — bus is latest-wins per flush.
    feed.attach((handler) => stream.store.onAppliedTick(handler));
    this.attached = true;
  }

  listStrategies() {
    if (!this.freezeRegistry) this.refreshRegistry();
    return this.registry.list();
  }

  getStatus(): StrategyEngineStatus {
    this.refreshRegistry();
    return {
      lifecycle: this.lifecycle,
      schedulerRunning: this.schedulerRunning,
      busy: this.runPromise != null,
      enabledStrategyIds: this.registry.list().filter((s) => s.enabled).map((s) => s.id),
      lastEvaluations: this.lastEvaluations,
      marketSession: getMarketSessionState(this.now())
    };
  }

  async evaluate(request: StrategyEvaluateRequest = {}): Promise<StrategyEvaluateResult> {
    if (this.runPromise) {
      throw new StrategyError("STRATEGY_BUSY", "A strategy evaluation is already in progress.");
    }

    this.runPromise = this.executeEvaluate(request);
    try {
      return await this.runPromise;
    } finally {
      this.runPromise = null;
    }
  }

  startScheduler() {
    if (this.schedulerRunning) {
      return this.getStatus();
    }
    const config = getStrategyConfig(this.configOverrides);
    this.ensureMarketFeedAttached();
    this.schedulerRunning = true;
    this.lifecycle = this.lifecycle === "STOPPED" ? "IDLE" : this.lifecycle;
    this.timer = setInterval(() => {
      void this.scheduledTick();
    }, config.evaluationIntervalMs);
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      this.timer.unref();
    }
    void this.log("INFO", "strategy_scheduler_started", "Strategy scheduler started.", {
      intervalMs: config.evaluationIntervalMs
    });
    return this.getStatus();
  }

  stopScheduler() {
    this.schedulerRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lifecycle = "STOPPED";
    void this.log("INFO", "strategy_scheduler_stopped", "Strategy scheduler stopped.");
    return this.getStatus();
  }

  async listSignals(params?: { strategyId?: string; symbol?: string; limit?: number }) {
    return listPersistedStrategySetups(params);
  }

  getLatestSignals() {
    return this.lastEvaluations.filter((e) => e.status === "SETUP_DETECTED");
  }

  private async scheduledTick() {
    if (!this.schedulerRunning || this.runPromise) {
      return;
    }
    const session = getMarketSessionState(this.now());
    if (!this.ignoreMarketSession && !isScannerTradingSession(session)) {
      return;
    }
    try {
      await this.evaluate({ force: false });
    } catch (error) {
      void this.log("ERROR", "strategy_scheduled_failed", error instanceof Error ? error.message : "Scheduled evaluate failed.");
    }
  }

  private refreshRegistry() {
    const config = getStrategyConfig(this.configOverrides);
    this.registry = StrategyRegistry.createDefault(config);
  }

  private async executeEvaluate(request: StrategyEvaluateRequest): Promise<StrategyEvaluateResult> {
    if (!request.contexts?.length) {
      this.ensureMarketFeedAttached();
    }
    this.refreshRegistry();
    this.lifecycle = "RUNNING";

    const now = this.now();
    const session = getMarketSessionState(now);
    if (!this.ignoreMarketSession && !request.force && !isScannerTradingSession(session) && !request.contexts?.length) {
      this.lifecycle = "IDLE";
      return {
        evaluatedAt: now.toISOString(),
        marketSession: session,
        candidateCount: 0,
        evaluationCount: 0,
        setupCount: 0,
        evaluations: [],
        persisted: null
      };
    }

    const registryStarted = process.hrtime.bigint();
    const strategies = this.registry.enabledStrategies(request.strategyIds);
    if (request.profile) request.profile.registryNs += elapsedNs(registryStarted);
    const dispatchStarted = process.hrtime.bigint();
    const evaluations: StrategyEvaluation[] = [];

    if (request.contexts?.length) {
      for (const context of request.contexts) {
        for (const strategy of strategies) {
          const ruleStarted = process.hrtime.bigint();
          evaluations.push(strategy.evaluate(context));
          if (request.profile) { request.profile.ruleNs += elapsedNs(ruleStarted); request.profile.evaluations += 1; }
        }
      }
    } else {
      const candidates = this.resolveCandidates(request.instrumentTokens);
      for (const candidate of candidates) {
        const context = this.buildContext(candidate, now, session);
        for (const strategy of strategies) {
          const ruleStarted = process.hrtime.bigint();
          evaluations.push(strategy.evaluate(context));
          if (request.profile) { request.profile.ruleNs += elapsedNs(ruleStarted); request.profile.evaluations += 1; }
        }
      }
    }

    this.lastEvaluations = evaluations;
    const setups = evaluations.filter((e) => e.status === "SETUP_DETECTED");

    let persisted: StrategyEvaluateResult["persisted"] = null;
    if (this.shouldPersist && setups.length > 0) {
      const result = await persistStrategySetups(setups);
      persisted = { count: result.count, mode: result.mode };
    }

    this.lifecycle = "IDLE";
    const result = {
      evaluatedAt: now.toISOString(),
      marketSession: session,
      candidateCount: request.contexts?.length ?? this.resolveCandidates(request.instrumentTokens).length,
      evaluationCount: evaluations.length,
      setupCount: setups.length,
      evaluations,
      persisted
    };
    if (request.profile) request.profile.dispatchNs += elapsedNs(dispatchStarted);
    return result;
  }

  private resolveCandidates(instrumentTokens?: string[]): Array<ScannerCandidate | SyntheticCandidate> {
    const fromScanner = this.getCandidates();
    if (instrumentTokens?.length) {
      const wanted = new Set(instrumentTokens.map(String));
      const matched = fromScanner.filter((c) => wanted.has(c.instrumentToken));
      const missing = [...wanted].filter((token) => !matched.some((c) => c.instrumentToken === token));
      return [...matched, ...missing.map((token) => this.syntheticFromStore(token))];
    }
    return fromScanner;
  }

  private syntheticFromStore(instrumentToken: string): SyntheticCandidate {
    const tick = this.getLatestStore().getLatest(instrumentToken);
    return {
      instrumentToken,
      tradingSymbol: tick?.tradingSymbol ?? instrumentToken,
      exchange: tick?.exchange ?? "NSE",
      instrumentId: tick?.instrumentId ?? null,
      direction: "NEUTRAL",
      score: 0,
      scoreComponents: {
        volumeActivity: 0,
        momentum: 0,
        rangeExpansion: 0,
        dayExtremumProximity: 0,
        priceMovement: 0
      },
      lastPrice: tick?.lastPrice ?? 0,
      dataTimestamp: tick?.exchangeTimestamp ?? tick?.receivedAt ?? new Date(0).toISOString(),
      dataAgeMs: tick ? Math.max(0, Date.now() - Date.parse(tick.receivedAt)) : Number.MAX_SAFE_INTEGER,
      stale: true,
      features: {
        changeFromOpenPercent: null,
        changeFromPreviousClosePercent: null,
        intradayRangePercent: null,
        distanceFromDayHighPercent: null,
        distanceFromDayLowPercent: null,
        nearDayHigh: null,
        nearDayLow: null,
        breakingDayHigh: null,
        breakingDayLow: null,
        volume: tick?.volume ?? null,
        volumeActivity: tick?.volume != null ? "AVAILABLE" : "UNAVAILABLE",
        volumeSpike: "UNKNOWN",
        volumeSpikeRatio: null,
        volatilityPercent: null,
        momentumBias: "UNKNOWN"
      },
      reasons: [],
      marketRegime: "UNKNOWN",
      source: "SCANNER",
      scannerSignalId: null
    };
  }

  private buildContext(
    candidate: ScannerCandidate | SyntheticCandidate,
    now: Date,
    session: ReturnType<typeof getMarketSessionState>
  ): StrategyContext {
    const feed = this.getFeed();
    const storeTick = this.getLatestStore().getLatest(candidate.instrumentToken);
    const latestTick = storeTick ?? null;
    const receivedAt = latestTick?.receivedAt ?? candidate.dataTimestamp;
    const dataAgeMs = latestTick
      ? Math.max(0, now.getTime() - Date.parse(latestTick.receivedAt))
      : candidate.dataAgeMs;
    const stale = dataAgeMs > getStrategyConfig(this.configOverrides).maxDataAgeMs;

    // Seed history with latest if empty (manual eval without live stream).
    if (latestTick && feed.tickHistory.size(candidate.instrumentToken) === 0) {
      feed.ingest(latestTick);
    }

    return {
      instrumentToken: candidate.instrumentToken,
      tradingSymbol: candidate.tradingSymbol,
      exchange: candidate.exchange,
      instrumentId: candidate.instrumentId,
      latestTick,
      recentTicks: feed.tickHistory.get(candidate.instrumentToken),
      candles1m: feed.candles.getCandles(candidate.instrumentToken, "1m"),
      candles5m: feed.candles.getCandles(candidate.instrumentToken, "5m"),
      scannerCandidate: "score" in candidate && candidate.source === "SCANNER" ? (candidate as ScannerCandidate) : null,
      scannerSignalId: "scannerSignalId" in candidate ? candidate.scannerSignalId ?? null : null,
      marketSession: session,
      currentTime: now,
      dataAgeMs,
      stale
    };
  }

  private async log(
    level: "INFO" | "ERROR" | "WARN",
    event: string,
    message: string,
    metadata?: Record<string, unknown>
  ) {
    try {
      const repos = this.resolveRepos();
      const user = await repos.users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
      await repos.systemLogs.create({
        userId: user.id,
        level,
        source: "strategies",
        message,
        metadata: { event, ...metadata, strategyEnabled: env.STRATEGY_ENABLED }
      });
    } catch {
      // Logging must not break evaluation.
    }
  }
}

function elapsedNs(started: bigint) {
  return Number(process.hrtime.bigint() - started);
}

type SyntheticCandidate = ScannerCandidate & { scannerSignalId?: string | null };

let engine: StrategyEngineService | null = null;

export function getStrategyEngineService() {
  if (!engine) {
    engine = new StrategyEngineService();
  }
  return engine;
}

export function resetStrategyEngineServiceForTests(next?: StrategyEngineService) {
  engine?.stopScheduler();
  engine = next ?? null;
}

/** Build a StrategyContext for tests / backtests without the full engine. */
export function buildStrategyContext(partial: Partial<StrategyContext> & Pick<
  StrategyContext,
  "instrumentToken" | "tradingSymbol" | "exchange"
>): StrategyContext {
  const now = partial.currentTime ?? new Date();
  return {
    instrumentToken: partial.instrumentToken,
    tradingSymbol: partial.tradingSymbol,
    exchange: partial.exchange,
    instrumentId: partial.instrumentId ?? null,
    latestTick: partial.latestTick ?? null,
    recentTicks: partial.recentTicks ?? [],
    candles1m: partial.candles1m ?? [],
    candles5m: partial.candles5m ?? [],
    scannerCandidate: partial.scannerCandidate ?? null,
    scannerSignalId: partial.scannerSignalId ?? null,
    marketSession: partial.marketSession ?? getMarketSessionState(now),
    currentTime: now,
    dataAgeMs: partial.dataAgeMs ?? 0,
    stale: partial.stale ?? false
  };
}

export function makeTick(partial: Partial<MarketTick> & Pick<MarketTick, "instrumentToken" | "lastPrice">): MarketTick {
  const receivedAt = partial.receivedAt ?? new Date().toISOString();
  return {
    instrumentToken: partial.instrumentToken,
    exchange: partial.exchange ?? "NSE",
    tradingSymbol: partial.tradingSymbol ?? "TEST",
    instrumentId: partial.instrumentId ?? null,
    timestamp: partial.timestamp ?? receivedAt,
    receivedAt,
    lastPrice: partial.lastPrice,
    volume: partial.volume ?? 5000,
    lastTradedQuantity: partial.lastTradedQuantity ?? 1,
    open: partial.open ?? partial.lastPrice,
    high: partial.high ?? partial.lastPrice,
    low: partial.low ?? partial.lastPrice,
    close: partial.close ?? partial.lastPrice,
    averagePrice: partial.averagePrice ?? partial.lastPrice,
    buyQuantity: partial.buyQuantity ?? null,
    sellQuantity: partial.sellQuantity ?? null,
    exchangeTimestamp: partial.exchangeTimestamp ?? receivedAt,
    mode: partial.mode ?? "QUOTE",
    source: partial.source ?? "MOCK",
    orderKey: partial.orderKey ?? `${partial.instrumentToken}|${receivedAt}|${partial.lastPrice}`
  };
}
