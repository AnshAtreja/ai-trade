import type {
  HistoricalCandleAdjustment,
  HistoricalCandleIntervalCode,
  HistoricalCandleRecord,
  HistoricalCandleSource
} from "../../db/domain";

/**
 * Normalized historical candle used across providers, validation, aggregation, and persistence.
 * `timestamp` is the candle open/start instant (UTC).
 */
export interface NormalizedHistoricalCandle {
  instrumentId: string | null;
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  interval: HistoricalCandleIntervalCode;
  timestamp: Date;
  open: number;
  high: number;
  low: number;
  close: number;
  volume: number;
  openInterest: number | null;
  source: HistoricalCandleSource;
  adjustment: HistoricalCandleAdjustment;
  fetchedAt: Date;
}

export type ValidationIssueKind =
  | "INVALID_OHLC"
  | "NON_POSITIVE_PRICE"
  | "NEGATIVE_VOLUME"
  | "DUPLICATE_TIMESTAMP"
  | "OUT_OF_ORDER"
  | "INTERVAL_MISALIGNED"
  | "MISSING_CANDLE"
  | "EXPECTED_SESSION_GAP"
  | "INVALID_SOURCE_RECORD";

export interface ValidationIssue {
  kind: ValidationIssueKind;
  timestamp?: string;
  detail: string;
}

export interface ValidationReport {
  instrumentToken: string;
  interval: HistoricalCandleIntervalCode;
  from: string;
  to: string;
  candleCount: number;
  valid: boolean;
  issues: ValidationIssue[];
}

/**
 * Range query semantics: half-open [from, to).
 * `to` is exclusive so "candles available up to T" never includes timestamp === T or later.
 */
export interface HistoricalRangeRequest {
  instrumentToken: string;
  exchange?: string;
  tradingSymbol?: string;
  instrumentId?: string | null;
  interval: HistoricalCandleIntervalCode;
  /** Inclusive. */
  from: Date;
  /** Exclusive. */
  to: Date;
}

export interface HistoricalFetchResult {
  candles: NormalizedHistoricalCandle[];
  source: HistoricalCandleSource;
  requested: { from: string; to: string; interval: HistoricalCandleIntervalCode };
}

export interface CoverageSummary {
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  interval: HistoricalCandleIntervalCode;
  count: number;
  earliest: string | null;
  latest: string | null;
  lastFetchedAt: string | null;
  sources: string[];
  missingRanges: Array<{ from: string; to: string; reason: string }>;
}

export function toNormalizedFromRecord(row: HistoricalCandleRecord): NormalizedHistoricalCandle {
  return {
    instrumentId: row.instrumentId,
    instrumentToken: row.instrumentToken,
    exchange: row.exchange,
    tradingSymbol: row.tradingSymbol,
    interval: row.interval,
    timestamp: row.timestamp,
    open: row.open,
    high: row.high,
    low: row.low,
    close: row.close,
    volume: row.volume,
    openInterest: row.openInterest,
    source: row.source as HistoricalCandleSource,
    adjustment: row.adjustment as HistoricalCandleAdjustment,
    fetchedAt: row.fetchedAt
  };
}

export function kiteIntervalFor(interval: HistoricalCandleIntervalCode): "minute" | "5minute" {
  return interval === "1m" ? "minute" : "5minute";
}

/** Format for Kite historical `from`/`to` query params in Asia/Kolkata wall time. */
export function formatKiteHistoricalTimestamp(at: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);
  const get = (type: Intl.DateTimeFormatPartTypes) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")} ${get("hour")}:${get("minute")}:${get("second")}`;
}

export function parseCandleTimestamp(value: string): Date {
  const parsed = new Date(value.includes("T") ? value : value.replace(" ", "T") + "+05:30");
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`Invalid candle timestamp: ${value}`);
  }
  return parsed;
}
