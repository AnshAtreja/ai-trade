import type { PaperExecutionConfig } from "./config";
import { applySlippage, type ExecutionMarketView, type FillDecision } from "./types";

/**
 * Deterministic fill evaluation for paper MARKET/LIMIT orders.
 * Never invents bid/ask; records fallback usage via market.usedFallbackSpread.
 */
export function evaluateFill(input: {
  side: "BUY" | "SELL";
  orderType: "MARKET" | "LIMIT";
  quantity: number;
  filledQuantity: number;
  limitPrice: number | null;
  market: ExecutionMarketView;
  config: PaperExecutionConfig;
}): FillDecision {
  const remaining = input.quantity - input.filledQuantity;
  if (remaining <= 0) {
    return {
      action: "KEEP_OPEN",
      fillQuantity: 0,
      referencePrice: input.market.ltp,
      fillPrice: input.market.ltp,
      slippageAmount: 0,
      reason: "nothing remaining",
      market: input.market
    };
  }

  if (input.market.stale) {
    return reject(input.market, "stale market data");
  }

  const reference =
    input.side === "BUY"
      ? input.market.ask ?? (input.config.allowLtpFallback ? input.market.ltp : null)
      : input.market.bid ?? (input.config.allowLtpFallback ? input.market.ltp : null);

  if (reference == null || !(reference > 0)) {
    return reject(input.market, "missing bid/ask and LTP fallback disabled");
  }

  if (input.orderType === "LIMIT") {
    if (input.limitPrice == null || !(input.limitPrice > 0)) {
      return reject(input.market, "invalid limit price");
    }
    const crossed =
      input.side === "BUY" ? reference <= input.limitPrice : reference >= input.limitPrice;
    if (!crossed) {
      return {
        action: "KEEP_OPEN",
        fillQuantity: 0,
        referencePrice: reference,
        fillPrice: reference,
        slippageAmount: 0,
        reason: "limit not crossed",
        market: input.market
      };
    }
  }

  const available =
    input.side === "BUY"
      ? input.market.askQty
      : input.market.bidQty;

  let fillQuantity = remaining;
  if (available != null) {
    if (available <= 0) {
      return applyLiquidityPolicy(0, remaining, reference, input);
    }
    fillQuantity = Math.min(remaining, Math.floor(available));
  }

  if (fillQuantity <= 0) {
    return applyLiquidityPolicy(0, remaining, reference, input);
  }

  // Cap fill price for limits
  let { fillPrice, slippageAmount } = applySlippage(input.side, reference, input.config);
  if (input.orderType === "LIMIT" && input.limitPrice != null) {
    if (input.side === "BUY" && fillPrice > input.limitPrice) {
      fillPrice = input.limitPrice;
      slippageAmount = Math.max(0, fillPrice - reference);
    }
    if (input.side === "SELL" && fillPrice < input.limitPrice) {
      fillPrice = input.limitPrice;
      slippageAmount = Math.max(0, reference - fillPrice);
    }
  }

  if (fillQuantity < remaining) {
    return applyLiquidityPolicy(fillQuantity, remaining, reference, input, fillPrice, slippageAmount);
  }

  return {
    action: "FILL",
    fillQuantity,
    referencePrice: reference,
    fillPrice,
    slippageAmount,
    reason: input.market.usedFallbackSpread ? "filled using LTP+/-fallback spread" : "filled against quote",
    market: input.market
  };
}

function applyLiquidityPolicy(
  fillQuantity: number,
  remaining: number,
  reference: number,
  input: {
    side: "BUY" | "SELL";
    market: ExecutionMarketView;
    config: PaperExecutionConfig;
  },
  fillPrice?: number,
  slippageAmount?: number
): FillDecision {
  const slipped = fillPrice != null && slippageAmount != null
    ? { fillPrice, slippageAmount }
    : applySlippage(input.side, reference, input.config);

  switch (input.config.liquidityPolicy) {
    case "REJECT":
      return reject(input.market, "insufficient liquidity");
    case "KEEP_OPEN":
      if (fillQuantity <= 0) {
        return {
          action: "KEEP_OPEN",
          fillQuantity: 0,
          referencePrice: reference,
          fillPrice: slipped.fillPrice,
          slippageAmount: slipped.slippageAmount,
          reason: "insufficient liquidity; keeping open",
          market: input.market
        };
      }
      return {
        action: "PARTIAL",
        fillQuantity,
        referencePrice: reference,
        fillPrice: slipped.fillPrice,
        slippageAmount: slipped.slippageAmount,
        reason: "partial fill; remainder kept open",
        market: input.market
      };
    case "PARTIAL_THEN_CANCEL":
      if (fillQuantity <= 0) {
        return {
          action: "EXPIRE",
          fillQuantity: 0,
          referencePrice: reference,
          fillPrice: slipped.fillPrice,
          slippageAmount: slipped.slippageAmount,
          reason: "no liquidity; cancel remainder",
          market: input.market
        };
      }
      return {
        action: "PARTIAL",
        fillQuantity,
        referencePrice: reference,
        fillPrice: slipped.fillPrice,
        slippageAmount: slipped.slippageAmount,
        reason: "partial fill; remainder to cancel",
        market: input.market
      };
    case "FILL_AVAILABLE_LIQUIDITY":
    default:
      if (fillQuantity <= 0) {
        return {
          action: "KEEP_OPEN",
          fillQuantity: 0,
          referencePrice: reference,
          fillPrice: slipped.fillPrice,
          slippageAmount: slipped.slippageAmount,
          reason: "no available liquidity",
          market: input.market
        };
      }
      return {
        action: fillQuantity < remaining ? "PARTIAL" : "FILL",
        fillQuantity,
        referencePrice: reference,
        fillPrice: slipped.fillPrice,
        slippageAmount: slipped.slippageAmount,
        reason: fillQuantity < remaining ? "filled available liquidity" : "fully filled",
        market: input.market
      };
  }
}

function reject(market: ExecutionMarketView, reason: string): FillDecision {
  return {
    action: "REJECT",
    fillQuantity: 0,
    referencePrice: market.ltp,
    fillPrice: market.ltp,
    slippageAmount: 0,
    reason,
    market
  };
}
