import { env, isDatabasePersistenceEnabled } from "../config/env";
import { getPrismaClient } from "./prisma";

export interface DatabaseHealth {
  mode: "mock" | "database";
  required: boolean;
  ok: boolean;
  latencyMs: number | null;
  message: string;
}

export async function getDatabaseHealth(): Promise<DatabaseHealth> {
  if (!isDatabasePersistenceEnabled()) {
    return {
      mode: "mock",
      required: false,
      ok: true,
      latencyMs: null,
      message: "PERSISTENCE_MODE=mock. PostgreSQL is optional; in-memory repositories are active."
    };
  }

  const started = Date.now();

  try {
    await getPrismaClient().$queryRaw`SELECT 1`;

    return {
      mode: "database",
      required: true,
      ok: true,
      latencyMs: Date.now() - started,
      message: `Connected via DATABASE_URL/DATARL (${env.DATABASE_URL.replace(/:[^:@/]+@/, ":***@")}).`
    };
  } catch (error) {
    return {
      mode: "database",
      required: true,
      ok: false,
      latencyMs: Date.now() - started,
      message: error instanceof Error ? error.message : "Database health check failed"
    };
  }
}
