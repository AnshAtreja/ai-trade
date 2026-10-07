import { isDatabasePersistenceEnabled } from "../../config/env";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import { MarketDataError } from "./errors";
import { toInstrumentDto, type InstrumentProvider } from "./instrument-types";
import { kiteMarketDataProvider } from "./kite-market-data-provider";
import { mockMarketDataProvider } from "./mock-market-data-provider";
import type { MarketDataProvider, NormalizedLtp, NormalizedQuote } from "./quote-types";
import { InstrumentSyncService, defaultInstrumentProvider } from "./sync-service";
import { InstrumentUniverseService } from "./universe-service";

type SnapshotObservation = NormalizedLtp & {
  open: number | null;
  high: number | null;
  low: number | null;
  close: number | null;
  volume: number | null;
  averagePrice: number | null;
  buyQuantity: number | null;
  sellQuantity: number | null;
};

export class MarketInstrumentService {
  constructor(
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly universe = new InstrumentUniverseService(resolveRepos),
    private readonly syncService = new InstrumentSyncService(resolveRepos, defaultInstrumentProvider()),
    private readonly quotes: MarketDataProvider = defaultMarketDataProvider()
  ) {}

  private repos() {
    return this.resolveRepos();
  }

  listInstruments(params?: {
    search?: string;
    exchange?: string;
    symbol?: string;
    isActive?: boolean;
    instrumentType?: string;
    segment?: string;
    hasExpiry?: boolean;
    excludeEtfs?: boolean;
    offset?: number;
    limit?: number;
  }) {
    return this.universe.listInstruments(params);
  }

  async getByTradingSymbol(tradingSymbol: string, exchange?: string) {
    const instrument = await this.universe.findByTradingSymbol(tradingSymbol, exchange);
    if (!instrument) {
      throw new MarketDataError("INSTRUMENT_NOT_FOUND", `Instrument ${tradingSymbol} was not found.`);
    }
    return toInstrumentDto(instrument);
  }

  async getByInstrumentToken(instrumentToken: string) {
    const instrument = await this.universe.findByInstrumentToken(instrumentToken);
    if (!instrument) {
      throw new MarketDataError("INSTRUMENT_NOT_FOUND", `Instrument token ${instrumentToken} was not found.`);
    }
    return toInstrumentDto(instrument);
  }

  getTradableEquities(exchanges?: string[]) {
    return this.universe.getTradableEquities(exchanges);
  }

  listTradableEquities(input?: { exchange?: string; search?: string; page?: number; pageSize?: number }) {
    return this.universe.listTradableEquities(input);
  }

  syncInstruments() {
    return this.syncService.sync();
  }

  async getLtp(input: { instrumentTokens?: string[]; tradingSymbols?: string[]; exchange?: string; persist?: boolean }) {
    const instruments = await this.resolveRequested(input);
    const quotes = await this.quotes.getLtp(instruments);
    const persisted = input.persist
      ? await this.persistObservations(
          quotes.map((item) => ({
            ...item,
            open: null,
            high: null,
            low: null,
            close: null,
            volume: null,
            averagePrice: null,
            buyQuantity: null,
            sellQuantity: null
          }))
        )
      : [];
    return { source: this.quotes.source, quotes, persisted: persisted.length };
  }

  async getQuotes(input: { instrumentTokens?: string[]; tradingSymbols?: string[]; exchange?: string; persist?: boolean }) {
    const instruments = await this.resolveRequested(input);
    const quotes = await this.quotes.getQuotes(instruments);
    const persisted = input.persist === false ? [] : await this.persistObservations(quotes);
    return { source: this.quotes.source, quotes, persisted: persisted.length };
  }

  listSnapshots(params?: { symbol?: string; instrumentId?: string; limit?: number }) {
    return this.repos().marketSnapshots.list(params);
  }

  private async resolveRequested(input: {
    instrumentTokens?: string[];
    tradingSymbols?: string[];
    exchange?: string;
  }) {
    const tokens = input.instrumentTokens ?? [];
    const symbols = input.tradingSymbols ?? [];

    if (tokens.length === 0 && symbols.length === 0) {
      throw new MarketDataError("INVALID_MARKET_UNIVERSE", "Provide instrumentTokens or tradingSymbols.");
    }

    const resolved = [];

    for (const token of tokens) {
      resolved.push(await this.universe.requireInstrument({ instrumentToken: token }));
    }

    for (const symbol of symbols) {
      resolved.push(await this.universe.requireInstrument({ tradingSymbol: symbol, exchange: input.exchange }));
    }

    const unique = new Map(resolved.map((item) => [`${item.exchange}:${item.instrumentToken ?? item.symbol}`, item]));
    return [...unique.values()];
  }

  private async persistObservations(quotes: Array<NormalizedQuote | SnapshotObservation>) {
    const user = await this.repos().users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
    const snapshots = [];

    for (const quote of quotes) {
      const instrument = await this.universe.findByInstrumentToken(quote.instrumentToken);
      snapshots.push(
        await this.repos().marketSnapshots.create({
          instrumentId: instrument?.id ?? null,
          instrumentToken: quote.instrumentToken,
          symbol: quote.tradingSymbol,
          exchange: quote.exchange,
          source: this.quotes.source,
          lastPrice: quote.lastPrice,
          openPrice: quote.open ?? null,
          highPrice: quote.high ?? null,
          lowPrice: quote.low ?? null,
          closePrice: quote.close ?? null,
          volume: quote.volume ?? null,
          averagePrice: quote.averagePrice ?? null,
          buyQuantity: quote.buyQuantity ?? null,
          sellQuantity: quote.sellQuantity ?? null,
          capturedAt: new Date(quote.timestamp)
        })
      );
    }

    await this.repos().systemLogs.create({
      userId: user.id,
      level: "INFO",
      source: "market-data",
      message: "Persisted immutable market snapshots.",
      metadata: { event: "MARKET_SNAPSHOTS_WRITTEN", count: snapshots.length }
    });

    return snapshots;
  }
}

export function defaultMarketDataProvider(): MarketDataProvider {
  return isDatabasePersistenceEnabled() ? kiteMarketDataProvider : mockMarketDataProvider;
}

export function createMarketInstrumentService(options?: {
  repos?: () => AppRepositories;
  instrumentProvider?: InstrumentProvider;
  quotes?: MarketDataProvider;
}) {
  const resolveRepos = options?.repos ?? getRepositories;
  return new MarketInstrumentService(
    resolveRepos,
    new InstrumentUniverseService(resolveRepos),
    new InstrumentSyncService(resolveRepos, options?.instrumentProvider ?? defaultInstrumentProvider()),
    options?.quotes ?? defaultMarketDataProvider()
  );
}

export const marketInstrumentService = createMarketInstrumentService();
