import type { MarketMover, MarketOverview } from "./types";

export const marketOverview: MarketOverview[] = [
  { index: "S&P 500", value: 5318.24, changePercent: 0.42 },
  { index: "NASDAQ 100", value: 18644.21, changePercent: 0.88 },
  { index: "VIX", value: 14.33, changePercent: -3.1 }
];

export const watchlistMovers: MarketMover[] = [
  { symbol: "AAPL", price: 212.33, changePercent: 1.24 },
  { symbol: "NVDA", price: 1048.12, changePercent: 2.52 },
  { symbol: "TSLA", price: 178.42, changePercent: -0.66 }
];

