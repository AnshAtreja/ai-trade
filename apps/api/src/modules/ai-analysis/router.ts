import { Router } from "express";
import { validate } from "../../common/middleware/validate";
import { analyzeScannerOutputSchema } from "./schema";
import { aiAnalysisService } from "./service";

export const aiAnalysisRouter = Router();

aiAnalysisRouter.get("/insights", async (_req, res) => {
  res.json(await aiAnalysisService.listInsights());
});

aiAnalysisRouter.post("/analyze", validate(analyzeScannerOutputSchema), async (req, res) => {
  res.json(await aiAnalysisService.analyzeScannerOutput(req.body));
});

aiAnalysisRouter.post("/analyze-scanner-output", validate(analyzeScannerOutputSchema), async (req, res) => {
  res.json(await aiAnalysisService.analyzeScannerOutput(req.body));
});
