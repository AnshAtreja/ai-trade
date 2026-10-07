/**
 * Prisma repository implementations (PERSISTENCE_MODE=database).
 * persistent: yes
 * mock: unused
 * broker integration: BrokerConnection metadata only; tokens stay in BrokerCredentialStore
 * paper trading: Order/Trade/Position rows are written as PAPER by services
 * live trading disabled: this layer does not call any broker placeOrder API
 */
import type { Prisma, PrismaClient } from "@prisma/client";
import type {
  AccountSnapshotRecord,
  BrokerAccountSnapshotRecord,
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
  TradeRecord,
  HistoricalCandleRecord
} from "../domain";
import { toNumber, toNumberOrNull } from "../mappers";
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

type DbClient = PrismaClient | Prisma.TransactionClient;

function mapUser(row: { id: string; email: string; name: string; createdAt: Date; updatedAt: Date }): PersistedUser {
  return row;
}

function mapInstrument(row: Prisma.InstrumentGetPayload<object>): InstrumentRecord {
  return {
    ...row,
    tickSize: toNumber(row.tickSize),
    strike: toNumberOrNull(row.strike)
  };
}

function mapAccountSnapshot(row: Prisma.AccountSnapshotGetPayload<object>): AccountSnapshotRecord {
  return {
    ...row,
    equity: toNumber(row.equity),
    buyingPower: toNumber(row.buyingPower),
    availableCash: toNumber(row.availableCash),
    usedMargin: toNumber(row.usedMargin),
    realizedPnl: toNumber(row.realizedPnl),
    unrealizedPnl: toNumber(row.unrealizedPnl),
    startingCapital: toNumberOrNull(row.startingCapital),
    dayPnl: toNumberOrNull(row.dayPnl),
    openExposure: toNumberOrNull(row.openExposure),
    riskUsedToday: toNumberOrNull(row.riskUsedToday)
  };
}

function mapBrokerAccountSnapshot(row: Prisma.BrokerAccountSnapshotGetPayload<object>): BrokerAccountSnapshotRecord {
  return {
    ...row,
    equityNet: toNumber(row.equityNet),
    availableCash: toNumber(row.availableCash),
    usedMargin: toNumber(row.usedMargin),
    realizedPnl: toNumber(row.realizedPnl),
    unrealizedPnl: toNumber(row.unrealizedPnl),
    dayPnl: toNumber(row.dayPnl),
    state: row.state
  };
}

function mapPaperAccount(row: Prisma.PaperAccountGetPayload<object>): PaperAccountRecord {
  return {
    ...row,
    startingCapital: toNumber(row.startingCapital)
  };
}

function mapScannerSignal(row: Prisma.ScannerSignalGetPayload<object>): ScannerSignalRecord {
  return {
    ...row,
    entryTrigger: toNumberOrNull(row.entryTrigger),
    stopLoss: toNumberOrNull(row.stopLoss),
    target: toNumberOrNull(row.target),
    riskAmount: toNumberOrNull(row.riskAmount)
  };
}

function mapOrder(row: Prisma.OrderGetPayload<object>): OrderRecord {
  return {
    ...row,
    price: toNumberOrNull(row.price),
    limitPrice: toNumberOrNull(row.limitPrice),
    averageFillPrice: toNumberOrNull(row.averageFillPrice),
    executionProvenance: (row.executionProvenance as Record<string, unknown> | null) ?? null
  };
}

function mapTrade(row: Prisma.TradeGetPayload<object>): TradeRecord {
  return {
    ...row,
    entryPrice: toNumber(row.entryPrice),
    stopLoss: toNumberOrNull(row.stopLoss),
    targetPrice: toNumberOrNull(row.targetPrice),
    exitPrice: toNumberOrNull(row.exitPrice),
    pnl: toNumber(row.pnl),
    maxLoss: toNumberOrNull(row.maxLoss),
    rewardToRisk: toNumberOrNull(row.rewardToRisk),
    grossPnl: toNumberOrNull(row.grossPnl),
    charges: toNumberOrNull(row.charges)
  };
}

function mapPosition(row: Prisma.PositionGetPayload<object>): PositionRecord {
  return {
    ...row,
    averagePrice: toNumber(row.averagePrice),
    currentPrice: toNumberOrNull(row.currentPrice),
    stopLoss: toNumberOrNull(row.stopLoss),
    targetPrice: toNumberOrNull(row.targetPrice),
    unrealizedPnl: toNumber(row.unrealizedPnl),
    realizedPnl: toNumber(row.realizedPnl),
    originalQuantity: row.originalQuantity
  };
}

function mapRiskConfiguration(row: Prisma.RiskConfigurationGetPayload<object>): RiskConfigurationRecord {
  return {
    ...row,
    capital: toNumber(row.capital),
    maxRiskPerTradePercent: toNumber(row.maxRiskPerTradePercent),
    maxDailyLossPercent: toNumber(row.maxDailyLossPercent),
    maxPositionSize: toNumber(row.maxPositionSize),
    maxCapitalExposure: toNumber(row.maxCapitalExposure)
  };
}

function mapJournal(row: Prisma.JournalEntryGetPayload<object>): JournalEntryRecord {
  return row;
}

function mapSystemLog(row: Prisma.SystemLogGetPayload<object>): SystemLogRecord {
  return {
    ...row,
    metadata: (row.metadata as Record<string, unknown> | null) ?? null
  };
}

export class PrismaUserRepository implements UserRepository {
  constructor(private readonly prisma: DbClient) {}

  async upsertByEmail(input: { email: string; name: string }) {
    const row = await this.prisma.user.upsert({
      where: { email: input.email.toLowerCase() },
      update: { name: input.name },
      create: { email: input.email.toLowerCase(), name: input.name }
    });

    return mapUser(row);
  }

  async findByEmail(email: string) {
    const row = await this.prisma.user.findUnique({ where: { email: email.toLowerCase() } });
    return row ? mapUser(row) : null;
  }

  async findById(id: string) {
    const row = await this.prisma.user.findUnique({ where: { id } });
    return row ? mapUser(row) : null;
  }
}

export class PrismaInstrumentRepository implements InstrumentRepository {
  constructor(private readonly prisma: DbClient) {}

  async upsertByExchangeSymbol(input: InstrumentWrite) {
    const exchange = input.exchange.toUpperCase();
    const symbol = input.symbol.toUpperCase();
    const row = await this.prisma.instrument.upsert({
      where: { exchange_symbol: { exchange, symbol } },
      update: {
        name: input.name,
        instrumentToken: input.instrumentToken,
        exchangeToken: input.exchangeToken ?? null,
        segment: input.segment,
        instrumentType: input.instrumentType ?? null,
        expiry: input.expiry ?? null,
        strike: input.strike ?? null,
        tickSize: input.tickSize,
        lotSize: input.lotSize,
        isActive: input.isActive
      },
      create: {
        symbol,
        exchange,
        name: input.name,
        instrumentToken: input.instrumentToken,
        exchangeToken: input.exchangeToken ?? null,
        segment: input.segment,
        instrumentType: input.instrumentType ?? null,
        expiry: input.expiry ?? null,
        strike: input.strike ?? null,
        tickSize: input.tickSize,
        lotSize: input.lotSize,
        isActive: input.isActive
      }
    });

    return mapInstrument(row);
  }

  async upsertNormalized(input: InstrumentWrite) {
    const exchange = input.exchange.toUpperCase();
    const byToken = input.instrumentToken
      ? await this.prisma.instrument.findFirst({
          where: { exchange, instrumentToken: input.instrumentToken }
        })
      : null;

    if (byToken) {
      const row = await this.prisma.instrument.update({
        where: { id: byToken.id },
        data: {
          symbol: input.symbol.toUpperCase(),
          name: input.name,
          instrumentToken: input.instrumentToken,
          exchangeToken: input.exchangeToken ?? null,
          segment: input.segment,
          instrumentType: input.instrumentType ?? null,
          expiry: input.expiry ?? null,
          strike: input.strike ?? null,
          tickSize: input.tickSize,
          lotSize: input.lotSize,
          isActive: input.isActive
        }
      });
      return mapInstrument(row);
    }

    return this.upsertByExchangeSymbol(input);
  }

  async findByExchangeSymbol(exchange: string, symbol: string) {
    const row = await this.prisma.instrument.findUnique({
      where: { exchange_symbol: { exchange: exchange.toUpperCase(), symbol: symbol.toUpperCase() } }
    });

    return row ? mapInstrument(row) : null;
  }

  async findByInstrumentToken(instrumentToken: string) {
    const row = await this.prisma.instrument.findFirst({
      where: { instrumentToken },
      orderBy: { updatedAt: "desc" }
    });

    return row ? mapInstrument(row) : null;
  }

  async findByExchangeInstrumentToken(exchange: string, instrumentToken: string) {
    const row = await this.prisma.instrument.findFirst({
      where: { exchange: exchange.toUpperCase(), instrumentToken }
    });

    return row ? mapInstrument(row) : null;
  }

  async list(params?: {
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
  }) {
    const rows = await this.prisma.instrument.findMany({
      where: {
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined,
        ...(params?.symbolPrefix ? { symbol: { startsWith: params.symbolPrefix.toUpperCase() } } : {}),
        ...(params?.search
          ? {
              OR: [
                { symbol: { contains: params.search.toUpperCase() } },
                { name: { contains: params.search, mode: "insensitive" } }
              ]
            }
          : {}),
        exchange: params?.exchange ? params.exchange.toUpperCase() : undefined,
        segment: params?.segment,
        instrumentType: params?.instrumentType,
        isActive: params?.isActive,
        expiry: params?.hasExpiry == null ? undefined : params.hasExpiry ? { not: null } : null,
        ...(params?.excludeEtfs
          ? {
              NOT: [
                { name: { contains: "ETF", mode: "insensitive" } },
                { symbol: { contains: "BEES", mode: "insensitive" } }
              ]
            }
          : {})
      },
      orderBy: { symbol: "asc" },
      skip: params?.offset ?? 0,
      take: params?.limit ?? 5000
    });

    return rows.map(mapInstrument);
  }
}

export class PrismaAccountSnapshotRepository implements AccountSnapshotRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: AccountSnapshotWrite) {
    const row = await this.prisma.accountSnapshot.create({
      data: {
        userId: input.userId,
        brokerConnectionId: input.brokerConnectionId,
        tradingMode: input.tradingMode,
        source: input.source ?? "PAPER",
        equity: input.equity,
        buyingPower: input.buyingPower,
        availableCash: input.availableCash,
        usedMargin: input.usedMargin,
        realizedPnl: input.realizedPnl,
        unrealizedPnl: input.unrealizedPnl,
        sessionDate: input.sessionDate ?? null,
        event: input.event ?? null,
        status: input.status ?? "ACTIVE",
        startingCapital: input.startingCapital ?? null,
        dayPnl: input.dayPnl ?? null,
        openExposure: input.openExposure ?? null,
        riskUsedToday: input.riskUsedToday ?? null,
        tradesToday: input.tradesToday ?? null,
        openPositionCount: input.openPositionCount ?? null,
        capturedAt: input.capturedAt
      }
    });

    return mapAccountSnapshot(row);
  }

  async listByUser(
    userId: string,
    params?: { tradingMode?: AccountSnapshotRecord["tradingMode"]; source?: string; limit?: number }
  ) {
    const rows = await this.prisma.accountSnapshot.findMany({
      where: { userId, tradingMode: params?.tradingMode, source: params?.source },
      orderBy: { capturedAt: "desc" },
      take: params?.limit ?? 50
    });

    return rows.map(mapAccountSnapshot);
  }

  async findById(id: string) {
    const row = await this.prisma.accountSnapshot.findUnique({ where: { id } });
    return row ? mapAccountSnapshot(row) : null;
  }

  async findLatest(userId: string, tradingMode: AccountSnapshotRecord["tradingMode"], source?: string) {
    const row = await this.prisma.accountSnapshot.findFirst({
      where: { userId, tradingMode, source },
      orderBy: { capturedAt: "desc" }
    });

    return row ? mapAccountSnapshot(row) : null;
  }
}

export class PrismaScannerSignalRepository implements ScannerSignalRepository {
  constructor(private readonly prisma: DbClient) {}

  async upsertByDedupeKey(input: ScannerSignalWrite) {
    const row = await this.prisma.scannerSignal.upsert({
      where: { dedupeKey: input.dedupeKey },
      update: {
        instrumentId: input.instrumentId,
        symbol: input.symbol.toUpperCase(),
        direction: input.direction,
        score: input.score,
        matchedSignals: input.matchedSignals,
        explanation: input.explanation,
        entryTrigger: input.entryTrigger,
        stopLoss: input.stopLoss,
        target: input.target,
        riskAmount: input.riskAmount,
        riskApproved: input.riskApproved,
        suggestedAction: input.suggestedAction,
        confidenceLabel: input.confidenceLabel,
        tradingMode: input.tradingMode,
        sessionDate: input.sessionDate
      },
      create: {
        userId: input.userId,
        instrumentId: input.instrumentId,
        symbol: input.symbol.toUpperCase(),
        direction: input.direction,
        score: input.score,
        matchedSignals: input.matchedSignals,
        explanation: input.explanation,
        entryTrigger: input.entryTrigger,
        stopLoss: input.stopLoss,
        target: input.target,
        riskAmount: input.riskAmount,
        riskApproved: input.riskApproved,
        suggestedAction: input.suggestedAction,
        confidenceLabel: input.confidenceLabel,
        tradingMode: input.tradingMode,
        sessionDate: input.sessionDate,
        dedupeKey: input.dedupeKey
      }
    });

    return mapScannerSignal(row);
  }

  async findByDedupeKey(dedupeKey: string) {
    const row = await this.prisma.scannerSignal.findUnique({ where: { dedupeKey } });
    return row ? mapScannerSignal(row) : null;
  }

  async findById(id: string) {
    const row = await this.prisma.scannerSignal.findUnique({ where: { id } });
    return row ? mapScannerSignal(row) : null;
  }

  async listByUser(
    userId: string,
    params?: { symbol?: string; tradingMode?: ScannerSignalRecord["tradingMode"]; sessionDate?: string }
  ) {
    const rows = await this.prisma.scannerSignal.findMany({
      where: {
        userId,
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined,
        tradingMode: params?.tradingMode,
        sessionDate: params?.sessionDate
      },
      orderBy: [{ updatedAt: "desc" }, { score: "desc" }]
    });

    return rows.map(mapScannerSignal);
  }
}

export class PrismaOrderRepository implements OrderRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: OrderWrite) {
    const row = await this.prisma.order.create({
      data: {
        userId: input.userId,
        tradeId: input.tradeId,
        positionId: input.positionId,
        strategyId: input.strategyId,
        brokerConnectionId: input.brokerConnectionId,
        instrumentId: input.instrumentId,
        brokerOrderId: input.brokerOrderId,
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        status: input.status,
        tradingMode: input.tradingMode,
        quantity: input.quantity,
        filledQuantity: input.filledQuantity,
        price: input.price,
        purpose: input.purpose
      }
    });

    return mapOrder(row);
  }

  async update(id: string, patch: Partial<OrderWrite>) {
    try {
      const {
        userId: _userId,
        tradeId,
        positionId,
        strategyId,
        brokerConnectionId,
        instrumentId,
        ...scalar
      } = patch;
      const row = await this.prisma.order.update({
        where: { id },
        data: {
          ...scalar,
          symbol: patch.symbol ? patch.symbol.toUpperCase() : undefined,
          trade: tradeId === undefined ? undefined : tradeId ? { connect: { id: tradeId } } : { disconnect: true },
          position: positionId === undefined ? undefined : positionId ? { connect: { id: positionId } } : { disconnect: true },
          strategy: strategyId === undefined ? undefined : strategyId ? { connect: { id: strategyId } } : { disconnect: true },
          brokerConnection:
            brokerConnectionId === undefined
              ? undefined
              : brokerConnectionId
                ? { connect: { id: brokerConnectionId } }
                : { disconnect: true },
          instrument:
            instrumentId === undefined ? undefined : instrumentId ? { connect: { id: instrumentId } } : { disconnect: true },
          executionProvenance: (patch.executionProvenance as Prisma.InputJsonValue) ?? undefined
        }
      });

      return mapOrder(row);
    } catch {
      return null;
    }
  }

  async findById(id: string) {
    const row = await this.prisma.order.findUnique({ where: { id } });
    return row ? mapOrder(row) : null;
  }

  async findByBrokerOrderId(brokerOrderId: string) {
    const row = await this.prisma.order.findUnique({ where: { brokerOrderId } });
    return row ? mapOrder(row) : null;
  }

  async listByUser(
    userId: string,
    params?: { symbol?: string; status?: OrderRecord["status"]; tradingMode?: OrderRecord["tradingMode"] }
  ) {
    const rows = await this.prisma.order.findMany({
      where: {
        userId,
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined,
        status: params?.status,
        tradingMode: params?.tradingMode
      },
      orderBy: { createdAt: "desc" }
    });

    return rows.map(mapOrder);
  }

  async listByTrade(tradeId: string) {
    const rows = await this.prisma.order.findMany({
      where: { tradeId },
      orderBy: { createdAt: "asc" }
    });

    return rows.map(mapOrder);
  }

  async findByIdempotencyKey(idempotencyKey: string) {
    const row = await this.prisma.order.findUnique({ where: { idempotencyKey } });
    return row ? mapOrder(row) : null;
  }

  async findByClientOrderId(clientOrderId: string) {
    const row = await this.prisma.order.findUnique({ where: { clientOrderId } });
    return row ? mapOrder(row) : null;
  }

  async listWorking(userId: string, tradingMode: OrderRecord["tradingMode"] = "PAPER") {
    const rows = await this.prisma.order.findMany({
      where: {
        userId,
        tradingMode,
        status: { in: ["CREATED", "SUBMITTED", "OPEN", "PARTIALLY_FILLED"] }
      },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapOrder);
  }
}

function mapPaperFill(row: Prisma.PaperFillGetPayload<object>): PaperFillRecord {
  return {
    id: row.id,
    orderId: row.orderId,
    userId: row.userId,
    quantity: row.quantity,
    price: toNumber(row.price),
    fillKey: row.fillKey,
    marketTimestamp: row.marketTimestamp,
    receivedAt: row.receivedAt,
    referenceLtp: toNumberOrNull(row.referenceLtp),
    referenceBid: toNumberOrNull(row.referenceBid),
    referenceAsk: toNumberOrNull(row.referenceAsk),
    referenceBidQty: toNumberOrNull(row.referenceBidQty),
    referenceAskQty: toNumberOrNull(row.referenceAskQty),
    slippageAmount: toNumberOrNull(row.slippageAmount),
    provenance: (row.provenance as Record<string, unknown> | null) ?? null,
    createdAt: row.createdAt
  };
}

export class PrismaPaperFillRepository implements PaperFillRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: PaperFillWrite) {
    const row = await this.prisma.paperFill.create({
      data: {
        id: input.id,
        orderId: input.orderId,
        userId: input.userId,
        quantity: input.quantity,
        price: input.price,
        fillKey: input.fillKey,
        marketTimestamp: input.marketTimestamp,
        receivedAt: input.receivedAt,
        referenceLtp: input.referenceLtp,
        referenceBid: input.referenceBid,
        referenceAsk: input.referenceAsk,
        referenceBidQty: input.referenceBidQty,
        referenceAskQty: input.referenceAskQty,
        slippageAmount: input.slippageAmount,
        provenance: (input.provenance as Prisma.InputJsonValue) ?? undefined
      }
    });
    return mapPaperFill(row);
  }

  async findByFillKey(fillKey: string) {
    const row = await this.prisma.paperFill.findUnique({ where: { fillKey } });
    return row ? mapPaperFill(row) : null;
  }

  async listByOrder(orderId: string) {
    const rows = await this.prisma.paperFill.findMany({
      where: { orderId },
      orderBy: { createdAt: "asc" }
    });
    return rows.map(mapPaperFill);
  }
}

export class PrismaTradeRepository implements TradeRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: TradeWrite) {
    const row = await this.prisma.trade.create({
      data: {
        userId: input.userId,
        strategyId: input.strategyId,
        scannerSignalId: input.scannerSignalId,
        instrumentId: input.instrumentId,
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        status: input.status,
        tradingMode: input.tradingMode,
        quantity: input.quantity,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        targetPrice: input.targetPrice,
        exitPrice: input.exitPrice,
        pnl: input.pnl,
        maxLoss: input.maxLoss,
        rewardToRisk: input.rewardToRisk,
        exitReason: input.exitReason,
        strategyName: input.strategyName,
        explanation: input.explanation,
        grossPnl: input.grossPnl,
        charges: input.charges,
        strategySetupId: input.strategySetupId,
        instrumentToken: input.instrumentToken,
        openedAt: input.openedAt,
        closedAt: input.closedAt
      }
    });

    return mapTrade(row);
  }

  async update(id: string, patch: Partial<TradeWrite>) {
    try {
      const row = await this.prisma.trade.update({
        where: { id },
        data: {
          ...patch,
          symbol: patch.symbol ? patch.symbol.toUpperCase() : undefined
        }
      });

      return mapTrade(row);
    } catch {
      return null;
    }
  }

  async findById(id: string) {
    const row = await this.prisma.trade.findUnique({ where: { id } });
    return row ? mapTrade(row) : null;
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
    const rows = await this.prisma.trade.findMany({
      where: {
        userId,
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined,
        status: params?.status,
        tradingMode: params?.tradingMode,
        strategyId: params?.strategyId,
        createdAt: params?.from || params?.to ? { gte: params?.from, lte: params?.to } : undefined
      },
      orderBy: { createdAt: "desc" }
    });

    return rows.map(mapTrade);
  }
}

export class PrismaPositionRepository implements PositionRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: PositionWrite) {
    const row = await this.prisma.position.create({
      data: {
        userId: input.userId,
        tradeId: input.tradeId,
        instrumentId: input.instrumentId,
        symbol: input.symbol.toUpperCase(),
        side: input.side,
        status: input.status,
        tradingMode: input.tradingMode,
        quantity: input.quantity,
        originalQuantity: input.originalQuantity ?? input.quantity,
        averagePrice: input.averagePrice,
        currentPrice: input.currentPrice,
        stopLoss: input.stopLoss,
        targetPrice: input.targetPrice,
        unrealizedPnl: input.unrealizedPnl,
        realizedPnl: input.realizedPnl,
        exitReason: input.exitReason,
        instrumentToken: input.instrumentToken,
        lastProcessedTickKey: input.lastProcessedTickKey,
        exitInProgress: input.exitInProgress,
        openedAt: input.openedAt,
        closedAt: input.closedAt
      }
    });

    return mapPosition(row);
  }

  async update(id: string, patch: Partial<PositionWrite>) {
    try {
      const row = await this.prisma.position.update({
        where: { id },
        data: {
          ...patch,
          symbol: patch.symbol ? patch.symbol.toUpperCase() : undefined
        }
      });

      return mapPosition(row);
    } catch {
      return null;
    }
  }

  async findById(id: string) {
    const row = await this.prisma.position.findUnique({ where: { id } });
    return row ? mapPosition(row) : null;
  }

  async findByTradeId(tradeId: string) {
    const row = await this.prisma.position.findFirst({ where: { tradeId } });
    return row ? mapPosition(row) : null;
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
    const rows = await this.prisma.position.findMany({
      where: {
        userId,
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined,
        status: params?.status,
        tradingMode: params?.tradingMode,
        createdAt: params?.from || params?.to ? { gte: params?.from, lte: params?.to } : undefined
      },
      orderBy: { createdAt: "desc" }
    });

    return rows.map(mapPosition);
  }

  async listOpenBySymbol(symbol: string, tradingMode?: PositionRecord["tradingMode"]) {
    const rows = await this.prisma.position.findMany({
      where: {
        symbol: symbol.toUpperCase(),
        status: "OPEN",
        tradingMode
      }
    });

    return rows.map(mapPosition);
  }
}

export class PrismaJournalEntryRepository implements JournalEntryRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: JournalEntryWrite) {
    const row = await this.prisma.journalEntry.create({
      data: {
        authorId: input.authorId,
        tradeId: input.tradeId,
        type: input.type,
        title: input.title,
        body: input.body,
        mood: input.mood,
        tags: input.tags,
        symbol: input.symbol
      }
    });

    return mapJournal(row);
  }

  async findById(id: string) {
    const row = await this.prisma.journalEntry.findUnique({ where: { id } });
    return row ? mapJournal(row) : null;
  }

  async listByAuthor(authorId: string, params?: { symbol?: string; type?: JournalEntryRecord["type"] }) {
    const rows = await this.prisma.journalEntry.findMany({
      where: { authorId, symbol: params?.symbol, type: params?.type },
      orderBy: { createdAt: "desc" }
    });

    return rows.map(mapJournal);
  }
}

export class PrismaSystemLogRepository implements SystemLogRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: SystemLogWrite) {
    const row = await this.prisma.systemLog.create({
      data: {
        userId: input.userId,
        level: input.level,
        source: input.source,
        message: input.message,
        metadata: (input.metadata ?? undefined) as Prisma.InputJsonValue | undefined
      }
    });

    return mapSystemLog(row);
  }

  async list(params?: { userId?: string; source?: string; limit?: number }) {
    const rows = await this.prisma.systemLog.findMany({
      where: { userId: params?.userId, source: params?.source },
      orderBy: { createdAt: "desc" },
      take: params?.limit ?? 100
    });

    return rows.map(mapSystemLog);
  }
}

export class PrismaRiskConfigurationRepository implements RiskConfigurationRepository {
  constructor(private readonly prisma: DbClient) {}

  async upsertForUser(input: RiskConfigurationWrite) {
    const row = await this.prisma.riskConfiguration.upsert({
      where: {
        userId_tradingMode: {
          userId: input.userId,
          tradingMode: input.tradingMode
        }
      },
      update: {
        capital: input.capital,
        maxRiskPerTradePercent: input.maxRiskPerTradePercent,
        maxDailyLossPercent: input.maxDailyLossPercent,
        maxTradesPerDay: input.maxTradesPerDay,
        maxPositionSize: input.maxPositionSize,
        maxOpenPositions: input.maxOpenPositions ?? 5,
        maxCapitalExposure: input.maxCapitalExposure ?? 100000,
        allowShortSelling: input.allowShortSelling,
        tradeStartTime: input.tradeStartTime,
        tradeEndTime: input.tradeEndTime
      },
      create: {
        userId: input.userId,
        tradingMode: input.tradingMode,
        capital: input.capital,
        maxRiskPerTradePercent: input.maxRiskPerTradePercent,
        maxDailyLossPercent: input.maxDailyLossPercent,
        maxTradesPerDay: input.maxTradesPerDay,
        maxPositionSize: input.maxPositionSize,
        maxOpenPositions: input.maxOpenPositions ?? 5,
        maxCapitalExposure: input.maxCapitalExposure ?? 100000,
        allowShortSelling: input.allowShortSelling,
        tradeStartTime: input.tradeStartTime,
        tradeEndTime: input.tradeEndTime
      }
    });

    return mapRiskConfiguration(row);
  }

  async findByUser(userId: string, tradingMode: RiskConfigurationRecord["tradingMode"]) {
    const row = await this.prisma.riskConfiguration.findUnique({
      where: { userId_tradingMode: { userId, tradingMode } }
    });

    return row ? mapRiskConfiguration(row) : null;
  }
}

export class PrismaPaperAccountRepository implements PaperAccountRepository {
  constructor(private readonly prisma: DbClient) {}

  async findByUser(userId: string, tradingMode: PaperAccountRecord["tradingMode"]) {
    const row = await this.prisma.paperAccount.findUnique({
      where: { userId_tradingMode: { userId, tradingMode } }
    });

    return row ? mapPaperAccount(row) : null;
  }

  async create(input: PaperAccountWrite) {
    const row = await this.prisma.paperAccount.create({
      data: {
        userId: input.userId,
        tradingMode: input.tradingMode,
        startingCapital: input.startingCapital,
        initializedAt: input.initializedAt
      }
    });

    return mapPaperAccount(row);
  }

  async touch(id: string) {
    const row = await this.prisma.paperAccount.update({
      where: { id },
      data: { updatedAt: new Date() }
    });

    return mapPaperAccount(row);
  }

  async lock(userId: string, tradingMode: PaperAccountRecord["tradingMode"]) {
    const existing = await this.prisma.paperAccount.findUnique({
      where: { userId_tradingMode: { userId, tradingMode } }
    });

    if (!existing) {
      return;
    }

    await this.prisma.paperAccount.update({
      where: { id: existing.id },
      data: { startingCapital: existing.startingCapital }
    });
  }
}

export class PrismaBrokerAccountSnapshotRepository implements BrokerAccountSnapshotRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: BrokerAccountSnapshotWrite) {
    const row = await this.prisma.brokerAccountSnapshot.create({
      data: {
        userId: input.userId,
        source: input.source,
        tradingMode: input.tradingMode,
        event: input.event,
        refreshStatus: input.refreshStatus,
        equityNet: input.equityNet,
        availableCash: input.availableCash,
        usedMargin: input.usedMargin,
        realizedPnl: input.realizedPnl,
        unrealizedPnl: input.unrealizedPnl,
        dayPnl: input.dayPnl,
        positionCount: input.positionCount,
        orderCount: input.orderCount,
        holdingCount: input.holdingCount,
        state: input.state as Prisma.InputJsonValue,
        capturedAt: input.capturedAt
      }
    });

    return mapBrokerAccountSnapshot(row);
  }

  async findLatest(userId: string, source?: string) {
    const row = await this.prisma.brokerAccountSnapshot.findFirst({
      where: { userId, source },
      orderBy: { capturedAt: "desc" }
    });

    return row ? mapBrokerAccountSnapshot(row) : null;
  }

  async listByUser(userId: string, params?: { source?: string; limit?: number }) {
    const rows = await this.prisma.brokerAccountSnapshot.findMany({
      where: { userId, source: params?.source },
      orderBy: { capturedAt: "desc" },
      take: params?.limit ?? 50
    });

    return rows.map(mapBrokerAccountSnapshot);
  }

  async findById(id: string) {
    const row = await this.prisma.brokerAccountSnapshot.findUnique({ where: { id } });
    return row ? mapBrokerAccountSnapshot(row) : null;
  }
}

function mapMarketSnapshot(row: Prisma.MarketSnapshotGetPayload<object>): MarketSnapshotRecord {
  return {
    ...row,
    lastPrice: toNumber(row.lastPrice),
    openPrice: toNumberOrNull(row.openPrice),
    highPrice: toNumberOrNull(row.highPrice),
    lowPrice: toNumberOrNull(row.lowPrice),
    closePrice: toNumberOrNull(row.closePrice),
    volume: toNumberOrNull(row.volume),
    averagePrice: toNumberOrNull(row.averagePrice),
    buyQuantity: toNumberOrNull(row.buyQuantity),
    sellQuantity: toNumberOrNull(row.sellQuantity)
  };
}

export class PrismaMarketSnapshotRepository implements MarketSnapshotRepository {
  constructor(private readonly prisma: DbClient) {}

  async create(input: MarketSnapshotWrite) {
    const row = await this.prisma.marketSnapshot.create({
      data: {
        instrumentId: input.instrumentId,
        instrumentToken: input.instrumentToken,
        symbol: input.symbol.toUpperCase(),
        exchange: input.exchange,
        source: input.source,
        lastPrice: input.lastPrice,
        openPrice: input.openPrice,
        highPrice: input.highPrice,
        lowPrice: input.lowPrice,
        closePrice: input.closePrice,
        volume: input.volume,
        averagePrice: input.averagePrice,
        buyQuantity: input.buyQuantity,
        sellQuantity: input.sellQuantity,
        capturedAt: input.capturedAt
      }
    });

    return mapMarketSnapshot(row);
  }

  async list(params?: { symbol?: string; instrumentId?: string; source?: string; limit?: number }) {
    const rows = await this.prisma.marketSnapshot.findMany({
      where: {
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined,
        instrumentId: params?.instrumentId,
        source: params?.source
      },
      orderBy: { capturedAt: "desc" },
      take: params?.limit ?? 100
    });

    return rows.map(mapMarketSnapshot);
  }
}

function mapStrategySetup(row: Prisma.StrategySetupGetPayload<object>): StrategySetupRecord {
  return {
    id: row.id,
    userId: row.userId,
    setupIdentity: row.setupIdentity,
    strategyId: row.strategyId,
    strategyVersion: row.strategyVersion,
    instrumentId: row.instrumentId,
    instrumentToken: row.instrumentToken,
    symbol: row.symbol,
    exchange: row.exchange,
    direction: row.direction,
    status: row.status,
    confidence: row.confidence,
    confidenceComponents: (row.confidenceComponents as Record<string, number> | null) ?? null,
    entryType: row.entryType,
    entryPrice: toNumberOrNull(row.entryPrice),
    stopLoss: toNumber(row.stopLoss),
    target: toNumber(row.target),
    rewardRisk: toNumber(row.rewardRisk),
    riskPerUnit: toNumberOrNull(row.riskPerUnit),
    conditions: row.conditions,
    reasons: row.reasons,
    invalidation: row.invalidation,
    scannerSignalId: row.scannerSignalId,
    marketDataTimestamp: row.marketDataTimestamp,
    marketSession: row.marketSession,
    capturedAt: row.capturedAt,
    createdAt: row.createdAt
  };
}

export class PrismaStrategySetupRepository implements StrategySetupRepository {
  constructor(private readonly prisma: DbClient) {}

  async upsertByIdentity(input: StrategySetupWrite) {
    const existing = await this.prisma.strategySetup.findUnique({
      where: { setupIdentity: input.setupIdentity }
    });
    if (existing) {
      return mapStrategySetup(existing);
    }

    const row = await this.prisma.strategySetup.create({
      data: {
        id: input.id,
        userId: input.userId,
        setupIdentity: input.setupIdentity,
        strategyId: input.strategyId,
        strategyVersion: input.strategyVersion,
        instrumentId: input.instrumentId,
        instrumentToken: input.instrumentToken,
        symbol: input.symbol,
        exchange: input.exchange,
        direction: input.direction,
        status: input.status,
        confidence: input.confidence,
        confidenceComponents: input.confidenceComponents ?? undefined,
        entryType: input.entryType,
        entryPrice: input.entryPrice,
        stopLoss: input.stopLoss,
        target: input.target,
        rewardRisk: input.rewardRisk,
        riskPerUnit: input.riskPerUnit,
        conditions: input.conditions as Prisma.InputJsonValue,
        reasons: input.reasons,
        invalidation: (input.invalidation as Prisma.InputJsonValue) ?? undefined,
        scannerSignalId: input.scannerSignalId,
        marketDataTimestamp: input.marketDataTimestamp,
        marketSession: input.marketSession,
        capturedAt: input.capturedAt
      }
    });

    return mapStrategySetup(row);
  }

  async findByIdentity(setupIdentity: string) {
    const row = await this.prisma.strategySetup.findUnique({ where: { setupIdentity } });
    return row ? mapStrategySetup(row) : null;
  }

  async list(params?: { strategyId?: string; symbol?: string; limit?: number }) {
    const rows = await this.prisma.strategySetup.findMany({
      where: {
        strategyId: params?.strategyId,
        symbol: params?.symbol ? params.symbol.toUpperCase() : undefined
      },
      orderBy: { capturedAt: "desc" },
      take: params?.limit ?? 100
    });
    return rows.map(mapStrategySetup);
  }
}

function mapHistoricalCandle(row: Prisma.HistoricalCandleGetPayload<object>): HistoricalCandleRecord {
  return {
    id: row.id,
    instrumentId: row.instrumentId,
    instrumentToken: row.instrumentToken,
    exchange: row.exchange,
    tradingSymbol: row.tradingSymbol,
    interval: row.interval as HistoricalCandleRecord["interval"],
    timestamp: row.timestamp,
    open: toNumber(row.open),
    high: toNumber(row.high),
    low: toNumber(row.low),
    close: toNumber(row.close),
    volume: toNumber(row.volume),
    openInterest: toNumberOrNull(row.openInterest),
    source: row.source,
    adjustment: row.adjustment,
    fetchedAt: row.fetchedAt,
    createdAt: row.createdAt
  };
}

export class PrismaHistoricalCandleRepository implements HistoricalCandleRepository {
  constructor(private readonly prisma: DbClient) {}

  async insertMany(inputs: HistoricalCandleWrite[], options?: { reconcile?: boolean }) {
    if (inputs.length === 0) {
      return { inserted: 0, skipped: 0, updated: 0 };
    }

    const fetchedAt = new Date();
    let inserted = 0;
    let skipped = 0;
    let updated = 0;

    if (options?.reconcile) {
      for (const input of inputs) {
        const existing = await this.prisma.historicalCandle.findUnique({
          where: {
            instrumentToken_interval_timestamp: {
              instrumentToken: input.instrumentToken,
              interval: input.interval,
              timestamp: input.timestamp
            }
          }
        });
        if (existing) {
          await this.prisma.historicalCandle.update({
            where: { id: existing.id },
            data: {
              instrumentId: input.instrumentId,
              exchange: input.exchange,
              tradingSymbol: input.tradingSymbol,
              open: input.open,
              high: input.high,
              low: input.low,
              close: input.close,
              volume: input.volume,
              openInterest: input.openInterest,
              source: input.source,
              adjustment: input.adjustment,
              fetchedAt: input.fetchedAt ?? fetchedAt
            }
          });
          updated += 1;
        } else {
          await this.prisma.historicalCandle.create({
            data: {
              id: input.id,
              instrumentId: input.instrumentId,
              instrumentToken: input.instrumentToken,
              exchange: input.exchange,
              tradingSymbol: input.tradingSymbol,
              interval: input.interval,
              timestamp: input.timestamp,
              open: input.open,
              high: input.high,
              low: input.low,
              close: input.close,
              volume: input.volume,
              openInterest: input.openInterest,
              source: input.source,
              adjustment: input.adjustment,
              fetchedAt: input.fetchedAt ?? fetchedAt
            }
          });
          inserted += 1;
        }
      }
      return { inserted, skipped, updated };
    }

    const result = await this.prisma.historicalCandle.createMany({
      data: inputs.map((input) => ({
        ...(input.id ? { id: input.id } : {}),
        instrumentId: input.instrumentId,
        instrumentToken: input.instrumentToken,
        exchange: input.exchange,
        tradingSymbol: input.tradingSymbol,
        interval: input.interval,
        timestamp: input.timestamp,
        open: input.open,
        high: input.high,
        low: input.low,
        close: input.close,
        volume: input.volume,
        openInterest: input.openInterest,
        source: input.source,
        adjustment: input.adjustment,
        fetchedAt: input.fetchedAt ?? fetchedAt
      })),
      skipDuplicates: true
    });
    inserted = result.count;
    skipped = Math.max(0, inputs.length - inserted);
    return { inserted, skipped, updated };
  }

  async listRange(query: HistoricalCandleRangeQuery) {
    const rows = await this.prisma.historicalCandle.findMany({
      where: {
        instrumentToken: query.instrumentToken,
        interval: query.interval,
        timestamp: {
          gte: query.from,
          lt: query.to
        }
      },
      orderBy: { timestamp: "asc" },
      take: query.limit
    });
    return rows.map(mapHistoricalCandle);
  }

  async count(query: Omit<HistoricalCandleRangeQuery, "limit">) {
    return this.prisma.historicalCandle.count({
      where: {
        instrumentToken: query.instrumentToken,
        interval: query.interval,
        timestamp: {
          gte: query.from,
          lt: query.to
        }
      }
    });
  }

  async earliest(instrumentToken: string, interval: HistoricalCandleRecord["interval"]) {
    const row = await this.prisma.historicalCandle.findFirst({
      where: { instrumentToken, interval },
      orderBy: { timestamp: "asc" },
      select: { timestamp: true }
    });
    return row?.timestamp ?? null;
  }

  async latest(instrumentToken: string, interval: HistoricalCandleRecord["interval"]) {
    const row = await this.prisma.historicalCandle.findFirst({
      where: { instrumentToken, interval },
      orderBy: { timestamp: "desc" },
      select: { timestamp: true }
    });
    return row?.timestamp ?? null;
  }

  async coverage(params?: {
    instrumentToken?: string;
    interval?: HistoricalCandleRecord["interval"];
    limit?: number;
  }): Promise<HistoricalCandleCoverageRow[]> {
    const groups = await this.prisma.historicalCandle.groupBy({
      by: ["instrumentToken", "interval", "exchange", "tradingSymbol"],
      where: {
        instrumentToken: params?.instrumentToken,
        interval: params?.interval
      },
      _count: { _all: true },
      _min: { timestamp: true, fetchedAt: true },
      _max: { timestamp: true, fetchedAt: true },
      orderBy: { tradingSymbol: "asc" },
      take: params?.limit ?? 500
    });

    return groups.map((group) => ({
      instrumentToken: group.instrumentToken,
      exchange: group.exchange,
      tradingSymbol: group.tradingSymbol,
      interval: group.interval as HistoricalCandleRecord["interval"],
      count: group._count._all,
      earliest: group._min.timestamp,
      latest: group._max.timestamp,
      lastFetchedAt: group._max.fetchedAt,
      sources: []
    }));
  }
}

export function createPrismaRepositories(prisma: DbClient): AppRepositories {
  const repos: AppRepositories = {
    users: new PrismaUserRepository(prisma),
    instruments: new PrismaInstrumentRepository(prisma),
    accountSnapshots: new PrismaAccountSnapshotRepository(prisma),
    scannerSignals: new PrismaScannerSignalRepository(prisma),
    strategySetups: new PrismaStrategySetupRepository(prisma),
    historicalCandles: new PrismaHistoricalCandleRepository(prisma),
    orders: new PrismaOrderRepository(prisma),
    paperFills: new PrismaPaperFillRepository(prisma),
    trades: new PrismaTradeRepository(prisma),
    positions: new PrismaPositionRepository(prisma),
    journalEntries: new PrismaJournalEntryRepository(prisma),
    systemLogs: new PrismaSystemLogRepository(prisma),
    riskConfigurations: new PrismaRiskConfigurationRepository(prisma),
    paperAccounts: new PrismaPaperAccountRepository(prisma),
    brokerAccountSnapshots: new PrismaBrokerAccountSnapshotRepository(prisma),
    marketSnapshots: new PrismaMarketSnapshotRepository(prisma),
    async runInTransaction<T>(work: (next: AppRepositories) => Promise<T>) {
      if ("$transaction" in prisma) {
        return prisma.$transaction(async (tx) => work(createPrismaRepositories(tx)));
      }

      return work(repos);
    }
  };

  return repos;
}
