import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import {
  getMarketSessionState,
  isScannerTradingSession,
  marketSessionMeta
} from "../../common/utils/market-session";
import { InstrumentUniverseService } from "../market-data/universe-service";
import { getMarketStreamService } from "../market-data/stream/service";
import type { LatestMarketStateStore } from "../market-data/stream/latest-state-store";
import type { MarketTick } from "../market-data/stream/types";
import { getScannerConfig, type ScannerConfig } from "./config";
import { newScannerRunId, persistScannerCandidates } from "./candidate-persistence";
import { ScannerError } from "./errors";
import { calculateFeatures } from "./feature-calculator";
import { applyScannerFilters } from "./filters";
import { scoreCandidate } from "./scoring";
import type {
  ScannerCandidate,
  ScannerLifecycle,
  ScannerMarketObservation,
  ScannerRunResult,
  ScannerRunStats,
  ScannerStatus
} from "./production-types";

export interface ProductionScannerDependencies {
  resolveRepos?: () => AppRepositories;
  universe?: InstrumentUniverseService;
  getLatestStore?: () => LatestMarketStateStore;
  config?: Partial<ScannerConfig>;
  now?: () => Date;
  persist?: boolean;
  /** When true, ignore market-closed skip (tests / forced manual diagnostics). */
  ignoreMarketSession?: boolean;
  /** Suppress diagnostic persistence for isolated research replays. */
  suppressDiagnostics?: boolean;
}

export interface ScannerRunProfile {
  universeLoadNs: number;
  observationNs: number;
  featureNs: number;
  filterNs: number;
  scoreNs: number;
  rankingNs: number;
  instrumentsConsidered: number;
  featureCalculations: number;
  candidatesConstructed: number;
}

export class ProductionScannerService {
  private lifecycle: ScannerLifecycle = "IDLE";
  private schedulerRunning = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private runPromise: Promise<ScannerRunResult> | null = null;
  private lastRun: ScannerRunResult | null = null;
  private readonly runs: ScannerRunResult[] = [];
  private readonly resolveRepos: () => AppRepositories;
  private readonly universe: InstrumentUniverseService;
  private readonly getLatestStore: () => LatestMarketStateStore;
  private readonly configOverrides: Partial<ScannerConfig>;
  private readonly now: () => Date;
  private readonly shouldPersist: boolean;
  private readonly ignoreMarketSession: boolean;
  private readonly suppressDiagnostics: boolean;
  private incrementalState: {
    universe: Awaited<ReturnType<InstrumentUniverseService["getTradableEquities"]>>;
    timestampMs: number;
    seenTokens: Set<string>;
    candidates: Map<string, ScannerCandidate>;
    filteredCount: number;
  } | null = null;

  constructor(deps: ProductionScannerDependencies = {}) {
    this.resolveRepos = deps.resolveRepos ?? getRepositories;
    this.universe = deps.universe ?? new InstrumentUniverseService(this.resolveRepos);
    this.getLatestStore =
      deps.getLatestStore ?? (() => getMarketStreamService().store);
    this.configOverrides = deps.config ?? {};
    this.now = deps.now ?? (() => new Date());
    this.shouldPersist = deps.persist !== false;
    this.ignoreMarketSession = deps.ignoreMarketSession ?? false;
    this.suppressDiagnostics = deps.suppressDiagnostics ?? false;
  }

  getStatus(): ScannerStatus {
    const config = getScannerConfig(this.configOverrides);
    return {
      lifecycle: this.lifecycle,
      schedulerRunning: this.schedulerRunning,
      lastRun: this.lastRun,
      busy: this.runPromise != null,
      config: {
        enabled: config.enabled,
        intervalMs: config.intervalMs,
        maxCandidates: config.maxCandidates,
        minScore: config.minScore
      },
      marketSession: getMarketSessionState(this.now())
    };
  }

  listRuns(limit = 20) {
    return this.runs.slice(0, limit);
  }

  async runOnce(options?: { force?: boolean; profile?: ScannerRunProfile; incrementalDirtyInstrumentToken?: string }): Promise<ScannerRunResult> {
    if (this.runPromise) {
      throw new ScannerError("SCANNER_BUSY", "A scanner run is already in progress.");
    }

    this.runPromise = options?.incrementalDirtyInstrumentToken
      ? this.executeIncrementalRun(options.force === true, options.incrementalDirtyInstrumentToken, options.profile)
      : this.executeRun(options?.force === true, options?.profile);
    try {
      const result = await this.runPromise;
      return result;
    } finally {
      this.runPromise = null;
    }
  }

  startScheduler() {
    if (this.schedulerRunning) {
      return this.getStatus();
    }

    const config = getScannerConfig(this.configOverrides);
    this.schedulerRunning = true;
    this.lifecycle = this.lifecycle === "STOPPED" ? "IDLE" : this.lifecycle;
    this.log("INFO", "scanner_started_scheduler", "Scanner scheduler started.", {
      intervalMs: config.intervalMs
    });

    this.timer = setInterval(() => {
      void this.scheduledTick();
    }, config.intervalMs);

    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      this.timer.unref();
    }

    return this.getStatus();
  }

  stopScheduler() {
    this.schedulerRunning = false;
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    this.lifecycle = "STOPPED";
    this.log("INFO", "scanner_stopped_scheduler", "Scanner scheduler stopped.");
    return this.getStatus();
  }

  private async scheduledTick() {
    if (!this.schedulerRunning) {
      return;
    }

    if (this.runPromise) {
      this.log("INFO", "scanner_busy", "Scheduled scan skipped; previous run still active.");
      return;
    }

    const session = getMarketSessionState(this.now());
    if (!this.ignoreMarketSession && !isScannerTradingSession(session)) {
      this.log("INFO", "scanner_skipped_market_closed", "Scheduled scan skipped; market session not active.", {
        marketSession: session
      });
      return;
    }

    try {
      await this.runOnce();
    } catch (error) {
      if (error instanceof ScannerError && error.code === "SCANNER_BUSY") {
        return;
      }
      this.lifecycle = "FAILED";
      this.log("ERROR", "scanner_failed", error instanceof Error ? error.message : "Scheduled scan failed.");
    }
  }

  private async executeRun(force: boolean, profile?: ScannerRunProfile): Promise<ScannerRunResult> {
    const startedAt = this.now();
    const runId = newScannerRunId();
    const config = getScannerConfig(this.configOverrides);
    const sessionMeta = marketSessionMeta(startedAt);
    const emptyStats = (): ScannerRunStats => ({
      universeSize: 0,
      evaluatedCount: 0,
      candidateCount: 0,
      skippedMissingData: 0,
      skippedStale: 0,
      skippedFiltered: 0,
      errorCount: 0
    });

    if (!force && !this.ignoreMarketSession && !isScannerTradingSession(sessionMeta.marketSession)) {
      const skipped: ScannerRunResult = {
        runId,
        status: "SKIPPED_MARKET_CLOSED",
        startedAt: startedAt.toISOString(),
        completedAt: this.now().toISOString(),
        marketSession: sessionMeta.marketSession,
        tradingDate: sessionMeta.tradingDate,
        message: `Market session is ${sessionMeta.marketSession}; scan skipped.`,
        stats: emptyStats(),
        candidates: []
      };
      this.remember(skipped);
      this.log("INFO", "scanner_skipped_market_closed", skipped.message!, {
        marketSession: sessionMeta.marketSession
      });
      return skipped;
    }

    this.lifecycle = "RUNNING";
    if (!this.suppressDiagnostics) this.log("INFO", "scanner_started", "Scanner run started.", { runId });

    const stats = emptyStats();

    try {
      const universeStarted = process.hrtime.bigint();
      const universe = await this.universe.getTradableEquities(["NSE"]);
      if (profile) profile.universeLoadNs += elapsedNs(universeStarted);
      stats.universeSize = universe.length;
      const store = this.getLatestStore();
      const nowMs = this.now().getTime();
      const candidates: ScannerCandidate[] = [];

      for (const instrument of universe) {
        try {
          if (!instrument.instrumentToken) {
            stats.skippedMissingData += 1;
            continue;
          }

          if (profile) profile.instrumentsConsidered += 1;
          const observationStarted = process.hrtime.bigint();
          const tick = store.getLatest(instrument.instrumentToken);
          const observation = toObservation(tick, instrument.instrumentToken, nowMs, config.maxDataAgeMs);
          if (profile) profile.observationNs += elapsedNs(observationStarted);
          stats.evaluatedCount += 1;

          if (observation.missing) {
            stats.skippedMissingData += 1;
            continue;
          }
          if (observation.stale) {
            stats.skippedStale += 1;
            this.logThrottledStale(instrument.tradingSymbol);
            continue;
          }

          const featureStarted = process.hrtime.bigint();
          const features = calculateFeatures(observation, config);
          if (profile) { profile.featureNs += elapsedNs(featureStarted); profile.featureCalculations += 1; }
          const filterStarted = process.hrtime.bigint();
          const filter = applyScannerFilters({
            observation,
            features,
            config,
            isActive: instrument.isActive
          });
          if (profile) profile.filterNs += elapsedNs(filterStarted);

          if (!filter.ok) {
            stats.skippedFiltered += 1;
            continue;
          }

          const scoreStarted = process.hrtime.bigint();
          const scored = scoreCandidate(features, config);
          if (profile) profile.scoreNs += elapsedNs(scoreStarted);
          if (scored.score < config.minScore || scored.reasons.length === 0) {
            stats.skippedFiltered += 1;
            continue;
          }

          candidates.push({
            instrumentToken: instrument.instrumentToken,
            tradingSymbol: instrument.tradingSymbol,
            exchange: instrument.exchange,
            instrumentId: instrument.id,
            direction: scored.direction,
            score: scored.score,
            scoreComponents: scored.scoreComponents,
            lastPrice: observation.lastPrice!,
            dataTimestamp: observation.dataTimestamp!,
            dataAgeMs: observation.dataAgeMs ?? 0,
            stale: false,
            features,
            reasons: scored.reasons,
            marketRegime: "UNKNOWN",
            source: "SCANNER"
          });
          if (profile) profile.candidatesConstructed += 1;
        } catch {
          stats.errorCount += 1;
          this.log("WARN", "scanner_feature_error", "Instrument evaluation failed.", {
            tradingSymbol: instrument.tradingSymbol
          });
        }
      }

      const rankingStarted = process.hrtime.bigint();
      candidates.sort((a, b) => b.score - a.score || a.tradingSymbol.localeCompare(b.tradingSymbol));
      const top = candidates.slice(0, config.maxCandidates);
      if (profile) profile.rankingNs += elapsedNs(rankingStarted);
      stats.candidateCount = top.length;

      if (this.shouldPersist && top.length > 0) {
        await persistScannerCandidates(runId, top);
      }

      const result: ScannerRunResult = {
        runId,
        status: "COMPLETE",
        startedAt: startedAt.toISOString(),
        completedAt: this.now().toISOString(),
        marketSession: sessionMeta.marketSession,
        tradingDate: sessionMeta.tradingDate,
        stats,
        candidates: top
      };

      // Incomplete market-data coverage is surfaced in stats, not silently as success with zero interest.
      if (stats.universeSize > 0 && stats.skippedMissingData === stats.universeSize) {
        result.message = "Scan completed but no instruments had usable market data.";
      }

      this.lifecycle = "IDLE";
      this.remember(result);
      if (!this.suppressDiagnostics) this.log("INFO", "scanner_completed", "Scanner run completed.", {
        runId,
        candidateCount: top.length,
        evaluatedCount: stats.evaluatedCount,
        skippedMissingData: stats.skippedMissingData,
        skippedStale: stats.skippedStale
      });
      return result;
    } catch (error) {
      this.lifecycle = "FAILED";
      const failed: ScannerRunResult = {
        runId,
        status: "FAILED",
        startedAt: startedAt.toISOString(),
        completedAt: this.now().toISOString(),
        marketSession: sessionMeta.marketSession,
        tradingDate: sessionMeta.tradingDate,
        message: error instanceof Error ? error.message : "Scanner failed.",
        stats,
        candidates: []
      };
      this.remember(failed);
      this.log("ERROR", "scanner_failed", failed.message!);
      throw new ScannerError("SCANNER_FAILED", failed.message!);
    }
  }

  private async executeIncrementalRun(force: boolean, dirtyInstrumentToken: string, profile?: ScannerRunProfile): Promise<ScannerRunResult> {
    const startedAt = this.now();
    const runId = newScannerRunId();
    const config = getScannerConfig(this.configOverrides);
    const sessionMeta = marketSessionMeta(startedAt);
    if (!force && !this.ignoreMarketSession && !isScannerTradingSession(sessionMeta.marketSession)) {
      return this.executeRun(force, profile);
    }

    this.lifecycle = "RUNNING";
    const universeStarted = process.hrtime.bigint();
    const universe = this.incrementalState?.universe ?? await this.universe.getTradableEquities(["NSE"]);
    if (profile) profile.universeLoadNs += elapsedNs(universeStarted);
    const nowMs = startedAt.getTime();
    if (!this.incrementalState || this.incrementalState.timestampMs !== nowMs) {
      this.incrementalState = { universe, timestampMs: nowMs, seenTokens: this.incrementalState?.seenTokens ?? new Set(), candidates: new Map(), filteredCount: 0 };
    }
    const state = this.incrementalState;
    const instrument = state.universe.find((item) => item.instrumentToken === dirtyInstrumentToken);
    if (!instrument) {
      throw new ScannerError("SCANNER_FAILED", `Incremental scanner received unknown instrument ${dirtyInstrumentToken}.`);
    }

    state.seenTokens.add(dirtyInstrumentToken);
    if (profile) profile.instrumentsConsidered += 1;
    const store = this.getLatestStore();
    const observationStarted = process.hrtime.bigint();
    const observation = toObservation(store.getLatest(dirtyInstrumentToken), dirtyInstrumentToken, nowMs, config.maxDataAgeMs);
    if (profile) profile.observationNs += elapsedNs(observationStarted);
    state.candidates.delete(dirtyInstrumentToken);

    let errorCount = 0;
    if (observation.missing) {
      // Missing ticks are represented in aggregate stats below.
    } else if (observation.stale) {
      // The historical timestamp transition makes all prior-minute ticks stale.
    } else {
      try {
        const featureStarted = process.hrtime.bigint();
        const features = calculateFeatures(observation, config);
        if (profile) { profile.featureNs += elapsedNs(featureStarted); profile.featureCalculations += 1; }
        const filterStarted = process.hrtime.bigint();
        const filter = applyScannerFilters({ observation, features, config, isActive: instrument.isActive });
        if (profile) profile.filterNs += elapsedNs(filterStarted);
        if (!filter.ok) {
          state.filteredCount += 1;
        } else {
          const scoreStarted = process.hrtime.bigint();
          const scored = scoreCandidate(features, config);
          if (profile) profile.scoreNs += elapsedNs(scoreStarted);
          if (scored.score < config.minScore || scored.reasons.length === 0) {
            state.filteredCount += 1;
          } else {
            state.candidates.set(dirtyInstrumentToken, {
              instrumentToken: dirtyInstrumentToken,
              tradingSymbol: instrument.tradingSymbol,
              exchange: instrument.exchange,
              instrumentId: instrument.id,
              direction: scored.direction,
              score: scored.score,
              scoreComponents: scored.scoreComponents,
              lastPrice: observation.lastPrice!,
              dataTimestamp: observation.dataTimestamp!,
              dataAgeMs: observation.dataAgeMs ?? 0,
              stale: false,
              features,
              reasons: scored.reasons,
              marketRegime: "UNKNOWN",
              source: "SCANNER"
            });
            if (profile) profile.candidatesConstructed += 1;
          }
        }
      } catch {
        errorCount += 1;
      }
    }

    const rankingStarted = process.hrtime.bigint();
    const candidates = [...state.candidates.values()].sort((a, b) => b.score - a.score || a.tradingSymbol.localeCompare(b.tradingSymbol)).slice(0, config.maxCandidates);
    if (profile) profile.rankingNs += elapsedNs(rankingStarted);
    const missing = state.universe.length - state.seenTokens.size;
    const fresh = state.candidates.size + state.filteredCount;
    const stats: ScannerRunStats = {
      universeSize: state.universe.length,
      evaluatedCount: state.universe.length,
      candidateCount: candidates.length,
      skippedMissingData: missing,
      skippedStale: Math.max(0, state.universe.length - missing - fresh),
      skippedFiltered: state.filteredCount,
      errorCount
    };
    const result: ScannerRunResult = {
      runId,
      status: "COMPLETE",
      startedAt: startedAt.toISOString(),
      completedAt: this.now().toISOString(),
      marketSession: sessionMeta.marketSession,
      tradingDate: sessionMeta.tradingDate,
      stats,
      candidates
    };
    if (stats.universeSize > 0 && stats.skippedMissingData === stats.universeSize) result.message = "Scan completed but no instruments had usable market data.";
    this.lifecycle = "IDLE";
    this.remember(result);
    return result;
  }

  private remember(result: ScannerRunResult) {
    this.lastRun = result;
    this.runs.unshift(result);
    if (this.runs.length > 50) {
      this.runs.length = 50;
    }
  }

  private lastStaleLogAt = 0;
  private logThrottledStale(tradingSymbol: string) {
    const now = Date.now();
    if (now - this.lastStaleLogAt < 5000) {
      return;
    }
    this.lastStaleLogAt = now;
    this.log("WARN", "scanner_market_data_stale", "Stale market data excluded from candidates.", {
      tradingSymbol
    });
  }

  private log(
    level: "INFO" | "WARN" | "ERROR",
    event: string,
    message: string,
    metadata: Record<string, unknown> = {}
  ) {
    void this.resolveRepos()
      .users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME })
      .then((user) =>
        this.resolveRepos().systemLogs.create({
          userId: user.id,
          level,
          source: "scanner",
          message,
          metadata: { event, ...metadata }
        })
      )
      .catch(() => undefined);
  }
}

function elapsedNs(started: bigint) {
  return Number(process.hrtime.bigint() - started);
}

function toObservation(
  tick: MarketTick | null,
  instrumentToken: string,
  nowMs: number,
  maxAgeMs: number
): ScannerMarketObservation {
  if (!tick) {
    return {
      instrumentToken,
      lastPrice: null,
      open: null,
      high: null,
      low: null,
      close: null,
      volume: null,
      averagePrice: null,
      dataTimestamp: null,
      receivedAt: null,
      dataAgeMs: null,
      stale: true,
      missing: true
    };
  }

  const receivedAtMs = Date.parse(tick.receivedAt);
  const dataAgeMs = Number.isFinite(receivedAtMs) ? Math.max(0, nowMs - receivedAtMs) : null;
  const stale = dataAgeMs == null || dataAgeMs > maxAgeMs || !(tick.lastPrice > 0);

  return {
    instrumentToken,
    lastPrice: tick.lastPrice > 0 ? tick.lastPrice : null,
    open: tick.open,
    high: tick.high,
    low: tick.low,
    close: tick.close,
    volume: tick.volume,
    averagePrice: tick.averagePrice,
    dataTimestamp: tick.timestamp,
    receivedAt: tick.receivedAt,
    dataAgeMs,
    stale,
    missing: false
  };
}

let singleton: ProductionScannerService | null = null;

export function getProductionScannerService() {
  singleton ??= new ProductionScannerService();
  return singleton;
}

export function resetProductionScannerServiceForTests(next?: ProductionScannerService) {
  singleton?.stopScheduler();
  singleton = next ?? null;
}
