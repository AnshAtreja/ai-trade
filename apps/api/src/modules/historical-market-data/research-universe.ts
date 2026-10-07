import { createHash } from "node:crypto";

export interface ResearchUniverseInstrument {
  tradingSymbol: string;
  instrumentToken: string;
  exchange: "NSE";
  instrumentType: "EQ";
  sector: string;
  selectionRationale: string;
  corporateActionFlags: string[];
}

export const RESEARCH_UNIVERSE_VERSION = "NSE_EQ_RESEARCH_UNIVERSE_2026_V1";
export const RESEARCH_PERIOD = {
  from: "2025-09-18T03:45:00.000Z",
  to: "2026-09-18T03:45:00.000Z"
} as const;

const selectionRationale = "Large, actively traded NSE equity with established market prominence and sector diversification value; selected independently of TradePilot strategy results.";

export const researchUniverseInstruments: ResearchUniverseInstrument[] = [
  ["RELIANCE", "738561", "Energy"],
  ["HDFCBANK", "341249", "Financial Services"],
  ["ICICIBANK", "1270529", "Financial Services"],
  ["SBIN", "779521", "Financial Services"],
  ["AXISBANK", "1510401", "Financial Services"],
  ["KOTAKBANK", "492033", "Financial Services"],
  ["BAJFINANCE", "81153", "Financial Services"],
  ["TCS", "2953217", "Information Technology"],
  ["INFY", "408065", "Information Technology"],
  ["HCLTECH", "1850625", "Information Technology"],
  ["WIPRO", "969473", "Information Technology"],
  ["BHARTIARTL", "2714625", "Telecommunication"],
  ["MARUTI", "2815745", "Automobile and Auto Components"],
  ["M&M", "519937", "Automobile and Auto Components"],
  ["TITAN", "897537", "Consumer Durables"],
  ["HINDUNILVR", "356865", "Fast Moving Consumer Goods"],
  ["ITC", "424961", "Fast Moving Consumer Goods"],
  ["NESTLEIND", "4598529", "Fast Moving Consumer Goods"],
  ["SUNPHARMA", "857857", "Healthcare"],
  ["DRREDDY", "225537", "Healthcare"],
  ["CIPLA", "177665", "Healthcare"],
  ["APOLLOHOSP", "40193", "Healthcare"],
  ["LT", "2939649", "Industrials / Capital Goods"],
  ["TATASTEEL", "895745", "Metals and Mining"],
  ["JSWSTEEL", "3001089", "Metals and Mining"]
].map(([tradingSymbol, instrumentToken, sector]) => ({
  tradingSymbol,
  instrumentToken,
  exchange: "NSE",
  instrumentType: "EQ",
  sector,
  selectionRationale,
  corporateActionFlags: []
}));

export const researchUniverseManifest = {
  version: RESEARCH_UNIVERSE_VERSION,
  selectionDate: "2026-09-18",
  methodologyVersion: "NSE_EQ_CURRENT_UNIVERSE_FACTUAL_DIVERSIFIED_V1",
  constructionMethodology: "Select approximately 25 current active NSE cash equities from the synchronized Phase 3 Kite instrument master, using established market prominence, broad trading activity, and sector diversification. No strategy, setup, P&L, or backtest result was used.",
  candidateFilter: { exchange: "NSE", instrumentType: "EQ", isActive: true, hasExpiry: false },
  instrumentMasterSnapshot: "Kite instrument master synchronized 2026-09-18",
  canonicalIdentity: "Kite instrumentToken",
  researchPeriod: RESEARCH_PERIOD,
  timezone: "Asia/Kolkata",
  survivorshipBias: "CURRENT_UNIVERSE_SELECTED_AT_2026_09_18",
  knownLimitations: [
    "KNOWN_LIMITATION: current-universe selection has survivorship bias and is not a point-in-time historical constituent universe.",
    "Historical OHLCV adjustment remains UNKNOWN until each instrument is reviewed before download.",
    "CAS eligibility is historically covered only for RELIANCE, HDFCBANK, and INFY in the current local dataset.",
    "The selection is a research baseline, not a portfolio or investment recommendation."
  ],
  corporateActionReview: "Review exchange corporate-action history and preserve adjustment UNKNOWN before downloading. RELIANCE has an identity conflict in the current local master: the row currently exposes 2885/738, while the canonical Kite historical identity is instrumentToken 738561 and exchangeToken 2885. Refresh/reconcile the Phase 3 master before downloading this universe.",
  instruments: researchUniverseInstruments,
  casEligibilityCoveredTokens: ["341249", "408065", "738561"],
  casEligibilityRequiredTokens: researchUniverseInstruments.filter((instrument) => !["341249", "408065", "738561"].includes(instrument.instrumentToken)).map((instrument) => instrument.instrumentToken),
  unresolvedInstruments: [],
  identityConflicts: [{
    tradingSymbol: "RELIANCE",
    canonicalInstrumentToken: "738561",
    currentMasterInstrumentToken: "2885",
    currentMasterExchangeToken: "738",
    reason: "The current local row swaps the canonical Kite instrumentToken and exchangeToken fields; verified historical data and Phase 3 reference documentation identify 738561 as the instrumentToken."
  }],
  excludedCandidates: [{ tradingSymbol: "TATAMOTORS", reason: "No unique active NSE EQ record under TATAMOTORS in the synchronized instrument master; replaced with TITAN." }]
} as const;

const identityMaterial = JSON.stringify({
  version: researchUniverseManifest.version,
  methodologyVersion: researchUniverseManifest.methodologyVersion,
  candidateFilter: researchUniverseManifest.candidateFilter,
  instrumentMasterSnapshot: researchUniverseManifest.instrumentMasterSnapshot,
  researchPeriod: researchUniverseManifest.researchPeriod,
  instruments: researchUniverseManifest.instruments
});

export const researchUniverseManifestId = createHash("sha256").update(identityMaterial).digest("hex").slice(0, 16);

export function validateResearchUniverseManifest(manifest = researchUniverseManifest) {
  const tokens = manifest.instruments.map((instrument) => instrument.instrumentToken);
  const symbols = manifest.instruments.map((instrument) => instrument.tradingSymbol);
  if (manifest.instruments.length !== 25) throw new Error(`Expected 25 research instruments, received ${manifest.instruments.length}`);
  if (new Set(tokens).size !== tokens.length) throw new Error("Research universe contains duplicate instrumentToken values");
  if (new Set(symbols).size !== symbols.length) throw new Error("Research universe contains duplicate symbols");
  if (manifest.instruments.some((instrument) => instrument.exchange !== "NSE" || instrument.instrumentType !== "EQ")) throw new Error("Research universe contains a non-NSE EQ instrument");
  return true;
}

validateResearchUniverseManifest();
