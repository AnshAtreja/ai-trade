import { createHash } from "node:crypto";

export const REGIME_SCHEMA_VERSION = "MARKET_REGIME_SNAPSHOT_V1";
export const REGIME_DEFINITION_VERSION = "MARKET_REGIME_V1";

// Percent units throughout. A new semantic threshold requires a V2 definition.
export const regimeDefinition = Object.freeze({
  version: REGIME_DEFINITION_VERSION,
  input: "finalized 9B market/sector context; no strategy outcomes",
  trend: Object.freeze({
    minimum15mPct: 0.12,
    minimum30mPct: 0.2,
    maximumRange15mPct: 0.1,
    maximumRange30mPct: 0.16,
    nearSessionExtremePct: 0.4,
    minimumDirectionalBreadthPct: 55,
    maximumOpposingBreadthPct: 45,
    rangeBreadthLowerPct: 40,
    rangeBreadthUpperPct: 60
  }),
  volatility: Object.freeze({
    proxy: "absolute exact same-session 5m benchmark return",
    baseline: "median of up to 60 prior unique completed 1m observations, across sessions",
    minimumPriorObservations: 20,
    maximumPriorObservations: 60,
    highMedianMultiple: 2,
    lowMedianMultiple: 0.5,
    zeroMedian: "UNKNOWN"
  }),
  relative: Object.freeze({ horizon: "15m", materialDifferencePct: 0.1 }),
  breadth: "9B frozen 25-equity sample and frozen sector subsets; never whole-NSE breadth",
  evidence: "HIGH = four agreeing directional checks; MEDIUM = three; LOW = otherwise; not probability",
  hysteresis: "none; report observed transitions before considering versioned smoothing",
  eventDriven: "not classified without external event evidence"
});

export const regimeDefinitionHash = createHash("sha256")
  .update(JSON.stringify(regimeDefinition)).digest("hex");
