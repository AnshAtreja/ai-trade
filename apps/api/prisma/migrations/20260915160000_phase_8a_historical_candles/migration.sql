-- Phase 8A: Historical candle foundation for backtesting (storage only; no live orders).

CREATE TABLE "HistoricalCandle" (
    "id" TEXT NOT NULL,
    "instrumentId" TEXT,
    "instrumentToken" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "tradingSymbol" TEXT NOT NULL,
    "interval" TEXT NOT NULL,
    "timestamp" TIMESTAMP(3) NOT NULL,
    "open" DECIMAL(18,4) NOT NULL,
    "high" DECIMAL(18,4) NOT NULL,
    "low" DECIMAL(18,4) NOT NULL,
    "close" DECIMAL(18,4) NOT NULL,
    "volume" DECIMAL(20,2) NOT NULL,
    "openInterest" DECIMAL(20,2),
    "source" TEXT NOT NULL,
    "adjustment" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "fetchedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "HistoricalCandle_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "HistoricalCandle_instrumentToken_interval_timestamp_key" ON "HistoricalCandle"("instrumentToken", "interval", "timestamp");

CREATE INDEX "HistoricalCandle_instrumentId_interval_timestamp_idx" ON "HistoricalCandle"("instrumentId", "interval", "timestamp");

CREATE INDEX "HistoricalCandle_instrumentToken_interval_timestamp_idx" ON "HistoricalCandle"("instrumentToken", "interval", "timestamp");

CREATE INDEX "HistoricalCandle_timestamp_interval_idx" ON "HistoricalCandle"("timestamp", "interval");

CREATE INDEX "HistoricalCandle_exchange_tradingSymbol_interval_timestamp_idx" ON "HistoricalCandle"("exchange", "tradingSymbol", "interval", "timestamp");

CREATE INDEX "HistoricalCandle_source_idx" ON "HistoricalCandle"("source");

CREATE INDEX "HistoricalCandle_fetchedAt_idx" ON "HistoricalCandle"("fetchedAt");

ALTER TABLE "HistoricalCandle" ADD CONSTRAINT "HistoricalCandle_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;
