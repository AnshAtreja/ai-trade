import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncRoute } from "../../common/utils/async-route";
import { HistoricalMarketDataError, httpStatusForHistoricalError } from "./errors";
import {
  coverageHistoricalSchema,
  downloadHistoricalSchema,
  listHistoricalCandlesSchema,
  validateHistoricalSchema
} from "./schema";
import { getHistoricalMarketDataService } from "./service";

/**
 * Internal historical-data API (Phase 8A).
 * Not a generic Kite proxy — download requires instrumentToken + explicit range.
 * Never places live orders.
 */
export const historicalMarketDataRouter = Router();

historicalMarketDataRouter.get(
  "/coverage",
  validate(coverageHistoricalSchema),
  asyncRoute(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : undefined;
    res.json({
      coverage: await getHistoricalMarketDataService().coverage({
        instrumentToken: typeof req.query.instrumentToken === "string" ? req.query.instrumentToken : undefined,
        interval: req.query.interval === "5m" || req.query.interval === "1m" ? req.query.interval : undefined,
        from: typeof req.query.from === "string" ? req.query.from : undefined,
        to: typeof req.query.to === "string" ? req.query.to : undefined,
        limit: Number.isFinite(limit) ? limit : undefined
      }),
      rangeSemantics: "[from, to) half-open; to is exclusive"
    });
  })
);

historicalMarketDataRouter.get(
  "/candles",
  validate(listHistoricalCandlesSchema),
  asyncRoute(async (req, res) => {
    const candles = await getHistoricalMarketDataService().getCandles({
      instrumentToken: String(req.query.instrumentToken),
      interval: req.query.interval === "5m" ? "5m" : "1m",
      from: String(req.query.from),
      to: String(req.query.to),
      derive5m: req.query.derive5m !== "false"
    });
    res.json({
      count: candles.length,
      rangeSemantics: "[from, to) half-open; to is exclusive",
      candles
    });
  })
);

historicalMarketDataRouter.post(
  "/download",
  validate(downloadHistoricalSchema),
  asyncRoute(async (req, res) => {
    try {
      const result = await getHistoricalMarketDataService().download(req.body);
      res.status(201).json(result);
    } catch (error) {
      sendHistoricalError(res, error);
    }
  })
);

historicalMarketDataRouter.post(
  "/validate",
  validate(validateHistoricalSchema),
  asyncRoute(async (req, res) => {
    try {
      res.json(await getHistoricalMarketDataService().validate(req.body));
    } catch (error) {
      sendHistoricalError(res, error);
    }
  })
);

function sendHistoricalError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof HistoricalMarketDataError) {
    res.status(httpStatusForHistoricalError(error.code)).json({
      error: { code: error.code, message: error.message }
    });
    return;
  }
  throw error;
}
