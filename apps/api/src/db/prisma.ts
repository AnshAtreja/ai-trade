import { PrismaClient } from "@prisma/client";
import { env } from "../config/env";

let prismaClient: PrismaClient | null = null;

export function getPrismaClient() {
  if (!prismaClient) {
    prismaClient = new PrismaClient({
      datasources: {
        db: {
          url: env.DATABASE_URL
        }
      }
    });
  }

  return prismaClient;
}

export async function disconnectPrisma() {
  if (prismaClient) {
    await prismaClient.$disconnect();
    prismaClient = null;
  }
}
