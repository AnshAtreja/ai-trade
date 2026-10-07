import { Router } from "express";
import { asyncRoute } from "../../common/utils/async-route";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { getMarketStreamService } from "../market-data/stream/service";
import { LiveMarketIntelligenceService } from "./live-intelligence-service";

let singleton: LiveMarketIntelligenceService | null = null;
export function getLiveMarketIntelligenceService() {
  singleton ??= new LiveMarketIntelligenceService(getMarketStreamService());
  return singleton;
}

export const liveMarketIntelligenceRouter = Router();

liveMarketIntelligenceRouter.get("/market", (_req, res) => {
  res.json(getLiveMarketIntelligenceService().getLatestMarketContext());
});
liveMarketIntelligenceRouter.get("/sectors", (_req, res) => {
  res.json({ sectors: getLiveMarketIntelligenceService().getSectors() });
});
liveMarketIntelligenceRouter.get("/instruments/:token", (req, res) => {
  const result = getLiveMarketIntelligenceService().getIntelligenceSnapshot(String(req.params.token));
  if (!result) { res.status(404).json({ message: "Instrument is not in the 25-stock research context sample." }); return; }
  res.json(result);
});
liveMarketIntelligenceRouter.get("/health", asyncRoute(async (_req, res) => {
  const health = getLiveMarketIntelligenceService().getHealth();
  const broker = health.stream.source === "KITE" ? await kiteBrokerAdapter.getStatus() : null;
  const authentication = broker ? { status: broker.status, verified: broker.verified, reasonCode: broker.reasonCode } :
    { status: "NOT_APPLICABLE", verified: true, reasonCode: null };
  res.json({ ...health, authentication,
    marketFreshness: broker?.status === "AUTH_REQUIRED" ? { ...health.marketFreshness, status: "UNAVAILABLE", reason: "AUTH_REQUIRED" } : health.marketFreshness,
    regimeFreshness: broker?.status === "AUTH_REQUIRED" ? { ...health.regimeFreshness, status: "UNAVAILABLE", reason: "AUTH_REQUIRED" } : health.regimeFreshness });
}));
