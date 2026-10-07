import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createPrismaRepositories } from "../../db/repositories/prisma-repositories";
import { PaperTradingService } from "./service";

const prisma = new PrismaClient({
  datasources: {
    db: { url: env.DATABASE_URL }
  }
});

async function databaseAvailable() {
  try {
    await prisma.$queryRaw`SELECT 1`;
    return true;
  } catch {
    return false;
  }
}

describe("paper trading database persistence", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    resetRepositoriesForTests();
  });

  it("keeps an open paper position after constructing a new service (restart stand-in)", async () => {
    if (!(await databaseAvailable())) {
      console.warn("Skipping Prisma paper-trading restart test: PostgreSQL is not reachable.");
      return;
    }

    resetRepositoriesForTests(createPrismaRepositories(prisma));
    const first = new PaperTradingService();
    const created = await first.createTrade({
      signal: {
        symbol: "RESTART",
        side: "BUY",
        entryPrice: 100,
        stopLoss: 99,
        targetPrice: 110,
        timestamp: "10:15"
      },
      strategyName: "Restart Check",
      aiExplanation: "Database restart stand-in."
    });

    expect(created.allowed).toBe(true);

    const second = new PaperTradingService();
    const position = await second.getPosition(created.position!.id);
    expect(position?.status).toBe("OPEN");

    const accountAfterOpen = await second.getAccount();
    expect(accountAfterOpen.startingCapital).toBeGreaterThan(0);
    expect(accountAfterOpen.openPositions).toBeGreaterThanOrEqual(1);

    await second.updateWithTick({
      symbol: "RESTART",
      price: 110,
      timestamp: "2026-09-10T15:00:00.000Z"
    });

    const closed = await second.getPosition(created.position!.id);
    expect(closed?.status).toBe("CLOSED");
    expect(closed?.realizedPnl).toBeGreaterThan(0);

    const accountAfterClose = await new PaperTradingService().getAccount();
    expect(accountAfterClose.openExposure).toBe(0);
    expect(accountAfterClose.unrealisedPnl).toBe(0);
    expect(accountAfterClose.currentEquity).toBe(
      accountAfterClose.startingCapital + accountAfterClose.realisedPnl + accountAfterClose.unrealisedPnl
    );

    if (created.trade?.id) {
      await prisma.order.deleteMany({ where: { tradeId: created.trade.id } });
      await prisma.position.deleteMany({ where: { tradeId: created.trade.id } });
      await prisma.journalEntry.deleteMany({ where: { tradeId: created.trade.id } });
      await prisma.systemLog.deleteMany({ where: { metadata: { path: ["tradeId"], equals: created.trade.id } } }).catch(() => undefined);
      await prisma.trade.delete({ where: { id: created.trade.id } });
    }
  });
});
