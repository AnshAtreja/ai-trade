import type { InstrumentRecord } from "../../db/domain";
import type { AppRepositories } from "../../db/repositories/contracts";
import { getRepositories } from "../../db/persistence";
import { MarketDataError } from "./errors";
import { toInstrumentDto } from "./instrument-types";
import { isTradableCashEquity, isTradableNseEquity } from "./universe";

export class InstrumentUniverseService {
  constructor(private readonly resolveRepos: () => AppRepositories = getRepositories) {}

  private repos() {
    return this.resolveRepos();
  }

  async listInstruments(params?: {
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
    return (await this.repos().instruments.list(params)).map(toInstrumentDto);
  }

  async getTradableEquities(exchanges: string[] = ["NSE"]) {
    if (exchanges.length === 0) {
      throw new MarketDataError("INVALID_MARKET_UNIVERSE", "At least one exchange is required.");
    }

    const normalizedExchanges = exchanges.map((exchange) => exchange.toUpperCase());

    const listed = await this.repos().instruments.list({
      isActive: true,
      hasExpiry: false,
      instrumentType: "EQ",
      exchange: normalizedExchanges.length === 1 ? normalizedExchanges[0] : undefined,
      segment: normalizedExchanges.length === 1 && normalizedExchanges[0] === "NSE" ? "NSE" : undefined,
      excludeEtfs: true,
      limit: 5000
    });

    const filtered = listed.filter((item) =>
      normalizedExchanges.length === 1 && normalizedExchanges[0] === "NSE"
        ? isTradableNseEquity(item)
        : isTradableCashEquity(item, normalizedExchanges)
    );

    return filtered.map(toInstrumentDto);
  }

  async listTradableEquities(input: { exchange?: string; search?: string; page?: number; pageSize?: number } = {}) {
    const exchange = (input.exchange ?? "NSE").toUpperCase();
    const pageSize = Math.min(Math.max(input.pageSize ?? 30, 1), 100);
    const page = Math.max(input.page ?? 1, 1);
    const rows = await this.repos().instruments.list({
      exchange,
      segment: exchange === "NSE" ? "NSE" : undefined,
      instrumentType: "EQ",
      isActive: true,
      hasExpiry: false,
      excludeEtfs: true,
      search: input.search?.trim() || undefined,
      offset: (page - 1) * pageSize,
      limit: pageSize + 1
    });

    return {
      equities: rows.slice(0, pageSize).map(toInstrumentDto),
      page,
      pageSize,
      hasNext: rows.length > pageSize
    };
  }

  async findByTradingSymbol(tradingSymbol: string, exchange?: string) {
    if (exchange) {
      return this.repos().instruments.findByExchangeSymbol(exchange, tradingSymbol);
    }

    const matches = await this.repos().instruments.list({ symbol: tradingSymbol, isActive: true, limit: 20 });
    return matches.find((item) => item.exchange === "NSE") ?? matches[0] ?? null;
  }

  async findByInstrumentToken(instrumentToken: string) {
    return this.repos().instruments.findByInstrumentToken(instrumentToken);
  }

  async findByExchangeAndTradingSymbol(exchange: string, tradingSymbol: string) {
    return this.repos().instruments.findByExchangeSymbol(exchange, tradingSymbol);
  }

  async requireInstrument(input: {
    tradingSymbol?: string;
    exchange?: string;
    instrumentToken?: string;
  }): Promise<InstrumentRecord> {
    const instrument = input.instrumentToken
      ? await this.findByInstrumentToken(input.instrumentToken)
      : input.tradingSymbol
        ? await this.findByTradingSymbol(input.tradingSymbol, input.exchange)
        : null;

    if (!instrument) {
      throw new MarketDataError("INSTRUMENT_NOT_FOUND", "Instrument was not found in the synchronized master.");
    }

    return instrument;
  }
}

export const instrumentUniverseService = new InstrumentUniverseService();
