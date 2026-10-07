import type { InstrumentRecord } from "../../db/domain";
import { MOCK_QUOTE_CAPTURED_AT } from "./mock-instruments";
import type { MarketDataProvider, NormalizedLtp, NormalizedQuote } from "./quote-types";

function mockLastPrice(token: string) {
  const numeric = Number.parseInt(token, 10);
  const seed = Number.isFinite(numeric) ? numeric : token.length * 17;
  return Number((100 + (seed % 900) + 0.25).toFixed(2));
}

function quoteFor(instrument: InstrumentRecord): NormalizedQuote {
  const lastPrice = mockLastPrice(instrument.instrumentToken ?? instrument.symbol);
  return {
    instrumentToken: instrument.instrumentToken ?? "",
    exchange: instrument.exchange,
    tradingSymbol: instrument.symbol,
    lastPrice,
    timestamp: MOCK_QUOTE_CAPTURED_AT,
    open: Number((lastPrice - 1.5).toFixed(2)),
    high: Number((lastPrice + 2).toFixed(2)),
    low: Number((lastPrice - 2).toFixed(2)),
    close: Number((lastPrice - 0.5).toFixed(2)),
    volume: 100000 + Number.parseInt(instrument.instrumentToken ?? "0", 10),
    averagePrice: lastPrice,
    buyQuantity: 5000,
    sellQuantity: 4200
  };
}

export class MockMarketDataProvider implements MarketDataProvider {
  readonly source = "MOCK" as const;

  async getLtp(instruments: InstrumentRecord[]): Promise<NormalizedLtp[]> {
    return instruments.map((instrument) => {
      const quote = quoteFor(instrument);
      return {
        instrumentToken: quote.instrumentToken,
        exchange: quote.exchange,
        tradingSymbol: quote.tradingSymbol,
        lastPrice: quote.lastPrice,
        timestamp: quote.timestamp
      };
    });
  }

  async getQuotes(instruments: InstrumentRecord[]): Promise<NormalizedQuote[]> {
    return instruments.map(quoteFor);
  }
}

export const mockMarketDataProvider = new MockMarketDataProvider();
