import { getTradingDate, isTimestampOnTradingDate, money } from "../../common/utils/trading-date";
import type { PositionRecord, TradeRecord } from "../../db/domain";
import type { AccountStatus } from "./types";

export function positionNotional(position: PositionRecord) {
  const price = position.currentPrice ?? position.averagePrice;
  return money(Math.abs(position.quantity * price));
}

export function openExposure(positions: PositionRecord[]) {
  return money(
    positions.filter((position) => position.status === "OPEN").reduce((total, position) => total + positionNotional(position), 0)
  );
}

export function realisedPnl(trades: TradeRecord[]) {
  return money(
    trades
      .filter((trade) => trade.status === "CLOSED" || trade.status === "CANCELLED")
      .reduce((total, trade) => total + trade.pnl, 0)
  );
}

export function unrealisedPnl(positions: PositionRecord[]) {
  return money(
    positions.filter((position) => position.status === "OPEN").reduce((total, position) => total + position.unrealizedPnl, 0)
  );
}

export function currentEquity(startingCapital: number, realised: number, unrealised: number) {
  return money(startingCapital + realised + unrealised);
}

export function availableCapital(equity: number, usedCapital: number) {
  return money(equity - usedCapital);
}

export function committedStopRisk(position: PositionRecord) {
  if (position.status !== "OPEN" || position.stopLoss == null) {
    return 0;
  }

  const perShare =
    position.side === "SELL" ? position.stopLoss - position.averagePrice : position.averagePrice - position.stopLoss;

  return money(Math.max(0, perShare) * position.quantity);
}

export function realisedLossesOnTradingDate(trades: TradeRecord[], tradingDate: string) {
  return money(
    trades
      .filter((trade) => trade.status === "CLOSED" || trade.status === "CANCELLED")
      .filter((trade) => trade.closedAt != null && isTimestampOnTradingDate(trade.closedAt, tradingDate))
      .filter((trade) => trade.pnl < 0)
      .reduce((total, trade) => total + Math.abs(trade.pnl), 0)
  );
}

export function realisedPnlOnTradingDate(trades: TradeRecord[], tradingDate: string) {
  return money(
    trades
      .filter((trade) => trade.status === "CLOSED" || trade.status === "CANCELLED")
      .filter((trade) => trade.closedAt != null && isTimestampOnTradingDate(trade.closedAt, tradingDate))
      .reduce((total, trade) => total + trade.pnl, 0)
  );
}

/**
 * Conservative risk used today:
 * - realised losses from paper trades closed on the Asia/Kolkata trading date
 * - plus committed stop-loss risk of currently OPEN paper positions
 *
 * This is not daily PnL and not notional exposure.
 */
export function riskUsedToday(trades: TradeRecord[], openPositions: PositionRecord[], tradingDate: string) {
  const committed = money(openPositions.reduce((total, position) => total + committedStopRisk(position), 0));
  return money(realisedLossesOnTradingDate(trades, tradingDate) + committed);
}

export function tradesOpenedOnTradingDate(trades: TradeRecord[], tradingDate: string) {
  return trades.filter((trade) => trade.status !== "REJECTED").filter((trade) => isTimestampOnTradingDate(trade.createdAt, tradingDate));
}

export function winningLosingToday(trades: TradeRecord[], tradingDate: string) {
  const closedToday = trades.filter(
    (trade) =>
      (trade.status === "CLOSED" || trade.status === "CANCELLED") &&
      trade.closedAt != null &&
      isTimestampOnTradingDate(trade.closedAt, tradingDate)
  );

  return {
    winningTradesToday: closedToday.filter((trade) => trade.pnl > 0).length,
    losingTradesToday: closedToday.filter((trade) => trade.pnl < 0).length
  };
}

export function dailyLossLimit(capital: number, maxDailyLossPercent: number) {
  return money(capital * (maxDailyLossPercent / 100));
}

export function maxRiskPerTrade(capital: number, maxRiskPerTradePercent: number) {
  return money(capital * (maxRiskPerTradePercent / 100));
}

export function accountStatus(dayPnl: number, lossLimit: number): AccountStatus {
  return dayPnl <= -lossLimit ? "TRADING_BLOCKED_DAILY_LOSS" : "ACTIVE";
}

export function sessionDateFor(at = new Date()) {
  return getTradingDate(at);
}
