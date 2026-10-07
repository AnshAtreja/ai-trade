-- AlterEnum
CREATE TYPE "OrderPurpose" AS ENUM ('ENTRY', 'EXIT');

-- AlterTable Trade
ALTER TABLE "Trade" ADD COLUMN "maxLoss" DECIMAL(18,2);
ALTER TABLE "Trade" ADD COLUMN "rewardToRisk" DECIMAL(8,4);
ALTER TABLE "Trade" ADD COLUMN "exitReason" TEXT;
ALTER TABLE "Trade" ADD COLUMN "strategyName" TEXT;
ALTER TABLE "Trade" ADD COLUMN "explanation" TEXT;

-- AlterTable Order
ALTER TABLE "Order" ADD COLUMN "purpose" "OrderPurpose" NOT NULL DEFAULT 'ENTRY';
CREATE INDEX "Order_tradeId_idx" ON "Order"("tradeId");
CREATE INDEX "Order_purpose_idx" ON "Order"("purpose");

-- AlterTable Position
ALTER TABLE "Position" ADD COLUMN "side" "OrderSide" NOT NULL DEFAULT 'BUY';
ALTER TABLE "Position" ADD COLUMN "stopLoss" DECIMAL(18,4);
ALTER TABLE "Position" ADD COLUMN "targetPrice" DECIMAL(18,4);
ALTER TABLE "Position" ADD COLUMN "realizedPnl" DECIMAL(18,2) NOT NULL DEFAULT 0;
ALTER TABLE "Position" ADD COLUMN "exitReason" TEXT;
ALTER TABLE "Position" ADD COLUMN "lastProcessedTickKey" TEXT;
ALTER TABLE "Position" ADD COLUMN "exitInProgress" BOOLEAN NOT NULL DEFAULT false;
CREATE INDEX "Position_tradeId_idx" ON "Position"("tradeId");
