import { PrismaClient } from "@prisma/client";
import { randomUUID } from "node:crypto";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createPrismaRepositories } from "../../db/repositories/prisma-repositories";
import { createMarketInstrumentService } from "./instrument-service";
import { MockMarketDataProvider } from "./mock-market-data-provider";
import { MOCK_INSTRUMENTS } from "./mock-instruments";

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

describe("instrument market-data database persistence", () => {
  let testSymbol: string | null = null;
  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(async () => {
    if (testSymbol) {
      await prisma.marketSnapshot.deleteMany({ where: { symbol: testSymbol } });
      await prisma.instrument.deleteMany({ where: { exchange: "NSE", symbol: testSymbol } });
      testSymbol = null;
    }
    resetRepositoriesForTests();
  });

  it("keeps synced instruments and snapshots after a repository restart", async () => {
    if (!(await databaseAvailable())) {
      console.warn("Skipping Prisma instrument/snapshot restart test: PostgreSQL is not reachable.");
      return;
    }

    testSymbol = `TPTEST${randomUUID().slice(0, 8).toUpperCase()}`;
    const testToken = BigInt(`0x${randomUUID().replace(/-/g, "").slice(0, 12)}`).toString();
    const fixture = { ...MOCK_INSTRUMENTS[0]!, tradingSymbol: testSymbol, instrumentToken: testToken };
    const provider = { source: "MOCK" as const, async getInstruments() {
      return { instruments: [fixture], received: 1, failed: 0 };
    } };
    resetRepositoriesForTests(createPrismaRepositories(prisma));
    const first = createMarketInstrumentService({
      instrumentProvider: provider,
      quotes: new MockMarketDataProvider()
    });
    const sync = await first.syncInstruments();
    await first.getQuotes({ tradingSymbols: [testSymbol] });
    expect(sync.inserted + sync.updated).toBeGreaterThan(0);

    resetRepositoriesForTests(createPrismaRepositories(prisma));
    const restarted = createMarketInstrumentService({
      instrumentProvider: provider,
      quotes: new MockMarketDataProvider()
    });
    const instrument = await restarted.getByTradingSymbol(testSymbol, "NSE");
    const snapshots = await restarted.listSnapshots({ symbol: testSymbol });

    expect(instrument.instrumentToken).toBe(testToken);
    expect(snapshots.length).toBeGreaterThan(0);
  });
});
