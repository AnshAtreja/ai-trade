import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import { isDatabasePersistenceEnabled } from "../../config/env";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { aggregateOneMinuteToFiveMinute } from "./aggregation";
import { getHistoricalMarketDataConfig, type HistoricalMarketDataConfig } from "./config";
import { HistoricalCandleDownloader } from "./downloader";
import { HistoricalMarketDataError } from "./errors";
import { KiteHistoricalMarketDataProvider } from "./kite-historical-provider";
import { MockHistoricalMarketDataProvider } from "./mock-historical-provider";
import type { HistoricalMarketDataProvider } from "./provider";
import type { CoverageSummary, HistoricalRangeRequest, NormalizedHistoricalCandle } from "./types";
import { detectMissingRanges, validateHistoricalCandles } from "./validation";
import { datasetManifest, sessionCoverage } from "./dataset";
import { selectResearchCandles, type ResearchCandleEligibilityResult } from "./eligibility";
import { historicalCasEligibilityDataset, NseCashInstrumentSessionPolicy, type InstrumentIdentity, type InstrumentSessionPolicy } from "./session-policy";

export class HistoricalMarketDataService {
  private downloader: HistoricalCandleDownloader;
  private readonly sessionPolicy: InstrumentSessionPolicy;
  private readonly historicalSessionPolicy: InstrumentSessionPolicy;

  constructor(
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly config: HistoricalMarketDataConfig = getHistoricalMarketDataConfig(),
    private provider: HistoricalMarketDataProvider = defaultHistoricalProvider()
  ) {
    this.downloader = new HistoricalCandleDownloader(this.provider, this.resolveRepos, this.config);
    this.sessionPolicy = new NseCashInstrumentSessionPolicy();
    this.historicalSessionPolicy = new NseCashInstrumentSessionPolicy(historicalCasEligibilityDataset);
  }

  getProvider() {
    return this.provider;
  }

  setProviderForTests(provider: HistoricalMarketDataProvider) {
    this.provider = provider;
    this.downloader = new HistoricalCandleDownloader(provider, this.resolveRepos, this.config);
  }

  getSessionPolicy() {
    return this.sessionPolicy;
  }

  getHistoricalSessionPolicy() {
    return this.historicalSessionPolicy;
  }

  async resolveSessionIdentity(instrumentToken: string, tradingSymbol?: string): Promise<InstrumentIdentity> {
    const instrument = await this.resolveRepos().instruments.findByInstrumentToken(instrumentToken);
    if (!instrument) {
      return { instrumentToken, tradingSymbol: tradingSymbol ?? instrumentToken, exchange: "NSE", eligibility: "UNKNOWN", eligibilitySource: "Instrument master record not found" };
    }
    if (instrument.exchange !== "NSE" || instrument.instrumentType !== "EQ" || instrument.expiry) {
      return { instrumentToken, tradingSymbol: instrument.symbol, exchange: instrument.exchange, eligibility: "NOT_ELIGIBLE", eligibilitySource: "Instrument master: not an NSE cash EQ instrument" };
    }
    const futures = await this.resolveRepos().instruments.list({ exchange: "NFO", instrumentType: "FUT", isActive: true, hasExpiry: true, symbolPrefix: instrument.symbol, limit: 5000 });
    const hasMatchingFuture = futures.some((future) => future.symbol.startsWith(instrument.symbol) && /^\d/.test(future.symbol.slice(instrument.symbol.length)));
    return { instrumentToken, tradingSymbol: instrument.symbol, exchange: instrument.exchange, eligibility: hasMatchingFuture ? "ELIGIBLE" : "NOT_ELIGIBLE", eligibilitySource: "Current synchronized Kite instrument master: active matching NFO futures" };
  }

  async resolveHistoricalSessionIdentity(instrumentToken: string, tradingSymbol?: string): Promise<InstrumentIdentity> {
    const instrument = await this.resolveRepos().instruments.findByInstrumentToken(instrumentToken);
    if (!instrument) return { instrumentToken, tradingSymbol: tradingSymbol ?? instrumentToken, exchange: "NSE", eligibility: "UNKNOWN", eligibilitySource: `Historical CAS dataset ${historicalCasEligibilityDataset.version}: instrument master record not found` };
    const eligibleUniverse = instrument.exchange === "NSE" && instrument.instrumentType === "EQ" && !instrument.expiry;
    return { instrumentToken, tradingSymbol: instrument.symbol, exchange: instrument.exchange, eligibility: eligibleUniverse ? "UNKNOWN" : "NOT_ELIGIBLE", eligibilitySource: eligibleUniverse ? `Historical CAS dataset ${historicalCasEligibilityDataset.version}: no point-in-time record loaded` : "Historical session policy: not an NSE cash EQ instrument" };
  }

  async download(input: {
    instrumentToken: string;
    tradingSymbol?: string;
    exchange?: string;
    interval?: "1m" | "5m";
    from: string | Date;
    to: string | Date;
    reconcile?: boolean;
  }) {
    const request = await this.resolveRequest(input);
    if (request.interval === "5m") {
      throw new HistoricalMarketDataError(
        "HISTORICAL_INVALID_REQUEST",
        "Download 1m candles and derive 5m locally. Direct 5m Kite download is out of scope for Phase 8A."
      );
    }
    return this.downloader.download(request, { reconcile: input.reconcile === true });
  }

  async getCandles(input: {
    instrumentToken: string;
    interval?: "1m" | "5m";
    from: string | Date;
    to: string | Date;
    /** When interval=5m and no stored 5m rows, derive from stored 1m. */
    derive5m?: boolean;
  }): Promise<NormalizedHistoricalCandle[]> {
    const request = await this.resolveRequest({ ...input, interval: input.interval ?? "1m" });
    const stored = await this.provider.getStoredCandles(request);
    if (request.interval === "5m" && stored.length === 0 && input.derive5m !== false) {
      const oneMinute = await this.provider.getStoredCandles({ ...request, interval: "1m" });
      return aggregateOneMinuteToFiveMinute(oneMinute, { includeIncomplete: false, asOf: request.to });
    }
    // Temporal guarantee: filter again for end exclusivity
    return stored.filter((c) => c.timestamp.getTime() < request.to.getTime() && c.timestamp.getTime() >= request.from.getTime());
  }

  /**
   * Research-facing view. Raw getCandles() intentionally remains an observation
   * accessor; consumers must explicitly choose whether incomplete sessions are allowed.
   */
  async getResearchCandles(input: {
    instrumentToken: string;
    interval?: "1m" | "5m";
    from: string | Date;
    to: string | Date;
    requireCompleteSession: boolean;
  }): Promise<ResearchCandleEligibilityResult> {
    const interval = input.interval ?? "1m";
    const from = asDate(input.from);
    const to = asDate(input.to);
    const candles = await this.getCandles({ instrumentToken: input.instrumentToken, interval, from, to });
    const identity = await this.resolveHistoricalSessionIdentity(input.instrumentToken, candles[0]?.tradingSymbol);
    const sessions = sessionCoverage({ from, to, interval, candles, instrument: identity, sessionPolicy: this.historicalSessionPolicy });
    return selectResearchCandles({ candles, sessions, interval, requireCompleteSession: input.requireCompleteSession });
  }

  async validate(input: {
    instrumentToken: string;
    interval?: "1m" | "5m";
    from: string | Date;
    to: string | Date;
  }) {
    const request = await this.resolveRequest({ ...input, interval: input.interval ?? "1m" });
    const candles = await this.getCandles(request);
    return validateHistoricalCandles({
      instrumentToken: request.instrumentToken,
      interval: request.interval,
      from: request.from,
      to: request.to,
      candles
    });
  }

  async coverage(params?: {
    instrumentToken?: string;
    interval?: "1m" | "5m";
    from?: string | Date;
    to?: string | Date;
    limit?: number;
  }): Promise<CoverageSummary[]> {
    const rows = await this.resolveRepos().historicalCandles.coverage({
      instrumentToken: params?.instrumentToken,
      interval: params?.interval,
      limit: params?.limit
    });

    const from = params?.from ? asDate(params.from) : null;
    const to = params?.to ? asDate(params.to) : null;

    const summaries: CoverageSummary[] = [];
    for (const row of rows) {
      let missingRanges: CoverageSummary["missingRanges"] = [];
      if (from && to) {
        const candles = await this.resolveRepos().historicalCandles.listRange({
          instrumentToken: row.instrumentToken,
          interval: row.interval,
          from,
          to
        });
        missingRanges = detectMissingRanges({
          interval: row.interval,
          from,
          to,
          candles: candles.map((c) => ({
            instrumentId: c.instrumentId,
            instrumentToken: c.instrumentToken,
            exchange: c.exchange,
            tradingSymbol: c.tradingSymbol,
            interval: c.interval,
            timestamp: c.timestamp,
            open: c.open,
            high: c.high,
            low: c.low,
            close: c.close,
            volume: c.volume,
            openInterest: c.openInterest,
            source: c.source as "KITE",
            adjustment: c.adjustment as "UNKNOWN",
            fetchedAt: c.fetchedAt
          }))
        });
      }

      summaries.push({
        instrumentToken: row.instrumentToken,
        exchange: row.exchange,
        tradingSymbol: row.tradingSymbol,
        interval: row.interval,
        count: row.count,
        earliest: row.earliest?.toISOString() ?? null,
        latest: row.latest?.toISOString() ?? null,
        lastFetchedAt: row.lastFetchedAt?.toISOString() ?? null,
        sources: row.sources.length > 0 ? row.sources : ["unknown"],
        missingRanges
      });
    }
    return summaries;
  }

  async validateDataset(input: { tokens: string[]; from: string | Date; to: string | Date; interval?: "1m" | "5m" }) {
    const from = asDate(input.from); const to = asDate(input.to); const interval = input.interval ?? "1m";
    const coverage = await Promise.all([...new Set(input.tokens)].sort().map(async instrumentToken => {
      const candles = await this.getCandles({ instrumentToken, from, to, interval });
      const identity = await this.resolveHistoricalSessionIdentity(instrumentToken, candles[0]?.tradingSymbol);
      return { instrumentToken, identity, candles, sessions: sessionCoverage({ from, to, interval, candles, instrument: identity, sessionPolicy: this.historicalSessionPolicy }) };
    }));
    return datasetManifest({ instruments: coverage.map(x => ({ instrumentToken: x.instrumentToken, tradingSymbol: x.identity.tradingSymbol, identity: x.identity })), from, to, interval, coverage });
  }

  async bulkDownload(input: { tokens: string[]; from: string | Date; to: string | Date; interval?: "1m" | "5m" }) {
    const results: Array<{ instrumentToken: string; status: "COMPLETE" | "FAILED" | "SKIPPED"; result?: unknown; error?: string }> = [];
    for (const instrumentToken of [...new Set(input.tokens)].sort()) {
      try {
        const before = await this.getCandles({ instrumentToken, from: input.from, to: input.to, interval: input.interval ?? "1m" });
        const identity = await this.resolveHistoricalSessionIdentity(instrumentToken, before[0]?.tradingSymbol);
        const sessions = sessionCoverage({ from: asDate(input.from), to: asDate(input.to), interval: input.interval ?? "1m", candles: before, instrument: identity, sessionPolicy: this.historicalSessionPolicy });
        if (sessions.length > 0 && sessions.every(s => s.classification === "COMPLETE")) { results.push({ instrumentToken, status: "SKIPPED" }); continue; }
        results.push({ instrumentToken, status: "COMPLETE", result: await this.download({ instrumentToken, from: input.from, to: input.to, interval: input.interval ?? "1m" }) });
      } catch (error) { results.push({ instrumentToken, status: "FAILED", error: error instanceof Error ? error.message : String(error) }); }
    }
    return { results, manifest: await this.validateDataset(input) };
  }

  private async resolveRequest(input: {
    instrumentToken: string;
    tradingSymbol?: string;
    exchange?: string;
    interval?: "1m" | "5m";
    from: string | Date;
    to: string | Date;
    instrumentId?: string | null;
  }): Promise<HistoricalRangeRequest> {
    const from = asDate(input.from);
    const to = asDate(input.to);
    if (!(from < to)) {
      throw new HistoricalMarketDataError(
        "HISTORICAL_INVALID_REQUEST",
        "Range must satisfy from < to ([from, to) half-open)."
      );
    }

    const instrument = await this.resolveRepos().instruments.findByInstrumentToken(input.instrumentToken);
    return {
      instrumentToken: input.instrumentToken,
      instrumentId: input.instrumentId ?? instrument?.id ?? null,
      exchange: input.exchange ?? instrument?.exchange ?? "NSE",
      tradingSymbol: input.tradingSymbol ?? instrument?.symbol ?? input.instrumentToken,
      interval: input.interval ?? this.config.defaultInterval,
      from,
      to
    };
  }
}

function asDate(value: string | Date) {
  const date = value instanceof Date ? value : new Date(value);
  if (Number.isNaN(date.getTime())) {
    throw new HistoricalMarketDataError("HISTORICAL_INVALID_REQUEST", `Invalid date: ${String(value)}`);
  }
  return date;
}

export function defaultHistoricalProvider(): HistoricalMarketDataProvider {
  const config = getHistoricalMarketDataConfig();
  if (config.provider === "mock" || !isDatabasePersistenceEnabled()) {
    return new MockHistoricalMarketDataProvider();
  }
  return new KiteHistoricalMarketDataProvider(kiteBrokerAdapter);
}

let singleton: HistoricalMarketDataService | null = null;

export function getHistoricalMarketDataService() {
  if (!singleton) {
    singleton = new HistoricalMarketDataService();
  }
  return singleton;
}

export function resetHistoricalMarketDataServiceForTests() {
  singleton = null;
}
