import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createPrismaRepositories } from "../../db/repositories/prisma-repositories";

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

describe("historical candles database persistence", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    resetRepositoriesForTests();
  });

  it("inserts idempotently and supports range queries when Postgres is available", async () => {
    if (!(await databaseAvailable())) {
      console.warn("Skipping Prisma historical candle test: PostgreSQL is not reachable.");
      return;
    }

    const repos = createPrismaRepositories(prisma);
    resetRepositoriesForTests(repos);
    const token = `test-hist-${Date.now()}`;
    const ts = new Date("2026-09-15T03:45:00.000Z");

    const first = await repos.historicalCandles.insertMany([
      {
        instrumentId: null,
        instrumentToken: token,
        exchange: "NSE",
        tradingSymbol: "TESTHIST",
        interval: "1m",
        timestamp: ts,
        open: 1,
        high: 2,
        low: 0.5,
        close: 1.5,
        volume: 10,
        openInterest: null,
        source: "MOCK",
        adjustment: "UNADJUSTED"
      }
    ]);
    const second = await repos.historicalCandles.insertMany([
      {
        instrumentId: null,
        instrumentToken: token,
        exchange: "NSE",
        tradingSymbol: "TESTHIST",
        interval: "1m",
        timestamp: ts,
        open: 9,
        high: 9,
        low: 9,
        close: 9,
        volume: 99,
        openInterest: null,
        source: "MOCK",
        adjustment: "UNADJUSTED"
      }
    ]);

    expect(first.inserted).toBe(1);
    expect(second.skipped).toBe(1);

    const rows = await repos.historicalCandles.listRange({
      instrumentToken: token,
      interval: "1m",
      from: ts,
      to: new Date(ts.getTime() + 60_000)
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.open).toBe(1);

    await prisma.historicalCandle.deleteMany({ where: { instrumentToken: token } });
  });
});
