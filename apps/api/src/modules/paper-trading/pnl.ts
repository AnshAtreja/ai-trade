/**
 * Shared paper/live-direction PnL. One implementation for ticks, exits, and replay.
 * persistent: used when writing Position.unrealizedPnl / Trade.pnl
 * paper trading: yes
 * live trading disabled: not an execution path
 */
export type PnlSide = "BUY" | "SELL" | "SHORT";

export function isShortSide(side: PnlSide) {
  return side === "SHORT" || side === "SELL";
}

export function toOrderSide(side: PnlSide): "BUY" | "SELL" {
  return isShortSide(side) ? "SELL" : "BUY";
}

export function calculatePnl(side: PnlSide, entryPrice: number, price: number, quantity: number) {
  const pnl = isShortSide(side) ? (entryPrice - price) * quantity : (price - entryPrice) * quantity;

  return Number(pnl.toFixed(2));
}

export function calculateRewardToRisk(entryPrice: number, stopLoss: number, targetPrice: number, side: PnlSide) {
  const risk = isShortSide(side) ? stopLoss - entryPrice : entryPrice - stopLoss;
  const reward = isShortSide(side) ? entryPrice - targetPrice : targetPrice - entryPrice;

  if (risk <= 0) {
    return null;
  }

  return Number((reward / risk).toFixed(4));
}

export type PaperExitReason = "STOP_LOSS" | "TARGET" | "MANUAL" | "CANCELLED";

export function evaluateStopOrTarget(input: {
  side: PnlSide;
  stopLoss: number;
  targetPrice: number;
  price: number;
}): PaperExitReason | null {
  if (isShortSide(input.side)) {
    if (input.price >= input.stopLoss) {
      return "STOP_LOSS";
    }

    if (input.price <= input.targetPrice) {
      return "TARGET";
    }

    return null;
  }

  if (input.price <= input.stopLoss) {
    return "STOP_LOSS";
  }

  if (input.price >= input.targetPrice) {
    return "TARGET";
  }

  return null;
}

export function evaluateRangeExit(input: {
  side: PnlSide;
  stopLoss: number;
  targetPrice: number;
  high: number;
  low: number;
}): { price: number; reason: PaperExitReason } | null {
  if (isShortSide(input.side)) {
    if (input.high >= input.stopLoss) {
      return { price: input.stopLoss, reason: "STOP_LOSS" };
    }

    if (input.low <= input.targetPrice) {
      return { price: input.targetPrice, reason: "TARGET" };
    }

    return null;
  }

  if (input.low <= input.stopLoss) {
    return { price: input.stopLoss, reason: "STOP_LOSS" };
  }

  if (input.high >= input.targetPrice) {
    return { price: input.targetPrice, reason: "TARGET" };
  }

  return null;
}

export function buildTickKey(symbol: string, price: number, timestamp: string) {
  return `${symbol.toUpperCase()}|${price}|${timestamp}`;
}
