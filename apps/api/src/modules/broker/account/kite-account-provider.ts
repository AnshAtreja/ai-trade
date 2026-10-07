import type { KiteBrokerAdapter } from "../adapters/kite-broker-adapter";
import { kiteBrokerAdapter } from "../adapters/kite-broker-adapter";
import { KiteAccountError } from "./errors";
import { mapKiteFunds, mapKiteHoldings, mapKiteOrders, mapKitePositions, mapKiteProfile } from "./mappers";
import type { BrokerAccountProvider } from "./types";

export class KiteAccountProvider implements BrokerAccountProvider {
  readonly source = "KITE" as const;

  constructor(private readonly adapter: KiteBrokerAdapter = kiteBrokerAdapter) {}

  isConfigured() {
    return this.adapter.isConfigured();
  }

  isAuthenticated() {
    return this.adapter.isAuthenticated();
  }

  async getProfile() {
    this.assertReadable();
    return mapKiteProfile(await this.adapter.fetchReadOnly("/user/profile"), "KITE");
  }

  async getFunds() {
    this.assertReadable();
    return mapKiteFunds(await this.adapter.fetchReadOnly("/user/margins"), "KITE");
  }

  async getPositions() {
    this.assertReadable();
    return mapKitePositions(await this.adapter.fetchReadOnly("/portfolio/positions"));
  }

  async getOrders() {
    this.assertReadable();
    return mapKiteOrders(await this.adapter.fetchReadOnly("/orders"));
  }

  async getHoldings() {
    this.assertReadable();
    return mapKiteHoldings(await this.adapter.fetchReadOnly("/portfolio/holdings"));
  }

  private assertReadable() {
    if (!this.isConfigured()) {
      throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite API key is not configured.");
    }

    if (!this.isAuthenticated()) {
      throw new KiteAccountError("KITE_NOT_AUTHENTICATED", "Kite access token is missing. Complete Kite login first.");
    }
  }
}

export const kiteAccountProvider = new KiteAccountProvider();
