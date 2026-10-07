import type {
  AccountSnapshotRecord,
  BrokerAccountSnapshotRecord,
  HistoricalCandleRecord,
  InstrumentRecord,
  JournalEntryRecord,
  MarketSnapshotRecord,
  OrderRecord,
  PaperAccountRecord,
  PersistedUser,
  PositionRecord,
  RiskConfigurationRecord,
  ScannerSignalRecord,
  StrategySetupRecord,
  PaperFillRecord,
  SystemLogRecord,
  TradeRecord
} from "../domain";

export interface UserRepository {
  upsertByEmail(input: { email: string; name: string }): Promise<PersistedUser>;
  findByEmail(email: string): Promise<PersistedUser | null>;
  findById(id: string): Promise<PersistedUser | null>;
}

export type InstrumentWrite = Omit<
  InstrumentRecord,
  "id" | "createdAt" | "updatedAt" | "exchangeToken" | "instrumentType" | "expiry" | "strike"
> & {
  id?: string;
  exchangeToken?: string | null;
  instrumentType?: string | null;
  expiry?: Date | null;
  strike?: number | null;
};
export type AccountSnapshotWrite = Omit<
  AccountSnapshotRecord,
  | "id"
  | "createdAt"
  | "capturedAt"
  | "sessionDate"
  | "event"
  | "status"
  | "startingCapital"
  | "dayPnl"
  | "openExposure"
  | "riskUsedToday"
  | "tradesToday"
  | "openPositionCount"
  | "source"
> & {
  id?: string;
  capturedAt?: Date;
  sessionDate?: string | null;
  event?: string | null;
  status?: string;
  startingCapital?: number | null;
  dayPnl?: number | null;
  openExposure?: number | null;
  riskUsedToday?: number | null;
  tradesToday?: number | null;
  openPositionCount?: number | null;
  source?: string;
};
export type ScannerSignalWrite = Omit<ScannerSignalRecord, "id" | "createdAt" | "updatedAt"> & { id?: string };
type OrderOptional =
  | "clientOrderId"
  | "idempotencyKey"
  | "orderType"
  | "limitPrice"
  | "averageFillPrice"
  | "instrumentToken"
  | "strategySetupId"
  | "rejectionCode"
  | "rejectionSource"
  | "submittedAt"
  | "firstFillAt"
  | "filledAt"
  | "cancelledAt"
  | "rejectedAt"
  | "expiredAt"
  | "executableAt"
  | "executionProvenance";
export type OrderWrite = Omit<OrderRecord, "id" | "createdAt" | "updatedAt" | OrderOptional> &
  Partial<Pick<OrderRecord, OrderOptional>> & { id?: string };
type TradeOptional = "grossPnl" | "charges" | "strategySetupId" | "instrumentToken";
export type TradeWrite = Omit<TradeRecord, "id" | "createdAt" | "updatedAt" | TradeOptional> &
  Partial<Pick<TradeRecord, TradeOptional>> & { id?: string };
type PositionOptional = "originalQuantity" | "instrumentToken";
export type PositionWrite = Omit<PositionRecord, "id" | "createdAt" | "updatedAt" | PositionOptional> &
  Partial<Pick<PositionRecord, PositionOptional>> & { id?: string };
export type JournalEntryWrite = Omit<JournalEntryRecord, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type SystemLogWrite = Omit<SystemLogRecord, "id" | "createdAt"> & { id?: string };
export type RiskConfigurationWrite = Omit<
  RiskConfigurationRecord,
  "id" | "createdAt" | "updatedAt" | "maxOpenPositions" | "maxCapitalExposure"
> & {
  id?: string;
  maxOpenPositions?: number;
  maxCapitalExposure?: number;
};
export type PaperAccountWrite = Omit<PaperAccountRecord, "id" | "createdAt" | "updatedAt"> & { id?: string };
export type MarketSnapshotWrite = Omit<MarketSnapshotRecord, "id" | "createdAt" | "capturedAt"> & {
  id?: string;
  capturedAt?: Date;
};
export type BrokerAccountSnapshotWrite = Omit<BrokerAccountSnapshotRecord, "id" | "createdAt" | "capturedAt"> & {
  id?: string;
  capturedAt?: Date;
};

export interface DateRangeFilter {
  from?: Date;
  to?: Date;
}

export interface InstrumentListFilter {
  symbol?: string;
  symbolPrefix?: string;
  search?: string;
  exchange?: string;
  segment?: string;
  instrumentType?: string;
  isActive?: boolean;
  hasExpiry?: boolean;
  excludeEtfs?: boolean;
  offset?: number;
  limit?: number;
}

export interface InstrumentRepository {
  upsertByExchangeSymbol(input: InstrumentWrite): Promise<InstrumentRecord>;
  /** Identity prefers exchange + instrumentToken, then exchange + tradingSymbol. */
  upsertNormalized(input: InstrumentWrite): Promise<InstrumentRecord>;
  findByExchangeSymbol(exchange: string, symbol: string): Promise<InstrumentRecord | null>;
  findByInstrumentToken(instrumentToken: string): Promise<InstrumentRecord | null>;
  findByExchangeInstrumentToken(exchange: string, instrumentToken: string): Promise<InstrumentRecord | null>;
  list(params?: InstrumentListFilter): Promise<InstrumentRecord[]>;
}

export interface AccountSnapshotRepository {
  create(input: AccountSnapshotWrite): Promise<AccountSnapshotRecord>;
  listByUser(
    userId: string,
    params?: { tradingMode?: AccountSnapshotRecord["tradingMode"]; source?: string; limit?: number }
  ): Promise<AccountSnapshotRecord[]>;
  findById(id: string): Promise<AccountSnapshotRecord | null>;
  findLatest(
    userId: string,
    tradingMode: AccountSnapshotRecord["tradingMode"],
    source?: string
  ): Promise<AccountSnapshotRecord | null>;
}

export interface ScannerSignalRepository {
  upsertByDedupeKey(input: ScannerSignalWrite): Promise<ScannerSignalRecord>;
  findByDedupeKey(dedupeKey: string): Promise<ScannerSignalRecord | null>;
  findById(id: string): Promise<ScannerSignalRecord | null>;
  listByUser(
    userId: string,
    params?: { symbol?: string; tradingMode?: ScannerSignalRecord["tradingMode"]; sessionDate?: string }
  ): Promise<ScannerSignalRecord[]>;
}

export interface OrderRepository {
  create(input: OrderWrite): Promise<OrderRecord>;
  update(id: string, patch: Partial<OrderWrite>): Promise<OrderRecord | null>;
  findById(id: string): Promise<OrderRecord | null>;
  findByBrokerOrderId(brokerOrderId: string): Promise<OrderRecord | null>;
  findByIdempotencyKey(idempotencyKey: string): Promise<OrderRecord | null>;
  findByClientOrderId(clientOrderId: string): Promise<OrderRecord | null>;
  listByUser(
    userId: string,
    params?: { symbol?: string; status?: OrderRecord["status"]; tradingMode?: OrderRecord["tradingMode"] }
  ): Promise<OrderRecord[]>;
  listByTrade(tradeId: string): Promise<OrderRecord[]>;
  listWorking(userId: string, tradingMode?: OrderRecord["tradingMode"]): Promise<OrderRecord[]>;
}

export type PaperFillWrite = Omit<PaperFillRecord, "id" | "createdAt"> & { id?: string };

export interface PaperFillRepository {
  create(input: PaperFillWrite): Promise<PaperFillRecord>;
  findByFillKey(fillKey: string): Promise<PaperFillRecord | null>;
  listByOrder(orderId: string): Promise<PaperFillRecord[]>;
}

export interface TradeRepository {
  create(input: TradeWrite): Promise<TradeRecord>;
  update(id: string, patch: Partial<TradeWrite>): Promise<TradeRecord | null>;
  findById(id: string): Promise<TradeRecord | null>;
  listByUser(
    userId: string,
    params?: {
      symbol?: string;
      status?: TradeRecord["status"];
      tradingMode?: TradeRecord["tradingMode"];
      strategyId?: string;
    } & DateRangeFilter
  ): Promise<TradeRecord[]>;
}

export interface PositionRepository {
  create(input: PositionWrite): Promise<PositionRecord>;
  update(id: string, patch: Partial<PositionWrite>): Promise<PositionRecord | null>;
  findById(id: string): Promise<PositionRecord | null>;
  findByTradeId(tradeId: string): Promise<PositionRecord | null>;
  listByUser(
    userId: string,
    params?: {
      symbol?: string;
      status?: PositionRecord["status"];
      tradingMode?: PositionRecord["tradingMode"];
    } & DateRangeFilter
  ): Promise<PositionRecord[]>;
  listOpenBySymbol(symbol: string, tradingMode?: PositionRecord["tradingMode"]): Promise<PositionRecord[]>;
}

export interface JournalEntryRepository {
  create(input: JournalEntryWrite): Promise<JournalEntryRecord>;
  findById(id: string): Promise<JournalEntryRecord | null>;
  listByAuthor(authorId: string, params?: { symbol?: string; type?: JournalEntryRecord["type"] }): Promise<JournalEntryRecord[]>;
}

export interface SystemLogRepository {
  create(input: SystemLogWrite): Promise<SystemLogRecord>;
  list(params?: { userId?: string; source?: string; limit?: number }): Promise<SystemLogRecord[]>;
}

export interface RiskConfigurationRepository {
  upsertForUser(input: RiskConfigurationWrite): Promise<RiskConfigurationRecord>;
  findByUser(userId: string, tradingMode: RiskConfigurationRecord["tradingMode"]): Promise<RiskConfigurationRecord | null>;
}

export interface PaperAccountRepository {
  findByUser(userId: string, tradingMode: PaperAccountRecord["tradingMode"]): Promise<PaperAccountRecord | null>;
  create(input: PaperAccountWrite): Promise<PaperAccountRecord>;
  touch(id: string): Promise<PaperAccountRecord | null>;
  /** Row lock inside a DB transaction. No-op in mock mode. */
  lock(userId: string, tradingMode: PaperAccountRecord["tradingMode"]): Promise<void>;
}

export interface BrokerAccountSnapshotRepository {
  create(input: BrokerAccountSnapshotWrite): Promise<BrokerAccountSnapshotRecord>;
  findLatest(userId: string, source?: string): Promise<BrokerAccountSnapshotRecord | null>;
  listByUser(userId: string, params?: { source?: string; limit?: number }): Promise<BrokerAccountSnapshotRecord[]>;
  findById(id: string): Promise<BrokerAccountSnapshotRecord | null>;
}

export interface MarketSnapshotRepository {
  create(input: MarketSnapshotWrite): Promise<MarketSnapshotRecord>;
  list(params?: { symbol?: string; instrumentId?: string; source?: string; limit?: number }): Promise<MarketSnapshotRecord[]>;
}

export type StrategySetupWrite = Omit<StrategySetupRecord, "id" | "createdAt"> & { id?: string };

export interface StrategySetupRepository {
  /** Upsert by setupIdentity — same identity within a minute bucket stays one row. */
  upsertByIdentity(input: StrategySetupWrite): Promise<StrategySetupRecord>;
  findByIdentity(setupIdentity: string): Promise<StrategySetupRecord | null>;
  list(params?: {
    strategyId?: string;
    symbol?: string;
    limit?: number;
  }): Promise<StrategySetupRecord[]>;
}

export type HistoricalCandleWrite = Omit<HistoricalCandleRecord, "id" | "createdAt" | "fetchedAt"> & {
  id?: string;
  fetchedAt?: Date;
};

/**
 * Historical candle queries use half-open range [from, to) when both bounds are set.
 * `to` is exclusive so callers can request "available up to T" without including T.
 */
export interface HistoricalCandleRangeQuery {
  instrumentToken: string;
  interval: HistoricalCandleRecord["interval"];
  /** Inclusive lower bound. */
  from?: Date;
  /** Exclusive upper bound. */
  to?: Date;
  limit?: number;
}

export interface HistoricalCandleCoverageRow {
  instrumentToken: string;
  exchange: string;
  tradingSymbol: string;
  interval: HistoricalCandleRecord["interval"];
  count: number;
  earliest: Date | null;
  latest: Date | null;
  lastFetchedAt: Date | null;
  sources: string[];
}

export interface HistoricalCandleRepository {
  /** Insert-only by default. Duplicates on (token, interval, timestamp) are skipped. */
  insertMany(inputs: HistoricalCandleWrite[], options?: { reconcile?: boolean }): Promise<{
    inserted: number;
    skipped: number;
    updated: number;
  }>;
  listRange(query: HistoricalCandleRangeQuery): Promise<HistoricalCandleRecord[]>;
  count(query: Omit<HistoricalCandleRangeQuery, "limit">): Promise<number>;
  earliest(instrumentToken: string, interval: HistoricalCandleRecord["interval"]): Promise<Date | null>;
  latest(instrumentToken: string, interval: HistoricalCandleRecord["interval"]): Promise<Date | null>;
  coverage(params?: {
    instrumentToken?: string;
    interval?: HistoricalCandleRecord["interval"];
    limit?: number;
  }): Promise<HistoricalCandleCoverageRow[]>;
}

export interface AppRepositories {
  users: UserRepository;
  instruments: InstrumentRepository;
  accountSnapshots: AccountSnapshotRepository;
  scannerSignals: ScannerSignalRepository;
  strategySetups: StrategySetupRepository;
  historicalCandles: HistoricalCandleRepository;
  orders: OrderRepository;
  paperFills: PaperFillRepository;
  trades: TradeRepository;
  positions: PositionRepository;
  journalEntries: JournalEntryRepository;
  systemLogs: SystemLogRepository;
  riskConfigurations: RiskConfigurationRepository;
  paperAccounts: PaperAccountRepository;
  brokerAccountSnapshots: BrokerAccountSnapshotRepository;
  marketSnapshots: MarketSnapshotRepository;
  runInTransaction<T>(work: (repos: AppRepositories) => Promise<T>): Promise<T>;
}
