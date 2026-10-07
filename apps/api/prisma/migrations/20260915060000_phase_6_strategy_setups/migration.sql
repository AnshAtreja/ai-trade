-- Phase 6: historical strategy setups (analytical outputs, not orders)

CREATE TABLE "StrategySetup" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "setupIdentity" TEXT NOT NULL,
    "strategyId" TEXT NOT NULL,
    "strategyVersion" TEXT NOT NULL,
    "instrumentId" TEXT,
    "instrumentToken" TEXT,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT,
    "direction" "SignalDirection" NOT NULL,
    "status" TEXT NOT NULL,
    "confidence" INTEGER,
    "confidenceComponents" JSONB,
    "entryType" TEXT,
    "entryPrice" DECIMAL(18,4),
    "stopLoss" DECIMAL(18,4) NOT NULL,
    "target" DECIMAL(18,4) NOT NULL,
    "rewardRisk" DECIMAL(8,4) NOT NULL,
    "riskPerUnit" DECIMAL(18,4),
    "conditions" JSONB NOT NULL,
    "reasons" TEXT[],
    "invalidation" JSONB,
    "scannerSignalId" TEXT,
    "marketDataTimestamp" TIMESTAMP(3),
    "marketSession" TEXT,
    "capturedAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StrategySetup_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "StrategySetup_setupIdentity_key" ON "StrategySetup"("setupIdentity");
CREATE INDEX "StrategySetup_userId_idx" ON "StrategySetup"("userId");
CREATE INDEX "StrategySetup_strategyId_idx" ON "StrategySetup"("strategyId");
CREATE INDEX "StrategySetup_symbol_idx" ON "StrategySetup"("symbol");
CREATE INDEX "StrategySetup_capturedAt_idx" ON "StrategySetup"("capturedAt");
CREATE INDEX "StrategySetup_instrumentToken_idx" ON "StrategySetup"("instrumentToken");

ALTER TABLE "StrategySetup" ADD CONSTRAINT "StrategySetup_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "StrategySetup" ADD CONSTRAINT "StrategySetup_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
