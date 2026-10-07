/**
 * PaperExecutionProvider — Phase 7 realistic simulator.
 * Uses live market state + virtual money. Never calls Kite placeOrder/modifyOrder/cancelOrder.
 */
import { getMarketSessionState, isScannerTradingSession } from "../../../common/utils/market-session";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../../db/domain";
import type { AppRepositories } from "../../../db/repositories/contracts";
import { getRepositories } from "../../../db/persistence";
import { createId } from "../../../db/mappers";
import { AccountStateService } from "../../account-state/service";
import { withUserLock } from "../../account-state/lock";
import type { LatestMarketStateStore } from "../../market-data/stream/latest-state-store";
import type { MarketTick } from "../../market-data/stream/types";
import { getMarketStreamService } from "../../market-data/stream/service";
import { validateTrade } from "../../risk/validator";
import { calculatePnl, calculateRewardToRisk } from "../pnl";
import { assertOrderCanFill, assertPaperTradingMode } from "../state-machine";
import { calculatePaperCharges, netPnlFromGross } from "./charges";
import { getPaperExecutionConfig, type PaperExecutionConfig } from "./config";
import { evaluateLiveExit, isPastSquareOff, markPrice } from "./exits";
import { evaluateFill } from "./fill-model";
import {
  toExecutionMarketView,
  type ExecutionRequest,
  type ExecutionResult,
  type ExecutionMarketView
} from "./types";

const SOURCE = "paper-execution";

export interface PaperExecutionProviderDeps {
  resolveRepos?: () => AppRepositories;
  getLatestStore?: () => LatestMarketStateStore;
  config?: Partial<PaperExecutionConfig>;
  now?: () => Date;
  accountState?: AccountStateService;
}

export class PaperExecutionProvider {
  private readonly resolveRepos: () => AppRepositories;
  private readonly getLatestStore: () => LatestMarketStateStore;
  private readonly configOverrides: Partial<PaperExecutionConfig>;
  private readonly now: () => Date;
  private readonly accountState: AccountStateService;
  private attached = false;
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;

  constructor(deps: PaperExecutionProviderDeps = {}) {
    this.resolveRepos = deps.resolveRepos ?? getRepositories;
    this.getLatestStore = deps.getLatestStore ?? (() => getMarketStreamService().store);
    this.configOverrides = deps.config ?? {};
    this.now = deps.now ?? (() => new Date());
    this.accountState = deps.accountState ?? new AccountStateService(this.resolveRepos);
  }

  getConfig() {
    return getPaperExecutionConfig(this.configOverrides);
  }

  getStatus() {
    const config = this.getConfig();
    return {
      provider: "PaperExecutionProvider",
      liveKiteOrders: false,
      autoPaperExecution: config.autoPaperExecution,
      reconcilerRunning: this.timer != null,
      busy: this.busy,
      config: {
        slippagePolicy: config.slippagePolicy,
        liquidityPolicy: config.liquidityPolicy,
        maxLatencyMs: config.maxLatencyMs,
        orderTimeoutMs: config.orderTimeoutMs,
        squareOffTimeIst: config.squareOffTimeIst,
        markPricePolicy: config.markPricePolicy,
        stopGapPolicy: config.stopGapPolicy
      },
      marketSession: getMarketSessionState(this.now())
    };
  }

  ensureAttached() {
    if (this.attached) {
      return;
    }
    this.getLatestStore().onAppliedTick((tick) => {
      void this.onMarketTick(tick);
    });
    this.attached = true;
  }

  startReconciler() {
    if (this.timer) {
      return this.getStatus();
    }
    this.ensureAttached();
    const config = this.getConfig();
    this.timer = setInterval(() => {
      void this.reconcile();
    }, config.reconcileIntervalMs);
    if (typeof this.timer === "object" && this.timer && "unref" in this.timer) {
      this.timer.unref();
    }
    return this.getStatus();
  }

  stopReconciler() {
    if (this.timer) {
      clearInterval(this.timer);
      this.timer = null;
    }
    return this.getStatus();
  }

  async reconcile() {
    if (this.busy) {
      return { skipped: true as const };
    }
    this.busy = true;
    try {
      const user = await this.ensureUser();
      await this.processWorkingOrders(user.id);
      await this.monitorOpenPositions(user.id);
      return { skipped: false as const };
    } finally {
      this.busy = false;
    }
  }

  /**
   * Submit a paper execution request after risk has approved quantity.
   * Idempotent by idempotencyKey / clientOrderId.
   */
  async submit(request: ExecutionRequest): Promise<ExecutionResult> {
    assertPaperTradingMode(request.paperAccountMode);
    return withUserLock(`paper-exec:${request.userId}`, async () => this.submitLocked(request));
  }

  private async submitLocked(request: ExecutionRequest): Promise<ExecutionResult> {
    const repos = this.resolveRepos();
    const existing =
      (await repos.orders.findByIdempotencyKey(request.idempotencyKey)) ??
      (await repos.orders.findByClientOrderId(request.clientOrderId));
    if (existing) {
      return {
        status: "DUPLICATE",
        orderId: existing.id,
        tradeId: existing.tradeId ?? undefined,
        positionId: existing.positionId ?? undefined,
        fills: [],
        message: "Duplicate paper execution request."
      };
    }

    const config = this.getConfig();
    const now = this.now();

    if (config.blockEntriesAfterSquareOff && request.purpose === "ENTRY" && isPastSquareOff(now, config.squareOffTimeIst)) {
      return this.reject(request, "SQUARE_OFF_BLOCK", "New paper entries blocked after square-off time.");
    }

    const session = getMarketSessionState(now);
    if (request.purpose === "ENTRY" && !isScannerTradingSession(session)) {
      return this.reject(request, "MARKET_CLOSED", `Market session ${session} does not allow new paper entries.`);
    }

    if (!(request.quantity > 0) || !Number.isInteger(request.quantity)) {
      return this.reject(request, "INVALID_QUANTITY", "Quantity must be a positive integer.");
    }

    const market = this.resolveMarket(request.instrumentToken, request.symbol, now);
    if (!market || market.stale) {
      return this.reject(request, "STALE_MISSING_MARKET_DATA", "Fresh market data required for paper execution.");
    }

    const executableAt = new Date(now.getTime() + config.maxLatencyMs);
    const trade =
      request.tradeId != null
        ? await repos.trades.findById(request.tradeId)
        : await repos.trades.create({
            userId: request.userId,
            strategyId: null,
            scannerSignalId: request.scannerSignalId,
            instrumentId: request.instrumentId,
            symbol: request.symbol,
            side: request.side,
            status: "PENDING",
            tradingMode: "PAPER",
            quantity: request.quantity,
            entryPrice: request.requestedPrice ?? market.ltp,
            stopLoss: request.stopLoss,
            targetPrice: request.targetPrice,
            exitPrice: null,
            pnl: 0,
            maxLoss: null,
            rewardToRisk:
              request.stopLoss != null && request.targetPrice != null && request.requestedPrice != null
                ? calculateRewardToRisk(
                    request.requestedPrice,
                    request.stopLoss,
                    request.targetPrice,
                    request.side
                  )
                : null,
            exitReason: null,
            strategyName: request.strategyName,
            explanation: request.explanation,
            grossPnl: null,
            charges: null,
            strategySetupId: request.strategySetupId,
            instrumentToken: request.instrumentToken,
            openedAt: null,
            closedAt: null
          });

    if (!trade) {
      return this.reject(request, "INVALID_INSTRUMENT", "Trade could not be created.");
    }

    const order = await repos.orders.create({
      userId: request.userId,
      tradeId: trade.id,
      positionId: request.positionId,
      strategyId: null,
      brokerConnectionId: null,
      instrumentId: request.instrumentId,
      brokerOrderId: `paper_${request.purpose.toLowerCase()}_${createId("req")}`,
      clientOrderId: request.clientOrderId,
      idempotencyKey: request.idempotencyKey,
      symbol: request.symbol,
      side: request.side,
      status: "SUBMITTED",
      purpose: request.purpose,
      tradingMode: "PAPER",
      orderType: request.orderType,
      quantity: request.quantity,
      filledQuantity: 0,
      price: request.requestedPrice,
      limitPrice: request.limitPrice,
      averageFillPrice: null,
      instrumentToken: request.instrumentToken,
      strategySetupId: request.strategySetupId,
      rejectionCode: null,
      rejectionSource: null,
      submittedAt: now,
      firstFillAt: null,
      filledAt: null,
      cancelledAt: null,
      rejectedAt: null,
      expiredAt: null,
      executableAt,
      executionProvenance: {
        signalTimestamp: request.signalTimestamp,
        requestTimestamp: request.requestTimestamp,
        latencyMs: config.maxLatencyMs,
        slippagePolicy: config.slippagePolicy,
        liquidityPolicy: config.liquidityPolicy
      }
    });

    await this.log(repos, request.userId, "ORDER_SUBMITTED", `Paper ${request.purpose} order submitted for ${request.symbol}.`, {
      orderId: order.id,
      tradeId: trade.id
    });

    // Process immediately when latency is 0 (tests / deterministic sync path).
    if (config.maxLatencyMs === 0) {
      return this.processOrder(order.id, now);
    }

    return {
      status: "SUBMITTED",
      orderId: order.id,
      tradeId: trade.id,
      fills: [],
      message: `Paper order submitted; executable after ${config.maxLatencyMs}ms simulated latency.`
    };
  }

  async processOrder(orderId: string, at = this.now()): Promise<ExecutionResult> {
    const repos = this.resolveRepos();
    const order = await repos.orders.findById(orderId);
    if (!order || order.tradingMode !== "PAPER") {
      return { status: "REJECTED", fills: [], message: "Order not found.", rejectionCode: "INVALID_INSTRUMENT", rejectionSource: "PAPER_SIMULATION_REJECTION" };
    }

    if (order.status === "FILLED" || order.status === "CANCELLED" || order.status === "REJECTED" || order.status === "EXPIRED") {
      return { status: order.status === "FILLED" ? "FILLED" : order.status === "EXPIRED" ? "EXPIRED" : order.status === "CANCELLED" ? "CANCELLED" : "REJECTED", orderId: order.id, tradeId: order.tradeId ?? undefined, fills: [], message: `Order already ${order.status}.` };
    }

    const config = this.getConfig();
    if (order.executableAt && order.executableAt.getTime() > at.getTime()) {
      return { status: "SUBMITTED", orderId: order.id, tradeId: order.tradeId ?? undefined, fills: [], message: "Waiting for simulated latency." };
    }

    const submittedAt = order.submittedAt ?? order.createdAt;
    if (at.getTime() - submittedAt.getTime() > config.orderTimeoutMs && order.filledQuantity === 0) {
      await repos.orders.update(order.id, {
        status: "EXPIRED",
        expiredAt: at,
        rejectionCode: "ORDER_TIMEOUT",
        rejectionSource: "PAPER_SIMULATION_REJECTION"
      });
      return { status: "EXPIRED", orderId: order.id, rejectionCode: "ORDER_TIMEOUT", rejectionSource: "PAPER_SIMULATION_REJECTION", fills: [], message: "Paper order expired." };
    }

    const market = this.resolveMarket(order.instrumentToken, order.symbol, at);
    if (!market || market.stale) {
      // Do not fill from stale data; leave working.
      return { status: "SUBMITTED", orderId: order.id, tradeId: order.tradeId ?? undefined, fills: [], message: "Deferred: stale/missing market data." };
    }

    const decision = evaluateFill({
      side: order.side,
      orderType: order.orderType,
      quantity: order.quantity,
      filledQuantity: order.filledQuantity,
      limitPrice: order.limitPrice,
      market,
      config
    });

    if (decision.action === "REJECT") {
      await repos.orders.update(order.id, {
        status: "REJECTED",
        rejectedAt: at,
        rejectionCode: decision.reason.includes("liquidity") ? "INSUFFICIENT_LIQUIDITY" : "STALE_MISSING_MARKET_DATA",
        rejectionSource: "PAPER_SIMULATION_REJECTION"
      });
      return {
        status: "REJECTED",
        orderId: order.id,
        rejectionCode: "INSUFFICIENT_LIQUIDITY",
        rejectionSource: "PAPER_SIMULATION_REJECTION",
        fills: [],
        message: decision.reason
      };
    }

    if (decision.action === "KEEP_OPEN" || decision.fillQuantity <= 0) {
      if (order.status === "SUBMITTED") {
        await repos.orders.update(order.id, { status: "OPEN" });
      }
      return { status: "SUBMITTED", orderId: order.id, tradeId: order.tradeId ?? undefined, fills: [], message: decision.reason };
    }

    if (decision.action === "EXPIRE") {
      await repos.orders.update(order.id, {
        status: "EXPIRED",
        expiredAt: at,
        rejectionCode: "INSUFFICIENT_LIQUIDITY",
        rejectionSource: "PAPER_SIMULATION_REJECTION"
      });
      return { status: "EXPIRED", orderId: order.id, fills: [], message: decision.reason };
    }

    return this.applyFill(order.id, decision.fillQuantity, decision.fillPrice, decision.slippageAmount, decision.referencePrice, market, at, decision.reason);
  }

  private async applyFill(
    orderId: string,
    fillQty: number,
    fillPrice: number,
    slippageAmount: number,
    referencePrice: number,
    market: ExecutionMarketView,
    at: Date,
    reason: string
  ): Promise<ExecutionResult> {
    const repos = this.resolveRepos();
    return repos.runInTransaction(async (tx) => {
      const order = await tx.orders.findById(orderId);
      if (!order) {
        return { status: "REJECTED" as const, fills: [], message: "Order missing." };
      }
      assertOrderCanFill(order.status);

      const fillKey = `${order.id}|${order.filledQuantity}|${fillQty}|${fillPrice}|${market.dataTimestamp}`;
      const existingFill = await tx.paperFills.findByFillKey(fillKey);
      if (existingFill) {
        return {
          status: order.filledQuantity + fillQty >= order.quantity ? ("FILLED" as const) : ("PARTIALLY_FILLED" as const),
          orderId: order.id,
          tradeId: order.tradeId ?? undefined,
          fills: [],
          message: "Duplicate fill ignored."
        };
      }

      const fill = await tx.paperFills.create({
        orderId: order.id,
        userId: order.userId,
        quantity: fillQty,
        price: fillPrice,
        fillKey,
        marketTimestamp: new Date(market.dataTimestamp),
        receivedAt: new Date(market.receivedAt),
        referenceLtp: market.ltp,
        referenceBid: market.bid,
        referenceAsk: market.ask,
        referenceBidQty: market.bidQty,
        referenceAskQty: market.askQty,
        slippageAmount,
        provenance: {
          reason,
          referencePrice,
          source: market.source,
          mode: market.mode,
          usedFallbackSpread: market.usedFallbackSpread,
          spread: market.spread
        }
      });

      const newFilled = order.filledQuantity + fillQty;
      const avg =
        order.averageFillPrice == null
          ? fillPrice
          : (order.averageFillPrice * order.filledQuantity + fillPrice * fillQty) / newFilled;
      const fullyFilled = newFilled >= order.quantity;
      const status = fullyFilled ? "FILLED" : "PARTIALLY_FILLED";

      const updatedOrder =
        (await tx.orders.update(order.id, {
          status,
          filledQuantity: newFilled,
          averageFillPrice: avg,
          firstFillAt: order.firstFillAt ?? at,
          filledAt: fullyFilled ? at : null,
          executionProvenance: {
            ...(order.executionProvenance ?? {}),
            lastFillReason: reason,
            lastMarketTimestamp: market.dataTimestamp
          }
        })) ?? order;

      let positionId = order.positionId;
      let tradeId = order.tradeId;

      if (order.purpose === "ENTRY" && order.tradeId) {
        const trade = await tx.trades.findById(order.tradeId);
        if (trade) {
          let position = await tx.positions.findByTradeId(trade.id);
          if (!position && newFilled > 0) {
            position = await tx.positions.create({
              userId: order.userId,
              tradeId: trade.id,
              instrumentId: order.instrumentId,
              symbol: order.symbol,
              side: order.side,
              status: "OPEN",
              tradingMode: "PAPER",
              quantity: newFilled,
              originalQuantity: newFilled,
              averagePrice: avg,
              currentPrice: fillPrice,
              stopLoss: trade.stopLoss,
              targetPrice: trade.targetPrice,
              unrealizedPnl: 0,
              realizedPnl: 0,
              exitReason: null,
              instrumentToken: order.instrumentToken,
              lastProcessedTickKey: null,
              exitInProgress: false,
              openedAt: at,
              closedAt: null
            });
            await tx.orders.update(order.id, { positionId: position.id });
            await tx.trades.update(trade.id, {
              status: "OPEN",
              entryPrice: avg,
              quantity: newFilled,
              openedAt: at
            });
            positionId = position.id;
            await this.log(tx, order.userId, "POSITION_OPENED", `Paper position opened for ${order.symbol}.`, {
              positionId: position.id,
              tradeId: trade.id
            });
          } else if (position && position.status === "OPEN") {
            const posAvg =
              (position.averagePrice * position.quantity + fillPrice * fillQty) / (position.quantity + fillQty);
            position =
              (await tx.positions.update(position.id, {
                quantity: position.quantity + fillQty,
                originalQuantity: (position.originalQuantity ?? position.quantity) + fillQty,
                averagePrice: posAvg,
                currentPrice: fillPrice
              })) ?? position;
            await tx.trades.update(trade.id, {
              entryPrice: posAvg,
              quantity: position.quantity,
              status: "OPEN"
            });
            positionId = position.id;
          }
        }
      }

      if (order.purpose === "EXIT" && order.positionId) {
        const position = await tx.positions.findById(order.positionId);
        if (position && position.status === "OPEN") {
          const exitSidePnl = calculatePnl(position.side, position.averagePrice, fillPrice, fillQty);
          const remaining = position.quantity - fillQty;
          const charges = calculatePaperCharges({
            turnover: fillPrice * fillQty + position.averagePrice * fillQty,
            config: this.getConfig()
          }).charges;
          const gross = (position.realizedPnl || 0) + exitSidePnl;
          if (remaining <= 0) {
            const net = netPnlFromGross(gross, charges);
            await tx.positions.update(position.id, {
              status: "CLOSED",
              quantity: 0,
              currentPrice: fillPrice,
              unrealizedPnl: 0,
              realizedPnl: net,
              exitReason: (order.executionProvenance?.exitReason as string) ?? "MANUAL",
              exitInProgress: false,
              closedAt: at
            });
            if (position.tradeId) {
              await tx.trades.update(position.tradeId, {
                status: "CLOSED",
                exitPrice: avg,
                pnl: net,
                grossPnl: gross,
                charges,
                exitReason: (order.executionProvenance?.exitReason as string) ?? "MANUAL",
                closedAt: at
              });
            }
            await this.log(tx, order.userId, "POSITION_CLOSED", `Paper position closed for ${order.symbol}.`, {
              positionId: position.id,
              realizedPnl: net
            });
          } else {
            await tx.positions.update(position.id, {
              quantity: remaining,
              currentPrice: fillPrice,
              realizedPnl: gross,
              unrealizedPnl: calculatePnl(position.side, position.averagePrice, fillPrice, remaining),
              exitInProgress: false
            });
            await this.log(tx, order.userId, "POSITION_PARTIALLY_CLOSED", `Partial paper exit for ${order.symbol}.`, {
              positionId: position.id,
              remaining
            });
          }
        }
      }

      await this.log(tx, order.userId, fullyFilled ? "ORDER_FILLED" : "ORDER_PARTIALLY_FILLED", reason, {
        orderId: order.id,
        fillId: fill.id,
        fillQty,
        fillPrice
      });

      const state = await this.accountState.deriveState(tx, order.userId, at);
      await this.accountState.persistSnapshot(order.userId, fullyFilled ? "PAPER_TRADE_OPENED" : "PAPER_ACCOUNT_REFRESHED", state, tx);

      return {
        status: status as "FILLED" | "PARTIALLY_FILLED",
        orderId: updatedOrder.id,
        tradeId: tradeId ?? undefined,
        positionId: positionId ?? undefined,
        fills: [
          {
            quantity: fillQty,
            price: fillPrice,
            referencePrice,
            slippageAmount,
            fillKey,
            market
          }
        ],
        message: reason
      };
    });
  }

  async processWorkingOrders(userId: string) {
    const orders = await this.resolveRepos().orders.listWorking(userId, "PAPER");
    const at = this.now();
    for (const order of orders) {
      if (order.executableAt && order.executableAt.getTime() > at.getTime()) {
        continue;
      }
      await this.processOrder(order.id, at);
    }
  }

  async monitorOpenPositions(userId: string) {
    const config = this.getConfig();
    const repos = this.resolveRepos();
    const positions = await repos.positions.listByUser(userId, { tradingMode: "PAPER", status: "OPEN" });
    const at = this.now();

    for (const position of positions) {
      if (position.exitInProgress) {
        continue;
      }
      const market = this.resolveMarket(position.instrumentToken, position.symbol, at);
      if (!market || market.stale) {
        continue;
      }

      const mark = markPrice(position.side, market, config);
      if (mark != null) {
        const unrealized = calculatePnl(position.side, position.averagePrice, mark, position.quantity);
        await repos.positions.update(position.id, { currentPrice: mark, unrealizedPnl: unrealized });
      }

      let exit = evaluateLiveExit({
        side: position.side,
        stopLoss: position.stopLoss,
        targetPrice: position.targetPrice,
        market,
        config
      });

      if (!exit && isPastSquareOff(at, config.squareOffTimeIst)) {
        exit = {
          reason: "SQUARE_OFF",
          triggerPrice: mark ?? market.ltp,
          exitPrice: mark ?? market.ltp,
          gapAmount: 0,
          ambiguous: false,
          policy: "square_off"
        };
      }

      if (!exit) {
        continue;
      }

      await this.submitExit(position.id, exit.exitPrice, exit.reason, at, market, {
        ...exit
      } as unknown as Record<string, unknown>);
    }
  }

  private async submitExit(
    positionId: string,
    exitPrice: number,
    reason: string,
    at: Date,
    market: ExecutionMarketView,
    meta: Record<string, unknown>
  ) {
    const repos = this.resolveRepos();
    const position = await repos.positions.findById(positionId);
    if (!position || position.status !== "OPEN" || position.quantity <= 0) {
      return;
    }

    const idempotencyKey = `exit|${position.id}|${reason}|${position.quantity}`;
    const existing = await repos.orders.findByIdempotencyKey(idempotencyKey);
    if (existing) {
      if (existing.status === "SUBMITTED" || existing.status === "OPEN" || existing.status === "PARTIALLY_FILLED") {
        await this.processOrder(existing.id, at);
      }
      return;
    }

    await repos.positions.update(position.id, { exitInProgress: true });
    const exitSide = position.side === "BUY" ? "SELL" : "BUY";

    const tradeId = position.tradeId;
    const order = await repos.orders.create({
      userId: position.userId,
      tradeId,
      positionId: position.id,
      strategyId: null,
      brokerConnectionId: null,
      instrumentId: position.instrumentId,
      brokerOrderId: `paper_exit_${createId("x")}`,
      clientOrderId: `client_${idempotencyKey}`,
      idempotencyKey,
      symbol: position.symbol,
      side: exitSide,
      status: "SUBMITTED",
      purpose: "EXIT",
      tradingMode: "PAPER",
      orderType: "MARKET",
      quantity: position.quantity,
      filledQuantity: 0,
      price: exitPrice,
      limitPrice: null,
      averageFillPrice: null,
      instrumentToken: position.instrumentToken,
      strategySetupId: null,
      rejectionCode: null,
      rejectionSource: null,
      submittedAt: at,
      firstFillAt: null,
      filledAt: null,
      cancelledAt: null,
      rejectedAt: null,
      expiredAt: null,
      executableAt: at,
      executionProvenance: {
        exitReason: reason,
        ...meta,
        marketTimestamp: market.dataTimestamp
      }
    });

    await this.log(repos, position.userId, reason === "STOP_LOSS" ? "STOP_TRIGGERED" : reason === "TARGET" ? "TARGET_TRIGGERED" : "SQUARE_OFF_TRIGGERED", `Paper exit triggered (${reason}).`, {
      orderId: order.id,
      positionId: position.id
    });

    await this.processOrder(order.id, at);
  }

  private async onMarketTick(tick: MarketTick) {
    const user = await this.ensureUser();
    const repos = this.resolveRepos();
    const working = await repos.orders.listWorking(user.id, "PAPER");
    for (const order of working) {
      if (order.instrumentToken === tick.instrumentToken || order.symbol === (tick.tradingSymbol ?? "").toUpperCase()) {
        await this.processOrder(order.id, this.now());
      }
    }
    const open = await repos.positions.listOpenBySymbol((tick.tradingSymbol ?? "").toUpperCase(), "PAPER");
    if (open.length > 0) {
      await this.monitorOpenPositions(user.id);
    }
  }

  private resolveMarket(instrumentToken: string | null, symbol: string, now: Date): ExecutionMarketView | null {
    const store = this.getLatestStore();
    let tick: MarketTick | null = null;
    if (instrumentToken) {
      tick = store.getLatest(instrumentToken);
    }
    if (!tick) {
      tick = store.getAll().find((t) => (t.tradingSymbol ?? "").toUpperCase() === symbol.toUpperCase()) ?? null;
    }
    const view = toExecutionMarketView(tick, this.getConfig(), now, { symbol });
    return view;
  }

  private reject(request: ExecutionRequest, code: ExecutionResult["rejectionCode"], message: string): ExecutionResult {
    return {
      status: "REJECTED",
      rejectionCode: code,
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message
    };
  }

  private async ensureUser() {
    return this.resolveRepos().users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  }

  private async log(
    repos: AppRepositories,
    userId: string,
    event: string,
    message: string,
    metadata: Record<string, unknown>
  ) {
    await repos.systemLogs.create({
      userId,
      level: "INFO",
      source: SOURCE,
      message,
      metadata: { event, ...metadata, liveKiteOrders: false }
    });
  }
}

/** Risk-validate a strategy setup and optionally submit paper execution. */
export async function executeStrategySetupPaper(input: {
  setupIdentity: string;
  provider?: PaperExecutionProvider;
  force?: boolean;
}): Promise<ExecutionResult & { riskAllowed?: boolean; calculatedQuantity?: number }> {
  const provider = input.provider ?? getPaperExecutionProvider();
  const config = provider.getConfig();
  if (!config.autoPaperExecution && !input.force) {
    return {
      status: "REJECTED",
      rejectionCode: "TRADING_BLOCKED",
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message: "AUTO paper execution is disabled (PAPER_AUTO_EXECUTION=false).",
      riskAllowed: false,
      calculatedQuantity: 0
    };
  }

  const repos = getRepositories();
  const setup = await repos.strategySetups.findByIdentity(input.setupIdentity);
  if (!setup || setup.status !== "SETUP_DETECTED") {
    return {
      status: "REJECTED",
      rejectionCode: "INVALID_INSTRUMENT",
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message: "Strategy setup not found or not SETUP_DETECTED."
    };
  }

  const age = Date.now() - setup.capturedAt.getTime();
  if (age > config.setupMaxAgeMs) {
    return {
      status: "REJECTED",
      rejectionCode: "SETUP_STALE",
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message: "Strategy setup is stale."
    };
  }

  if (setup.entryPrice == null || setup.stopLoss == null || setup.target == null) {
    return {
      status: "REJECTED",
      rejectionCode: "INVALID_PRICE",
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message: "Setup missing entry/stop/target."
    };
  }

  const user = await repos.users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  const accountState = new AccountStateService(() => repos);
  await accountState.initializePaperAccount(user.id);
  const riskRow = await repos.riskConfigurations.findByUser(user.id, "PAPER");
  if (!riskRow) {
    throw new Error("Paper risk configuration missing.");
  }
  const state = await accountState.deriveState(repos, user.id);
  const riskProfile = accountState.toRiskProfile(riskRow);
  const side = setup.direction === "BEARISH" ? "SELL" : "BUY";
  const signal = {
    symbol: setup.symbol,
    side: side as "BUY" | "SELL",
    entryPrice: setup.entryPrice,
    stopLoss: setup.stopLoss,
    targetPrice: setup.target,
    timestamp: setup.capturedAt.toISOString(),
    quantity: 1
  };
  const seed = validateTrade(signal, riskProfile, {
    dailyLoss: state.realisedLossesToday,
    tradesTaken: state.tradesToday
  }, {
    availableCapital: state.availableCapital,
    openExposure: state.openExposure,
    openPositions: state.openPositions,
    dayPnl: state.dayPnl,
    dailyLossLimit: state.dailyLossLimit,
    newTradeExposure: 0,
    status: state.status,
    maxOpenPositions: state.maxOpenPositions,
    maxCapitalExposure: state.maxCapitalExposure
  });

  if (!seed.allowed || seed.calculatedQuantity <= 0) {
    return {
      status: "REJECTED",
      rejectionCode: "TRADING_BLOCKED",
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message: seed.rejectionReasons.map((r) => r.message).join("; "),
      riskAllowed: false,
      calculatedQuantity: seed.calculatedQuantity
    };
  }

  const quantity = seed.calculatedQuantity;
  const final = validateTrade(
    { ...signal, quantity },
    riskProfile,
    { dailyLoss: state.realisedLossesToday, tradesTaken: state.tradesToday },
    {
      availableCapital: state.availableCapital,
      openExposure: state.openExposure,
      openPositions: state.openPositions,
      dayPnl: state.dayPnl,
      dailyLossLimit: state.dailyLossLimit,
      newTradeExposure: quantity * setup.entryPrice,
      status: state.status,
      maxOpenPositions: state.maxOpenPositions,
      maxCapitalExposure: state.maxCapitalExposure
    }
  );

  if (!final.allowed) {
    return {
      status: "REJECTED",
      rejectionCode: "INSUFFICIENT_PAPER_CAPITAL",
      rejectionSource: "PAPER_SIMULATION_REJECTION",
      fills: [],
      message: final.rejectionReasons.map((r) => r.message).join("; "),
      riskAllowed: false,
      calculatedQuantity: quantity
    };
  }

  const idempotencyKey = `setup|${setup.setupIdentity}|ENTRY`;
  const result = await provider.submit({
    userId: user.id,
    paperAccountMode: "PAPER",
    symbol: setup.symbol,
    instrumentToken: setup.instrumentToken,
    instrumentId: setup.instrumentId,
    side,
    orderType: setup.entryType === "MARKET" ? "MARKET" : "LIMIT",
    quantity,
    limitPrice: setup.entryType === "MARKET" ? null : setup.entryPrice,
    requestedPrice: setup.entryPrice,
    purpose: "ENTRY",
    strategySetupId: setup.id,
    tradeId: null,
    positionId: null,
    stopLoss: setup.stopLoss,
    targetPrice: setup.target,
    strategyName: `${setup.strategyId}:v${setup.strategyVersion}`,
    explanation: setup.reasons.join("; "),
    scannerSignalId: setup.scannerSignalId,
    clientOrderId: `client_${idempotencyKey}`,
    idempotencyKey,
    signalTimestamp: setup.capturedAt.toISOString(),
    requestTimestamp: new Date().toISOString(),
    timeInForceMs: config.orderTimeoutMs
  });

  return { ...result, riskAllowed: true, calculatedQuantity: quantity };
}

let singleton: PaperExecutionProvider | null = null;

export function getPaperExecutionProvider() {
  if (!singleton) {
    singleton = new PaperExecutionProvider();
  }
  return singleton;
}

export function resetPaperExecutionProviderForTests(next?: PaperExecutionProvider) {
  singleton?.stopReconciler();
  singleton = next ?? null;
}
