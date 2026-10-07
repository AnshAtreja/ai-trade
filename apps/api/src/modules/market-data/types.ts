export interface MarketMover {
  symbol: string;
  price: number;
  changePercent: number;
}

export interface MarketOverview {
  index: string;
  value: number;
  changePercent: number;
}

