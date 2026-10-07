import { PrismaClient } from "@prisma/client";
import { afterAll, describe, expect, it } from "vitest";
import { env } from "../../config/env";
import { benchmarkRegistry, matchesSynchronizedBenchmark } from "./context-universe";

const prisma = new PrismaClient({ datasources: { db: { url: env.DATABASE_URL } } });

describe("Phase 9B synchronized context benchmark identities", () => {
  afterAll(async () => { await prisma.$disconnect(); });

  it("matches every registered index against the existing Phase 3 master", async () => {
    try {
      await prisma.$queryRaw`SELECT 1`;
    } catch {
      console.warn("Skipping Phase 9B Prisma benchmark identity test: PostgreSQL is not reachable.");
      return;
    }
    const rows = await prisma.instrument.findMany({
      where: { exchange: "NSE", symbol: { in: benchmarkRegistry.map((item) => item.symbol) } },
      select: { symbol: true, instrumentToken: true, exchange: true, segment: true, isActive: true }
    });
    expect(rows).toHaveLength(benchmarkRegistry.length);
    for (const definition of benchmarkRegistry) {
      const matches = rows.filter((row) => matchesSynchronizedBenchmark(definition, row));
      expect(matches, definition.id).toHaveLength(1);
    }
  });
});
