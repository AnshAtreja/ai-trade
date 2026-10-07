import cors from "cors";
import express from "express";
import { errorHandler } from "./common/middleware/error-handler";
import { notFoundHandler } from "./common/middleware/not-found";
import { asyncRoute } from "./common/utils/async-route";
import { getDatabaseHealth, getPersistenceMode } from "./db";
import { authRouter } from "./modules/auth/router";
import { authService } from "./modules/auth/service";
import { kiteAccountRouter } from "./modules/broker/account/router";
import { brokerRouter } from "./modules/broker/router";
import { brokerService } from "./modules/broker/service";
import { marketRouter } from "./modules/market-data/market-router";
import { marketDataRouter } from "./modules/market-data/router";
import { marketDataService } from "./modules/market-data/service";
import { getMarketStreamService } from "./modules/market-data/stream/service";
import { scannerRouter } from "./modules/scanner/router";
import { scannerService } from "./modules/scanner/service";
import { strategiesRouter } from "./modules/strategies/router";
import { strategiesService } from "./modules/strategies/service";
import { riskRouter } from "./modules/risk/router";
import { riskService } from "./modules/risk/service";
import { aiAnalysisRouter } from "./modules/ai-analysis/router";
import { aiAnalysisService } from "./modules/ai-analysis/service";
import { paperTradingRouter } from "./modules/paper-trading/router";
import { paperTradingService } from "./modules/paper-trading/service";
import { ordersRouter } from "./modules/orders/router";
import { ordersService } from "./modules/orders/service";
import { journalRouter } from "./modules/journal/router";
import { journalService } from "./modules/journal/service";
import { historicalMarketDataRouter } from "./modules/historical-market-data/router";
import { getLiveMarketIntelligenceService, liveMarketIntelligenceRouter } from "./modules/market-intelligence/live-router";

export const app = express();

app.use(cors());
app.use(express.json());

app.get(
  "/api/health",
  asyncRoute(async (_req, res) => {
    const kite = await brokerService.getKiteStatus();
    const database = await getDatabaseHealth();
    const stream = getMarketStreamService().getStatus();
    const ok = !database.required || database.ok;

    res.status(ok ? 200 : 503).json({
      ok,
      persistenceMode: getPersistenceMode(),
      database,
      kite: {
        configured: kite.status !== "NOT_CONFIGURED",
        authenticated: kite.verified,
        accountReadable: kite.verified,
        source: "KITE",
        status: kite.status,
        lastVerifiedAt: kite.lastVerifiedAt
      },
      marketStream: {
        state: stream.state,
        running: stream.running,
        connected: stream.connected,
        receiving: stream.receiving,
        source: stream.source,
        subscriptionCount: stream.subscriptionCount,
        lastMessageAt: stream.lastMessageAt
      },
      liveTrading: {
        enabled: false,
        message: "Live order placement remains disabled."
      }
    });
  })
);

app.get("/api/dashboard", (_req, res) => {
  res.json([
    authService.getSummary(),
    brokerService.getSummary(),
    marketDataService.getSummary(),
    scannerService.getSummary(),
    strategiesService.getSummary(),
    riskService.getSummary(),
    aiAnalysisService.getSummary(),
    paperTradingService.getSummary(),
    ordersService.getSummary(),
    journalService.getSummary()
  ]);
});

app.use("/api/auth", authRouter);
app.use("/api/broker", brokerRouter);
app.use("/api/kite", kiteAccountRouter);
app.use("/api/market-data", marketDataRouter);
app.use("/api/market", marketRouter);
app.use("/api/scanner", scannerRouter);
app.use("/api/strategies", strategiesRouter);
app.use("/api/risk", riskRouter);
app.use("/api/ai-analysis", aiAnalysisRouter);
app.use("/api/paper-trading", paperTradingRouter);
app.use("/api/orders", ordersRouter);
app.use("/api/journal", journalRouter);
app.use("/api/backtest/historical", historicalMarketDataRouter);
app.use("/api/market-intelligence", liveMarketIntelligenceRouter);

getLiveMarketIntelligenceService().start();

app.use(notFoundHandler);
app.use(errorHandler);
