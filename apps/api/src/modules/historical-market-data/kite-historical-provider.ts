import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import { HistoricalMarketDataError } from "./errors";
import type { HistoricalMarketDataProvider } from "./provider";
import {
  formatKiteHistoricalTimestamp,
  kiteIntervalFor,
  parseCandleTimestamp,
  toNormalizedFromRecord,
  type HistoricalFetchResult,
  type HistoricalRangeRequest,
  type NormalizedHistoricalCandle,
  type ValidationReport
} from "./types";
import { validateHistoricalCandles } from "./validation";
import { KiteAccountError } from "../broker/account/errors";
import type { KiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";

type KiteHistoricalAdapter = Pick<KiteBrokerAdapter, "getHistoricalCandlesByToken" | "getStatus">;

export class KiteHistoricalMarketDataProvider implements HistoricalMarketDataProvider {
  readonly source = "KITE" as const;

  constructor(
    private readonly adapter: KiteHistoricalAdapter,
    private readonly resolveRepos: () => AppRepositories = getRepositories
  ) {}

  async fetchCandles(request: HistoricalRangeRequest): Promise<HistoricalFetchResult> {
    return this.fetchRange(request);
  }

  async fetchRange(request: HistoricalRangeRequest): Promise<HistoricalFetchResult> {
    assertHalfOpen(request);
    try {
      const connection = await this.adapter.getStatus();
      if (!connection.verified) {
        throw new KiteAccountError(
          connection.reasonCode === "KITE_AUTH_EXPIRED" ? "KITE_AUTH_EXPIRED" : "KITE_NOT_AUTHENTICATED",
          connection.reason
        );
      }

      const raw = await this.adapter.getHistoricalCandlesByToken(
        request.instrumentToken,
        kiteIntervalFor(request.interval),
        formatKiteHistoricalTimestamp(request.from),
        // Kite `to` is inclusive wall-time; request our half-open end as last includable second.
        formatKiteHistoricalTimestamp(new Date(request.to.getTime() - 1000))
      );

      const fetchedAt = new Date();
      const candles: NormalizedHistoricalCandle[] = [];
      for (const row of raw) {
        const timestamp = parseCandleTimestamp(row.timestamp);
        if (timestamp.getTime() < request.from.getTime() || timestamp.getTime() >= request.to.getTime()) {
          continue;
        }
        candles.push({
          instrumentId: request.instrumentId ?? null,
          instrumentToken: request.instrumentToken,
          exchange: request.exchange ?? "NSE",
          tradingSymbol: request.tradingSymbol ?? request.instrumentToken,
          interval: request.interval,
          timestamp,
          open: row.open,
          high: row.high,
          low: row.low,
          close: row.close,
          volume: row.volume,
          openInterest: row.openInterest ?? null,
          source: "KITE",
          adjustment: "UNKNOWN",
          fetchedAt
        });
      }

      return {
        candles,
        source: "KITE",
        requested: {
          from: request.from.toISOString(),
          to: request.to.toISOString(),
          interval: request.interval
        }
      };
    } catch (error) {
      throw mapProviderError(error);
    }
  }

  async getStoredCandles(request: HistoricalRangeRequest): Promise<NormalizedHistoricalCandle[]> {
    assertHalfOpen(request);
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

function assertHalfOpen(request: HistoricalRangeRequest) {
  if (!(request.from < request.to)) {
    throw new HistoricalMarketDataError(
      "HISTORICAL_INVALID_REQUEST",
      "Historical range requires from < to with half-open [from, to) semantics."
    );
  }
}

function mapProviderError(error: unknown): HistoricalMarketDataError {
  if (error instanceof HistoricalMarketDataError) return error;
  if (error instanceof KiteAccountError) {
    if (error.code === "KITE_RATE_LIMITED") {
      return new HistoricalMarketDataError("HISTORICAL_RATE_LIMITED", error.message);
    }
    if (error.code === "KITE_NOT_AUTHENTICATED" || error.code === "KITE_AUTH_EXPIRED") {
      return new HistoricalMarketDataError("HISTORICAL_AUTH", error.message);
    }
    if (error.code === "KITE_MALFORMED_RESPONSE") {
      return new HistoricalMarketDataError("HISTORICAL_MALFORMED", error.message);
    }
    return new HistoricalMarketDataError("HISTORICAL_PROVIDER_ERROR", error.message);
  }
  return new HistoricalMarketDataError(
    "HISTORICAL_PROVIDER_ERROR",
    error instanceof Error ? error.message : "Historical provider failed."
  );
}
