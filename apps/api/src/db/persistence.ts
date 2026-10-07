/**
 * Persistence factory.
 * persistent: Prisma repositories when PERSISTENCE_MODE=database
 * mock: in-memory repositories (default) so demo/Kite workflows still run without PostgreSQL
 * broker integration: not wired here
 * paper trading: PaperTradingService persists PAPER trades through this factory
 * live trading disabled: no order-routing client is constructed here
 */
import { isDatabasePersistenceEnabled } from "../config/env";
import { getPrismaClient } from "./prisma";
import type { AppRepositories } from "./repositories/contracts";
import { createMemoryRepositories } from "./repositories/memory-repositories";
import { createPrismaRepositories } from "./repositories/prisma-repositories";

let repositories: AppRepositories | null = null;

export function getRepositories(): AppRepositories {
  if (!repositories) {
    repositories = isDatabasePersistenceEnabled()
      ? createPrismaRepositories(getPrismaClient())
      : createMemoryRepositories();
  }

  return repositories;
}

export function resetRepositoriesForTests(next?: AppRepositories) {
  repositories = next ?? null;
}

export function getPersistenceMode() {
  return isDatabasePersistenceEnabled() ? "database" : "mock";
}
