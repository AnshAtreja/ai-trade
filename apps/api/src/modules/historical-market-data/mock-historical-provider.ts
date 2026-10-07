import { candleIntervalMs } from "../../common/utils/candle-buckets";
import { getMarketSessionState, isScannerTradingSession } from "../../common/utils/market-session";
import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import { HistoricalMarketDataError } from "./errors";
import type { HistoricalMarketDataProvider } from "./provider";
import {
  toNormalizedFromRecord,
  type HistoricalFetchResult,
  type HistoricalRangeRequest,
  type NormalizedHistoricalCandle,
  type ValidationReport
} from "./types";
import { validateHistoricalCandles } from "./validation";

/**
 * Deterministic fixture provider for tests and mock mode.
 * Generates 1m OHLCV only inside scanner trading sessions.
 */
export class MockHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly source = "MOCK" as const;

  constructor(
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly basePrice = 1000
  ) {}

  async fetchCandles(request: HistoricalRangeRequest): Promise<HistoricalFetchResult> {
    return this.fetchRange(request);
  }

  async fetchRange(request: HistoricalRangeRequest): Promise<HistoricalFetchResult> {
    if (!(request.from < request.to)) {
      throw new HistoricalMarketDataError(
        "HISTORICAL_INVALID_REQUEST",
        "Historical range requires from < to with half-open [from, to) semantics."
      );
    }

    const step = candleIntervalMs(request.interval === "5m" ? "5m" : "1m");
    const candles: NormalizedHistoricalCandle[] = [];
    const fetchedAt = new Date();
    let index = 0;

    for (let cursor = request.from.getTime(); cursor < request.to.getTime(); cursor += step) {
      const at = new Date(cursor);
      if (!isScannerTradingSession(getMarketSessionState(at))) {
        continue;
      }
      const open = this.basePrice + (index % 50) * 0.5;
      const close = open + ((index % 2 === 0 ? 1 : -1) * 0.25);
      candles.push({
        instrumentId: request.instrumentId ?? null,
        instrumentToken: request.instrumentToken,
        exchange: request.exchange ?? "NSE",
        tradingSymbol: request.tradingSymbol ?? "MOCK",
        interval: request.interval,
        timestamp: at,
        open,
        high: Math.max(open, close) + 0.5,
        low: Math.min(open, close) - 0.5,
        close,
        volume: 1000 + index,
        openInterest: null,
        source: "MOCK",
        adjustment: "UNADJUSTED",
        fetchedAt
      });
      index += 1;
    }

    return {
      candles,
      source: "MOCK",
      requested: {
        from: request.from.toISOString(),
        to: request.to.toISOString(),
        interval: request.interval
      }
    };
  }

  async getStoredCandles(request: HistoricalRangeRequest): Promise<NormalizedHistoricalCandle[]> {
    const rows = await this.resolveRepos().historicalCandles.listRange({
      instrumentToken: request.instrumentToken,
      interval: request.interval,
      from: request.from,
      to: request.to
    });
    return rows.map(toNormalizedFromRecord);
  }

  async validateRange(
    request: HistoricalRangeRequest,
    candles?: NormalizedHistoricalCandle[]
  ): Promise<ValidationReport> {
    const series = candles ?? (await this.getStoredCandles(request));
    return validateHistoricalCandles({
      instrumentToken: request.instrumentToken,
      interval: request.interval,
      from: request.from,
      to: request.to,
      candles: series
    });
  }
}
