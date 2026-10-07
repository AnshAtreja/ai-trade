import { createHash } from "node:crypto";
import { getMarketSessionState } from "../../../common/utils/market-session";
import { calculatePaperCharges, netPnlFromGross } from "../../paper-trading/execution/charges";
import { getPaperExecutionConfig, type PaperExecutionConfig } from "../../paper-trading/execution/config";
import { evaluateRangeExitPolicy } from "../../paper-trading/execution/exits";
import { applySlippage, round2, round4 } from "../../paper-trading/execution/types";
import { validateTrade } from "../../risk/validator";
import type { RiskProfile } from "../../risk/types";
import type { StrategyEvaluation } from "../../strategies/engine-types";
import type { HistoricalReplayResult, ReplayCandleEvent, ReplayEvent } from "./types";

export type HistoricalOrderStatus = "PENDING" | "PARTIALLY_FILLED" | "FILLED" | "CANCELLED" | "EXPIRED" | "REJECTED";
export type HistoricalPositionStatus = "OPEN" | "CLOSED" | "INCOMPLETE_DATA";
export type HistoricalExitReason = "STOP_LOSS" | "TARGET" | "SQUARE_OFF" | "INCOMPLETE_DATA";

export interface HistoricalPaperOrder {
  orderId: string;
  setupId: string;
  instrumentToken: string;
  tradingSymbol: string;
  strategyId: string;
  strategyVersion: string;
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  stopPrice: number;
  targetPrice: number;
  setupTimestamp: string;
  orderTimestamp: string;
  eligibleAfter: string;
  status: HistoricalOrderStatus;
  rejectionReasons: string[];
}

export interface HistoricalPaperFill {
  fillId: string;
  orderId: string;
  instrumentToken: string;
  timestamp: string;
  quantity: number;
  rawExecutablePrice: number;
  slippage: number;
  fillPrice: number;
  gapExecution: boolean;
}

export interface HistoricalPaperTrade {
  tradeId: string;
  instrumentToken: string;
  tradingSymbol: string;
  strategyId: string;
  strategyVersion: string;
  setupId: string;
  direction: "LONG" | "SHORT";
  quantity: number;
  setupTimestamp: string;
  orderTimestamp: string;
  entryTimestamp: string;
  entryPrice: number;
  stopPrice: number;
  targetPrice: number;
  exitTimestamp: string | null;
  exitPrice: number | null;
  exitReason: HistoricalExitReason | null;
  grossPnl: number;
  charges: number;
  netPnl: number;
  status: HistoricalPositionStatus;
  slippage: number;
  partialFillCount: number;
  intrabarAmbiguity: boolean;
  gapExecution: boolean;
  lastPrice: number;
}

export interface HistoricalPortfolioSnapshot {
  startingCapital: number;
  cash: number;
  availableCapital: number;
  equity: number;
  realisedPnl: number;
  unrealisedPnl: number;
  capitalExposure: number;
  openPositions: number;
  closedTrades: number;
  orders: number;
  fills: number;
  charges: number;
}

export interface HistoricalPaperExecutionResult {
  runId: string;
  replayRunId: string;
  source: {
    startTimestamp: string;
    endTimestamp: string;
    duplicateCandleEvents: number;
    dataGapEvents: number;
  };
  orders: HistoricalPaperOrder[];
  fills: HistoricalPaperFill[];
  trades: HistoricalPaperTrade[];
  account: HistoricalPortfolioSnapshot;
  snapshots: Array<{ timestamp: string; account: HistoricalPortfolioSnapshot }>;
  /** Compact analytics points used by bounded research execution. */
  equityCurve?: HistoricalEquityPoint[];
  summary: {
    instrumentCount: number;
    candlesProcessed: number;
    setupsDetected: number;
    ordersCreated: number;
    ordersFilled: number;
    ordersExpired: number;
    positionsOpened: number;
    positionsClosed: number;
    positionsIncomplete: number;
    fills: number;
    grossPnl: number;
    charges: number;
    netPnl: number;
    endingCash: number;
    endingEquity: number;
    dataGapEvents: number;
    ambiguousIntrabarEvents: number;
    /**
     * Constant-size canonical trade metrics for long-running research workers.
     * They are updated as trades close and do not require retaining trades to
     * calculate parameter-classification inputs.
     */
    classificationMetrics: {
      closedTradeCount: number;
      sumNetPnl: number;
      expectancyPnl: number | null;
      validRTradeCount: number;
      sumR: number;
      expectancyR: number | null;
    };
  };
  limitations: string[];
}

export interface HistoricalEquityPoint {
  timestamp: string;
  cash: number;
  realisedPnl: number;
  unrealisedPnl: number;
  equity: number;
  exposure: number;
}

export interface HistoricalPaperExecutionOptions {
  /** Legacy scan is retained for research equivalence checks and benchmarks. */
  indexPendingOrders?: boolean;
  profile?: { orderRowsVisited: number; processCandleNs: number };
  startingCapital?: number;
  /** Keep full account snapshots for diagnostics/tests; disable for long research runs. */
  collectSnapshots?: boolean;
  /** Retain every compact point when a consumer needs an intraday equity curve. */
  collectEquityCurve?: boolean;
  /** Receives each exact compact equity point without requiring it to be retained. */
  onEquityPoint?: (point: HistoricalEquityPoint) => void;
  riskProfile?: Partial<RiskProfile>;
  executionConfig?: Partial<PaperExecutionConfig>;
}

/**
 * Isolated deterministic execution runtime for Phase 8C. It consumes only replay
 * events and Phase 7 pure execution primitives; it has no repository, broker, or
 * live-market dependency.
 */
export class HistoricalPaperExecutionEngine {
  private readonly orders: HistoricalPaperOrder[] = [];
  private readonly pendingByToken = new Map<string, Set<HistoricalPaperOrder>>();
  private readonly indexPendingOrders: boolean;
  private readonly profile?: HistoricalPaperExecutionOptions["profile"];
  private readonly fills: HistoricalPaperFill[] = [];
  private readonly trades: HistoricalPaperTrade[] = [];
  private readonly snapshots: Array<{ timestamp: string; account: HistoricalPortfolioSnapshot }> = [];
  private readonly equityCurve: HistoricalEquityPoint[] = [];
  private readonly collectSnapshots: boolean;
  private readonly collectEquityCurve: boolean;
  private readonly onEquityPoint?: (point: HistoricalEquityPoint) => void;
  private readonly config: PaperExecutionConfig;
  private readonly risk: RiskProfile;
  private readonly startingCapital: number;
  private realisedPnl = 0;
  private charges = 0;
  private closedTradeCount = 0;
  private sumClosedTradeNetPnl = 0;
  private validRTradeCount = 0;
  private sumR = 0;
  private readonly recordedClosedTradeIds = new Set<string>();
  private observedGap = false;
  private readonly lastCandleByToken = new Map<string, ReplayCandleEvent>();

  constructor(options: HistoricalPaperExecutionOptions = {}) {
    this.indexPendingOrders = options.indexPendingOrders ?? true;
    this.profile = options.profile;
    this.startingCapital = options.startingCapital ?? 100000;
    this.collectSnapshots = options.collectSnapshots ?? true;
    this.collectEquityCurve = options.collectEquityCurve ?? !this.collectSnapshots;
    this.onEquityPoint = options.onEquityPoint;
    this.config = getPaperExecutionConfig({
      slippagePolicy: "NONE",
      allowLtpFallback: true,
      liquidityPolicy: "FILL_AVAILABLE_LIQUIDITY",
      ambiguousExitPolicy: "CONSERVATIVE_STOP",
      stopGapPolicy: "FILL_AT_TRIGGER_PRICE",
      ...options.executionConfig
    });
    this.risk = {
      capital: this.startingCapital,
      maxRiskPerTradePercent: 1,
      maxDailyLossPercent: 3,
      maxTradesPerDay: 8,
      maxPositionSize: this.startingCapital,
      maxOpenPositions: 5,
      maxCapitalExposure: this.startingCapital,
      allowShortSelling: false,
      tradeStartTime: "09:15",
      tradeEndTime: "15:15",
      ...options.riskProfile
    };
  }

  execute(replay: HistoricalReplayResult): HistoricalPaperExecutionResult {
    for (const event of replay.events) {
      this.processEvent(event);
    }
    return this.complete(replay.summary);
  }

  processEvent(event: ReplayEvent) {
    if (event.type === "DATA_GAP") {
      this.observedGap = true;
      return;
    }
    if (event.type !== "CANDLE") return;
    this.lastCandleByToken.set(event.instrumentToken, event);
    this.processCandle(event);
    this.createOrders(event);
    const account = this.account();
    if (this.collectSnapshots) this.snapshots.push({ timestamp: event.replayTimestamp, account });
    const equityPoint = { timestamp: event.replayTimestamp, cash: account.cash, realisedPnl: account.realisedPnl, unrealisedPnl: account.unrealisedPnl, equity: account.equity, exposure: account.capitalExposure };
    if (!this.collectSnapshots && this.collectEquityCurve) this.equityCurve.push(equityPoint);
    this.onEquityPoint?.(equityPoint);
  }

  /** Read-only account view for bounded shared research fan-out. */
  snapshot() {
    return this.account();
  }

  complete(summary: HistoricalReplayResult["summary"]): HistoricalPaperExecutionResult {
    this.finish();
    const account = this.account();
    const material = JSON.stringify({ replayRunId: summary.deterministicRunId, orders: this.orders, fills: this.fills, trades: this.trades });
    return {
      runId: createHash("sha256").update(material).digest("hex").slice(0, 16),
      replayRunId: summary.deterministicRunId,
      source: {
        startTimestamp: summary.replayStart,
        endTimestamp: summary.replayEnd,
        duplicateCandleEvents: summary.duplicateCandleEvents,
        dataGapEvents: summary.dataGapEvents
      },
      orders: this.orders,
      fills: this.fills,
      trades: this.trades,
      account,
      snapshots: this.snapshots,
      equityCurve: this.collectSnapshots ? undefined : this.equityCurve,
      summary: {
        instrumentCount: summary.instrumentCount,
        candlesProcessed: summary.candleCountProcessed,
        setupsDetected: summary.setupsDetected,
        ordersCreated: this.orders.length,
        ordersFilled: this.orders.filter((o) => o.status === "FILLED").length,
        ordersExpired: this.orders.filter((o) => o.status === "EXPIRED").length,
        positionsOpened: this.trades.length,
        positionsClosed: this.trades.filter((t) => t.status === "CLOSED").length,
        positionsIncomplete: this.trades.filter((t) => t.status === "INCOMPLETE_DATA").length,
        fills: this.fills.length,
        grossPnl: round2(this.trades.reduce((sum, trade) => sum + trade.grossPnl, 0)),
        charges: account.charges,
        netPnl: round2(this.trades.reduce((sum, trade) => sum + trade.netPnl, 0)),
        endingCash: account.cash,
        endingEquity: account.equity,
        dataGapEvents: summary.dataGapEvents,
        ambiguousIntrabarEvents: this.trades.filter((t) => t.intrabarAmbiguity).length,
        classificationMetrics: {
          closedTradeCount: this.closedTradeCount,
          sumNetPnl: round2(this.sumClosedTradeNetPnl),
          expectancyPnl: this.closedTradeCount ? this.sumClosedTradeNetPnl / this.closedTradeCount : null,
          validRTradeCount: this.validRTradeCount,
          sumR: this.sumR,
          expectancyR: this.validRTradeCount ? this.sumR / this.validRTradeCount : null
        }
      },
      limitations: [
        "OHLC bars use conservative stop-first resolution when both stop and target are touched.",
        "Historical data gaps never receive fabricated fills or prices.",
        "Phase 8C records execution accounting only; it does not calculate performance analytics or validate strategy profitability."
      ]
    };
  }

  private processCandle(event: ReplayCandleEvent) {
    const at = event.replayTimestamp;
    const started = this.profile ? process.hrtime.bigint() : 0n;
    if (this.indexPendingOrders) {
      // Preserve insertion order and the original order objects; terminal orders
      // remain in the audit history but never participate in future fill scans.
      const pending = this.pendingByToken.get(event.instrumentToken);
      const timestamp = Date.parse(at);
      for (const order of pending ?? []) {
        if (this.profile) this.profile.orderRowsVisited += 1;
        if (Date.parse(order.eligibleAfter) <= timestamp) this.fillOrder(order, event);
        if (order.status === "FILLED") pending!.delete(order);
      }
      if (pending?.size === 0) this.pendingByToken.delete(event.instrumentToken);
    } else {
      if (this.profile) this.profile.orderRowsVisited += this.orders.length;
      for (const order of this.orders.filter((item) => item.instrumentToken === event.instrumentToken && (item.status === "PENDING" || item.status === "PARTIALLY_FILLED") && Date.parse(item.eligibleAfter) <= Date.parse(at))) {
        this.fillOrder(order, event);
      }
    }
    for (const trade of this.trades.filter((item) => item.instrumentToken === event.instrumentToken && item.status === "OPEN" && item.entryTimestamp < at)) {
      this.markOrExit(trade, event);
    }
    if (this.profile) this.profile.processCandleNs += Number(process.hrtime.bigint() - started);
  }

  private createOrders(event: ReplayCandleEvent) {
    for (const setup of event.strategy.evaluations.filter(isExecutableSetup)) {
      const side = setup.direction === "BULLISH" ? "BUY" : "SELL";
      const entryPrice = setup.entry!.price;
      const account = this.account();
      const validation = validateTrade({
        symbol: setup.tradingSymbol,
        side: side === "BUY" ? "BUY" : "SHORT",
        entryPrice,
        stopLoss: setup.stopLoss!,
        targetPrice: setup.target!,
        quantity: 1,
        timestamp: event.replayTimestamp
      }, this.risk, { dailyLoss: Math.max(0, -this.realisedPnl), tradesTaken: this.trades.length }, {
        availableCapital: account.availableCapital,
        openExposure: account.capitalExposure,
        openPositions: account.openPositions,
        dayPnl: this.realisedPnl,
        dailyLossLimit: this.startingCapital * (this.risk.maxDailyLossPercent / 100),
        newTradeExposure: entryPrice,
        maxOpenPositions: this.risk.maxOpenPositions,
        maxCapitalExposure: this.risk.maxCapitalExposure
      });
      const quantity = validation.calculatedQuantity;
      const finalValidation = validation.allowed && quantity > 0
        ? validateTrade({
            symbol: setup.tradingSymbol,
            side: side === "BUY" ? "BUY" : "SHORT",
            entryPrice,
            stopLoss: setup.stopLoss!,
            targetPrice: setup.target!,
            quantity,
            timestamp: event.replayTimestamp
          }, this.risk, { dailyLoss: Math.max(0, -this.realisedPnl), tradesTaken: this.trades.length }, {
            availableCapital: account.availableCapital,
            openExposure: account.capitalExposure,
            openPositions: account.openPositions,
            dayPnl: this.realisedPnl,
            dailyLossLimit: this.startingCapital * (this.risk.maxDailyLossPercent / 100),
            newTradeExposure: entryPrice * quantity,
            maxOpenPositions: this.risk.maxOpenPositions,
            maxCapitalExposure: this.risk.maxCapitalExposure
          })
        : validation;
      if (!finalValidation.allowed || quantity <= 0) {
        this.orders.push({
          orderId: id("ord", setup.setupIdentity), setupId: setup.setupIdentity, instrumentToken: setup.instrumentToken,
          tradingSymbol: setup.tradingSymbol, strategyId: setup.strategyId, strategyVersion: setup.strategyVersion,
          side, orderType: setup.entry!.type === "MARKET" ? "MARKET" : "LIMIT", quantity: 0, filledQuantity: 0,
          limitPrice: setup.entry!.type === "MARKET" ? null : entryPrice, stopPrice: setup.stopLoss!, targetPrice: setup.target!,
          setupTimestamp: event.replayTimestamp, orderTimestamp: event.replayTimestamp, eligibleAfter: nextInstant(event),
          status: "REJECTED", rejectionReasons: finalValidation.rejectionReasons.map((reason) => reason.code)
        });
        continue;
      }
      const order: HistoricalPaperOrder = {
        orderId: id("ord", `${setup.setupIdentity}|${event.replayTimestamp}`), setupId: setup.setupIdentity,
        instrumentToken: setup.instrumentToken, tradingSymbol: setup.tradingSymbol, strategyId: setup.strategyId,
        strategyVersion: setup.strategyVersion, side, orderType: setup.entry!.type === "MARKET" ? "MARKET" : "LIMIT",
        quantity, filledQuantity: 0, limitPrice: setup.entry!.type === "MARKET" ? null : entryPrice,
        stopPrice: setup.stopLoss!, targetPrice: setup.target!, setupTimestamp: event.replayTimestamp,
        orderTimestamp: event.replayTimestamp, eligibleAfter: nextInstant(event), status: "PENDING", rejectionReasons: []
      };
      this.orders.push(order);
      if (this.indexPendingOrders) {
        let pending = this.pendingByToken.get(order.instrumentToken);
        if (!pending) this.pendingByToken.set(order.instrumentToken, pending = new Set());
        pending.add(order);
      }
    }
  }

  private fillOrder(order: HistoricalPaperOrder, event: ReplayCandleEvent) {
    const candle = event.candle;
    const reference = entryReference(order, candle);
    if (reference == null) return;
    const remaining = order.quantity - order.filledQuantity;
    const fillQuantity = Math.min(remaining, Math.max(0, Math.floor(candle.volume)));
    if (fillQuantity <= 0) return;
    const slipped = applySlippage(order.side, reference.price, this.config);
    const fill: HistoricalPaperFill = {
      fillId: id("fill", `${order.orderId}|${event.replayTimestamp}|${order.filledQuantity}`), orderId: order.orderId,
      instrumentToken: order.instrumentToken, timestamp: event.replayTimestamp, quantity: fillQuantity,
      rawExecutablePrice: reference.price, slippage: slipped.slippageAmount, fillPrice: slipped.fillPrice, gapExecution: reference.gap
    };
    this.fills.push(fill);
    order.filledQuantity += fillQuantity;
    order.status = order.filledQuantity === order.quantity ? "FILLED" : "PARTIALLY_FILLED";
    const existing = this.trades.find((trade) => trade.setupId === order.setupId && trade.status === "OPEN");
    if (existing) {
      const total = existing.quantity + fillQuantity;
      existing.entryPrice = round4((existing.entryPrice * existing.quantity + fill.fillPrice * fillQuantity) / total);
      existing.quantity = total;
      existing.partialFillCount += 1;
      existing.slippage = round4(existing.slippage + fill.slippage);
      existing.gapExecution ||= fill.gapExecution;
      return;
    }
    this.trades.push({
      tradeId: id("trade", order.orderId), instrumentToken: order.instrumentToken, tradingSymbol: order.tradingSymbol,
      strategyId: order.strategyId, strategyVersion: order.strategyVersion, setupId: order.setupId,
      direction: order.side === "BUY" ? "LONG" : "SHORT", quantity: fillQuantity, setupTimestamp: order.setupTimestamp,
      orderTimestamp: order.orderTimestamp, entryTimestamp: event.replayTimestamp, entryPrice: fill.fillPrice,
      stopPrice: order.stopPrice, targetPrice: order.targetPrice, exitTimestamp: null, exitPrice: null, exitReason: null,
      grossPnl: 0, charges: 0, netPnl: 0, status: "OPEN", slippage: fill.slippage, partialFillCount: 0,
      intrabarAmbiguity: false, gapExecution: fill.gapExecution, lastPrice: candle.close
    });
  }

  private markOrExit(trade: HistoricalPaperTrade, event: ReplayCandleEvent) {
    const candle = event.candle;
    const side = trade.direction === "LONG" ? "BUY" : "SELL";
    const gap = gapExit(trade, candle.open);
    const exit = gap ?? evaluateRangeExitPolicy({ side, stopLoss: trade.stopPrice, targetPrice: trade.targetPrice, high: candle.high, low: candle.low, config: this.config });
    if (!exit) {
      trade.lastPrice = candle.close;
      return;
    }
    const slipped = applySlippage(trade.direction === "LONG" ? "SELL" : "BUY", exit.exitPrice, this.config);
    const gross = trade.direction === "LONG" ? (slipped.fillPrice - trade.entryPrice) * trade.quantity : (trade.entryPrice - slipped.fillPrice) * trade.quantity;
    const entryCharges = calculatePaperCharges({ turnover: trade.entryPrice * trade.quantity, config: this.config }).charges;
    const exitCharges = calculatePaperCharges({ turnover: slipped.fillPrice * trade.quantity, config: this.config }).charges;
    trade.exitTimestamp = event.replayTimestamp;
    trade.exitPrice = slipped.fillPrice;
    trade.exitReason = exit.reason as Extract<HistoricalExitReason, "STOP_LOSS" | "TARGET">;
    trade.grossPnl = round2(gross);
    trade.charges = round2(entryCharges + exitCharges);
    trade.netPnl = netPnlFromGross(trade.grossPnl, trade.charges);
    trade.status = "CLOSED";
    trade.intrabarAmbiguity = exit.ambiguous;
    trade.gapExecution ||= gap != null;
    trade.slippage = round4(trade.slippage + slipped.slippageAmount);
    trade.lastPrice = slipped.fillPrice;
    this.realisedPnl = round2(this.realisedPnl + trade.netPnl);
    this.charges = round2(this.charges + trade.charges);
    this.recordClosedTrade(trade);
  }

  private finish() {
    for (const order of this.orders.filter((item) => item.status === "PENDING" || item.status === "PARTIALLY_FILLED")) order.status = "EXPIRED";
    this.pendingByToken.clear();
    for (const trade of this.trades.filter((item) => item.status === "OPEN")) {
      const last = this.lastCandleByToken.get(trade.instrumentToken);
      if (!last) { trade.status = "INCOMPLETE_DATA"; continue; }
      // A 15:15+ candle is proof we reached the configured square-off window. A partial data set is never treated as close.
      if (!this.observedGap && getMarketSessionState(new Date(last.replayTimestamp)) === "CLOSING") {
        const price = last.candle.close;
        const gross = trade.direction === "LONG" ? (price - trade.entryPrice) * trade.quantity : (trade.entryPrice - price) * trade.quantity;
        const charges = calculatePaperCharges({ turnover: trade.entryPrice * trade.quantity + price * trade.quantity, config: this.config }).charges;
        trade.exitTimestamp = last.replayTimestamp; trade.exitPrice = price; trade.exitReason = "SQUARE_OFF";
        trade.grossPnl = round2(gross); trade.charges = charges; trade.netPnl = netPnlFromGross(trade.grossPnl, charges); trade.status = "CLOSED";
        this.realisedPnl = round2(this.realisedPnl + trade.netPnl); this.charges = round2(this.charges + charges);
        this.recordClosedTrade(trade);
      } else {
        trade.status = "INCOMPLETE_DATA";
      }
    }
  }

  private account(): HistoricalPortfolioSnapshot {
    const open = this.trades.filter((trade) => trade.status === "OPEN" || trade.status === "INCOMPLETE_DATA");
    const exposure = round2(open.reduce((sum, trade) => sum + trade.entryPrice * trade.quantity, 0));
    const unrealised = round2(open.reduce((sum, trade) => sum + (trade.direction === "LONG" ? (trade.lastPrice - trade.entryPrice) : (trade.entryPrice - trade.lastPrice)) * trade.quantity, 0));
    const equity = round2(this.startingCapital + this.realisedPnl + unrealised);
    return { startingCapital: this.startingCapital, cash: round2(this.startingCapital + this.realisedPnl - exposure), availableCapital: round2(this.startingCapital + this.realisedPnl - exposure), equity, realisedPnl: this.realisedPnl, unrealisedPnl: unrealised, capitalExposure: exposure, openPositions: open.length, closedTrades: this.trades.filter((trade) => trade.status === "CLOSED").length, orders: this.orders.length, fills: this.fills.length, charges: this.charges };
  }

  private recordClosedTrade(trade: HistoricalPaperTrade) {
    if (this.recordedClosedTradeIds.has(trade.tradeId)) return;
    this.recordedClosedTradeIds.add(trade.tradeId);
    this.closedTradeCount += 1;
    this.sumClosedTradeNetPnl += trade.netPnl;
    const risk = Math.abs(trade.entryPrice - trade.stopPrice) * trade.quantity;
    if (risk > 0) {
      this.validRTradeCount += 1;
      this.sumR += trade.netPnl / risk;
    }
  }
}

export function executeHistoricalPaperReplay(replay: HistoricalReplayResult, options: HistoricalPaperExecutionOptions = {}) {
  return new HistoricalPaperExecutionEngine(options).execute(replay);
}

function isExecutableSetup(value: StrategyEvaluation): value is StrategyEvaluation & { entry: NonNullable<StrategyEvaluation["entry"]>; stopLoss: number; target: number } {
  return value.status === "SETUP_DETECTED" && (value.direction === "BULLISH" || value.direction === "BEARISH") && value.entry != null && value.stopLoss != null && value.target != null;
}

function entryReference(order: HistoricalPaperOrder, candle: ReplayCandleEvent["candle"]): { price: number; gap: boolean } | null {
  if (order.orderType === "MARKET") return { price: candle.open, gap: true };
  const limit = order.limitPrice!;
  if (order.side === "BUY") {
    if (candle.open <= limit) return { price: candle.open, gap: candle.open < limit };
    return candle.low <= limit ? { price: limit, gap: false } : null;
  }
  if (candle.open >= limit) return { price: candle.open, gap: candle.open > limit };
  return candle.high >= limit ? { price: limit, gap: false } : null;
}

function gapExit(trade: HistoricalPaperTrade, open: number) {
  if (trade.direction === "LONG") {
    if (open <= trade.stopPrice) return { reason: "STOP_LOSS" as const, exitPrice: open, ambiguous: false };
    if (open >= trade.targetPrice) return { reason: "TARGET" as const, exitPrice: open, ambiguous: false };
  } else {
    if (open >= trade.stopPrice) return { reason: "STOP_LOSS" as const, exitPrice: open, ambiguous: false };
    if (open <= trade.targetPrice) return { reason: "TARGET" as const, exitPrice: open, ambiguous: false };
  }
  return null;
}

function nextInstant(event: ReplayCandleEvent) {
  return new Date(Date.parse(event.replayTimestamp) + (event.candle.interval === "1m" ? 60_000 : 300_000)).toISOString();
}

function id(prefix: string, material: string) {
  return `${prefix}_${createHash("sha256").update(material).digest("hex").slice(0, 16)}`;
}
