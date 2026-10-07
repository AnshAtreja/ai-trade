import { Router } from "express";
import { asyncRoute } from "../../../common/utils/async-route";
import { KiteAccountError, httpStatusForKiteError } from "./errors";
import { brokerAccountService } from "./service";

export const kiteAccountRouter = Router();

kiteAccountRouter.get(
  "/account",
  asyncRoute(async (_req, res) => {
    res.json(await brokerAccountService.getBrokerAccountState());
  })
);

kiteAccountRouter.post(
  "/account/refresh",
  asyncRoute(async (_req, res) => {
    res.json(await brokerAccountService.refreshBrokerAccount());
  })
);

kiteAccountRouter.get(
  "/account/profile",
  asyncRoute(async (_req, res) => {
    res.json({ profile: await brokerAccountService.getProfile() });
  })
);

kiteAccountRouter.get(
  "/account/positions",
  asyncRoute(async (_req, res) => {
    res.json({ positions: await brokerAccountService.getPositions() });
  })
);

kiteAccountRouter.get(
  "/account/orders",
  asyncRoute(async (_req, res) => {
    res.json({ orders: await brokerAccountService.getOrders() });
  })
);

kiteAccountRouter.get(
  "/account/holdings",
  asyncRoute(async (_req, res) => {
    res.json({ holdings: await brokerAccountService.getHoldings() });
  })
);

kiteAccountRouter.get(
  "/account/snapshots",
  asyncRoute(async (_req, res) => {
    res.json(await brokerAccountService.listBrokerAccountSnapshots());
  })
);

export function sendKiteAccountError(res: { status: (code: number) => { json: (body: unknown) => unknown } }, error: unknown) {
  if (error instanceof KiteAccountError) {
    return res.status(httpStatusForKiteError(error.code)).json({ code: error.code, message: error.message });
  }

  throw error;
}
