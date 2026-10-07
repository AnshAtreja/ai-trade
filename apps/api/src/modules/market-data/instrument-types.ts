import type { InstrumentRecord } from "../../db/domain";
import type { BrokerInstrument } from "../broker/types";

export interface NormalizedInstrument {
  tradingSymbol: string;
  exchange: string;
  name: string;
  instrumentToken: string;
  exchangeToken: string | null;
  segment: string | null;
  instrumentType: string | null;
  expiry: Date | null;
  strike: number | null;
  tickSize: number;
  lotSize: number;
  isActive: boolean;
}

export interface InstrumentMasterFetch {
  instruments: NormalizedInstrument[];
  received: number;
  failed: number;
}

export interface InstrumentProvider {
  readonly source: "KITE" | "MOCK";
  getInstruments(): Promise<InstrumentMasterFetch>;
}

export interface InstrumentSyncResult {
  status: "COMPLETE" | "FAILED";
  source: "KITE" | "MOCK";
  received: number;
  inserted: number;
  updated: number;
  deactivated: number;
  failed: number;
}

export function toInstrumentDto(record: InstrumentRecord) {
  return {
    id: record.id,
    tradingSymbol: record.symbol,
    exchange: record.exchange,
    name: record.name,
    instrumentToken: record.instrumentToken,
    exchangeToken: record.exchangeToken,
    segment: record.segment,
    instrumentType: record.instrumentType,
    expiry: record.expiry?.toISOString() ?? null,
    strike: record.strike,
    tickSize: record.tickSize,
    lotSize: record.lotSize,
    isActive: record.isActive
  };
}

export function fromBrokerInstrument(item: BrokerInstrument): NormalizedInstrument | null {
  const tradingSymbol = item.symbol?.trim();
  const exchange = item.exchange?.trim();
  const instrumentToken = item.instrumentToken?.trim();

  if (!tradingSymbol || !exchange || !instrumentToken) {
    return null;
  }

  const tickSize = Number(item.tickSize);
  const lotSize = Number(item.lotSize);

  if (!Number.isFinite(tickSize) || tickSize <= 0 || !Number.isInteger(lotSize) || lotSize <= 0) {
    return null;
  }

  return {
    tradingSymbol: tradingSymbol.toUpperCase(),
    exchange: exchange.toUpperCase(),
    name: item.name?.trim() || tradingSymbol,
    instrumentToken,
    exchangeToken: item.exchangeToken?.trim() || null,
    segment: item.segment?.trim() || null,
    instrumentType: item.instrumentType?.trim() || null,
    expiry: parseExpiry(item.expiry),
    strike: item.strike != null && Number(item.strike) > 0 ? Number(item.strike) : null,
    tickSize,
    lotSize,
    isActive: true
  };
}

function parseExpiry(value?: string | null) {
  if (!value) {
    return null;
  }

  const match = /^(\d{4}-\d{2}-\d{2})/.exec(value.trim());

  if (!match) {
    return null;
  }

  const parsed = new Date(`${match[1]}T00:00:00+05:30`);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}
