import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { authService } from "./service";
import { loginSchema } from "./schema";

export const authRouter = Router();

authRouter.get("/session", async (_req, res) => {
  res.json(await authService.getSession());
});

authRouter.post("/login", validate(loginSchema), async (req, res) => {
  res.json(await authService.login(req.body.email));
});

authRouter.post("/logout", async (_req, res) => {
  res.json(await authService.logout());
});

