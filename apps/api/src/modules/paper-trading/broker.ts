import { calculatePnl } from "./pnl";
import type { PaperExitReason, PaperTrade, PaperTradeDraft } from "./types";

export interface PaperBroker {
  openTrade: (draft: PaperTradeDraft) => Promise<PaperTrade>;
  closeTrade: (trade: PaperTrade, exitPrice: number, exitReason: PaperExitReason, timestamp: string) => Promise<PaperTrade>;
  cancelTrade: (trade: PaperTrade, timestamp: string) => Promise<PaperTrade>;
}

export class MockPaperBroker implements PaperBroker {
  private nextId = 1;

  async openTrade(draft: PaperTradeDraft): Promise<PaperTrade> {
    const now = draft.openedAt;

    return {
      id: `paper_${this.nextId++}`,
      ...draft,
      lastPrice: draft.entryPrice,
      status: "OPEN",
      openedAt: now,
      updatedAt: now,
      pnl: 0
    };
  }

  async closeTrade(
    trade: PaperTrade,
    exitPrice: number,
    exitReason: PaperExitReason,
    timestamp: string
  ): Promise<PaperTrade> {
    return {
      ...trade,
      lastPrice: exitPrice,
      exitPrice,
      exitReason,
      closedAt: timestamp,
      updatedAt: timestamp,
      status: "CLOSED",
      pnl: calculatePnl(trade.side, trade.entryPrice, exitPrice, trade.quantity)
    };
  }

  async cancelTrade(trade: PaperTrade, timestamp: string): Promise<PaperTrade> {
    return {
      ...trade,
      status: "CANCELLED",
      exitReason: "CANCELLED",
      closedAt: timestamp,
      updatedAt: timestamp
    };
  }
}

export const mockPaperBroker = new MockPaperBroker();
