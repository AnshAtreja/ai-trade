import { PrismaClient } from "@prisma/client";
import "../src/config/env";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../src/db/domain";
import { buildScannerDedupeKey, utcSessionDate } from "../src/db/mappers";

const prisma = new PrismaClient();

async function main() {
  const user = await prisma.user.upsert({
    where: { email: DEMO_USER_EMAIL },
    update: { name: DEMO_USER_NAME },
    create: { email: DEMO_USER_EMAIL, name: DEMO_USER_NAME }
  });

  await prisma.riskConfiguration.upsert({
    where: {
      userId_tradingMode: {
        userId: user.id,
        tradingMode: "PAPER"
      }
    },
    update: {},
    create: {
      userId: user.id,
      tradingMode: "PAPER",
      capital: 100000,
      maxRiskPerTradePercent: 1,
      maxDailyLossPercent: 3,
      maxTradesPerDay: 8,
      maxPositionSize: 25000,
      maxOpenPositions: 5,
      maxCapitalExposure: 100000,
      allowShortSelling: false,
      tradeStartTime: "09:30",
      tradeEndTime: "15:30"
    }
  });

  await prisma.paperAccount.upsert({
    where: {
      userId_tradingMode: {
        userId: user.id,
        tradingMode: "PAPER"
      }
    },
    update: {},
    create: {
      userId: user.id,
      tradingMode: "PAPER",
      startingCapital: 100000
    }
  });

  await prisma.brokerConnection.upsert({
    where: { id: "seed_broker_kite" },
    update: {
      userId: user.id,
      accountMask: "XXXX1234",
      status: "DISCONNECTED",
      tradingMode: "PAPER",
      credentialRef: "kite-demo"
    },
    create: {
      id: "seed_broker_kite",
      userId: user.id,
      brokerName: "Kite",
      accountMask: "XXXX1234",
      status: "DISCONNECTED",
      tradingMode: "PAPER",
      credentialRef: "kite-demo"
    }
  });

  const nvda = await prisma.instrument.upsert({
    where: { exchange_symbol: { exchange: "MOCK", symbol: "NVDA" } },
    update: { name: "NVIDIA" },
    create: {
      symbol: "NVDA",
      exchange: "MOCK",
      name: "NVIDIA",
      segment: "EQ",
      tickSize: 0.01,
      lotSize: 1
    }
  });

  const sessionDate = utcSessionDate();

  await prisma.scannerSignal.upsert({
    where: {
      dedupeKey: buildScannerDedupeKey({
        userId: user.id,
        tradingMode: "PAPER",
        sessionDate,
        symbol: "NVDA",
        direction: "BULLISH"
      })
    },
    update: { score: 88, explanation: "Seeded NVDA gap-and-go candidate." },
    create: {
      userId: user.id,
      instrumentId: nvda.id,
      symbol: "NVDA",
      direction: "BULLISH",
      score: 88,
      matchedSignals: ["GAP_UP", "VOLUME_SPIKE"],
      explanation: "Seeded NVDA gap-and-go candidate.",
      entryTrigger: 1048.12,
      stopLoss: 1037.45,
      target: 1069.46,
      riskAmount: 250,
      riskApproved: true,
      suggestedAction: "WATCH_FOR_LONG_SETUP",
      confidenceLabel: "HIGH",
      tradingMode: "PAPER",
      sessionDate,
      dedupeKey: buildScannerDedupeKey({
        userId: user.id,
        tradingMode: "PAPER",
        sessionDate,
        symbol: "NVDA",
        direction: "BULLISH"
      })
    }
  });

  await prisma.systemLog.create({
    data: {
      userId: user.id,
      level: "INFO",
      source: "seed",
      message: "Development seed completed. Live trading remains disabled.",
      metadata: { liveTradingEnabled: false }
    }
  });

  console.log(`Seeded demo user ${user.email} (${user.id})`);
}

main()
  .catch((error) => {
    console.error(error);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
