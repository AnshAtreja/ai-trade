import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { previewOrderSchema } from "./schema";
import { ordersService } from "./service";

export const ordersRouter = Router();

ordersRouter.get("/", async (_req, res) => {
  res.json(await ordersService.listOrders());
});

ordersRouter.post("/preview", validate(previewOrderSchema), async (req, res) => {
  res.json(await ordersService.previewOrder(req.body));
});

