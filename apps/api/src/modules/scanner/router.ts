import { Router } from "express";
import { z } from "zod";
import { validate } from "../../common/middleware/validate";
import { asyncRoute } from "../../common/utils/async-route";
import { ScannerError } from "./errors";
import { createScanSchema, intradayScanSchema, listPersistedSignalsSchema } from "./schema";
import { scannerService } from "./service";
import { getProductionScannerService } from "./production-service";

export const scannerRouter = Router();

scannerRouter.get("/scans", async (_req, res) => {
  res.json(await scannerService.listScans());
});

scannerRouter.post("/scan", validate(createScanSchema), async (req, res) => {
  res.json(await scannerService.runScan(req.body.universe, req.body.timeframe));
});

scannerRouter.get("/intraday/mock", async (_req, res) => {
  res.json(await scannerService.listMockIntradayCandidates());
});

scannerRouter.get(
  "/intraday/mock/signal-pipeline",
  asyncRoute(async (_req, res) => {
    res.json(await scannerService.runMockSignalPipeline());
  })
);

scannerRouter.get(
  "/signals",
  validate(listPersistedSignalsSchema),
  asyncRoute(async (req, res) => {
    res.json(
      await scannerService.listPersistedSignals({
        symbol: typeof req.query.symbol === "string" ? req.query.symbol : undefined,
        sessionDate: typeof req.query.sessionDate === "string" ? req.query.sessionDate : undefined
      })
    );
  })
);

scannerRouter.get(
  "/signals/latest",
  asyncRoute(async (_req, res) => {
    const last = getProductionScannerService().getStatus().lastRun;
    res.json({ candidates: last?.candidates ?? [], run: last });
  })
);

scannerRouter.post("/intraday", validate(intradayScanSchema), async (req, res) => {
  res.json(await scannerService.runIntradayScan(req.body.instruments, req.body.options));
});

/** Phase 5 production scanner */
scannerRouter.get(
  "/status",
  asyncRoute(async (_req, res) => {
    res.json(getProductionScannerService().getStatus());
  })
);

scannerRouter.post(
  "/start",
  asyncRoute(async (_req, res) => {
    res.json(getProductionScannerService().startScheduler());
  })
);

scannerRouter.post(
  "/stop",
  asyncRoute(async (_req, res) => {
    res.json(getProductionScannerService().stopScheduler());
  })
);

const runSchema = z.object({
  force: z.boolean().optional()
});

scannerRouter.post(
  "/run",
  asyncRoute(async (req, res) => {
    const parsed = runSchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      throw new ScannerError("INVALID_SCANNER_REQUEST", parsed.error.issues[0]?.message ?? "Invalid scanner run request.");
    }
    res.json(await getProductionScannerService().runOnce({ force: parsed.data.force }));
  })
);

scannerRouter.get(
  "/runs",
  asyncRoute(async (req, res) => {
    const limit = req.query.limit ? Number(req.query.limit) : 20;
    res.json({ runs: getProductionScannerService().listRuns(Number.isFinite(limit) ? limit : 20) });
  })
);
