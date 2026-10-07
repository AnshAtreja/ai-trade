/**
 * In-memory repositories used when PERSISTENCE_MODE=mock.
 * persistent: no
 * mock: yes — process-local Maps, lost on restart
 * broker integration: unused
 * paper trading: can hold paper Order/Trade/Position records in-process
 * live trading disabled: LIVE orders are not created by application services
 */
import { DEMO_USER_EMAIL, DEMO_USER_NAME, MEMORY_DEMO_USER_ID } from "../domain";
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
  PaperFillRecord,
  StrategySetupRecord,
  SystemLogRecord,
  TradeRecord
} from "../domain";
import { createId } from "../mappers";
import type {
  AccountSnapshotRepository,
  AccountSnapshotWrite,
  AppRepositories,
  BrokerAccountSnapshotRepository,
  BrokerAccountSnapshotWrite,
  HistoricalCandleCoverageRow,
  HistoricalCandleRangeQuery,
  HistoricalCandleRepository,
  HistoricalCandleWrite,
  InstrumentRepository,
  InstrumentWrite,
  JournalEntryRepository,
  JournalEntryWrite,
  MarketSnapshotRepository,
  MarketSnapshotWrite,
  OrderRepository,
  OrderWrite,
  PaperAccountRepository,
  PaperAccountWrite,
  PositionRepository,
  PositionWrite,
  RiskConfigurationRepository,
  RiskConfigurationWrite,
  ScannerSignalRepository,
  ScannerSignalWrite,
  PaperFillRepository,
  PaperFillWrite,
  StrategySetupRepository,
  StrategySetupWrite,
  SystemLogRepository,
  SystemLogWrite,
  TradeRepository,
  TradeWrite,
  UserRepository
} from "./contracts";

function now() {
  return new Date();
}

function clone<T>(value: T): T {
  return structuredClone(value);
}

export class InMemoryUserRepository implements UserRepository {
  constructor(private readonly users = new Map<string, PersistedUser>()) {
    const createdAt = now();

    this.users.set(MEMORY_DEMO_USER_ID, {
      id: MEMORY_DEMO_USER_ID,
      email: DEMO_USER_EMAIL,
      name: DEMO_USER_NAME,
      createdAt,
      updatedAt: createdAt
    });
  }

  async upsertByEmail(input: { email: string; name: string }) {
    const existing = [...this.users.values()].find((user) => user.email === input.email.toLowerCase());

    if (existing) {
      const updated = { ...existing, name: input.name, updatedAt: now() };
      this.users.set(updated.id, updated);
      return clone(updated);
    }

    const createdAt = now();
    const user: PersistedUser = {
      id: createId("user"),
      email: input.email.toLowerCase(),
      name: input.name,
      createdAt,
      updatedAt: createdAt
    };

    this.users.set(user.id, user);
    return clone(user);
  }

  async findByEmail(email: string) {
    return clone([...this.users.values()].find((user) => user.email === email.toLowerCase()) ?? null);
  }

  async findById(id: string) {
    return clone(this.users.get(id) ?? null);
  }
}

export class InMemoryInstrumentRepository implements InstrumentRepository {
  constructor(private readonly instruments = new Map<string, InstrumentRecord>()) {}

  async upsertByExchangeSymbol(input: InstrumentWrite) {
    const key = instrumentKey(input.exchange, input.symbol);
    const existing = this.instruments.get(key);
    const timestamp = now();
    const record: InstrumentRecord = {
      id: existing?.id ?? input.id ?? createId("inst"),
      symbol: input.symbol.toUpperCase(),
      exchange: input.exchange.toUpperCase(),
      name: input.name,
      instrumentToken: input.instrumentToken,
      exchangeToken: input.exchangeToken ?? existing?.exchangeToken ?? null,
      segment: input.segment,
      instrumentType: input.instrumentType ?? existing?.instrumentType ?? null,
      expiry: input.expiry ?? existing?.expiry ?? null,
      strike: input.strike ?? existing?.strike ?? null,
      tickSize: input.tickSize,
      lotSize: input.lotSize,
      isActive: input.isActive,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.instruments.set(key, record);
    return clone(record);
  }

  async upsertNormalized(input: InstrumentWrite) {
    const exchange = input.exchange.toUpperCase();
    const symbol = input.symbol.toUpperCase();
    const existing = input.instrumentToken
      ? [...this.instruments.values()].find(
          (item) => item.exchange === exchange && item.instrumentToken === input.instrumentToken
        )
      : this.instruments.get(instrumentKey(exchange, symbol));
    const matched = existing ?? this.instruments.get(instrumentKey(exchange, symbol));

    if (!matched) {
      return this.upsertByExchangeSymbol(input);
    }

    const timestamp = now();
    const oldKey = instrumentKey(matched.exchange, matched.symbol);
    const record: InstrumentRecord = {
      id: matched.id,
      symbol,
      exchange,
      name: input.name,
      instrumentToken: input.instrumentToken,
      exchangeToken: input.exchangeToken ?? matched.exchangeToken ?? null,
      segment: input.segment,
      instrumentType: input.instrumentType ?? matched.instrumentType ?? null,
      expiry: input.expiry ?? matched.expiry ?? null,
      strike: input.strike ?? matched.strike ?? null,
      tickSize: input.tickSize,
      lotSize: input.lotSize,
      isActive: input.isActive,
      createdAt: matched.createdAt,
      updatedAt: timestamp
    };

    if (oldKey !== instrumentKey(exchange, symbol)) {
      this.instruments.delete(oldKey);
    }

    this.instruments.set(instrumentKey(exchange, symbol), record);
    return clone(record);
  }

  async findByExchangeSymbol(exchange: string, symbol: string) {
    return clone(this.instruments.get(instrumentKey(exchange, symbol)) ?? null);
  }

  async findByInstrumentToken(instrumentToken: string) {
    return clone(
      [...this.instruments.values()].find((item) => item.instrumentToken === instrumentToken) ?? null
    );
  }

  async findByExchangeInstrumentToken(exchange: string, instrumentToken: string) {
    return clone(
      [...this.instruments.values()].find(
        (item) => item.exchange === exchange.toUpperCase() && item.instrumentToken === instrumentToken
      ) ?? null
    );
  }

  async list(params?: { symbol?: string; symbolPrefix?: string; search?: string; exchange?: string; segment?: string; instrumentType?: string; isActive?: boolean; hasExpiry?: boolean; excludeEtfs?: boolean; offset?: number; limit?: number }) {
    return [...this.instruments.values()]
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .filter((item) => (params?.symbolPrefix ? item.symbol.startsWith(params.symbolPrefix.toUpperCase()) : true))
      .filter((item) => (params?.search ? `${item.symbol} ${item.name}`.toUpperCase().includes(params.search.toUpperCase()) : true))
      .filter((item) => (params?.exchange ? item.exchange === params.exchange.toUpperCase() : true))
      .filter((item) => (params?.segment ? item.segment === params.segment : true))
      .filter((item) => (params?.instrumentType ? item.instrumentType === params.instrumentType : true))
      .filter((item) => (params?.isActive == null ? true : item.isActive === params.isActive))
      .filter((item) => (params?.hasExpiry == null ? true : params.hasExpiry ? item.expiry != null : item.expiry == null))
      .filter((item) => (params?.excludeEtfs ? !/\bETF\b|BEES/i.test(`${item.name} ${item.symbol}`) : true))
      .sort((a, b) => a.symbol.localeCompare(b.symbol))
      .slice(params?.offset ?? 0, (params?.offset ?? 0) + (params?.limit ?? 5000))
      .map(clone);
  }
}

export class InMemoryAccountSnapshotRepository implements AccountSnapshotRepository {
  constructor(private readonly snapshots = new Map<string, AccountSnapshotRecord>()) {}

  async create(input: AccountSnapshotWrite) {
    const timestamp = now();
    const record: AccountSnapshotRecord = {
      ...input,
      id: input.id ?? createId("acct"),
      sessionDate: input.sessionDate ?? null,
      event: input.event ?? null,
      status: input.status ?? "ACTIVE",
      source: input.source ?? "PAPER",
      startingCapital: input.startingCapital ?? null,
      dayPnl: input.dayPnl ?? null,
      openExposure: input.openExposure ?? null,
      riskUsedToday: input.riskUsedToday ?? null,
      tradesToday: input.tradesToday ?? null,
      openPositionCount: input.openPositionCount ?? null,
      capturedAt: input.capturedAt ?? timestamp,
      createdAt: timestamp
    };

    this.snapshots.set(record.id, record);
    return clone(record);
  }

  async listByUser(
    userId: string,
    params?: { tradingMode?: AccountSnapshotRecord["tradingMode"]; source?: string; limit?: number }
  ) {
    return [...this.snapshots.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (params?.tradingMode ? item.tradingMode === params.tradingMode : true))
      .filter((item) => (params?.source ? item.source === params.source : true))
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .slice(0, params?.limit ?? 50)
      .map(clone);
  }

  async findById(id: string) {
    return clone(this.snapshots.get(id) ?? null);
  }

  async findLatest(userId: string, tradingMode: AccountSnapshotRecord["tradingMode"], source?: string) {
    const [latest] = await this.listByUser(userId, { tradingMode, source, limit: 1 });

    return latest ?? null;
  }
}

export class InMemoryScannerSignalRepository implements ScannerSignalRepository {
  constructor(private readonly signals = new Map<string, ScannerSignalRecord>()) {}

  async upsertByDedupeKey(input: ScannerSignalWrite) {
    const existing = [...this.signals.values()].find((item) => item.dedupeKey === input.dedupeKey);
    const timestamp = now();
    const record: ScannerSignalRecord = {
      ...input,
      id: existing?.id ?? input.id ?? createId("sig"),
      symbol: input.symbol.toUpperCase(),
      matchedSignals: [...input.matchedSignals],
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.signals.set(record.id, record);
    return clone(record);
  }

  async findByDedupeKey(dedupeKey: string) {
    return clone([...this.signals.values()].find((item) => item.dedupeKey === dedupeKey) ?? null);
  }

  async findById(id: string) {
    return clone(this.signals.get(id) ?? null);
  }

  async listByUser(
    userId: string,
    params?: { symbol?: string; tradingMode?: ScannerSignalRecord["tradingMode"]; sessionDate?: string }
  ) {
    return [...this.signals.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .filter((item) => (params?.tradingMode ? item.tradingMode === params.tradingMode : true))
      .filter((item) => (params?.sessionDate ? item.sessionDate === params.sessionDate : true))
      .sort((a, b) => b.updatedAt.getTime() - a.updatedAt.getTime() || b.score - a.score)
      .map(clone);
  }
}

export class InMemoryOrderRepository implements OrderRepository {
  constructor(private readonly orders = new Map<string, OrderRecord>()) {}

  async create(input: OrderWrite) {
    if (input.brokerOrderId && [...this.orders.values()].some((item) => item.brokerOrderId === input.brokerOrderId)) {
      throw new Error(`Duplicate broker order ID: ${input.brokerOrderId}`);
    }
    if (input.clientOrderId && [...this.orders.values()].some((item) => item.clientOrderId === input.clientOrderId)) {
      throw new Error(`Duplicate client order ID: ${input.clientOrderId}`);
    }
    if (input.idempotencyKey && [...this.orders.values()].some((item) => item.idempotencyKey === input.idempotencyKey)) {
      throw new Error(`Duplicate idempotency key: ${input.idempotencyKey}`);
    }

    const timestamp = now();
    const record: OrderRecord = {
      id: input.id ?? createId("ord"),
      userId: input.userId,
      tradeId: input.tradeId,
      positionId: input.positionId,
      strategyId: input.strategyId,
      brokerConnectionId: input.brokerConnectionId,
      instrumentId: input.instrumentId,
      brokerOrderId: input.brokerOrderId,
      clientOrderId: input.clientOrderId ?? null,
      idempotencyKey: input.idempotencyKey ?? null,
      symbol: input.symbol.toUpperCase(),
      side: input.side,
      status: input.status,
      purpose: input.purpose,
      tradingMode: input.tradingMode,
      orderType: input.orderType ?? "MARKET",
      quantity: input.quantity,
      filledQuantity: input.filledQuantity,
      price: input.price,
      limitPrice: input.limitPrice ?? null,
      averageFillPrice: input.averageFillPrice ?? null,
      instrumentToken: input.instrumentToken ?? null,
      strategySetupId: input.strategySetupId ?? null,
      rejectionCode: input.rejectionCode ?? null,
      rejectionSource: input.rejectionSource ?? null,
      submittedAt: input.submittedAt ?? null,
      firstFillAt: input.firstFillAt ?? null,
      filledAt: input.filledAt ?? null,
      cancelledAt: input.cancelledAt ?? null,
      rejectedAt: input.rejectedAt ?? null,
      expiredAt: input.expiredAt ?? null,
      executableAt: input.executableAt ?? null,
      executionProvenance: input.executionProvenance ?? null,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.orders.set(record.id, record);
    return clone(record);
  }

  async findByIdempotencyKey(idempotencyKey: string) {
    return clone([...this.orders.values()].find((item) => item.idempotencyKey === idempotencyKey) ?? null);
  }

  async findByClientOrderId(clientOrderId: string) {
    return clone([...this.orders.values()].find((item) => item.clientOrderId === clientOrderId) ?? null);
  }

  async listWorking(userId: string, tradingMode: OrderRecord["tradingMode"] = "PAPER") {
    const working = new Set(["CREATED", "SUBMITTED", "OPEN", "PARTIALLY_FILLED"]);
    return [...this.orders.values()]
      .filter((item) => item.userId === userId && item.tradingMode === tradingMode && working.has(item.status))
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }

  async update(id: string, patch: Partial<OrderWrite>) {
    const existing = this.orders.get(id);

    if (!existing) {
      return null;
    }

    const record = { ...existing, ...patch, id, updatedAt: now() };
    this.orders.set(id, record);
    return clone(record);
  }

  async findById(id: string) {
    return clone(this.orders.get(id) ?? null);
  }

  async findByBrokerOrderId(brokerOrderId: string) {
    return clone([...this.orders.values()].find((item) => item.brokerOrderId === brokerOrderId) ?? null);
  }

  async listByUser(
    userId: string,
    params?: { symbol?: string; status?: OrderRecord["status"]; tradingMode?: OrderRecord["tradingMode"] }
  ) {
    return [...this.orders.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .filter((item) => (params?.status ? item.status === params.status : true))
      .filter((item) => (params?.tradingMode ? item.tradingMode === params.tradingMode : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }

  async listByTrade(tradeId: string) {
    return [...this.orders.values()]
      .filter((item) => item.tradeId === tradeId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
}

export class InMemoryTradeRepository implements TradeRepository {
  constructor(private readonly trades = new Map<string, TradeRecord>()) {}

  async create(input: TradeWrite) {
    const timestamp = now();
    const record: TradeRecord = {
      ...input,
      grossPnl: input.grossPnl ?? null,
      charges: input.charges ?? null,
      strategySetupId: input.strategySetupId ?? null,
      instrumentToken: input.instrumentToken ?? null,
      id: input.id ?? createId("trd"),
      symbol: input.symbol.toUpperCase(),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.trades.set(record.id, record);
    return clone(record);
  }

  async update(id: string, patch: Partial<TradeWrite>) {
    const existing = this.trades.get(id);

    if (!existing) {
      return null;
    }

    const record = { ...existing, ...patch, id, updatedAt: now() };
    this.trades.set(id, record);
    return clone(record);
  }

  async findById(id: string) {
    return clone(this.trades.get(id) ?? null);
  }

  async listByUser(
    userId: string,
    params?: {
      symbol?: string;
      status?: TradeRecord["status"];
      tradingMode?: TradeRecord["tradingMode"];
      strategyId?: string;
      from?: Date;
      to?: Date;
    }
  ) {
    return [...this.trades.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .filter((item) => (params?.status ? item.status === params.status : true))
      .filter((item) => (params?.tradingMode ? item.tradingMode === params.tradingMode : true))
      .filter((item) => (params?.strategyId ? item.strategyId === params.strategyId : true))
      .filter((item) => (params?.from ? item.createdAt >= params.from : true))
      .filter((item) => (params?.to ? item.createdAt <= params.to : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }
}

export class InMemoryPositionRepository implements PositionRepository {
  constructor(private readonly positions = new Map<string, PositionRecord>()) {}

  async create(input: PositionWrite) {
    const timestamp = now();
    const record: PositionRecord = {
      ...input,
      originalQuantity: input.originalQuantity ?? input.quantity,
      instrumentToken: input.instrumentToken ?? null,
      id: input.id ?? createId("pos"),
      symbol: input.symbol.toUpperCase(),
      openedAt: input.openedAt ?? timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.positions.set(record.id, record);
    return clone(record);
  }

  async update(id: string, patch: Partial<PositionWrite>) {
    const existing = this.positions.get(id);

    if (!existing) {
      return null;
    }

    const record = { ...existing, ...patch, id, updatedAt: now() };
    this.positions.set(id, record);
    return clone(record);
  }

  async findById(id: string) {
    return clone(this.positions.get(id) ?? null);
  }

  async findByTradeId(tradeId: string) {
    return clone([...this.positions.values()].find((item) => item.tradeId === tradeId) ?? null);
  }

  async listByUser(
    userId: string,
    params?: {
      symbol?: string;
      status?: PositionRecord["status"];
      tradingMode?: PositionRecord["tradingMode"];
      from?: Date;
      to?: Date;
    }
  ) {
    return [...this.positions.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .filter((item) => (params?.status ? item.status === params.status : true))
      .filter((item) => (params?.tradingMode ? item.tradingMode === params.tradingMode : true))
      .filter((item) => (params?.from ? item.createdAt >= params.from : true))
      .filter((item) => (params?.to ? item.createdAt <= params.to : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }

  async listOpenBySymbol(symbol: string, tradingMode?: PositionRecord["tradingMode"]) {
    return [...this.positions.values()]
      .filter((item) => item.symbol === symbol.toUpperCase())
      .filter((item) => item.status === "OPEN")
      .filter((item) => (tradingMode ? item.tradingMode === tradingMode : true))
      .map(clone);
  }
}

export class InMemoryJournalEntryRepository implements JournalEntryRepository {
  constructor(private readonly entries = new Map<string, JournalEntryRecord>()) {}

  async create(input: JournalEntryWrite) {
    const timestamp = now();
    const record: JournalEntryRecord = {
      ...input,
      id: input.id ?? createId("jrnl"),
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.entries.set(record.id, record);
    return clone(record);
  }

  async findById(id: string) {
    return clone(this.entries.get(id) ?? null);
  }

  async listByAuthor(authorId: string, params?: { symbol?: string; type?: JournalEntryRecord["type"] }) {
    return [...this.entries.values()]
      .filter((item) => item.authorId === authorId)
      .filter((item) => (params?.symbol ? item.symbol === params.symbol : true))
      .filter((item) => (params?.type ? item.type === params.type : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .map(clone);
  }
}

export class InMemorySystemLogRepository implements SystemLogRepository {
  constructor(private readonly logs = new Map<string, SystemLogRecord>()) {}

  async create(input: SystemLogWrite) {
    const record: SystemLogRecord = {
      ...input,
      id: input.id ?? createId("log"),
      createdAt: now()
    };

    this.logs.set(record.id, record);
    return clone(record);
  }

  async list(params?: { userId?: string; source?: string; limit?: number }) {
    return [...this.logs.values()]
      .filter((item) => (params?.userId ? item.userId === params.userId : true))
      .filter((item) => (params?.source ? item.source === params.source : true))
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
      .slice(0, params?.limit ?? 100)
      .map(clone);
  }
}

export class InMemoryRiskConfigurationRepository implements RiskConfigurationRepository {
  constructor(private readonly configs = new Map<string, RiskConfigurationRecord>()) {}

  async upsertForUser(input: RiskConfigurationWrite) {
    const key = `${input.userId}:${input.tradingMode}`;
    const existing = this.configs.get(key);
    const timestamp = now();
    const record: RiskConfigurationRecord = {
      ...input,
      id: existing?.id ?? input.id ?? createId("risk"),
      maxOpenPositions: input.maxOpenPositions ?? existing?.maxOpenPositions ?? 5,
      maxCapitalExposure: input.maxCapitalExposure ?? existing?.maxCapitalExposure ?? 100000,
      createdAt: existing?.createdAt ?? timestamp,
      updatedAt: timestamp
    };

    this.configs.set(key, record);
    return clone(record);
  }

  async findByUser(userId: string, tradingMode: RiskConfigurationRecord["tradingMode"]) {
    return clone(this.configs.get(`${userId}:${tradingMode}`) ?? null);
  }
}

export class InMemoryPaperAccountRepository implements PaperAccountRepository {
  constructor(private readonly accounts = new Map<string, PaperAccountRecord>()) {}

  async findByUser(userId: string, tradingMode: PaperAccountRecord["tradingMode"]) {
    return clone(this.accounts.get(`${userId}:${tradingMode}`) ?? null);
  }

  async create(input: PaperAccountWrite) {
    const key = `${input.userId}:${input.tradingMode}`;
    const timestamp = now();
    const record: PaperAccountRecord = {
      ...input,
      id: input.id ?? createId("pacct"),
      initializedAt: input.initializedAt ?? timestamp,
      createdAt: timestamp,
      updatedAt: timestamp
    };

    this.accounts.set(key, record);
    return clone(record);
  }

  async touch(id: string) {
    const existing = [...this.accounts.values()].find((item) => item.id === id);

    if (!existing) {
      return null;
    }

    const updated = { ...existing, updatedAt: now() };
    this.accounts.set(`${updated.userId}:${updated.tradingMode}`, updated);
    return clone(updated);
  }

  async lock(_userId: string, _tradingMode: PaperAccountRecord["tradingMode"]) {
    return;
  }
}

export class InMemoryBrokerAccountSnapshotRepository implements BrokerAccountSnapshotRepository {
  constructor(private readonly snapshots = new Map<string, BrokerAccountSnapshotRecord>()) {}

  async create(input: BrokerAccountSnapshotWrite) {
    const timestamp = now();
    const record: BrokerAccountSnapshotRecord = {
      ...input,
      id: input.id ?? createId("bas"),
      state: clone(input.state),
      capturedAt: input.capturedAt ?? timestamp,
      createdAt: timestamp
    };

    this.snapshots.set(record.id, record);
    return clone(record);
  }

  async findLatest(userId: string, source?: string) {
    const [latest] = await this.listByUser(userId, { source, limit: 1 });
    return latest ?? null;
  }

  async listByUser(userId: string, params?: { source?: string; limit?: number }) {
    return [...this.snapshots.values()]
      .filter((item) => item.userId === userId)
      .filter((item) => (params?.source ? item.source === params.source : true))
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .slice(0, params?.limit ?? 50)
      .map(clone);
  }

  async findById(id: string) {
    return clone(this.snapshots.get(id) ?? null);
  }
}

export class InMemoryMarketSnapshotRepository implements MarketSnapshotRepository {
  constructor(private readonly snapshots = new Map<string, MarketSnapshotRecord>()) {}

  async create(input: MarketSnapshotWrite) {
    const timestamp = now();
    const record: MarketSnapshotRecord = {
      ...input,
      id: input.id ?? createId("msnap"),
      capturedAt: input.capturedAt ?? timestamp,
      createdAt: timestamp
    };

    this.snapshots.set(record.id, record);
    return clone(record);
  }

  async list(params?: { symbol?: string; instrumentId?: string; source?: string; limit?: number }) {
    return [...this.snapshots.values()]
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .filter((item) => (params?.instrumentId ? item.instrumentId === params.instrumentId : true))
      .filter((item) => (params?.source ? item.source === params.source : true))
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .slice(0, params?.limit ?? 100)
      .map(clone);
  }
}

export class InMemoryStrategySetupRepository implements StrategySetupRepository {
  private readonly byIdentity = new Map<string, StrategySetupRecord>();

  async upsertByIdentity(input: StrategySetupWrite) {
    const existing = this.byIdentity.get(input.setupIdentity);
    if (existing) {
      // Historical setups are immutable — return existing row.
      return clone(existing);
    }

    const record: StrategySetupRecord = {
      ...input,
      id: input.id ?? createId("stratsetup"),
      createdAt: now()
    };
    this.byIdentity.set(record.setupIdentity, record);
    return clone(record);
  }

  async findByIdentity(setupIdentity: string) {
    return clone(this.byIdentity.get(setupIdentity) ?? null);
  }

  async list(params?: { strategyId?: string; symbol?: string; limit?: number }) {
    return [...this.byIdentity.values()]
      .filter((item) => (params?.strategyId ? item.strategyId === params.strategyId : true))
      .filter((item) => (params?.symbol ? item.symbol === params.symbol.toUpperCase() : true))
      .sort((a, b) => b.capturedAt.getTime() - a.capturedAt.getTime())
      .slice(0, params?.limit ?? 100)
      .map(clone);
  }
}

export class InMemoryPaperFillRepository implements PaperFillRepository {
  constructor(private readonly fills = new Map<string, PaperFillRecord>()) {}

  async create(input: PaperFillWrite) {
    if ([...this.fills.values()].some((item) => item.fillKey === input.fillKey)) {
      throw new Error(`Duplicate fill key: ${input.fillKey}`);
    }
    const record: PaperFillRecord = {
      ...input,
      id: input.id ?? createId("pfill"),
      createdAt: now()
    };
    this.fills.set(record.id, record);
    return clone(record);
  }

  async findByFillKey(fillKey: string) {
    return clone([...this.fills.values()].find((item) => item.fillKey === fillKey) ?? null);
  }

  async listByOrder(orderId: string) {
    return [...this.fills.values()]
      .filter((item) => item.orderId === orderId)
      .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime())
      .map(clone);
  }
}

export class InMemoryHistoricalCandleRepository implements HistoricalCandleRepository {
  constructor(private readonly byKey = new Map<string, HistoricalCandleRecord>()) {}

  async insertMany(inputs: HistoricalCandleWrite[], options?: { reconcile?: boolean }) {
    let inserted = 0;
    let skipped = 0;
    let updated = 0;
    const fetchedAt = new Date();
    for (const input of inputs) {
      const key = historicalCandleKey(input.instrumentToken, input.interval, input.timestamp);
      const existing = this.byKey.get(key);
      if (existing) {
        if (options?.reconcile) {
          const next: HistoricalCandleRecord = {
            ...existing,
            ...input,
            id: existing.id,
            createdAt: existing.createdAt,
            fetchedAt: input.fetchedAt ?? fetchedAt
          };
          this.byKey.set(key, next);
          updated += 1;
        } else {
          skipped += 1;
        }
        continue;
      }
      const record: HistoricalCandleRecord = {
        ...input,
        id: input.id ?? createId("hcandle"),
        fetchedAt: input.fetchedAt ?? fetchedAt,
        createdAt: now()
      };
      this.byKey.set(key, record);
      inserted += 1;
    }
    return { inserted, skipped, updated };
  }

  async listRange(query: HistoricalCandleRangeQuery) {
    return [...this.byKey.values()]
      .filter((row) => row.instrumentToken === query.instrumentToken && row.interval === query.interval)
      .filter((row) => (query.from ? row.timestamp.getTime() >= query.from.getTime() : true))
      .filter((row) => (query.to ? row.timestamp.getTime() < query.to.getTime() : true))
      .sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime())
      .slice(0, query.limit ?? Number.MAX_SAFE_INTEGER)
      .map(clone);
  }

  async count(query: Omit<HistoricalCandleRangeQuery, "limit">) {
    const rows = await this.listRange({ ...query, limit: Number.MAX_SAFE_INTEGER });
    return rows.length;
  }

  async earliest(instrumentToken: string, interval: HistoricalCandleRecord["interval"]) {
    const rows = await this.listRange({ instrumentToken, interval });
    return rows[0]?.timestamp ?? null;
  }

  async latest(instrumentToken: string, interval: HistoricalCandleRecord["interval"]) {
    const rows = await this.listRange({ instrumentToken, interval });
    return rows[rows.length - 1]?.timestamp ?? null;
  }

  async coverage(params?: {
    instrumentToken?: string;
    interval?: HistoricalCandleRecord["interval"];
    limit?: number;
  }): Promise<HistoricalCandleCoverageRow[]> {
    const groups = new Map<string, HistoricalCandleRecord[]>();
    for (const row of this.byKey.values()) {
      if (params?.instrumentToken && row.instrumentToken !== params.instrumentToken) continue;
      if (params?.interval && row.interval !== params.interval) continue;
      const key = `${row.instrumentToken}|${row.interval}`;
      const list = groups.get(key) ?? [];
      list.push(row);
      groups.set(key, list);
    }
    return [...groups.values()]
      .map((rows) => {
        const sorted = [...rows].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
        return {
          instrumentToken: sorted[0]!.instrumentToken,
          exchange: sorted[0]!.exchange,
          tradingSymbol: sorted[0]!.tradingSymbol,
          interval: sorted[0]!.interval,
          count: sorted.length,
          earliest: sorted[0]!.timestamp,
          latest: sorted[sorted.length - 1]!.timestamp,
          lastFetchedAt: sorted.reduce(
            (max, row) => (row.fetchedAt > max ? row.fetchedAt : max),
            sorted[0]!.fetchedAt
          ),
          sources: [...new Set(sorted.map((row) => String(row.source)))]
        };
      })
      .sort((a, b) => a.tradingSymbol.localeCompare(b.tradingSymbol))
      .slice(0, params?.limit ?? 500);
  }
}

export function createMemoryRepositories(): AppRepositories {
  const repos: AppRepositories = {
    users: new InMemoryUserRepository(),
    instruments: new InMemoryInstrumentRepository(),
    accountSnapshots: new InMemoryAccountSnapshotRepository(),
    scannerSignals: new InMemoryScannerSignalRepository(),
    strategySetups: new InMemoryStrategySetupRepository(),
    historicalCandles: new InMemoryHistoricalCandleRepository(),
    orders: new InMemoryOrderRepository(),
    paperFills: new InMemoryPaperFillRepository(),
    trades: new InMemoryTradeRepository(),
    positions: new InMemoryPositionRepository(),
    journalEntries: new InMemoryJournalEntryRepository(),
    systemLogs: new InMemorySystemLogRepository(),
    riskConfigurations: new InMemoryRiskConfigurationRepository(),
    paperAccounts: new InMemoryPaperAccountRepository(),
    brokerAccountSnapshots: new InMemoryBrokerAccountSnapshotRepository(),
    marketSnapshots: new InMemoryMarketSnapshotRepository(),
    runInTransaction: async <T>(work: (next: AppRepositories) => Promise<T>) => work(repos)
  };

  return repos;
}

function instrumentKey(exchange: string, symbol: string) {
  return `${exchange.toUpperCase()}:${symbol.toUpperCase()}`;
}

function historicalCandleKey(instrumentToken: string, interval: string, timestamp: Date) {
  return `${instrumentToken}|${interval}|${timestamp.toISOString()}`;
}
