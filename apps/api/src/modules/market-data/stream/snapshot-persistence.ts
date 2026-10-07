import { env } from "../../../config/env";
import type { AppRepositories } from "../../../db/repositories/contracts";
import { getRepositories } from "../../../db/persistence";
import type { LatestMarketStateStore } from "./latest-state-store";
import type { StreamLogger } from "./logger";

export class MarketSnapshotPersistenceService {
  private timer: ReturnType<typeof setInterval> | null = null;

  constructor(
    private readonly store: LatestMarketStateStore,
    private readonly logger: StreamLogger,
    private readonly resolveRepos: () => AppRepositories = getRepositories
  ) {}

  start(intervalMs = env.MARKET_SNAPSHOT_INTERVAL_MS) {
    this.stop();
    if (intervalMs <= 0) {
      return;
    }

    this.timer = setInterval(() => {
      void this.persistLatest().catch((error) => {
        this.logger.error(
          "market_stream_persistence_error",
          error instanceof Error ? error.message : "Snapshot persistence failed.",
          { errorCode: "MARKET_SNAPSHOT_PERSIST_FAILED" }
        );
      });
    }, intervalMs);

    if (typeof this.timer === "object" && "unref" in this.timer) {
      this.timer.unref();
    }
  }

  stop() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  async persistLatest() {
    const ticks = this.store.getAll();
    if (ticks.length === 0) {
      return { persisted: 0 };
    }

    let persisted = 0;
    for (const tick of ticks) {
      await this.resolveRepos().marketSnapshots.create({
        instrumentId: tick.instrumentId,
        instrumentToken: tick.instrumentToken,
        symbol: tick.tradingSymbol ?? tick.instrumentToken,
        exchange: tick.exchange,
        source: tick.source,
        lastPrice: tick.lastPrice,
        openPrice: tick.open,
        highPrice: tick.high,
        lowPrice: tick.low,
        closePrice: tick.close,
        volume: tick.volume,
        averagePrice: tick.averagePrice,
        buyQuantity: tick.buyQuantity,
        sellQuantity: tick.sellQuantity,
        capturedAt: new Date(tick.receivedAt)
      });
      persisted += 1;
    }

    return { persisted };
  }
}
