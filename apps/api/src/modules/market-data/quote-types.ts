import type { InstrumentRecord } from "../../db/domain";

export interface NormalizedLtp {
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  lastPrice: number;
  timestamp: string;
}

export interface NormalizedQuote extends NormalizedLtp {
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  averagePrice: number | null;
  buyQuantity: number | null;
  sellQuantity: number | null;
}

export interface MarketDataProvider {
  readonly source: "KITE" | "MOCK";
  getLtp(instruments: InstrumentRecord[]): Promise<NormalizedLtp[]>;
  getQuotes(instruments: InstrumentRecord[]): Promise<NormalizedQuote[]>;
}

export function kiteInstrumentKey(instrument: Pick<InstrumentRecord, "exchange" | "symbol">) {
  return `${instrument.exchange}:${instrument.symbol}`;
}

export function chunkItems<T>(items: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < items.length; index += size) {
    chunks.push(items.slice(index, index + size));
  }
  return chunks;
}
