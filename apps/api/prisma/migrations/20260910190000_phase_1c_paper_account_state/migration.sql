-- CreateTable PaperAccount
CREATE TABLE "PaperAccount" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "startingCapital" DECIMAL(18,2) NOT NULL,
    "initializedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PaperAccount_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PaperAccount_userId_tradingMode_key" ON "PaperAccount"("userId", "tradingMode");
CREATE INDEX "PaperAccount_userId_idx" ON "PaperAccount"("userId");
CREATE INDEX "PaperAccount_tradingMode_idx" ON "PaperAccount"("tradingMode");

ALTER TABLE "PaperAccount" ADD CONSTRAINT "PaperAccount_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AlterTable AccountSnapshot
ALTER TABLE "AccountSnapshot" ADD COLUMN "sessionDate" TEXT;
ALTER TABLE "AccountSnapshot" ADD COLUMN "event" TEXT;
ALTER TABLE "AccountSnapshot" ADD COLUMN "status" TEXT NOT NULL DEFAULT 'ACTIVE';
ALTER TABLE "AccountSnapshot" ADD COLUMN "startingCapital" DECIMAL(18,2);
ALTER TABLE "AccountSnapshot" ADD COLUMN "dayPnl" DECIMAL(18,2);
ALTER TABLE "AccountSnapshot" ADD COLUMN "openExposure" DECIMAL(18,2);
ALTER TABLE "AccountSnapshot" ADD COLUMN "riskUsedToday" DECIMAL(18,2);
ALTER TABLE "AccountSnapshot" ADD COLUMN "tradesToday" INTEGER;
ALTER TABLE "AccountSnapshot" ADD COLUMN "openPositionCount" INTEGER;
CREATE INDEX "AccountSnapshot_sessionDate_idx" ON "AccountSnapshot"("sessionDate");

-- AlterTable RiskConfiguration
ALTER TABLE "RiskConfiguration" ADD COLUMN "maxOpenPositions" INTEGER NOT NULL DEFAULT 5;
ALTER TABLE "RiskConfiguration" ADD COLUMN "maxCapitalExposure" DECIMAL(18,2) NOT NULL DEFAULT 100000;
