import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/validate";
import { asyncRoute } from "../../common/utils/async-route";
import type { OrderRecord, PositionRecord, TradeRecord } from "../../db/domain";
import { PaperTradingError, httpStatusForPaperError } from "./errors";
import {
  executeStrategySetupPaper,
  getPaperExecutionProvider
} from "./execution/provider";
import {
  cancelTradeSchema,
  closePositionSchema,
  createPaperTradeSchema,
  listPaperRecordsSchema,
  positionIdParamsSchema,
  priceTickSchema,
  tradeIdParamsSchema
} from "./schema";
import { paperTradingService } from "./service";

export const paperTradingRouter = Router();

paperTradingRouter.get("/account", asyncRoute(async (_req, res) => {
  res.json(await paperTradingService.getAccount());
}));

paperTradingRouter.get("/account/snapshots", asyncRoute(async (_req, res) => {
  res.json(await paperTradingService.listAccountSnapshots());
}));

paperTradingRouter.post("/account/refresh", asyncRoute(async (_req, res) => {
  res.json(await paperTradingService.refreshAccount());
}));

paperTradingRouter.get(
  "/orders",
  validate(listPaperRecordsSchema),
  asyncRoute(async (req, res) => {
    res.json(
      await paperTradingService.listOrders({
        symbol: asString(req.query.symbol),
        status: asPaperOrderStatus(req.query.status)
      })
    );
  })
);

paperTradingRouter.get(
  "/orders/:orderId",
  asyncRoute(async (req, res) => {
    const order = await paperTradingService.getOrder(getId(req.params.orderId));
    if (!order) {
      return res.status(404).json({ message: "Paper order not found" });
    }
    return res.json(order);
  })
);

paperTradingRouter.get(
  "/orders/:orderId/fills",
  asyncRoute(async (req, res) => {
    res.json({ fills: await paperTradingService.listFills(getId(req.params.orderId)) });
  })
);

paperTradingRouter.get(
  "/execution/status",
  asyncRoute(async (_req, res) => {
    res.json(getPaperExecutionProvider().getStatus());
  })
);

paperTradingRouter.post(
  "/execution/reconcile",
  asyncRoute(async (_req, res) => {
    res.json(await getPaperExecutionProvider().reconcile());
  })
);

paperTradingRouter.post(
  "/execution/start",
  asyncRoute(async (_req, res) => {
    res.json(getPaperExecutionProvider().startReconciler());
  })
);

paperTradingRouter.post(
  "/execution/stop",
  asyncRoute(async (_req, res) => {
    res.json(getPaperExecutionProvider().stopReconciler());
  })
);

const executeSetupSchema = z.object({
  body: z.object({
    setupIdentity: z.string().min(1),
    force: z.boolean().optional()
  }),
  params: z.object({}),
  query: z.object({})
});

paperTradingRouter.post(
  "/execution/from-setup",
  validate(executeSetupSchema),
  asyncRoute(async (req, res) => {
    const result = await executeStrategySetupPaper({
      setupIdentity: req.body.setupIdentity,
      force: req.body.force
    });
    res.status(result.status === "REJECTED" || result.status === "DUPLICATE" ? 422 : 201).json(result);
  })
);

paperTradingRouter.get(
  "/positions",
  validate(listPaperRecordsSchema),
  asyncRoute(async (req, res) => {
    res.json(
      await paperTradingService.listPositions({
        status: asPositionStatus(req.query.status),
        symbol: asString(req.query.symbol),
        from: asDate(req.query.from),
        to: asDate(req.query.to)
      })
    );
  })
);

paperTradingRouter.get(
  "/positions/:positionId",
  validate(positionIdParamsSchema),
  asyncRoute(async (req, res) => {
    const position = await paperTradingService.getPosition(getId(req.params.positionId));

    if (!position) {
      return res.status(404).json({ message: "Paper position not found" });
    }

    return res.json(position);
  })
);

paperTradingRouter.post(
  "/positions/:positionId/close",
  validate(closePositionSchema),
  asyncRoute(async (req, res) => {
    try {
      const result = await paperTradingService.closePosition({
        positionId: getId(req.params.positionId),
        exitPrice: req.body?.exitPrice,
        timestamp: req.body?.timestamp,
        reason: "MANUAL"
      });

      return res.json(result);
    } catch (error) {
      return sendPaperError(res, error);
    }
  })
);

paperTradingRouter.get(
  "/trades",
  validate(listPaperRecordsSchema),
  asyncRoute(async (req, res) => {
    res.json(
      await paperTradingService.listTrades({
        status: asTradeStatus(req.query.status),
        symbol: asString(req.query.symbol),
        from: asDate(req.query.from),
        to: asDate(req.query.to)
      })
    );
  })
);

paperTradingRouter.get(
  "/trades/:tradeId",
  validate(tradeIdParamsSchema),
  asyncRoute(async (req, res) => {
    const trade = await paperTradingService.getTrade(getId(req.params.tradeId));

    if (!trade) {
      return res.status(404).json({ message: "Paper trade not found" });
    }

    return res.json(trade);
  })
);

paperTradingRouter.post(
  "/trades",
  validate(createPaperTradeSchema),
  asyncRoute(async (req, res) => {
    const result = await paperTradingService.createTrade(req.body);

    if (!result.allowed) {
      return res.status(422).json(result);
    }

    return res.status(201).json(result);
  })
);

paperTradingRouter.post(
  "/ticks",
  validate(priceTickSchema),
  asyncRoute(async (req, res) => {
    res.json(await paperTradingService.updateWithTick(req.body));
  })
);

paperTradingRouter.post(
  "/trades/:tradeId/cancel",
  validate(cancelTradeSchema),
  asyncRoute(async (req, res) => {
    const trade = await paperTradingService.cancelTrade(getId(req.params.tradeId), req.body?.timestamp);

    if (!trade) {
      return res.status(404).json({ message: "Open paper trade not found" });
    }

    return res.json(trade);
  })
);

function sendPaperError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof PaperTradingError) {
    return res.status(httpStatusForPaperError(error.code)).json({ code: error.code, message: error.message });
  }

  throw error;
}

function getId(value: string | string[]) {
  return Array.isArray(value) ? value[0] : value;
}

function asString(value: unknown) {
  return typeof value === "string" ? value : undefined;
}

function asDate(value: unknown) {
  return typeof value === "string" ? new Date(value) : undefined;
}

function asTradeStatus(value: unknown): TradeRecord["status"] | undefined {
  if (value === "OPEN" || value === "CLOSED" || value === "CANCELLED" || value === "PENDING" || value === "REJECTED") {
    return value;
  }

  return undefined;
}

function asPositionStatus(value: unknown): PositionRecord["status"] | undefined {
  if (value === "OPEN" || value === "CLOSED") {
    return value;
  }

  return undefined;
}

function asPaperOrderStatus(value: unknown): OrderRecord["status"] | undefined {
  const allowed: OrderRecord["status"][] = [
    "CREATED",
    "SUBMITTED",
    "OPEN",
    "PARTIALLY_FILLED",
    "FILLED",
    "REJECTED",
    "CANCELLED",
    "FAILED",
    "EXPIRED"
  ];
  if (typeof value === "string" && (allowed as string[]).includes(value)) {
    return value as OrderRecord["status"];
  }
  return undefined;
}
