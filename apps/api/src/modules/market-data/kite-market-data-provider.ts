import { env } from "../../config/env";
import type { InstrumentRecord } from "../../db/domain";
import { kiteBrokerAdapter, type KiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import type { BrokerLtpQuote, BrokerMarketQuote } from "../broker/types";
import { MarketDataError, wrapBrokerError } from "./errors";
import { chunkItems, kiteInstrumentKey, type MarketDataProvider, type NormalizedLtp, type NormalizedQuote } from "./quote-types";

export class KiteMarketDataProvider implements MarketDataProvider {
  readonly source = "KITE" as const;

  constructor(
    private readonly adapter: Pick<KiteBrokerAdapter, "isConfigured" | "isAuthenticated" | "getLTP" | "getQuotes"> = kiteBrokerAdapter,
    private readonly batchSize = env.KITE_QUOTE_BATCH_SIZE
  ) {}

  async getLtp(instruments: InstrumentRecord[]): Promise<NormalizedLtp[]> {
    this.assertReady();
    const quotes = await this.batched(instruments, (keys) => this.adapter.getLTP(keys));
    return instruments.map((instrument) => this.normalizeLtp(instrument, this.lookup(instrument, quotes)));
  }

  async getQuotes(instruments: InstrumentRecord[]): Promise<NormalizedQuote[]> {
    this.assertReady();
    const quotes = await this.batched(instruments, (keys) => this.adapter.getQuotes(keys));
    return instruments.map((instrument) => this.normalizeQuote(instrument, this.lookup(instrument, quotes)));
  }

  private assertReady() {
    if (!this.adapter.isConfigured() || !this.adapter.isAuthenticated()) {
      throw new MarketDataError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
    }
  }

  private async batched<T>(
    instruments: InstrumentRecord[],
    fetchBatch: (keys: string[]) => Promise<Record<string, T>>
  ) {
    if (instruments.length === 0) {
      return {} as Record<string, T>;
    }

    const merged: Record<string, T> = {};

    try {
      for (const group of chunkItems(instruments, this.batchSize)) {
        const keys = group.map(kiteInstrumentKey);
        Object.assign(merged, await fetchBatch(keys));
      }
    } catch (error) {
      wrapBrokerError(error, "MARKET_DATA_FETCH_FAILED");
    }

    return merged;
  }

  private lookup<T>(instrument: InstrumentRecord, quotes: Record<string, T>) {
    return quotes[kiteInstrumentKey(instrument)] ?? quotes[instrument.symbol];
  }

  private normalizeLtp(instrument: InstrumentRecord, quote?: BrokerLtpQuote): NormalizedLtp {
    if (!quote || !Number.isFinite(quote.lastPrice)) {
      throw new MarketDataError("KITE_MALFORMED_RESPONSE", `Kite LTP was missing or invalid for ${kiteInstrumentKey(instrument)}.`);
    }

    return {
      instrumentToken: instrument.instrumentToken ?? "",
      exchange: instrument.exchange,
      tradingSymbol: instrument.symbol,
      lastPrice: quote.lastPrice,
      timestamp: quote.updatedAt
    };
  }

  private normalizeQuote(instrument: InstrumentRecord, quote?: BrokerMarketQuote): NormalizedQuote {
    if (!quote || !Number.isFinite(quote.lastPrice)) {
      throw new MarketDataError("KITE_MALFORMED_RESPONSE", `Kite quote was missing or invalid for ${kiteInstrumentKey(instrument)}.`);
    }

    return {
      instrumentToken: String(quote.instrumentToken ?? instrument.instrumentToken ?? ""),
      exchange: instrument.exchange,
      tradingSymbol: instrument.symbol,
      lastPrice: quote.lastPrice,
      timestamp: quote.updatedAt,
      open: quote.open,
      high: quote.high,
      low: quote.low,
      close: quote.close,
      volume: quote.volume,
      averagePrice: quote.averagePrice ?? null,
      buyQuantity: quote.buyQuantity ?? null,
      sellQuantity: quote.sellQuantity ?? null
    };
  }
}

export const kiteMarketDataProvider = new KiteMarketDataProvider();
