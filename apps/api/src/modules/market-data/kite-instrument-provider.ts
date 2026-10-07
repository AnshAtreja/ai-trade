import { kiteBrokerAdapter, type KiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { MarketDataError, wrapBrokerError } from "./errors";
import { fromBrokerInstrument } from "./instrument-types";
import type { InstrumentMasterFetch, InstrumentProvider, NormalizedInstrument } from "./instrument-types";

export class KiteInstrumentProvider implements InstrumentProvider {
  readonly source = "KITE" as const;

  constructor(private readonly adapter: KiteBrokerAdapter = kiteBrokerAdapter) {}

  async getInstruments(): Promise<InstrumentMasterFetch> {
    if (!this.adapter.isConfigured() || !this.adapter.isAuthenticated()) {
      throw new MarketDataError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
    }

    try {
      const raw = await this.adapter.fetchInstrumentMaster();
      const instruments: NormalizedInstrument[] = [];
      let failed = 0;

      for (const item of raw) {
        const normalized = fromBrokerInstrument(item);
        if (!normalized) {
          failed += 1;
          continue;
        }
        instruments.push(normalized);
      }

      return { instruments, received: raw.length, failed };
    } catch (error) {
      wrapBrokerError(error, "INSTRUMENT_SYNC_FAILED");
    }
  }
}

export const kiteInstrumentProvider = new KiteInstrumentProvider();
