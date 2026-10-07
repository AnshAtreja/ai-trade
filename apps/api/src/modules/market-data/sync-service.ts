import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import type { AppRepositories } from "../../db/repositories/contracts";
import { getRepositories } from "../../db/persistence";
import { isDatabasePersistenceEnabled } from "../../config/env";
import { MarketDataError } from "./errors";
import type { InstrumentProvider, InstrumentSyncResult } from "./instrument-types";
import { mockInstrumentProvider } from "./mock-instrument-provider";
import { kiteInstrumentProvider } from "./kite-instrument-provider";

const SOURCE = "market-instruments";

export class InstrumentSyncService {
  constructor(
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly provider: InstrumentProvider = defaultInstrumentProvider()
  ) {}

  private repos() {
    return this.resolveRepos();
  }

  async sync(): Promise<InstrumentSyncResult> {
    const user = await this.repos().users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
    await this.log(user.id, "INFO", "INSTRUMENT_SYNC_STARTED", "Instrument master sync started.");

    try {
      const fetched = await this.provider.getInstruments();
      let inserted = 0;
      let updated = 0;
      let failed = fetched.failed;

      for (const item of fetched.instruments) {
        try {
          const existing =
            (await this.repos().instruments.findByExchangeInstrumentToken(item.exchange, item.instrumentToken)) ??
            (await this.repos().instruments.findByExchangeSymbol(item.exchange, item.tradingSymbol));
          await this.repos().instruments.upsertNormalized({
            symbol: item.tradingSymbol,
            exchange: item.exchange,
            name: item.name,
            instrumentToken: item.instrumentToken,
            exchangeToken: item.exchangeToken,
            segment: item.segment,
            instrumentType: item.instrumentType,
            expiry: item.expiry,
            strike: item.strike,
            tickSize: item.tickSize,
            lotSize: item.lotSize,
            isActive: item.isActive
          });
          if (existing) {
            updated += 1;
          } else {
            inserted += 1;
          }
        } catch {
          failed += 1;
        }
      }

      const result: InstrumentSyncResult = {
        status: "COMPLETE",
        source: this.provider.source,
        received: fetched.received,
        inserted,
        updated,
        deactivated: 0,
        failed
      };

      await this.log(user.id, "INFO", "INSTRUMENT_SYNC_SUCCEEDED", "Instrument master sync completed.", { ...result });
      return result;
    } catch (error) {
      await this.log(user.id, "ERROR", "INSTRUMENT_SYNC_FAILED", "Instrument provider failed.");
      if (error instanceof MarketDataError) {
        throw error;
      }
      throw new MarketDataError(
        "INSTRUMENT_SYNC_FAILED",
        error instanceof Error ? error.message : "Instrument sync failed."
      );
    }
  }

  private async log(
    userId: string,
    level: "INFO" | "ERROR",
    event: string,
    message: string,
    metadata: Record<string, unknown> = {}
  ) {
    await this.repos().systemLogs.create({
      userId,
      level,
      source: SOURCE,
      message,
      metadata: { event, ...metadata }
    });
  }
}

export function defaultInstrumentProvider(): InstrumentProvider {
  return isDatabasePersistenceEnabled() ? kiteInstrumentProvider : mockInstrumentProvider;
}

export const instrumentSyncService = new InstrumentSyncService();
