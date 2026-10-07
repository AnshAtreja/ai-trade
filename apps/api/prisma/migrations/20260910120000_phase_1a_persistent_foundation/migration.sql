-- CreateEnum
CREATE TYPE "TradingMode" AS ENUM ('PAPER', 'LIVE');

-- CreateEnum
CREATE TYPE "OrderSide" AS ENUM ('BUY', 'SELL');

-- CreateEnum
CREATE TYPE "OrderStatus" AS ENUM ('CREATED', 'SUBMITTED', 'OPEN', 'PARTIALLY_FILLED', 'FILLED', 'REJECTED', 'CANCELLED', 'FAILED');

-- CreateEnum
CREATE TYPE "PositionStatus" AS ENUM ('OPEN', 'CLOSED');

-- CreateEnum
CREATE TYPE "SignalDirection" AS ENUM ('BULLISH', 'BEARISH', 'NEUTRAL');

-- CreateEnum
CREATE TYPE "TradeStatus" AS ENUM ('PENDING', 'OPEN', 'CLOSED', 'CANCELLED', 'REJECTED');

-- CreateEnum
CREATE TYPE "JournalEntryType" AS ENUM ('NOTE', 'TRADE_REVIEW', 'RISK_EVENT', 'SYSTEM');

-- CreateEnum
CREATE TYPE "SystemLogLevel" AS ENUM ('DEBUG', 'INFO', 'WARN', 'ERROR', 'SAFE', 'BLOCKED');

-- CreateEnum
CREATE TYPE "BrokerConnectionStatus" AS ENUM ('DISCONNECTED', 'CONNECTED', 'SANDBOX');

-- CreateEnum
CREATE TYPE "StrategyStatus" AS ENUM ('DRAFT', 'PAPER_READY', 'DISABLED');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "BrokerConnection" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerName" TEXT NOT NULL,
    "accountMask" TEXT NOT NULL,
    "status" "BrokerConnectionStatus" NOT NULL DEFAULT 'DISCONNECTED',
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "credentialRef" TEXT,
    "lastSyncedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "BrokerConnection_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Instrument" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "instrumentToken" TEXT,
    "segment" TEXT,
    "tickSize" DECIMAL(18,6) NOT NULL DEFAULT 0.05,
    "lotSize" INTEGER NOT NULL DEFAULT 1,
    "isActive" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Instrument_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AccountSnapshot" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "brokerConnectionId" TEXT,
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "equity" DECIMAL(18,2) NOT NULL,
    "buyingPower" DECIMAL(18,2) NOT NULL,
    "availableCash" DECIMAL(18,2) NOT NULL,
    "usedMargin" DECIMAL(18,2) NOT NULL,
    "realizedPnl" DECIMAL(18,2) NOT NULL,
    "unrealizedPnl" DECIMAL(18,2) NOT NULL,
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AccountSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MarketSnapshot" (
    "id" TEXT NOT NULL,
    "symbol" TEXT NOT NULL,
    "exchange" TEXT,
    "lastPrice" DECIMAL(18,4) NOT NULL,
    "openPrice" DECIMAL(18,4),
    "highPrice" DECIMAL(18,4),
    "lowPrice" DECIMAL(18,4),
    "volume" DECIMAL(20,2),
    "capturedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MarketSnapshot_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ScannerSignal" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "direction" "SignalDirection" NOT NULL,
    "score" INTEGER NOT NULL,
    "matchedSignals" TEXT[],
    "explanation" TEXT NOT NULL,
    "entryTrigger" DECIMAL(18,4),
    "stopLoss" DECIMAL(18,4),
    "target" DECIMAL(18,4),
    "riskAmount" DECIMAL(18,2),
    "riskApproved" BOOLEAN NOT NULL DEFAULT false,
    "suggestedAction" TEXT,
    "confidenceLabel" TEXT,
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "sessionDate" TEXT NOT NULL,
    "dedupeKey" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ScannerSignal_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Strategy" (
    "id" TEXT NOT NULL,
    "ownerId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "status" "StrategyStatus" NOT NULL DEFAULT 'DRAFT',
    "description" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Strategy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Trade" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "strategyId" TEXT,
    "scannerSignalId" TEXT,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "TradeStatus" NOT NULL DEFAULT 'PENDING',
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "quantity" INTEGER NOT NULL,
    "entryPrice" DECIMAL(18,4) NOT NULL,
    "stopLoss" DECIMAL(18,4),
    "targetPrice" DECIMAL(18,4),
    "exitPrice" DECIMAL(18,4),
    "pnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3),
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Trade_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Order" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT,
    "positionId" TEXT,
    "strategyId" TEXT,
    "brokerConnectionId" TEXT,
    "instrumentId" TEXT,
    "brokerOrderId" TEXT,
    "symbol" TEXT NOT NULL,
    "side" "OrderSide" NOT NULL,
    "status" "OrderStatus" NOT NULL DEFAULT 'CREATED',
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "quantity" INTEGER NOT NULL,
    "filledQuantity" INTEGER NOT NULL DEFAULT 0,
    "price" DECIMAL(18,4),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Order_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Position" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradeId" TEXT,
    "instrumentId" TEXT,
    "symbol" TEXT NOT NULL,
    "status" "PositionStatus" NOT NULL DEFAULT 'OPEN',
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "quantity" INTEGER NOT NULL,
    "averagePrice" DECIMAL(18,4) NOT NULL,
    "currentPrice" DECIMAL(18,4),
    "unrealizedPnl" DECIMAL(18,2) NOT NULL DEFAULT 0,
    "openedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "closedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "Position_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RiskConfiguration" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tradingMode" "TradingMode" NOT NULL DEFAULT 'PAPER',
    "capital" DECIMAL(18,2) NOT NULL,
    "maxRiskPerTradePercent" DECIMAL(6,3) NOT NULL,
    "maxDailyLossPercent" DECIMAL(6,3) NOT NULL,
    "maxTradesPerDay" INTEGER NOT NULL,
    "maxPositionSize" DECIMAL(18,2) NOT NULL,
    "allowShortSelling" BOOLEAN NOT NULL DEFAULT false,
    "tradeStartTime" TEXT NOT NULL,
    "tradeEndTime" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "RiskConfiguration_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "JournalEntry" (
    "id" TEXT NOT NULL,
    "authorId" TEXT NOT NULL,
    "tradeId" TEXT,
    "type" "JournalEntryType" NOT NULL DEFAULT 'NOTE',
    "title" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "mood" TEXT,
    "tags" TEXT[],
    "symbol" TEXT,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "JournalEntry_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SystemLog" (
    "id" TEXT NOT NULL,
    "userId" TEXT,
    "level" "SystemLogLevel" NOT NULL,
    "source" TEXT NOT NULL,
    "message" TEXT NOT NULL,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "SystemLog_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE INDEX "User_createdAt_idx" ON "User"("createdAt");

-- CreateIndex
CREATE INDEX "BrokerConnection_userId_idx" ON "BrokerConnection"("userId");

-- CreateIndex
CREATE INDEX "BrokerConnection_status_idx" ON "BrokerConnection"("status");

-- CreateIndex
CREATE INDEX "BrokerConnection_tradingMode_idx" ON "BrokerConnection"("tradingMode");

-- CreateIndex
CREATE INDEX "BrokerConnection_createdAt_idx" ON "BrokerConnection"("createdAt");

-- CreateIndex
CREATE INDEX "Instrument_symbol_idx" ON "Instrument"("symbol");

-- CreateIndex
CREATE INDEX "Instrument_createdAt_idx" ON "Instrument"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Instrument_exchange_symbol_key" ON "Instrument"("exchange", "symbol");

-- CreateIndex
CREATE INDEX "AccountSnapshot_userId_idx" ON "AccountSnapshot"("userId");

-- CreateIndex
CREATE INDEX "AccountSnapshot_tradingMode_idx" ON "AccountSnapshot"("tradingMode");

-- CreateIndex
CREATE INDEX "AccountSnapshot_capturedAt_idx" ON "AccountSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "AccountSnapshot_createdAt_idx" ON "AccountSnapshot"("createdAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_symbol_idx" ON "MarketSnapshot"("symbol");

-- CreateIndex
CREATE INDEX "MarketSnapshot_capturedAt_idx" ON "MarketSnapshot"("capturedAt");

-- CreateIndex
CREATE INDEX "MarketSnapshot_createdAt_idx" ON "MarketSnapshot"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "ScannerSignal_dedupeKey_key" ON "ScannerSignal"("dedupeKey");

-- CreateIndex
CREATE INDEX "ScannerSignal_userId_idx" ON "ScannerSignal"("userId");

-- CreateIndex
CREATE INDEX "ScannerSignal_symbol_idx" ON "ScannerSignal"("symbol");

-- CreateIndex
CREATE INDEX "ScannerSignal_tradingMode_idx" ON "ScannerSignal"("tradingMode");

-- CreateIndex
CREATE INDEX "ScannerSignal_createdAt_idx" ON "ScannerSignal"("createdAt");

-- CreateIndex
CREATE INDEX "ScannerSignal_sessionDate_symbol_idx" ON "ScannerSignal"("sessionDate", "symbol");

-- CreateIndex
CREATE INDEX "Strategy_ownerId_idx" ON "Strategy"("ownerId");

-- CreateIndex
CREATE INDEX "Strategy_status_idx" ON "Strategy"("status");

-- CreateIndex
CREATE INDEX "Strategy_createdAt_idx" ON "Strategy"("createdAt");

-- CreateIndex
CREATE INDEX "Trade_userId_idx" ON "Trade"("userId");

-- CreateIndex
CREATE INDEX "Trade_symbol_idx" ON "Trade"("symbol");

-- CreateIndex
CREATE INDEX "Trade_status_idx" ON "Trade"("status");

-- CreateIndex
CREATE INDEX "Trade_tradingMode_idx" ON "Trade"("tradingMode");

-- CreateIndex
CREATE INDEX "Trade_strategyId_idx" ON "Trade"("strategyId");

-- CreateIndex
CREATE INDEX "Trade_createdAt_idx" ON "Trade"("createdAt");

-- CreateIndex
CREATE INDEX "Order_userId_idx" ON "Order"("userId");

-- CreateIndex
CREATE INDEX "Order_symbol_idx" ON "Order"("symbol");

-- CreateIndex
CREATE INDEX "Order_status_idx" ON "Order"("status");

-- CreateIndex
CREATE INDEX "Order_tradingMode_idx" ON "Order"("tradingMode");

-- CreateIndex
CREATE INDEX "Order_brokerOrderId_idx" ON "Order"("brokerOrderId");

-- CreateIndex
CREATE INDEX "Order_strategyId_idx" ON "Order"("strategyId");

-- CreateIndex
CREATE INDEX "Order_createdAt_idx" ON "Order"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Order_brokerOrderId_key" ON "Order"("brokerOrderId");

-- CreateIndex
CREATE INDEX "Position_userId_idx" ON "Position"("userId");

-- CreateIndex
CREATE INDEX "Position_symbol_idx" ON "Position"("symbol");

-- CreateIndex
CREATE INDEX "Position_status_idx" ON "Position"("status");

-- CreateIndex
CREATE INDEX "Position_tradingMode_idx" ON "Position"("tradingMode");

-- CreateIndex
CREATE INDEX "Position_createdAt_idx" ON "Position"("createdAt");

-- CreateIndex
CREATE INDEX "RiskConfiguration_userId_idx" ON "RiskConfiguration"("userId");

-- CreateIndex
CREATE INDEX "RiskConfiguration_tradingMode_idx" ON "RiskConfiguration"("tradingMode");

-- CreateIndex
CREATE UNIQUE INDEX "RiskConfiguration_userId_tradingMode_key" ON "RiskConfiguration"("userId", "tradingMode");

-- CreateIndex
CREATE INDEX "JournalEntry_authorId_idx" ON "JournalEntry"("authorId");

-- CreateIndex
CREATE INDEX "JournalEntry_symbol_idx" ON "JournalEntry"("symbol");

-- CreateIndex
CREATE INDEX "JournalEntry_type_idx" ON "JournalEntry"("type");

-- CreateIndex
CREATE INDEX "JournalEntry_createdAt_idx" ON "JournalEntry"("createdAt");

-- CreateIndex
CREATE INDEX "SystemLog_userId_idx" ON "SystemLog"("userId");

-- CreateIndex
CREATE INDEX "SystemLog_level_idx" ON "SystemLog"("level");

-- CreateIndex
CREATE INDEX "SystemLog_source_idx" ON "SystemLog"("source");

-- CreateIndex
CREATE INDEX "SystemLog_createdAt_idx" ON "SystemLog"("createdAt");

-- AddForeignKey
ALTER TABLE "BrokerConnection" ADD CONSTRAINT "BrokerConnection_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSnapshot" ADD CONSTRAINT "AccountSnapshot_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AccountSnapshot" ADD CONSTRAINT "AccountSnapshot_brokerConnectionId_fkey" FOREIGN KEY ("brokerConnectionId") REFERENCES "BrokerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerSignal" ADD CONSTRAINT "ScannerSignal_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ScannerSignal" ADD CONSTRAINT "ScannerSignal_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Strategy" ADD CONSTRAINT "Strategy_ownerId_fkey" FOREIGN KEY ("ownerId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_scannerSignalId_fkey" FOREIGN KEY ("scannerSignalId") REFERENCES "ScannerSignal"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Trade" ADD CONSTRAINT "Trade_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_positionId_fkey" FOREIGN KEY ("positionId") REFERENCES "Position"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_strategyId_fkey" FOREIGN KEY ("strategyId") REFERENCES "Strategy"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_brokerConnectionId_fkey" FOREIGN KEY ("brokerConnectionId") REFERENCES "BrokerConnection"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Order" ADD CONSTRAINT "Order_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Position" ADD CONSTRAINT "Position_instrumentId_fkey" FOREIGN KEY ("instrumentId") REFERENCES "Instrument"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RiskConfiguration" ADD CONSTRAINT "RiskConfiguration_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_authorId_fkey" FOREIGN KEY ("authorId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "JournalEntry" ADD CONSTRAINT "JournalEntry_tradeId_fkey" FOREIGN KEY ("tradeId") REFERENCES "Trade"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SystemLog" ADD CONSTRAINT "SystemLog_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;

