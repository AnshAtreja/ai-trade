ALTER TABLE "Instrument" ADD COLUMN "exchangeToken" TEXT;
ALTER TABLE "Instrument" ADD COLUMN "instrumentType" TEXT;
ALTER TABLE "Instrument" ADD COLUMN "expiry" TIMESTAMP(3);
ALTER TABLE "Instrument" ADD COLUMN "strike" DECIMAL(18,6);

CREATE INDEX "Instrument_instrumentToken_idx" ON "Instrument"("instrumentToken");
CREATE INDEX "Instrument_exchange_instrumentToken_idx" ON "Instrument"("exchange", "instrumentToken");
CREATE INDEX "Instrument_isActive_idx" ON "Instrument"("isActive");
CREATE INDEX "Instrument_segment_idx" ON "Instrument"("segment");
CREATE INDEX "Instrument_instrumentType_idx" ON "Instrument"("instrumentType");

ALTER TABLE "MarketSnapshot" ADD COLUMN "instrumentId" TEXT;
ALTER TABLE "MarketSnapshot" ADD COLUMN "instrumentToken" TEXT;
ALTER TABLE "MarketSnapshot" ADD COLUMN "source" TEXT NOT NULL DEFAULT 'KITE';
ALTER TABLE "MarketSnapshot" ADD COLUMN "closePrice" DECIMAL(18,4);
ALTER TABLE "MarketSnapshot" ADD COLUMN "averagePrice" DECIMAL(18,4);
ALTER TABLE "MarketSnapshot" ADD COLUMN "buyQuantity" DECIMAL(20,2);
ALTER TABLE "MarketSnapshot" ADD COLUMN "sellQuantity" DECIMAL(20,2);

CREATE INDEX "MarketSnapshot_instrumentToken_idx" ON "MarketSnapshot"("instrumentToken");
CREATE INDEX "MarketSnapshot_instrumentId_capturedAt_idx" ON "MarketSnapshot"("instrumentId", "capturedAt");

ALTER TABLE "MarketSnapshot" ADD CONSTRAINT "MarketSnapshot_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
