-- AccountSnapshot.source distinguishes PAPER vs KITE observations.
-- LIVE tradingMode on snapshots means real-broker context only; execution stays disabled.

ALTER TABLE "AccountSnapshot" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'PAPER';
CREATE INDEX "AccountSnapshot_source_idx" ON "AccountSnapshot"("source");

CREATE TABLE "BrokerAccountSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'KITE',
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'LIVE',
    "event" TEXT NOT NULL,
    "refreshStatus" TEXT NOT NULL,
    "equityNet" DECIMAL(18,2) NOT NULL,
    "availableCash" DECIMAL(18,2) NOT NULL,
    "usedMargin" DECIMAL(18,2) NOT NULL,
    "realizedPnl" DECIMAL(18,2) NOT NULL,
    "unrealizedPnl" DECIMAL(18,2) NOT NULL,
    "dayPnl" DECIMAL(18,2) NOT NULL,
    "positionCount" INTEGER NOT NULL,
    "orderCount" INTEGER NOT NULL,
    "holdingCount" INTEGER NOT NULL,
    "state" JSONB NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "BrokerAccountSnapshot_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "BrokerAccountSnapshot_userId_idx" ON "BrokerAccountSnapshot"("userId");
CREATE INDEX "BrokerAccountSnapshot_source_idx" ON "BrokerAccountSnapshot"("source");
CREATE INDEX "BrokerAccountSnapshot_tradingMode_idx" ON "BrokerAccountSnapshot"("tradingMode");
CREATE INDEX "BrokerAccountSnapshot_capturedAt_idx" ON "BrokerAccountSnapshot"("capturedAt");

ALTER TABLE "BrokerAccountSnapshot" ADD CONSTRAINT "BrokerAccountSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
