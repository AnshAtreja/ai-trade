export type BrokerAccountSource = "KITE" | "MOCK";
export type BrokerAccountRefreshStatus = "COMPLETE" | "PARTIAL";
export type BrokerPositionBook = "NET" | "DAY";

export interface BrokerSectionError {
  section: "profile" | "funds" | "positions" | "orders" | "holdings";
  code: string;
  message: string;
}

export interface BrokerAccountProfile {
  source: BrokerAccountSource;
  userId: string;
  userName: string;
  userShortName: string | null;
  email: string | null;
  broker: string;
  userType: string | null;
  products: string[];
  exchanges: string[];
  orderTypes: string[];
}

export interface BrokerMarginBucket {
  adhocMargin: number | null;
  cash: number | null;
  openingBalance: number | null;
  liveBalance: number | null;
  collateral: number | null;
  intradayPayin: number | null;
}

export interface BrokerUtilisedBucket {
  debits: number | null;
  exposure: number | null;
  m2mRealised: number | null;
  m2mUnrealised: number | null;
  optionPremium: number | null;
  payout: number | null;
  span: number | null;
  holdingSales: number | null;
  turnover: number | null;
  liquidCollateral: number | null;
  stockCollateral: number | null;
  delivery: number | null;
}

export interface BrokerMarginSegment {
  enabled: boolean | null;
  net: number | null;
  available: BrokerMarginBucket;
  utilised: BrokerUtilisedBucket;
}

export interface BrokerFunds {
  source: BrokerAccountSource;
  equity: BrokerMarginSegment | null;
  commodity: BrokerMarginSegment | null;
  capturedAt: string;
}

export interface BrokerAccountPosition {
  book: BrokerPositionBook;
  exchange: string;
  tradingSymbol: string;
  product: string;
  quantity: number;
  overnightQuantity: number;
  buyQuantity: number;
  sellQuantity: number;
  buyAverage: number | null;
  sellAverage: number | null;
  averagePrice: number | null;
  lastPrice: number | null;
  realisedPnl: number | null;
  unrealisedPnl: number | null;
  pnl: number | null;
  multiplier: number | null;
  value: number | null;
}

export interface BrokerAccountOrder {
  orderId: string;
  exchange: string;
  tradingSymbol: string;
  transactionType: string;
  quantity: number;
  filledQuantity: number;
  pendingQuantity: number;
  price: number | null;
  averagePrice: number | null;
  triggerPrice: number | null;
  orderType: string;
  product: string;
  validity: string | null;
  status: string;
  statusMessage: string | null;
  orderTimestamp: string | null;
  exchangeTimestamp: string | null;
}

export interface BrokerAccountHolding {
  tradingSymbol: string;
  exchange: string;
  quantity: number;
  averagePrice: number | null;
  lastPrice: number | null;
  pnl: number | null;
  authorisedQuantity: number | null;
  product: string | null;
}

export interface BrokerAccountPnl {
  realised: number;
  unrealised: number;
  day: number;
}

export interface BrokerAccountState {
  source: BrokerAccountSource;
  tradingMode: "LIVE";
  authenticated: boolean;
  refreshStatus: BrokerAccountRefreshStatus;
  capturedAt: string;
  profile: BrokerAccountProfile | null;
  funds: BrokerFunds | null;
  positions: BrokerAccountPosition[];
  orders: BrokerAccountOrder[];
  holdings: BrokerAccountHolding[];
  pnl: BrokerAccountPnl;
  errors: BrokerSectionError[];
}

export interface BrokerAccountProvider {
  readonly source: BrokerAccountSource;
  isConfigured(): boolean;
  isAuthenticated(): boolean;
  getProfile(): Promise<BrokerAccountProfile>;
  getFunds(): Promise<BrokerFunds>;
  getPositions(): Promise<BrokerAccountPosition[]>;
  getOrders(): Promise<BrokerAccountOrder[]>;
  getHoldings(): Promise<BrokerAccountHolding[]>;
}
