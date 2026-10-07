import { Router } from "express";
import { marketDataService } from "./service";

export const marketDataRouter = Router();

marketDataRouter.get("/overview", async (_req, res) => {
  res.json(await marketDataService.getOverview());
});

marketDataRouter.get("/watchlist", async (_req, res) => {
  res.json(await marketDataService.getWatchlistMovers());
});

