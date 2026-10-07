import type { HistoricalFetchResult, HistoricalRangeRequest, NormalizedHistoricalCandle, ValidationReport } from "./types";

/**
 * Abstraction consumed by future backtests. Callers must not depend on Kite directly.
 *
 * Range semantics for stored queries: half-open [from, to).
 */
export interface HistoricalMarketDataProvider {
  readonly source: "KITE" | "MOCK";

  /** Fetch candles from the remote/source provider for [from, to). */
  fetchCandles(request: HistoricalRangeRequest): Promise<HistoricalFetchResult>;

  /** Alias for fetchCandles — explicit range fetch. */
  fetchRange(request: HistoricalRangeRequest): Promise<HistoricalFetchResult>;

  /** Read persisted candles only (no remote call). */
  getStoredCandles(request: HistoricalRangeRequest): Promise<NormalizedHistoricalCandle[]>;

  /** Validate a candle series (does not fabricate fills). */
  validateRange(
    request: HistoricalRangeRequest,
    candles?: NormalizedHistoricalCandle[]
  ): Promise<ValidationReport>;
}
