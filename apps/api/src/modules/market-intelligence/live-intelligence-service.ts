import { getTradingDate } from "../../common/utils/trading-date";
import { nseCashCalendar } from "../historical-market-data/calendar";
import type { MarketStreamService } from "../market-data/stream/service";
import type { MarketStreamState, MarketTick } from "../market-data/stream/types";
import { fromCompletedBenchmarkCandle, MarketContextEngine } from "./context-engine";
import type { InstrumentMarketContext, MarketContextSnapshot, SectorContextSnapshot } from "./context-types";
import { benchmarkRegistry, contextUniverseId, getBenchmarkByToken, isContextBenchmarkToken, isFrozenBreadthConstituent, sectorMemberships, type SectorId } from "./context-universe";
import { fromCompletedMarketCandle, MarketFeatureEngine } from "./feature-engine";
import { FEATURE_SCHEMA_VERSION, type FeatureSnapshot } from "./feature-types";
import { LiveMinuteCandleAssembler, type CompletedLiveCandle } from "./live-minute-candles";
import { LIVE_SESSION_POLICY_VERSION, OperationalCasPolicy, resolveLiveFeatureSession } from "./live-session-policy";
import { MarketRegimeEngine } from "./regime-engine";
import { REGIME_DEFINITION_VERSION, regimeDefinitionHash } from "./regime-definition";
import type { MarketRegimeSnapshot, SectorRegimeSnapshot } from "./regime-types";

export const LIVE_INTELLIGENCE_VERSION = "LIVE_MARKET_INTELLIGENCE_V1";
const STALE_AFTER_MS = 90_000;
const BENCHMARK_TOKENS = benchmarkRegistry.map((item) => item.instrumentToken);
const EQUITY_TOKENS = sectorMemberships.map((item) => item.instrumentToken);

export interface IntelligenceChangeEvent {
  type: "MARKET_REGIME_CHANGED" | "SECTOR_REGIME_CHANGED" | "QUALITY_CHANGED";
  timestamp: string;
  scope: string;
  previous: string | null;
  current: string;
}

export class LiveMarketIntelligenceService {
  readonly featureEngine = new MarketFeatureEngine();
  readonly contextEngine = new MarketContextEngine();
  readonly regimeEngine = new MarketRegimeEngine();
  readonly assembler = new LiveMinuteCandleAssembler();
  private readonly features = new Map<string, FeatureSnapshot>();
  private readonly contexts = new Map<string, InstrumentMarketContext>();
  private readonly sectors = new Map<SectorId, SectorContextSnapshot>();
  private readonly sectorRegimes = new Map<SectorId, SectorRegimeSnapshot>();
  private readonly listeners = new Set<(event: IntelligenceChangeEvent) => void>();
  private market: MarketContextSnapshot | null = null;
  private marketRegime: MarketRegimeSnapshot | null = null;
  private lastBenchmarkAt: string | null = null;
  private lastEquityAt: string | null = null;
  private lastFrameMs = Number.NEGATIVE_INFINITY;
  private lastError: string | null = null;
  private errorCount = 0;
  private lastErrorLogAt = 0;
  private droppedFrames = 0;
  private processedCandles = 0;
  private featureEvaluations = 0;
  private marketContextUpdates = 0;
  private sectorContextUpdates = 0;
  private regimeUpdates = 0;
  private connectionState: MarketStreamState = "STOPPED";
  private unsubscribeTick: (() => void) | null = null;
  private unsubscribeConnection: (() => void) | null = null;
  private timer: ReturnType<typeof setInterval> | null = null;
  private policyDate: string | null = null;
  private sourceLoading: Promise<void> | null = null;
  private retryPolicyAfterMs = 0;
  private resumeAtMs = Number.NEGATIVE_INFINITY;

  constructor(private readonly stream: MarketStreamService, readonly casPolicy = new OperationalCasPolicy(),
    private readonly now: () => Date = () => new Date()) {}

  start() {
    if (this.unsubscribeTick) return;
    this.unsubscribeTick = this.stream.store.onAppliedTick((tick) => { try { this.ingestTick(tick); } catch (error) { this.recordError(error); } });
    this.unsubscribeConnection = this.stream.bus.onConnectionStateChange((state) => this.handleConnection(state));
    this.timer = setInterval(() => { try { this.flush(this.now()); this.ensurePolicy(this.now()); } catch (error) { this.recordError(error); } }, 1_000);
    this.timer.unref();
    this.connectionState = this.stream.getStatus().state;
    this.ensurePolicy(this.now());
    if (this.connectionState === "CONNECTED") this.handleConnection("CONNECTED");
  }

  stop() {
    this.unsubscribeTick?.(); this.unsubscribeTick = null;
    this.unsubscribeConnection?.(); this.unsubscribeConnection = null;
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
    this.assembler.discardOpen();
    this.connectionState = "STOPPED";
  }

  onChange(listener: (event: IntelligenceChangeEvent) => void) { this.listeners.add(listener); return () => this.listeners.delete(listener); }

  private emit(event: IntelligenceChangeEvent) {
    for (const listener of this.listeners) {
      try { listener(event); } catch (error) { this.recordError(error); }
    }
  }

  private recordError(error: unknown) {
    this.errorCount += 1;
    this.lastError = error instanceof Error ? error.message : String(error);
    if (Date.now() - this.lastErrorLogAt >= 60_000) {
      this.lastErrorLogAt = Date.now();
      this.stream.logger.error("market_intelligence_error", this.lastError, { errorCode: "MARKET_INTELLIGENCE_ERROR", suppressedErrors: this.errorCount - 1 });
    }
  }

  private ensurePolicy(at: Date) {
    const tradeDate = getTradingDate(at, "Asia/Kolkata");
    if (!nseCashCalendar.getDay(tradeDate).session) return;
    if (["READY", "RECONCILIATION_INCOMPLETE", "SOURCE_DISAGREEMENT"].includes(this.casPolicy.diagnostics(tradeDate).status)) {
      this.policyDate = tradeDate;
      return;
    }
    if (tradeDate === this.policyDate || this.sourceLoading || Date.now() < this.retryPolicyAfterMs) return;
    this.policyDate = tradeDate;
    this.sourceLoading = (async () => {
      await this.casPolicy.loadPersisted(tradeDate);
      await this.casPolicy.refresh(tradeDate);
    })().catch((error) => {
      this.policyDate = null;
      this.retryPolicyAfterMs = Date.now() + 300_000;
      this.recordError(error);
    }).finally(() => { this.sourceLoading = null; });
  }

  private handleConnection(state: MarketStreamState) {
    this.connectionState = state;
    if (state !== "CONNECTED") {
      this.assembler.discardOpen();
      this.resumeAtMs = Math.ceil(this.now().getTime() / 60_000) * 60_000;
      this.emit({ type: "QUALITY_CHANGED", timestamp: this.now().toISOString(), scope: "MARKET", previous: "CONNECTED", current: state });
      return;
    }
    this.ensurePolicy(this.now());
    void this.stream.subscribe(BENCHMARK_TOKENS, "QUOTE")
      .then(() => this.stream.subscribe(EQUITY_TOKENS, "QUOTE"))
      .then(() => this.stream.logger.info("market_intelligence_subscribed", "Context benchmarks and research-sample equities subscribed.",
        { benchmarkCount: BENCHMARK_TOKENS.length, equityCount: EQUITY_TOKENS.length }))
      .catch((error) => this.recordError(error));
  }

  private ingestTick(tick: MarketTick) {
    const benchmark = getBenchmarkByToken(tick.instrumentToken);
    const equity = isFrozenBreadthConstituent(tick.instrumentToken);
    if (!benchmark && !equity) return;
    if (benchmark && equity) throw new Error("Context benchmark overlaps tradable research equity");
    const at = new Date(tick.exchangeTimestamp ?? tick.receivedAt);
    if (!Number.isFinite(at.getTime()) || at.getTime() < this.resumeAtMs) return;
    const session = resolveLiveFeatureSession({ instrumentToken: tick.instrumentToken, exchange: tick.exchange ?? "",
      tradingSymbol: tick.tradingSymbol ?? "" }, at, this.casPolicy, Boolean(benchmark));
    if (!session) return;
    this.assembler.ingest(tick, session, Boolean(benchmark));
  }

  flush(asOf: Date) {
    const completed = this.assembler.drain(asOf);
    let i = 0;
    while (i < completed.length) {
      const closeMs = Date.parse(completed[i]!.candle.startTime) + 60_000;
      const frame: CompletedLiveCandle[] = [];
      while (i < completed.length && Date.parse(completed[i]!.candle.startTime) + 60_000 === closeMs) frame.push(completed[i++]!);
      if (closeMs < this.lastFrameMs) { this.droppedFrames += frame.length; continue; }
      try { this.processFrame(frame, closeMs); this.lastFrameMs = closeMs; }
      catch (error) { this.recordError(error); this.droppedFrames += frame.length; }
    }
  }

  private processFrame(frame: CompletedLiveCandle[], closeMs: number) {
    const asOf = new Date(closeMs);
    const equityTokens: string[] = [];
    for (const item of frame) {
      const { candle, previousSessionClose, sourceIdentity } = item;
      if (item.benchmark) {
        const benchmark = getBenchmarkByToken(candle.instrumentToken);
        if (!benchmark) throw new Error("Unregistered context benchmark");
        this.contextEngine.ingestBenchmark(fromCompletedBenchmarkCandle(candle, benchmark.id, sourceIdentity, previousSessionClose));
        this.lastBenchmarkAt = asOf.toISOString();
      } else {
        if (isContextBenchmarkToken(candle.instrumentToken) || !isFrozenBreadthConstituent(candle.instrumentToken)) {
          throw new Error("Context index entered equity feature path");
        }
        const feature = this.featureEngine.ingest(fromCompletedMarketCandle(candle, {
          exchange: item.exchange, tradingSymbol: item.tradingSymbol, sourceIdentity, previousSessionClose
        }, item.session));
        this.featureEvaluations += 1;
        this.features.set(candle.instrumentToken, feature);
        this.contextEngine.ingestEquity({ feature, previousSessionClose });
        equityTokens.push(candle.instrumentToken);
        this.lastEquityAt = asOf.toISOString();
      }
      this.processedCandles += 1;
    }
    if (!equityTokens.length) return;
    const representativeBySector = new Map<SectorId, string>();
    for (const token of equityTokens) {
      const context = this.contextEngine.getContext(token, asOf);
      this.contexts.set(token, context);
      if (context.sector && !representativeBySector.has(context.sector.sectorId)) representativeBySector.set(context.sector.sectorId, token);
    }
    const first = this.contexts.get(equityTokens[0]!)!;
    if (first.market.id !== this.market?.id) {
      this.market = first.market;
      this.marketContextUpdates += 1;
    }
    for (const [sectorId, token] of representativeBySector) {
      const sector = this.contexts.get(token)!.sector!;
      if (sector.id !== this.sectors.get(sectorId)?.id) {
        this.sectors.set(sectorId, sector);
        this.sectorContextUpdates += 1;
      }
    }
    const oldMarket = this.marketRegime;
    for (const token of representativeBySector.values()) {
      const result = this.regimeEngine.observe(this.contexts.get(token)!);
      this.marketRegime = result.market;
      if (result.sector) {
        const prior = this.sectorRegimes.get(result.sector.sectorId);
        this.sectorRegimes.set(result.sector.sectorId, result.sector);
        if (prior?.trend.state !== result.sector.trend.state) this.emit({ type: "SECTOR_REGIME_CHANGED", timestamp: asOf.toISOString(),
          scope: result.sector.sectorId, previous: prior?.trend.state ?? null, current: result.sector.trend.state });
      }
    }
    if (oldMarket?.id !== this.marketRegime?.id) this.regimeUpdates += 1;
    if (oldMarket?.trend.state !== this.marketRegime?.trend.state && this.marketRegime) this.emit({ type: "MARKET_REGIME_CHANGED",
      timestamp: asOf.toISOString(), scope: "MARKET", previous: oldMarket?.trend.state ?? null, current: this.marketRegime.trend.state });
  }

  private availability(timestamp: string | null, now: Date) {
    const ageMs = timestamp == null ? null : now.getTime() - Date.parse(timestamp);
    const reason = this.connectionState === "AUTH_FAILED" ? "AUTH_REQUIRED" : this.connectionState !== "CONNECTED" ? "STREAM_DISCONNECTED" :
      ageMs == null ? "WARMUP" : ageMs > STALE_AFTER_MS ? "STALE_OBSERVATION" : null;
    return { status: reason ? "UNAVAILABLE" as const : "AVAILABLE" as const, reason, observationTimestamp: timestamp, ageMs };
  }

  getLatestMarketContext(now = new Date()) {
    const base = this.availability(this.market?.timestamp ?? null, now);
    const benchmarkAge = this.market?.benchmark.observedAt == null ? null : now.getTime() - Date.parse(this.market.benchmark.observedAt);
    const freshness = base.status === "AVAILABLE" && (benchmarkAge == null || benchmarkAge > STALE_AFTER_MS)
      ? { ...base, status: "UNAVAILABLE" as const, reason: "STALE_BENCHMARK" } : base;
    return { version: LIVE_INTELLIGENCE_VERSION, contextUniverseId, freshness,
      market: freshness.status === "AVAILABLE" ? this.market : null,
      regime: freshness.status === "AVAILABLE" ? this.marketRegime : null };
  }

  getLatestSectorContext(sectorId: SectorId, now = new Date()) {
    const context = this.sectors.get(sectorId) ?? null;
    const base = this.availability(context?.timestamp ?? null, now);
    const market = this.getLatestMarketContext(now);
    const benchmarkAge = context?.benchmark?.observedAt == null ? null : now.getTime() - Date.parse(context.benchmark.observedAt);
    const freshness = base.status !== "AVAILABLE" ? base : market.freshness.status !== "AVAILABLE"
      ? { ...base, status: "UNAVAILABLE" as const, reason: market.freshness.reason }
      : context?.benchmark && (benchmarkAge == null || benchmarkAge > STALE_AFTER_MS)
        ? { ...base, status: "UNAVAILABLE" as const, reason: "STALE_BENCHMARK" } : base;
    return { sectorId, freshness, context: freshness.status === "AVAILABLE" ? context : null,
      regime: freshness.status === "AVAILABLE" ? this.sectorRegimes.get(sectorId) ?? null : null };
  }

  getSectors(now = new Date()) {
    return [...new Set(sectorMemberships.map((item) => item.sectorId))].sort().map((sectorId) => this.getLatestSectorContext(sectorId, now));
  }

  getLatestInstrumentFeatures(token: string, now = new Date()) {
    if (!isFrozenBreadthConstituent(token)) return null;
    const feature = this.features.get(token) ?? null;
    const freshness = this.availability(feature?.timestamp ?? null, now);
    return { instrumentToken: token, freshness, feature: freshness.status === "AVAILABLE" ? feature : null };
  }

  getIntelligenceSnapshot(token: string, now = new Date()) {
    const instrument = this.getLatestInstrumentFeatures(token, now);
    if (!instrument) return null;
    const context = this.contexts.get(token) ?? null;
    const market = this.getLatestMarketContext(now);
    const contextAvailable = instrument.freshness.status === "AVAILABLE" && market.freshness.status === "AVAILABLE" &&
      this.availability(context?.timestamp ?? null, now).status === "AVAILABLE";
    const sector = context?.sector ? this.getLatestSectorContext(context.sector.sectorId, now) : null;
    return { ...instrument, context: contextAvailable ? context : null,
      marketRegime: market.regime, sectorRegime: contextAvailable && sector?.freshness.status === "AVAILABLE" ? sector.regime : null };
  }

  getLatestMarketRegime(now = new Date()) { return this.getLatestMarketContext(now).regime; }
  getLatestSectorRegime(sectorId: SectorId, now = new Date()) { return this.getLatestSectorContext(sectorId, now).regime; }

  getHealth(now = new Date()) {
    const desired = new Set(this.stream.listSubscriptions().map((item) => item.instrumentToken));
    const active = new Set(this.stream.subscriptions.getActual().map((item) => item.instrumentToken));
    const tradeDate = getTradingDate(now, "Asia/Kolkata");
    return {
      version: LIVE_INTELLIGENCE_VERSION, featureSchemaVersion: FEATURE_SCHEMA_VERSION, contextUniverseId,
      regimeVersion: REGIME_DEFINITION_VERSION, regimeDefinitionHash, liveSessionPolicyVersion: LIVE_SESSION_POLICY_VERSION,
      cas: this.casPolicy.diagnostics(tradeDate), stream: this.stream.getStatus(),
      benchmarkSubscriptions: { expected: BENCHMARK_TOKENS.length, desired: BENCHMARK_TOKENS.filter((token) => desired.has(token)).length,
        active: BENCHMARK_TOKENS.filter((token) => active.has(token)).length,
        missing: BENCHMARK_TOKENS.filter((token) => !active.has(token)) },
      equitySubscriptions: { expected: EQUITY_TOKENS.length, desired: EQUITY_TOKENS.filter((token) => desired.has(token)).length,
        active: EQUITY_TOKENS.filter((token) => active.has(token)).length },
      instruments: sectorMemberships.map(({ instrumentToken, tradingSymbol, sectorId }) => ({ instrumentToken, tradingSymbol, sectorId })),
      lastBenchmarkAt: this.lastBenchmarkAt, lastEquityAt: this.lastEquityAt,
      marketFreshness: this.getLatestMarketContext(now).freshness,
      regimeFreshness: this.getLatestMarketContext(now).freshness,
      breadthCoveragePct: this.market?.breadth.coveragePct ?? 0,
      errors: { count: this.errorCount, last: this.lastError, droppedFrames: this.droppedFrames },
      counters: { processedCandles: this.processedCandles, featureEvaluations: this.featureEvaluations,
        marketContextUpdates: this.marketContextUpdates, sectorContextUpdates: this.sectorContextUpdates, regimeUpdates: this.regimeUpdates },
      stateSize: { ...this.assembler.size(), ...this.featureEngine.stateSize(), ...this.contextEngine.stateSize(),
        ...this.regimeEngine.stateSize(), latestFeatures: this.features.size, latestContexts: this.contexts.size,
        latestSectors: this.sectors.size, latestSectorRegimes: this.sectorRegimes.size }
    };
  }
}
