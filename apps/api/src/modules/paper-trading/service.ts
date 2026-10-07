/**
 * Persistent paper-trading orchestration (Phase 1B).
 *
 * persistent: Trade / Order / Position / JournalEntry / SystemLog via repositories
 * mock: same service against in-memory repositories (PERSISTENCE_MODE=mock)
 * broker integration: none — never calls Kite placeOrder
 * paper trading: yes — deterministic immediate fills
 * live trading disabled: LIVE tradingMode is rejected
 *
 * Historical replay still uses PaperTradingEngine (isolated in-memory) so CLI
 * backtests do not share API process state.
 */
import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { money } from "../../common/utils/trading-date";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import type { AppRepositories } from "../../db/repositories/contracts";
import { getPersistenceMode, getRepositories } from "../../db/persistence";
import type { OrderRecord, PositionRecord, TradeRecord } from "../../db/domain";
import { AccountStateService } from "../account-state/service";
import { withUserLock } from "../account-state/lock";
import type { AccountRiskContext } from "../risk/types";
import { validateTrade } from "../risk/validator";
import { PaperTradingError } from "./errors";
import {
  buildTickKey,
  calculatePnl,
  calculateRewardToRisk,
  evaluateRangeExit,
  evaluateStopOrTarget,
  toOrderSide,
  type PaperExitReason
} from "./pnl";
import {
  assertOrderCanFill,
  assertPaperTradingMode,
  assertPositionCanClose,
  assertPositionCanUpdate,
  assertTradeCanClose,
  assertTradeCanReceiveTick,
  isDuplicateTick
} from "./state-machine";
import type {
  CreatePaperTradeInput,
  CreatePaperTradeResult,
  PaperTrade,
  PriceRangeTick,
  PriceTick,
  PriceTickResult
} from "./types";

const SOURCE = "paper-trading";

export interface PaperTradeBundle {
  trade: TradeRecord;
  entryOrder: OrderRecord | null;
  exitOrder: OrderRecord | null;
  position: PositionRecord | null;
  view: PaperTrade;
}

export interface ClosePositionInput {
  positionId: string;
  exitPrice?: number;
  timestamp?: string;
  reason?: Extract<PaperExitReason, "MANUAL" | "CANCELLED">;
}

export class PaperTradingService {
  constructor(
    private readonly resolveRepos: () => AppRepositories = getRepositories,
    private readonly accountState = new AccountStateService(resolveRepos)
  ) {}

  private repos() {
    return this.resolveRepos();
  }

  async getAccount() {
    return this.accountState.getAccountView();
  }

  async listAccountSnapshots() {
    return this.accountState.listSnapshots();
  }

  async refreshAccount() {
    return this.accountState.toView(await this.accountState.refreshAccountState());
  }

  async createTrade(input: CreatePaperTradeInput): Promise<CreatePaperTradeResult> {
    const user = await this.ensureUser();
    await this.accountState.initializePaperAccount(user.id);

    return withUserLock(`paper-trade:${user.id}`, async () => {
      return this.createTradeLocked(user.id, input);
    });
  }

  private async createTradeLocked(userId: string, input: CreatePaperTradeInput): Promise<CreatePaperTradeResult> {
    const stopLoss = input.signal.stopLoss;

    return this.repos().runInTransaction(async (repos) => {
      await repos.paperAccounts.lock(userId, "PAPER");
      const riskRow = await repos.riskConfigurations.findByUser(userId, "PAPER");

      if (!riskRow) {
        throw new Error("Paper risk configuration is missing.");
      }

      const state = await this.accountState.deriveState(repos, userId);
      const riskProfile = this.accountState.toRiskProfile(riskRow);
      const currentDayStats = {
        dailyLoss: state.realisedLossesToday,
        tradesTaken: state.tradesToday
      };
      const baseContext = this.toAccountContext(state, 0);

      const seedValidation = validateTrade({ ...input.signal, quantity: 1 }, riskProfile, currentDayStats, baseContext);

      if (!seedValidation.allowed || seedValidation.calculatedQuantity <= 0 || stopLoss === undefined) {
        await this.rejectTrade(repos, userId, input.signal.symbol, seedValidation.rejectionReasons);
        return {
          allowed: false,
          rejectionReasons: seedValidation.rejectionReasons,
          calculatedQuantity: seedValidation.calculatedQuantity,
          maxLoss: seedValidation.maxLoss
        };
      }

      const quantity = seedValidation.calculatedQuantity;
      const newTradeExposure = money(quantity * input.signal.entryPrice);
      const finalValidation = validateTrade(
        { ...input.signal, stopLoss, quantity },
        riskProfile,
        currentDayStats,
        this.toAccountContext(state, newTradeExposure)
      );

      if (!finalValidation.allowed) {
        await this.rejectTrade(repos, userId, input.signal.symbol, finalValidation.rejectionReasons);
        return {
          allowed: false,
          rejectionReasons: finalValidation.rejectionReasons,
          calculatedQuantity: finalValidation.calculatedQuantity,
          maxLoss: finalValidation.maxLoss
        };
      }

      const openedAt = parseTimestamp(input.signal.timestamp);
      const side = toOrderSide(input.signal.side);
      const rewardToRisk = calculateRewardToRisk(input.signal.entryPrice, stopLoss, input.signal.targetPrice, input.signal.side);
      const trade = await repos.trades.create({
        userId,
        strategyId: null,
        scannerSignalId: input.scannerSignalId ?? null,
        instrumentId: null,
        symbol: input.signal.symbol,
        side,
        status: "PENDING",
        tradingMode: "PAPER",
        quantity,
        entryPrice: input.signal.entryPrice,
        stopLoss,
        targetPrice: input.signal.targetPrice,
        exitPrice: null,
        pnl: 0,
        maxLoss: finalValidation.maxLoss,
        rewardToRisk,
        exitReason: null,
        strategyName: input.strategyName,
        explanation: input.aiExplanation,
        openedAt,
        closedAt: null
      });

      let entryOrder = await repos.orders.create({
        userId,
        tradeId: trade.id,
        positionId: null,
        strategyId: null,
        brokerConnectionId: null,
        instrumentId: null,
        brokerOrderId: `paper_entry_${trade.id}`,
        symbol: trade.symbol,
        side,
        status: "CREATED",
        purpose: "ENTRY",
        tradingMode: "PAPER",
        quantity,
        filledQuantity: 0,
        price: input.signal.entryPrice
      });

      assertOrderCanFill(entryOrder.status);
      entryOrder =
        (await repos.orders.update(entryOrder.id, {
          status: "FILLED",
          filledQuantity: quantity
        })) ?? entryOrder;

      const position = await repos.positions.create({
        userId,
        tradeId: trade.id,
        instrumentId: null,
        symbol: trade.symbol,
        side,
        status: "OPEN",
        tradingMode: "PAPER",
        quantity,
        averagePrice: input.signal.entryPrice,
        currentPrice: input.signal.entryPrice,
        stopLoss,
        targetPrice: input.signal.targetPrice,
        unrealizedPnl: 0,
        realizedPnl: 0,
        exitReason: null,
        lastProcessedTickKey: null,
        exitInProgress: false,
        openedAt,
        closedAt: null
      });

      await repos.orders.update(entryOrder.id, { positionId: position.id });

      const openedTrade =
        (await repos.trades.update(trade.id, {
          status: "OPEN"
        })) ?? trade;

      await repos.systemLogs.create({
        userId,
        level: "INFO",
        source: SOURCE,
        message: `Paper trade opened for ${trade.symbol}.`,
        metadata: {
          event: "PAPER_TRADE_CREATED",
          tradeId: openedTrade.id,
          orderId: entryOrder.id,
          positionId: position.id
        }
      });
      await repos.systemLogs.create({
        userId,
        level: "INFO",
        source: SOURCE,
        message: `Paper entry order filled for ${trade.symbol}.`,
        metadata: { event: "PAPER_ORDER_FILLED", orderId: entryOrder.id, tradeId: openedTrade.id }
      });
      await repos.systemLogs.create({
        userId,
        level: "INFO",
        source: SOURCE,
        message: `Paper position opened for ${trade.symbol}.`,
        metadata: { event: "POSITION_OPENED", positionId: position.id, tradeId: openedTrade.id }
      });

      await repos.journalEntries.create({
        authorId: userId,
        tradeId: openedTrade.id,
        type: "TRADE_REVIEW",
        title: `PAPER_TRADE_OPENED ${trade.symbol}`,
        body: input.aiExplanation,
        mood: "Focused",
        tags: ["PAPER_TRADE_OPENED", input.strategyName],
        symbol: trade.symbol
      });

      await repos.systemLogs.create({
        userId,
        level: "INFO",
        source: SOURCE,
        message: `Paper trade risk approved for ${trade.symbol}.`,
        metadata: { event: "TRADE_RISK_APPROVED", tradeId: openedTrade.id, quantity, maxLoss: finalValidation.maxLoss }
      });

      const openedState = await this.accountState.deriveState(repos, userId);
      await this.accountState.persistSnapshot(userId, "PAPER_TRADE_OPENED", openedState, repos);
      await this.accountState.persistSnapshot(userId, "POSITION_OPENED", openedState, repos);

      return {
        allowed: true,
        rejectionReasons: [],
        calculatedQuantity: quantity,
        maxLoss: finalValidation.maxLoss,
        trade: toPaperTrade(openedTrade, position),
        position,
        entryOrder
      };
    });
  }

  async listTrades(params?: { status?: TradeRecord["status"]; symbol?: string; from?: Date; to?: Date }) {
    const user = await this.ensureUser();
    const trades = await this.repos().trades.listByUser(user.id, {
      tradingMode: "PAPER",
      ...params
    });

    return Promise.all(trades.map(async (trade) => (await this.toBundle(trade)).view));
  }

  async getTrade(tradeId: string) {
    const trade = await this.repos().trades.findById(tradeId);

    if (!trade || trade.tradingMode !== "PAPER") {
      return null;
    }

    return (await this.toBundle(trade)).view;
  }

  async getTradeBundle(tradeId: string) {
    const trade = await this.repos().trades.findById(tradeId);

    if (!trade || trade.tradingMode !== "PAPER") {
      return null;
    }

    return this.toBundle(trade);
  }

  async listPositions(params?: { status?: PositionRecord["status"]; symbol?: string; from?: Date; to?: Date }) {
    const user = await this.ensureUser();

    return this.repos().positions.listByUser(user.id, { tradingMode: "PAPER", ...params });
  }

  async listOrders(params?: { symbol?: string; status?: OrderRecord["status"] }) {
    const user = await this.ensureUser();
    return this.repos().orders.listByUser(user.id, { tradingMode: "PAPER", ...params });
  }

  async getOrder(orderId: string) {
    const order = await this.repos().orders.findById(orderId);
    if (!order || order.tradingMode !== "PAPER") {
      return null;
    }
    return order;
  }

  async listFills(orderId: string) {
    const order = await this.getOrder(orderId);
    if (!order) {
      return [];
    }
    return this.repos().paperFills.listByOrder(orderId);
  }

  async getOpenPositions() {
    return this.listPositions({ status: "OPEN" });
  }

  async getPosition(positionId: string) {
    const position = await this.repos().positions.findById(positionId);

    if (!position || position.tradingMode !== "PAPER") {
      return null;
    }

    return position;
  }

  async updateWithTick(tick: PriceTick): Promise<PriceTickResult> {
    const timestamp = tick.timestamp ?? new Date().toISOString();
    const normalizedTick = {
      symbol: tick.symbol.toUpperCase(),
      price: tick.price,
      timestamp
    };
    const tickKey = buildTickKey(normalizedTick.symbol, normalizedTick.price, normalizedTick.timestamp);
    const openPositions = await this.repos().positions.listOpenBySymbol(normalizedTick.symbol, "PAPER");
    const updatedTrades: PaperTrade[] = [];
    const closedTrades: PaperTrade[] = [];

    for (const position of openPositions) {
      const result = await this.applyTickToPosition(position, normalizedTick.price, timestamp, tickKey, "POINT");

      if (!result) {
        continue;
      }

      updatedTrades.push(result.view);

      if (result.trade.status === "CLOSED") {
        closedTrades.push(result.view);
      }
    }

    return { tick: normalizedTick, updatedTrades, closedTrades };
  }

  async updateWithRangeTick(tick: PriceRangeTick): Promise<PriceTickResult> {
    const timestamp = tick.timestamp ?? new Date().toISOString();
    const normalizedTick = {
      symbol: tick.symbol.toUpperCase(),
      price: tick.close,
      timestamp
    };
    const tickKey = buildTickKey(normalizedTick.symbol, tick.close, timestamp);
    const openPositions = await this.repos().positions.listOpenBySymbol(normalizedTick.symbol, "PAPER");
    const updatedTrades: PaperTrade[] = [];
    const closedTrades: PaperTrade[] = [];

    for (const position of openPositions) {
      const result = await this.applyTickToPosition(position, tick.close, timestamp, tickKey, "RANGE", tick.high, tick.low);

      if (!result) {
        continue;
      }

      updatedTrades.push(result.view);

      if (result.trade.status === "CLOSED") {
        closedTrades.push(result.view);
      }
    }

    return { tick: normalizedTick, updatedTrades, closedTrades };
  }

  async closePosition(input: ClosePositionInput) {
    const position = await this.repos().positions.findById(input.positionId);

    if (!position) {
      throw new PaperTradingError("NOT_FOUND", "Paper position not found.");
    }

    assertPaperTradingMode(position.tradingMode);
    assertPositionCanClose(position.status, position.exitInProgress);

    const exitPrice = input.exitPrice ?? position.currentPrice ?? position.averagePrice;
    const timestamp = input.timestamp ?? new Date().toISOString();

    if (exitPrice == null) {
      throw new PaperTradingError("MISSING_EXIT_PRICE", "An exit price is required to close this paper position.");
    }

    return this.closeOpenPosition(position, exitPrice, input.reason ?? "MANUAL", timestamp, `manual|${position.id}|${timestamp}`);
  }

  async cancelTrade(tradeId: string, timestamp = new Date().toISOString()) {
    const trade = await this.repos().trades.findById(tradeId);

    if (!trade || trade.tradingMode !== "PAPER") {
      return null;
    }

    if (trade.status !== "OPEN") {
      return null;
    }

    const position = await this.repos().positions.findByTradeId(trade.id);

    if (!position) {
      return null;
    }

    const closed = await this.closeOpenPosition(
      position,
      position.currentPrice ?? position.averagePrice,
      "CANCELLED",
      timestamp,
      `cancel|${position.id}|${timestamp}`
    );

    return toPaperTrade(closed.trade, closed.position);
  }

  getSummary(): ModuleSummary {
    return {
      key: "paper-trading",
      title: "Paper Trading",
      description: "Paper trades persist through risk validation, filled entry orders, open positions, and stop/target exits.",
      status: getPersistenceMode() === "database" ? "Persistent" : "In-memory",
      metrics: [
        { label: "Mode", value: getPersistenceMode() },
        { label: "Live trading", value: "Disabled" }
      ]
    };
  }

  private async applyTickToPosition(
    position: PositionRecord,
    markPrice: number,
    timestamp: string,
    tickKey: string,
    mode: "POINT" | "RANGE",
    high?: number,
    low?: number
  ) {
    const trade = position.tradeId ? await this.repos().trades.findById(position.tradeId) : null;

    if (!trade) {
      return null;
    }

    try {
      assertTradeCanReceiveTick(trade.status);
      assertPositionCanUpdate(position.status, position.exitInProgress);
    } catch (error) {
      if (error instanceof PaperTradingError) {
        return null;
      }

      throw error;
    }

    if (isDuplicateTick(position.lastProcessedTickKey, tickKey)) {
      return this.toBundle(trade);
    }

    if (!position.stopLoss || !position.targetPrice) {
      return null;
    }

    const exit =
      mode === "RANGE" && high != null && low != null
        ? evaluateRangeExit({
            side: position.side,
            stopLoss: position.stopLoss,
            targetPrice: position.targetPrice,
            high,
            low
          })
        : (() => {
            const reason = evaluateStopOrTarget({
              side: position.side,
              stopLoss: position.stopLoss,
              targetPrice: position.targetPrice,
              price: markPrice
            });

            return reason ? { price: markPrice, reason } : null;
          })();

    if (!exit) {
      const unrealizedPnl = calculatePnl(position.side, position.averagePrice, markPrice, position.quantity);
      const updatedPosition = await this.repos().positions.update(position.id, {
        currentPrice: markPrice,
        unrealizedPnl,
        lastProcessedTickKey: tickKey
      });

      return this.toBundle(trade, updatedPosition ?? { ...position, currentPrice: markPrice, unrealizedPnl });
    }

    return this.closeOpenPosition(position, exit.price, exit.reason, timestamp, tickKey);
  }

  private async closeOpenPosition(
    position: PositionRecord,
    exitPrice: number,
    reason: PaperExitReason,
    timestamp: string,
    tickKey: string
  ) {
    const trade = position.tradeId ? await this.repos().trades.findById(position.tradeId) : null;

    if (!trade) {
      throw new PaperTradingError("NOT_FOUND", "Paper trade not found for position.");
    }

    assertPaperTradingMode(position.tradingMode);
    assertTradeCanClose(trade.status);
    assertPositionCanClose(position.status, position.exitInProgress);

    const existingOrders = await this.repos().orders.listByTrade(trade.id);
    const existingExit = existingOrders.find((order) => order.purpose === "EXIT" && order.status === "FILLED");

    if (existingExit || position.status === "CLOSED") {
      throw new PaperTradingError("ALREADY_CLOSED", "This paper position already has a filled exit.");
    }

    const closedAt = parseTimestamp(timestamp);
    const realizedPnl = calculatePnl(position.side, position.averagePrice, exitPrice, position.quantity);
    const exitSide = position.side === "BUY" ? "SELL" : "BUY";
    const eventName =
      reason === "STOP_LOSS" ? "STOP_LOSS_TRIGGERED" : reason === "TARGET" ? "TARGET_TRIGGERED" : "MANUAL_EXIT";
    const journalTag =
      reason === "STOP_LOSS" ? "PAPER_STOP_LOSS" : reason === "TARGET" ? "PAPER_TARGET_REACHED" : "PAPER_MANUAL_EXIT";

    const result = await this.repos().runInTransaction(async (repos) => {
      const locked =
        (await repos.positions.update(position.id, {
          exitInProgress: true,
          lastProcessedTickKey: tickKey
        })) ?? position;

      if (locked.status !== "OPEN") {
        throw new PaperTradingError("ALREADY_CLOSED", "Closed positions cannot be closed again.");
      }

      let exitOrder = await repos.orders.create({
        userId: position.userId,
        tradeId: trade.id,
        positionId: position.id,
        strategyId: null,
        brokerConnectionId: null,
        instrumentId: null,
        brokerOrderId: `paper_exit_${position.id}`,
        symbol: position.symbol,
        side: exitSide,
        status: "CREATED",
        purpose: "EXIT",
        tradingMode: "PAPER",
        quantity: position.quantity,
        filledQuantity: 0,
        price: exitPrice
      });

      assertOrderCanFill(exitOrder.status);
      exitOrder =
        (await repos.orders.update(exitOrder.id, {
          status: "FILLED",
          filledQuantity: position.quantity
        })) ?? exitOrder;

      const closedPosition =
        (await repos.positions.update(position.id, {
          status: "CLOSED",
          currentPrice: exitPrice,
          unrealizedPnl: 0,
          realizedPnl,
          exitReason: reason,
          exitInProgress: false,
          closedAt,
          lastProcessedTickKey: tickKey
        })) ?? locked;

      const closedTrade =
        (await repos.trades.update(trade.id, {
          status: reason === "CANCELLED" ? "CANCELLED" : "CLOSED",
          exitPrice,
          pnl: realizedPnl,
          exitReason: reason,
          closedAt
        })) ?? trade;

      await repos.systemLogs.create({
        userId: position.userId,
        level: "INFO",
        source: SOURCE,
        message: `Paper position closed for ${position.symbol} (${reason}).`,
        metadata: {
          event: "POSITION_CLOSED",
          trigger: eventName,
          positionId: position.id,
          tradeId: trade.id,
          orderId: exitOrder.id,
          realizedPnl
        }
      });

      await repos.journalEntries.create({
        authorId: position.userId,
        tradeId: trade.id,
        type: "TRADE_REVIEW",
        title: `${journalTag} ${position.symbol}`,
        body: `Paper ${reason.toLowerCase()} exit at ${exitPrice} with realised PnL ${realizedPnl}.`,
        mood: reason === "TARGET" ? "Patient" : "Disciplined",
        tags: [journalTag],
        symbol: position.symbol
      });

      return {
        trade: closedTrade,
        position: closedPosition,
        exitOrder,
        view: toPaperTrade(closedTrade, closedPosition)
      };
    });

    const closedState = await this.accountState.deriveState(this.repos(), result.position.userId);
    await this.accountState.persistSnapshot(result.position.userId, "PAPER_TRADE_CLOSED", closedState);
    await this.accountState.persistSnapshot(result.position.userId, "POSITION_CLOSED", closedState);

    return result;
  }

  private async toBundle(trade: TradeRecord, positionOverride?: PositionRecord | null): Promise<PaperTradeBundle> {
    const orders = await this.repos().orders.listByTrade(trade.id);
    const position = positionOverride ?? (await this.repos().positions.findByTradeId(trade.id));

    return {
      trade,
      entryOrder: orders.find((order) => order.purpose === "ENTRY") ?? null,
      exitOrder: orders.find((order) => order.purpose === "EXIT") ?? null,
      position,
      view: toPaperTrade(trade, position)
    };
  }

  private async ensureUser() {
    return this.repos().users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  }

  private toAccountContext(state: { availableCapital: number; openExposure: number; openPositions: number; dayPnl: number; dailyLossLimit: number; status: "ACTIVE" | "TRADING_BLOCKED_DAILY_LOSS"; maxOpenPositions: number; maxCapitalExposure: number }, newTradeExposure: number): AccountRiskContext {
    return {
      availableCapital: state.availableCapital,
      openExposure: state.openExposure,
      openPositions: state.openPositions,
      dayPnl: state.dayPnl,
      dailyLossLimit: state.dailyLossLimit,
      newTradeExposure,
      status: state.status,
      maxOpenPositions: state.maxOpenPositions,
      maxCapitalExposure: state.maxCapitalExposure
    };
  }

  private async rejectTrade(
    repos: AppRepositories,
    userId: string,
    symbol: string,
    reasons: { code: string; message: string }[]
  ) {
    const primary = reasons[0]?.code ?? "TRADE_RISK_REJECTED";
    const event =
      primary === "MAX_OPEN_POSITIONS_REACHED" ||
      primary === "MAX_CAPITAL_EXPOSURE_EXCEEDED" ||
      primary === "MAX_TRADES_REACHED" ||
      primary === "TRADING_BLOCKED_DAILY_LOSS" ||
      primary === "DAILY_LOSS_LIMIT_REACHED"
        ? primary
        : "TRADE_RISK_REJECTED";

    await repos.systemLogs.create({
      userId,
      level: "WARN",
      source: SOURCE,
      message: `Paper trade rejected for ${symbol}.`,
      metadata: { event, reasons }
    });
  }

  private async log(
    userId: string,
    level: "INFO" | "WARN" | "SAFE",
    event: string,
    message: string,
    metadata: Record<string, unknown>
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

export function toPaperTrade(trade: TradeRecord, position?: PositionRecord | null): PaperTrade {
  const lastPrice = position?.currentPrice ?? trade.exitPrice ?? trade.entryPrice;
  const pnl = position?.status === "OPEN" ? position.unrealizedPnl : trade.pnl;

  return {
    id: trade.id,
    symbol: trade.symbol,
    side: trade.side === "SELL" ? "SHORT" : "BUY",
    quantity: trade.quantity,
    entryPrice: trade.entryPrice,
    stopLoss: trade.stopLoss ?? 0,
    targetPrice: trade.targetPrice ?? 0,
    lastPrice: lastPrice ?? trade.entryPrice,
    status: trade.status === "CANCELLED" ? "CANCELLED" : trade.status === "CLOSED" ? "CLOSED" : "OPEN",
    openedAt: (trade.openedAt ?? trade.createdAt).toISOString(),
    updatedAt: trade.updatedAt.toISOString(),
    closedAt: trade.closedAt?.toISOString(),
    exitPrice: trade.exitPrice ?? undefined,
    exitReason: (trade.exitReason as PaperTrade["exitReason"]) ?? undefined,
    pnl,
    maxLoss: trade.maxLoss ?? 0,
    aiExplanation: trade.explanation ?? "",
    strategyName: trade.strategyName ?? ""
  };
}

function parseTimestamp(value: string) {
  const iso = new Date(value);

  if (!Number.isNaN(iso.getTime()) && value.includes("T")) {
    return iso;
  }

  return new Date();
}

export const paperTradingService = new PaperTradingService();
