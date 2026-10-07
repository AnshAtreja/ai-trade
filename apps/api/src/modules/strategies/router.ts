import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { asyncRoute } from "../../common/utils/async-route";
import { getStrategyEngineService } from "./engine-service";
import { StrategyError } from "./errors";
import { evaluateStrategiesSchema, listStrategySignalsSchema } from "./schema";
import { strategiesService } from "./service";

export const strategiesRouter = Router();

strategiesRouter.get("/", async (_req, res) => {
  res.json({
    strategies: getStrategyEngineService().listStrategies(),
    legacy: await strategiesService.listStrategies()
  });
});

strategiesRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    res.json(getStrategyEngineService().getStatus());
  })
);

strategiesRouter.post(
  "/evaluate",
  validate(evaluateStrategiesSchema),
  asyncRoute(async (req, res) => {
    const body = req.body as {
      instrumentTokens?: Array<string | number>;
      strategyIds?: string[];
      force?: boolean;
    };
    try {
      res.json(
        await getStrategyEngineService().evaluate({
          instrumentTokens: body.instrumentTokens?.map(String),
          strategyIds: body.strategyIds,
          force: body.force
        })
      );
    } catch (error) {
      if (error instanceof StrategyError) {
        res.status(409).json({ error: { code: error.code, message: error.message } });
        return;
      }
      throw error;
    }
  })
);

strategiesRouter.post(
  "/start",
  asyncRoute(async (_req, res) => {
    res.json(getStrategyEngineService().startScheduler());
  })
);

strategiesRouter.post(
  "/stop",
  asyncRoute(async (_req, res) => {
    res.json(getStrategyEngineService().stopScheduler());
  })
);

strategiesRouter.get(
  "/signals",
  validate(listStrategySignalsSchema),
  asyncRoute(async (req, res) => {
    res.json(
      await getStrategyEngineService().listSignals({
        strategyId: typeof req.query.strategyId === "string" ? req.query.strategyId : undefined,
        symbol: typeof req.query.symbol === "string" ? req.query.symbol : undefined,
        limit: req.query.limit ? Number(req.query.limit) : undefined
      })
    );
  })
);

strategiesRouter.get(
  "/signals/latest",
  asyncRoute(async (_req, res) => {
    res.json({ setups: getStrategyEngineService().getLatestSignals() });
  })
);
