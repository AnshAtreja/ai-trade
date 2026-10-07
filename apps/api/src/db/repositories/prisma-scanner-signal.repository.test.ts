import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../domain";
import { buildScannerDedupeKey, utcSessionDate } from "../mappers";
import { PrismaOrderRepository, PrismaScannerSignalRepository, PrismaUserRepository } from "./prisma-repositories";

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

describe("Prisma scanner signal repository", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  it("upserts scanner signals without duplicating the dedupe key", async () => {
    if (!(await databaseAvailable())) {
      console.warn("Skipping Prisma test: PostgreSQL is not reachable.");
      return;
    }

    const users = new PrismaUserRepository(prisma);
    const signals = new PrismaScannerSignalRepository(prisma);
    const user = await users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
    const sessionDate = utcSessionDate();
    const dedupeKey = buildScannerDedupeKey({
      userId: user.id,
      tradingMode: "PAPER",
      sessionDate,
      symbol: "TEST",
      direction: "BULLISH"
    });

    const first = await signals.upsertByDedupeKey({
      userId: user.id,
      instrumentId: null,
      symbol: "TEST",
      direction: "BULLISH",
      score: 70,
      matchedSignals: ["GAP_UP"],
      explanation: "first",
      entryTrigger: 10,
      stopLoss: 9,
      target: 12,
      riskAmount: 20,
      riskApproved: true,
      suggestedAction: "WAIT",
      confidenceLabel: "LOW",
      tradingMode: "PAPER",
      sessionDate,
      dedupeKey
    });
    const second = await signals.upsertByDedupeKey({
      userId: user.id,
      instrumentId: null,
      symbol: "TEST",
      direction: "BULLISH",
      score: 77,
      matchedSignals: ["GAP_UP", "VOLUME_SPIKE"],
      explanation: "second",
      entryTrigger: 10.5,
      stopLoss: 9,
      target: 13,
      riskAmount: 22,
      riskApproved: true,
      suggestedAction: "WATCH_FOR_LONG_SETUP",
      confidenceLabel: "MEDIUM",
      tradingMode: "PAPER",
      sessionDate,
      dedupeKey
    });

    expect(second.id).toBe(first.id);
    expect(second.score).toBe(77);

    const listed = await signals.listByUser(user.id, { symbol: "TEST", sessionDate });
    expect(listed.filter((item) => item.dedupeKey === dedupeKey)).toHaveLength(1);

    await prisma.scannerSignal.deleteMany({ where: { dedupeKey } });
  });

  it("rejects duplicate broker order IDs", async () => {
    if (!(await databaseAvailable())) {
      console.warn("Skipping Prisma test: PostgreSQL is not reachable.");
      return;
    }

    const users = new PrismaUserRepository(prisma);
    const orders = new PrismaOrderRepository(prisma);
    const user = await users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
    const brokerOrderId = `test_broker_${Date.now()}`;

    await orders.create({
      userId: user.id,
      tradeId: null,
      positionId: null,
      strategyId: null,
      brokerConnectionId: null,
      instrumentId: null,
      brokerOrderId,
      symbol: "NVDA",
      side: "BUY",
      status: "CREATED",
      purpose: "ENTRY",
      tradingMode: "PAPER",
      quantity: 1,
      filledQuantity: 0,
      price: 100
    });

    await expect(
      orders.create({
        userId: user.id,
        tradeId: null,
        positionId: null,
        strategyId: null,
        brokerConnectionId: null,
        instrumentId: null,
        brokerOrderId,
        symbol: "NVDA",
        side: "BUY",
        status: "CREATED",
        purpose: "ENTRY",
        tradingMode: "PAPER",
        quantity: 1,
        filledQuantity: 0,
        price: 100
      })
    ).rejects.toThrow();

    await prisma.order.deleteMany({ where: { brokerOrderId } });
  });
});
