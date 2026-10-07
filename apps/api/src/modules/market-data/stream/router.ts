import { Router } from "express";
import { z } from "zod";
import { asyncRoute } from "../../../common/utils/async-route";
import { MarketStreamError } from "./errors";
import { getMarketStreamService, parseStreamMode } from "./service";

export const marketStreamRouter = Router();

const subscribeSchema = z.object({
  instrumentTokens: z.array(z.string().min(1)).min(1).max(200),
  mode: z.enum(["LTP", "QUOTE", "FULL"]).optional()
});

const unsubscribeSchema = z.object({
  instrumentTokens: z.array(z.string().min(1)).min(1).max(200)
});

marketStreamRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    res.json(getMarketStreamService().getStatus());
  })
);

marketStreamRouter.post(
  "/start",
  asyncRoute(async (_req, res) => {
    res.json(await getMarketStreamService().start());
  })
);

marketStreamRouter.post(
  "/stop",
  asyncRoute(async (_req, res) => {
    res.json(await getMarketStreamService().stop());
  })
);

marketStreamRouter.get(
  "/subscriptions",
  asyncRoute(async (_req, res) => {
    res.json({ subscriptions: getMarketStreamService().listSubscriptions() });
  })
);

marketStreamRouter.post(
  "/subscriptions",
  asyncRoute(async (req, res) => {
    const body = parseBody(subscribeSchema, req.body);
    res.json({
      subscriptions: await getMarketStreamService().subscribe(body.instrumentTokens, parseStreamMode(body.mode))
    });
  })
);

marketStreamRouter.delete(
  "/subscriptions",
  asyncRoute(async (req, res) => {
    const body = parseBody(unsubscribeSchema, req.body);
    res.json({
      subscriptions: await getMarketStreamService().unsubscribe(body.instrumentTokens)
    });
  })
);

marketStreamRouter.get(
  "/latest/:instrumentToken",
  asyncRoute(async (req, res) => {
    res.json(getMarketStreamService().getLatest(String(req.params.instrumentToken)));
  })
);

marketStreamRouter.get(
  "/latest",
  asyncRoute(async (_req, res) => {
    res.json({ ticks: getMarketStreamService().getLatestAll() });
  })
);

marketStreamRouter.post(
  "/snapshots",
  asyncRoute(async (_req, res) => {
    res.json(await getMarketStreamService().persistSnapshots());
  })
);

function parseBody<T>(schema: z.ZodType<T>, body: unknown): T {
  const parsed = schema.safeParse(body);
  if (!parsed.success) {
    throw new MarketStreamError("INVALID_STREAM_REQUEST", parsed.error.issues[0]?.message ?? "Invalid stream request.");
  }
  return parsed.data;
}
