import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { validateTradeSchema } from "./schema";
import { riskService } from "./service";

export const riskRouter = Router();

riskRouter.get("/profile", async (_req, res) => {
  res.json(await riskService.getProfile());
});

riskRouter.post("/validate-trade", validate(validateTradeSchema), (req, res) => {
  res.json(riskService.validateTrade(req.body.signal, req.body.riskProfile, req.body.currentDayStats));
});
