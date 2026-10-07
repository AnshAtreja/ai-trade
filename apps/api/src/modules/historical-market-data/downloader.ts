import { getRepositories } from "../../db/persistence";
import type { AppRepositories } from "../../db/repositories/contracts";
import type { HistoricalCandleWrite } from "../../db/repositories/contracts";
import { getHistoricalMarketDataConfig, type HistoricalMarketDataConfig } from "./config";
import { buildHistoricalChunks } from "./chunking";
import { HistoricalMarketDataError } from "./errors";
import type { HistoricalMarketDataProvider } from "./provider";
import { aggregateOneMinuteToFiveMinute } from "./aggregation";
import type { HistoricalRangeRequest, NormalizedHistoricalCandle } from "./types";
import { validateHistoricalCandles } from "./validation";

export interface DownloadProgress {
  phase: "start" | "chunk_requested" | "chunk_persisted" | "retry" | "rate_limited" | "complete" | "error";
  instrumentToken: string;
  interval: string;
  requestedFrom: string;
  requestedTo: string;
  chunkFrom?: string;
  chunkTo?: string;
  candleCount?: number;
  inserted?: number;
  skipped?: number;
  attempt?: number;
  durationMs?: number;
  errorCode?: string;
  message?: string;
}

export interface DownloadResult {
  instrumentToken: string;
  interval: string;
  requestedFrom: string;
  requestedTo: string;
  chunks: number;
  fetched: number;
  inserted: number;
  skipped: number;
  updated: number;
  derived5mInserted: number;
  durationMs: number;
  validation: ReturnType<typeof validateHistoricalCandles> | null;
}

type LogFn = (level: "INFO" | "WARN" | "ERROR", event: string, message: string, meta?: Record<string, unknown>) => void;

/**
 * Chunked, throttled, idempotent historical downloader.
 * Does not place or route live orders.
 */
export class HistoricalCandleDownloader {
  private busy = false;

  constructor(
    private readonly provider: HistoricalMarketDataProvider,
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly config: HistoricalMarketDataConfig = getHistoricalMarketDataConfig(),
    private readonly log: LogFn = defaultLog,
    private readonly sleepFn: (ms: number) => Promise<void> = sleep
  ) {}

  async download(request: HistoricalRangeRequest, options?: { reconcile?: boolean; force?: boolean }): Promise<DownloadResult> {
    if (this.busy) {
      throw new HistoricalMarketDataError("HISTORICAL_BUSY", "A historical download is already in progress.");
    }
    this.busy = true;
    const started = Date.now();
    let fetched = 0;
    let inserted = 0;
    let skipped = 0;
    let updated = 0;
    let derived5mInserted = 0;
    const allCandles: NormalizedHistoricalCandle[] = [];

    try {
      this.log("INFO", "download_start", "Historical download started.", {
        instrumentToken: request.instrumentToken,
        interval: request.interval,
        from: request.from.toISOString(),
        to: request.to.toISOString()
      });

      const windowDays = request.interval === "1m" ? this.config.chunkWindowDays1m : this.config.chunkWindowDays1m * 5;
      const chunks = buildHistoricalChunks({
        from: request.from,
        to: request.to,
        interval: request.interval,
        windowDays,
        overlapMinutes: this.config.chunkOverlapMinutes
      });

      for (const chunk of chunks) {
        this.log("INFO", "chunk_requested", "Requesting historical chunk.", {
          instrumentToken: request.instrumentToken,
          interval: request.interval,
          from: chunk.from.toISOString(),
          to: chunk.to.toISOString()
        });

        const result = await this.fetchWithRetry({
          ...request,
          from: chunk.from,
          to: chunk.to
        });

        fetched += result.candles.length;
        allCandles.push(...result.candles);

        if (this.config.persistenceEnabled) {
          const persist = await this.persist(result.candles, options?.reconcile === true);
          inserted += persist.inserted;
          skipped += persist.skipped;
          updated += persist.updated;
          this.log("INFO", "chunk_persisted", "Persisted historical chunk.", {
            instrumentToken: request.instrumentToken,
            interval: request.interval,
            candleCount: result.candles.length,
            inserted: persist.inserted,
            skipped: persist.skipped,
            updated: persist.updated
          });
        }

        await this.sleepFn(this.config.throttleMinIntervalMs);
      }

      if (request.interval === "1m" && this.config.persistDerived5m && this.config.persistenceEnabled) {
        const derived = aggregateOneMinuteToFiveMinute(dedupeCandles(allCandles), { includeIncomplete: false });
        const persist5m = await this.persist(derived, options?.reconcile === true);
        derived5mInserted = persist5m.inserted;
      }

      const validation =
        this.config.validateOnPersist
          ? validateHistoricalCandles({
              instrumentToken: request.instrumentToken,
              interval: request.interval,
              from: request.from,
              to: request.to,
              candles: dedupeCandles(allCandles)
            })
          : null;

      if (validation && !validation.valid) {
        this.log("WARN", "validation_failures", "Historical validation reported issues.", {
          instrumentToken: request.instrumentToken,
          issueCount: validation.issues.length
        });
      }

      const durationMs = Date.now() - started;
      this.log("INFO", "download_complete", "Historical download completed.", {
        instrumentToken: request.instrumentToken,
        interval: request.interval,
        fetched,
        inserted,
        skipped,
        durationMs
      });

      return {
        instrumentToken: request.instrumentToken,
        interval: request.interval,
        requestedFrom: request.from.toISOString(),
        requestedTo: request.to.toISOString(),
        chunks: chunks.length,
        fetched,
        inserted,
        skipped,
        updated,
        derived5mInserted,
        durationMs,
        validation
      };
    } catch (error) {
      this.log("ERROR", "download_error", error instanceof Error ? error.message : "Download failed.", {
        instrumentToken: request.instrumentToken,
        errorCode: error instanceof HistoricalMarketDataError ? error.code : "UNKNOWN"
      });
      throw error;
    } finally {
      this.busy = false;
    }
  }

  private async persist(candles: NormalizedHistoricalCandle[], reconcile: boolean) {
    const writes: HistoricalCandleWrite[] = candles.map((c) => ({
      instrumentId: c.instrumentId,
      instrumentToken: c.instrumentToken,
      exchange: c.exchange,
      tradingSymbol: c.tradingSymbol,
      interval: c.interval,
      timestamp: c.timestamp,
      open: c.open,
      high: c.high,
      low: c.low,
      close: c.close,
      volume: c.volume,
      openInterest: c.openInterest,
      source: c.source,
      adjustment: c.adjustment,
      fetchedAt: c.fetchedAt
    }));
    return this.resolveRepos().historicalCandles.insertMany(writes, { reconcile });
  }

  private async fetchWithRetry(request: HistoricalRangeRequest) {
    let attempt = 0;
    let lastError: unknown;
    while (attempt <= this.config.maxRetries) {
      try {
        return await this.provider.fetchRange(request);
      } catch (error) {
        lastError = error;
        const code = error instanceof HistoricalMarketDataError ? error.code : null;
        if (code === "HISTORICAL_AUTH" || code === "HISTORICAL_MALFORMED" || code === "HISTORICAL_INVALID_REQUEST") {
          throw error;
        }
        attempt += 1;
        if (attempt > this.config.maxRetries) break;
        const delay =
          code === "HISTORICAL_RATE_LIMITED"
            ? this.config.retryBackoffMs * attempt * 2
            : this.config.retryBackoffMs * attempt;
        this.log("WARN", code === "HISTORICAL_RATE_LIMITED" ? "rate_limited" : "retry", "Retrying historical fetch.", {
          instrumentToken: request.instrumentToken,
          attempt,
          delayMs: delay,
          errorCode: code ?? "UNKNOWN"
        });
        await this.sleepFn(delay);
      }
    }
    throw lastError instanceof Error
      ? lastError
      : new HistoricalMarketDataError("HISTORICAL_PROVIDER_ERROR", "Historical fetch failed after retries.");
  }
}

function dedupeCandles(candles: NormalizedHistoricalCandle[]) {
  const map = new Map<string, NormalizedHistoricalCandle>();
  for (const candle of candles) {
    map.set(`${candle.instrumentToken}|${candle.interval}|${candle.timestamp.toISOString()}`, candle);
  }
  return [...map.values()].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
}

function defaultLog(level: "INFO" | "WARN" | "ERROR", event: string, message: string, meta?: Record<string, unknown>) {
  const line = JSON.stringify({ level, source: "historical-market-data", event, message, ...meta });
  if (level === "ERROR") console.error(line);
  else if (level === "WARN") console.warn(line);
  else console.info(line);
}

function sleep(ms: number) {
  return new Promise<void>((resolve) => setTimeout(resolve, ms));
}
