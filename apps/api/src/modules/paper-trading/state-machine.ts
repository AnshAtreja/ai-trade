/**
 * Paper trading state machine (Phase 1B).
 *
 * Conceptual flow (mapped onto existing enums):
 *
 * SIGNAL
 *   → RISK_VALIDATED            (RiskValidator; no rows yet)
 *   → TRADE_CREATED             Trade.status = PENDING
 *   → ORDER_CREATED             Order.status = CREATED, purpose = ENTRY
 *   → ORDER_FILLED              Order.status = FILLED  (deterministic paper fill)
 *   → POSITION_OPEN             Position.status = OPEN, Trade.status = OPEN
 *   → POSITION_MONITORED        ticks update currentPrice + unrealizedPnl
 *   → EXIT_TRIGGERED            stop / target / manual (Position.exitInProgress = true)
 *   → EXIT_ORDER_CREATED        Order.purpose = EXIT, status = CREATED
 *   → EXIT_ORDER_FILLED         Order.status = FILLED
 *   → POSITION_CLOSED           Position.status = CLOSED, unrealizedPnl = 0
 *   → TRADE_CLOSED              Trade.status = CLOSED
 *
 * Invalid transitions are rejected:
 * - CLOSED / CANCELLED trades cannot receive ticks
 * - CLOSED positions cannot close again
 * - FILLED orders cannot be filled again
 * - duplicate tick keys and exitInProgress prevent double exits
 *
 * LIVE Kite execution is not part of this machine.
 */
import type { OrderStatus, PositionStatus, TradeStatus } from "../../db/domain";
import { PaperTradingError } from "./errors";

const TRADE_TICK_STATUSES: TradeStatus[] = ["OPEN"];
const TRADE_CLOSE_STATUSES: TradeStatus[] = ["OPEN"];
const POSITION_UPDATE_STATUSES: PositionStatus[] = ["OPEN"];
const FILLABLE_ORDER_STATUSES: OrderStatus[] = ["CREATED", "SUBMITTED", "OPEN", "PARTIALLY_FILLED"];

export function assertTradeCanReceiveTick(status: TradeStatus) {
  if (!TRADE_TICK_STATUSES.includes(status)) {
    throw new PaperTradingError("INVALID_TRANSITION", `A ${status} trade cannot receive price updates.`);
  }
}

export function assertTradeCanClose(status: TradeStatus) {
  if (!TRADE_CLOSE_STATUSES.includes(status)) {
    throw new PaperTradingError("INVALID_TRANSITION", `A ${status} trade cannot be closed.`);
  }
}

export function assertPositionCanUpdate(status: PositionStatus, exitInProgress: boolean) {
  if (status !== "OPEN") {
    throw new PaperTradingError("INVALID_TRANSITION", `A ${status} position cannot be updated.`);
  }

  if (exitInProgress) {
    throw new PaperTradingError("EXIT_IN_PROGRESS", "An exit is already being processed for this position.");
  }
}

export function assertPositionCanClose(status: PositionStatus, exitInProgress: boolean) {
  if (status !== "OPEN") {
    throw new PaperTradingError("ALREADY_CLOSED", "Closed positions cannot be closed again.");
  }

  if (exitInProgress) {
    throw new PaperTradingError("EXIT_IN_PROGRESS", "An exit is already being processed for this position.");
  }
}

export function assertOrderCanFill(status: OrderStatus) {
  if (!FILLABLE_ORDER_STATUSES.includes(status)) {
    throw new PaperTradingError("INVALID_TRANSITION", `A ${status} order cannot be filled again.`);
  }
}

export function isDuplicateTick(lastProcessedTickKey: string | null, tickKey: string) {
  return lastProcessedTickKey === tickKey;
}

export function assertPaperTradingMode(tradingMode: string) {
  if (tradingMode !== "PAPER") {
    throw new PaperTradingError("LIVE_TRADING_DISABLED", "Only PAPER positions can be managed through paper-trading APIs.");
  }
}
