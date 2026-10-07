import type { InstrumentRecord } from "../../db/domain";

const ETF_NAME = /\bETF\b|BEES/i;
const EQUITY_TYPES = new Set(["EQ"]);
const CASH_SEGMENTS = new Set(["NSE", "NSE-EQ", "BSE", "BSE-EQ"]);

export function isTradableNseEquity(instrument: InstrumentRecord) {
  return isTradableCashEquity(instrument, ["NSE"]);
}

export function isTradableCashEquity(instrument: InstrumentRecord, exchanges: string[] = ["NSE"]) {
  if (!instrument.isActive) {
    return false;
  }

  if (instrument.expiry) {
    return false;
  }

  if (!exchanges.includes(instrument.exchange)) {
    return false;
  }

  const type = (instrument.instrumentType ?? "EQ").toUpperCase();
  const segment = (instrument.segment ?? instrument.exchange).toUpperCase();

  if (!EQUITY_TYPES.has(type)) {
    return false;
  }

  if (!CASH_SEGMENTS.has(segment) && segment !== instrument.exchange) {
    return false;
  }

  if (ETF_NAME.test(instrument.name) || ETF_NAME.test(instrument.symbol)) {
    return false;
  }

  return true;
}
