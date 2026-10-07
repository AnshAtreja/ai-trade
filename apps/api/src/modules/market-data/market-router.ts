import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../common/utils/async-route";
import { MarketDataError } from "./errors";
import { marketInstrumentService } from "./instrument-service";
import { marketStreamRouter } from "./stream/router";

export const marketRouter = Router();

marketRouter.use("/stream", marketStreamRouter);

const marketRequestSchema = z
  .object({
    instrumentTokens: z.array(z.string().min(1)).optional(),
    tradingSymbols: z.array(z.string().min(1)).optional(),
    exchange: z.string().min(1).optional(),
    persist: z.boolean().optional()
  })
  .refine((value) => (value.instrumentTokens?.length ?? 0) + (value.tradingSymbols?.length ?? 0) > 0, {
    message: "Provide instrumentTokens or tradingSymbols."
  });

marketRouter.post(
  "/instruments/sync",
  asyncRoute(async (_req, res) => {
    res.json(await marketInstrumentService.syncInstruments());
  })
);

marketRouter.get(
  "/instruments",
  asyncRoute(async (req, res) => {
    res.json({
      instruments: await marketInstrumentService.listInstruments({
        exchange: req.query.exchange as string | undefined,
        symbol: req.query.symbol as string | undefined,
        search: req.query.search as string | undefined,
        segment: req.query.segment as string | undefined,
        instrumentType: req.query.instrumentType as string | undefined,
        isActive: req.query.isActive == null ? undefined : req.query.isActive === "true",
        hasExpiry: req.query.hasExpiry == null ? undefined : req.query.hasExpiry === "true",
        excludeEtfs: req.query.excludeEtfs == null ? undefined : req.query.excludeEtfs === "true",
        offset: req.query.offset ? Number(req.query.offset) : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      })
    });
  })
);

marketRouter.get(
  "/instruments/token/:instrumentToken",
  asyncRoute(async (req, res) => {
    const instrumentToken = String(req.params.instrumentToken);
    res.json(await marketInstrumentService.getByInstrumentToken(instrumentToken));
  })
);

marketRouter.get(
  "/instruments/:tradingSymbol",
  asyncRoute(async (req, res) => {
    const tradingSymbol = String(req.params.tradingSymbol);
    res.json(await marketInstrumentService.getByTradingSymbol(tradingSymbol, req.query.exchange as string | undefined));
  })
);

marketRouter.get(
  "/universe/equities",
  asyncRoute(async (req, res) => {
    res.json(await marketInstrumentService.listTradableEquities({
      exchange: typeof req.query.exchange === "string" ? req.query.exchange : "NSE",
      search: typeof req.query.search === "string" ? req.query.search : undefined,
      page: req.query.page ? Number(req.query.page) : undefined,
      pageSize: req.query.pageSize ? Number(req.query.pageSize) : undefined
    }));
  })
);

marketRouter.post(
  "/ltp",
  asyncRoute(async (req, res) => {
    res.json(await marketInstrumentService.getLtp(parseMarketRequest(req.body)));
  })
);

marketRouter.post(
  "/quotes",
  asyncRoute(async (req, res) => {
    res.json(await marketInstrumentService.getQuotes(parseMarketRequest(req.body)));
  })
);

marketRouter.get(
  "/snapshots",
  asyncRoute(async (req, res) => {
    res.json({
      snapshots: await marketInstrumentService.listSnapshots({
        symbol: req.query.symbol as string | undefined,
        instrumentId: req.query.instrumentId as string | undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      })
    });
  })
);

function parseMarketRequest(body: unknown) {
  const parsed = marketRequestSchema.safeParse(body);
  if (!parsed.success) {
    throw new MarketDataError("INVALID_MARKET_UNIVERSE", parsed.error.issues[0]?.message ?? "Invalid market-data request.");
  }
  return parsed.data;
}
