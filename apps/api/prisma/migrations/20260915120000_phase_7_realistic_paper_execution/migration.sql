-- Phase 7: realistic paper execution (fills, order lifecycle fields, charges)

CREATE TYPE "PaperOrderType" AS ENUM ('MARKET', 'LIMIT');
ALTER TYPE "OrderStatus" ADD VALUE IF NOT EXISTS 'EXPIRED';

ALTER TABLE "Trade"
  ADD COLUMN IF NOT EXISTS "grossPnl" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "charges" DECIMAL(18,2),
  ADD COLUMN IF NOT EXISTS "strategySetupId" TEXT,
  ADD COLUMN IF NOT EXISTS "instrumentToken" TEXT;

CREATE INDEX IF NOT EXISTS "Trade_strategySetupId_idx" ON "Trade"("strategySetupId");

ALTER TABLE "Order"
  ADD COLUMN IF NOT EXISTS "clientOrderId" TEXT,
  ADD COLUMN IF NOT EXISTS "idempotencyKey" TEXT,
  ADD COLUMN IF NOT EXISTS "orderType" "PaperOrderType" NOT NULL DEFAULT 'MARKET',
  ADD COLUMN IF NOT EXISTS "limitPrice" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "averageFillPrice" DECIMAL(18,4),
  ADD COLUMN IF NOT EXISTS "instrumentToken" TEXT,
  ADD COLUMN IF NOT EXISTS "strategySetupId" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionCode" TEXT,
  ADD COLUMN IF NOT EXISTS "rejectionSource" TEXT,
  ADD COLUMN IF NOT EXISTS "submittedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "firstFillAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "filledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "cancelledAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "rejectedAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "expiredAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "executableAt" TIMESTAMP(3),
  ADD COLUMN IF NOT EXISTS "executionProvenance" JSONB;

CREATE UNIQUE INDEX IF NOT EXISTS "Order_clientOrderId_key" ON "Order"("clientOrderId");
CREATE UNIQUE INDEX IF NOT EXISTS "Order_idempotencyKey_key" ON "Order"("idempotencyKey");
CREATE INDEX IF NOT EXISTS "Order_instrumentToken_idx" ON "Order"("instrumentToken");
CREATE INDEX IF NOT EXISTS "Order_executableAt_idx" ON "Order"("executableAt");

CREATE TABLE IF NOT EXISTS "PaperFill" (
  "id" TEXT NOT NULL,
  "orderId" TEXT NOT NULL,
  "userId" TEXT NOT NULL,
  "quantity" INTEGER NOT NULL,
  "price" DECIMAL(18,4) NOT NULL,
  "fillKey" TEXT NOT NULL,
  "marketTimestamp" TIMESTAMP(3),
  "receivedAt" TIMESTAMP(3),
  "referenceLtp" DECIMAL(18,4),
  "referenceBid" DECIMAL(18,4),
  "referenceAsk" DECIMAL(18,4),
  "referenceBidQty" DECIMAL(20,2),
  "referenceAskQty" DECIMAL(20,2),
  "slippageAmount" DECIMAL(18,6),
  "provenance" JSONB,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "PaperFill_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX IF NOT EXISTS "PaperFill_fillKey_key" ON "PaperFill"("fillKey");
CREATE INDEX IF NOT EXISTS "PaperFill_orderId_idx" ON "PaperFill"("orderId");
CREATE INDEX IF NOT EXISTS "PaperFill_userId_idx" ON "PaperFill"("userId");
CREATE INDEX IF NOT EXISTS "PaperFill_createdAt_idx" ON "PaperFill"("createdAt");

ALTER TABLE "PaperFill" DROP CONSTRAINT IF EXISTS "PaperFill_orderId_fkey";
ALTER TABLE "PaperFill" ADD CONSTRAINT "PaperFill_orderId_fkey" FOREIGN KEY ("orderId") REFERENCES "Order"("id") ON DELETE CASCADE ON UPDATE CASCADE;

ALTER TABLE "Position"
  ADD COLUMN IF NOT EXISTS "originalQuantity" INTEGER,
  ADD COLUMN IF NOT EXISTS "instrumentToken" TEXT;

CREATE INDEX IF NOT EXISTS "Position_instrumentToken_idx" ON "Position"("instrumentToken");
