import { Router } from "express";
import { env } from "../../config/env";
import { validate } from "../../common/middleware/validate";
import { asyncRoute } from "../../common/utils/async-route";
import {
  historicalCandlesQuerySchema,
  kiteAccessTokenSchema,
  kiteCallbackSchema,
  kiteRequestTokenSchema,
  ltpQuerySchema,
  subscribeTicksSchema
} from "./schema";
import { brokerService } from "./service";

export const brokerRouter = Router();

brokerRouter.get("/connections", async (_req, res) => {
  res.json(await brokerService.listConnections());
});

brokerRouter.get("/supported-brokers", async (_req, res) => {
  res.json(await brokerService.listSupportedBrokers());
});

brokerRouter.get("/mock/connect", async (_req, res) => {
  res.json(await brokerService.connectMockBroker());
});

brokerRouter.get("/mock/profile", async (_req, res) => {
  res.json(await brokerService.getMockProfile());
});

brokerRouter.get("/mock/margins", async (_req, res) => {
  res.json(await brokerService.getMockMargins());
});

brokerRouter.get("/mock/instruments", async (_req, res) => {
  res.json(await brokerService.getMockInstruments());
});

brokerRouter.get("/mock/ltp", validate(ltpQuerySchema), async (req, res) => {
  const symbols = String(req.query.symbols)
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);

  res.json(await brokerService.getMockLTP(symbols));
});

brokerRouter.get("/mock/historical-candles", validate(historicalCandlesQuerySchema), async (req, res) => {
  res.json(
    await brokerService.getMockHistoricalCandles(
      String(req.query.symbol),
      req.query.interval as never,
      String(req.query.from),
      String(req.query.to)
    )
  );
});

brokerRouter.post("/mock/subscribe-ticks", validate(subscribeTicksSchema), async (req, res) => {
  res.json(await brokerService.subscribeMockTicks(req.body.symbols));
});

brokerRouter.get("/kite/status", asyncRoute(async (_req, res) => {
  res.json(await brokerService.getKiteStatus());
}));

brokerRouter.get("/kite/login-url", (_req, res) => {
  res.json({ loginUrl: brokerService.getKiteLoginUrl() });
});

brokerRouter.get("/kite/callback", validate(kiteCallbackSchema), async (req, res) => {
  if (!req.query.request_token) {
    return res.redirect(`${env.WEB_APP_URL}?kite=missing_request_token`);
  }

  try {
    await brokerService.completeKiteLogin(String(req.query.request_token));
    return res.redirect(`${env.WEB_APP_URL}?kite=connected`);
  } catch {
    return res.redirect(`${env.WEB_APP_URL}?kite=auth_required`);
  }
});

brokerRouter.post("/kite/request-token", validate(kiteRequestTokenSchema), async (req, res) => {
  const profile = await brokerService.completeKiteLogin(req.body.requestToken);

  return res.json({
    message: "Kite request token exchanged and access token stored.",
    profile,
    status: await brokerService.getKiteStatus()
  });
});

brokerRouter.post("/kite/access-token", validate(kiteAccessTokenSchema), async (req, res) => {
  const profile = await brokerService.storeKiteAccessToken(req.body.accessToken);

  return res.json({
    message: "Kite access token verified and stored.",
    profile,
    status: await brokerService.getKiteStatus()
  });
});

brokerRouter.get("/kite/profile", asyncRoute(async (_req, res) => {
  res.json(await brokerService.getKiteProfile());
}));

brokerRouter.get("/kite/margins", asyncRoute(async (_req, res) => {
  res.json(await brokerService.getKiteMargins());
}));

brokerRouter.get("/kite/instruments", asyncRoute(async (_req, res) => {
  res.json(await brokerService.getKiteInstruments());
}));

brokerRouter.get("/kite/ltp", validate(ltpQuerySchema), asyncRoute(async (req, res) => {
  res.json(await brokerService.getKiteLTP(parseSymbols(String(req.query.symbols))));
}));

brokerRouter.get("/kite/historical-candles", validate(historicalCandlesQuerySchema), asyncRoute(async (req, res) => {
  res.json(
    await brokerService.getKiteHistoricalCandles(
      String(req.query.symbol),
      req.query.interval as never,
      String(req.query.from),
      String(req.query.to)
    )
  );
}));

brokerRouter.post("/kite/subscribe-ticks", validate(subscribeTicksSchema), asyncRoute(async (req, res) => {
  res.json(await brokerService.subscribeKiteTicks(req.body.symbols));
}));

brokerRouter.get("/kite/scanner-candidates", validate(ltpQuerySchema), asyncRoute(async (req, res) => {
  res.json(await brokerService.getKiteScannerCandidates(parseSymbols(String(req.query.symbols))));
}));

function parseSymbols(value: string) {
  return value
    .split(",")
    .map((symbol) => symbol.trim())
    .filter(Boolean);
}
