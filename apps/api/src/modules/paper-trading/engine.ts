/**
 * Isolated in-memory paper engine used by historical replay.
 * persistent: no — replay must not share API repository state
 * mock: MockPaperBroker fills
 * broker integration: none; never calls Kite placeOrder
 * paper trading: yes
 * live trading disabled: this engine is not a live router
 */
import type { PaperBroker } from "./broker";
import { calculatePnl, evaluateRangeExit, evaluateStopOrTarget, isShortSide } from "./pnl";
import type {
  CreatePaperTradeInput,
  CreatePaperTradeResult,
  PaperExitReason,
  PaperTrade,
  PaperTradeDraft,
  PriceTick,
  PriceRangeTick,
  PriceTickResult
} from "./types";
import { validateTrade } from "../risk/validator";

export class PaperTradingEngine {
  private trades = new Map<string, PaperTrade>();

  constructor(private readonly broker: PaperBroker) {}

  async createTrade(input: CreatePaperTradeInput): Promise<CreatePaperTradeResult> {
    if (!input.riskProfile || !input.currentDayStats) {
      return {
        allowed: false,
        rejectionReasons: [{ code: "INVALID_QUANTITY", message: "Replay engine requires an explicit risk profile and day stats." }],
        calculatedQuantity: 0,
        maxLoss: 0
      };
    }

    const seedValidation = validateTrade(
      {
        ...input.signal,
        quantity: 1
      },
      input.riskProfile,
      input.currentDayStats
    );

    if (!seedValidation.allowed || seedValidation.calculatedQuantity <= 0 || input.signal.stopLoss === undefined) {
      return {
        allowed: false,
        rejectionReasons: seedValidation.rejectionReasons,
        calculatedQuantity: seedValidation.calculatedQuantity,
        maxLoss: seedValidation.maxLoss
      };
    }

    const finalValidation = validateTrade(
      {
        ...input.signal,
        stopLoss: input.signal.stopLoss,
        quantity: seedValidation.calculatedQuantity
      },
      input.riskProfile,
      input.currentDayStats
    );

    if (!finalValidation.allowed) {
      return {
        allowed: false,
        rejectionReasons: finalValidation.rejectionReasons,
        calculatedQuantity: finalValidation.calculatedQuantity,
        maxLoss: finalValidation.maxLoss
      };
    }

    const draft: PaperTradeDraft = {
      symbol: input.signal.symbol.toUpperCase(),
      side: input.signal.side,
      quantity: finalValidation.calculatedQuantity,
      entryPrice: input.signal.entryPrice,
      stopLoss: input.signal.stopLoss,
      targetPrice: input.signal.targetPrice,
      maxLoss: finalValidation.maxLoss,
      aiExplanation: input.aiExplanation,
      strategyName: input.strategyName,
      openedAt: input.signal.timestamp
    };

    const trade = await this.broker.openTrade(draft);
    this.trades.set(trade.id, trade);

    return {
      allowed: true,
      rejectionReasons: [],
      calculatedQuantity: trade.quantity,
      maxLoss: trade.maxLoss,
      trade
    };
  }

  listTrades() {
    return [...this.trades.values()].sort((a, b) => b.openedAt.localeCompare(a.openedAt));
  }

  getTrade(tradeId: string) {
    return this.trades.get(tradeId) ?? null;
  }

  async updateWithTick(tick: PriceTick): Promise<PriceTickResult> {
    const timestamp = tick.timestamp ?? new Date().toISOString();
    const normalizedTick = {
      symbol: tick.symbol.toUpperCase(),
      price: tick.price,
      timestamp
    };
    const updatedTrades: PaperTrade[] = [];
    const closedTrades: PaperTrade[] = [];

    for (const trade of this.trades.values()) {
      if (trade.status !== "OPEN" || trade.symbol !== normalizedTick.symbol) {
        continue;
      }

      const exitReason = evaluateStopOrTarget({
        side: trade.side,
        stopLoss: trade.stopLoss,
        targetPrice: trade.targetPrice,
        price: normalizedTick.price
      });
      const updatedTrade = exitReason
        ? await this.broker.closeTrade(trade, normalizedTick.price, exitReason, timestamp)
        : {
            ...trade,
            lastPrice: normalizedTick.price,
            updatedAt: timestamp,
            pnl: calculatePnl(trade.side, trade.entryPrice, normalizedTick.price, trade.quantity)
          };

      this.trades.set(updatedTrade.id, updatedTrade);
      updatedTrades.push(updatedTrade);

      if (updatedTrade.status === "CLOSED") {
        closedTrades.push(updatedTrade);
      }
    }

    return {
      tick: normalizedTick,
      updatedTrades,
      closedTrades
    };
  }

  async updateWithRangeTick(tick: PriceRangeTick): Promise<PriceTickResult> {
    const timestamp = tick.timestamp ?? new Date().toISOString();
    const normalizedTick = {
      symbol: tick.symbol.toUpperCase(),
      price: tick.close,
      timestamp
    };
    const updatedTrades: PaperTrade[] = [];
    const closedTrades: PaperTrade[] = [];

    for (const trade of this.trades.values()) {
      if (trade.status !== "OPEN" || trade.symbol !== normalizedTick.symbol) {
        continue;
      }

      const exit = evaluateRangeExit({
        side: trade.side,
        stopLoss: trade.stopLoss,
        targetPrice: trade.targetPrice,
        high: tick.high,
        low: tick.low
      });
      const updatedTrade = exit
        ? await this.broker.closeTrade(trade, exit.price, exit.reason, timestamp)
        : {
            ...trade,
            lastPrice: tick.close,
            updatedAt: timestamp,
            pnl: calculatePnl(trade.side, trade.entryPrice, tick.close, trade.quantity)
          };

      this.trades.set(updatedTrade.id, updatedTrade);
      updatedTrades.push(updatedTrade);

      if (updatedTrade.status === "CLOSED") {
        closedTrades.push(updatedTrade);
      }
    }

    return {
      tick: normalizedTick,
      updatedTrades,
      closedTrades
    };
  }

  async closeTrade(tradeId: string, exitPrice: number, exitReason: PaperExitReason = "MANUAL", timestamp = new Date().toISOString()) {
    const trade = this.trades.get(tradeId);

    if (!trade || trade.status !== "OPEN") {
      return null;
    }

    const closedTrade = await this.broker.closeTrade(trade, exitPrice, exitReason, timestamp);
    this.trades.set(closedTrade.id, closedTrade);

    return closedTrade;
  }

  async cancelTrade(tradeId: string, timestamp = new Date().toISOString()) {
    const trade = this.trades.get(tradeId);

    if (!trade || trade.status !== "OPEN") {
      return null;
    }

    const cancelledTrade = await this.broker.cancelTrade(trade, timestamp);
    this.trades.set(cancelledTrade.id, cancelledTrade);

    return cancelledTrade;
  }
}

export { calculatePnl, isShortSide };
