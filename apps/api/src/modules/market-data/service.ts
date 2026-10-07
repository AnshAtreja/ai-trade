import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { marketOverview, watchlistMovers } from "./mock-data";

export interface MarketDataService {
  getOverview: () => Promise<typeof marketOverview>;
  getWatchlistMovers: () => Promise<typeof watchlistMovers>;
  getSummary: () => ModuleSummary;
}

export class MockMarketDataService implements MarketDataService {
  async getOverview() {
    return marketOverview;
  }

  async getWatchlistMovers() {
    return watchlistMovers;
  }

  getSummary(): ModuleSummary {
    return {
      key: "market-data",
      title: "Market Data",
      description: "Market snapshots and watchlist movers are served from deterministic fixtures.",
      status: "Mocked",
      metrics: [
        { label: "Indexes", value: `${marketOverview.length} tracked` },
        { label: "Watchlist", value: `${watchlistMovers.length} symbols` }
      ]
    };
  }
}

export const marketDataService = new MockMarketDataService();

