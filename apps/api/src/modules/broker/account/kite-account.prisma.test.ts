import { PrismaClient } from "@prisma/client";
import { afterAll, afterEach, describe, expect, it } from "vitest";
import { env } from "../../../config/env";
import { resetRepositoriesForTests } from "../../../db/persistence";
import { createPrismaRepositories } from "../../../db/repositories/prisma-repositories";
import { BrokerAccountService } from "./service";
import { MockBrokerAccountProvider } from "./mock-account-provider";
import { resetRefreshThrottleForTests } from "./throttle";

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

describe("kite broker account database snapshots", () => {
  afterAll(async () => {
    await prisma.$disconnect();
  });

  afterEach(() => {
    resetRepositoriesForTests();
    resetRefreshThrottleForTests();
  });

  it("persists a broker snapshot that a new service instance can read (restart stand-in)", async () => {
    if (!(await databaseAvailable())) {
      console.warn("Skipping Prisma Kite account snapshot test: PostgreSQL is not reachable.");
      return;
    }

    resetRepositoriesForTests(createPrismaRepositories(prisma));
    resetRefreshThrottleForTests();
    const first = new BrokerAccountService(undefined, new MockBrokerAccountProvider());
    const refreshed = await first.refreshBrokerAccount();
    expect(refreshed.profile?.userId).toBe("MOCKKITE01");

    const second = new BrokerAccountService(undefined, new MockBrokerAccountProvider());
    const loaded = await second.getBrokerAccountState();
    expect(loaded.profile?.userId).toBe(refreshed.profile?.userId);
    expect(loaded.positions).toHaveLength(refreshed.positions.length);

    const user = await prisma.user.findUnique({ where: { email: "demo@tradepilot.local" } });
    if (user) {
      await prisma.brokerAccountSnapshot.deleteMany({ where: { userId: user.id, source: "MOCK" } });
      await prisma.accountSnapshot.deleteMany({ where: { userId: user.id, source: "MOCK" } });
    }
  });
});
