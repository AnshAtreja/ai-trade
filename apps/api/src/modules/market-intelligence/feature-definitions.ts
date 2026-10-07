import { FEATURE_DEFINITIONS_VERSION, type FeatureValues } from "./feature-types";

export const ATR_PERIOD_9A = 14;

export interface FeatureDefinition {
  interval: "source" | "1m";
  lookback: number | "session" | null;
  reset: "SESSION" | "NONE";
  units: "price" | "percent" | "minutes" | "shares" | "boolean" | "bucket" | "ratio";
  normalization: string;
  minObservations: number;
  missing: string;
}

const unavailable = (units: FeatureDefinition["units"]): FeatureDefinition => ({
  interval: "source", lookback: null, reset: "NONE", units, normalization: "not implemented in 9A",
  minObservations: 0, missing: "NOT_APPLICABLE; later Phase 9 subphase"
});

export const featureDefinitionRegistry: Readonly<Record<keyof FeatureValues, FeatureDefinition>> = Object.freeze({
  lastPrice: { interval: "source", lookback: 1, reset: "NONE", units: "price", normalization: "candle close", minObservations: 1, missing: "UNSUPPORTED invalid OHLC" },
  open: { interval: "source", lookback: 1, reset: "NONE", units: "price", normalization: "candle open", minObservations: 1, missing: "UNSUPPORTED invalid OHLC" },
  high: { interval: "source", lookback: 1, reset: "NONE", units: "price", normalization: "candle high", minObservations: 1, missing: "UNSUPPORTED invalid OHLC" },
  low: { interval: "source", lookback: 1, reset: "NONE", units: "price", normalization: "candle low", minObservations: 1, missing: "UNSUPPORTED invalid OHLC" },
  sessionHigh: { interval: "source", lookback: "session", reset: "SESSION", units: "price", normalization: "max observed high since session open", minObservations: 1, missing: "DATA_GAP when session continuity fails" },
  sessionLow: { interval: "source", lookback: "session", reset: "SESSION", units: "price", normalization: "min observed low since session open", minObservations: 1, missing: "DATA_GAP when session continuity fails" },
  distanceFromSessionHighPct: { interval: "source", lookback: "session", reset: "SESSION", units: "percent", normalization: "(sessionHigh-close)/sessionHigh*100", minObservations: 1, missing: "DATA_GAP when session continuity fails" },
  distanceFromSessionLowPct: { interval: "source", lookback: "session", reset: "SESSION", units: "percent", normalization: "(close-sessionLow)/sessionLow*100", minObservations: 1, missing: "DATA_GAP when session continuity fails" },
  sessionVwap: { interval: "source", lookback: "session", reset: "SESSION", units: "price", normalization: "sum(typicalPrice*barVolume)/sum(barVolume); typicalPrice=(high+low+close)/3", minObservations: 1, missing: "DATA_GAP on missing bar; NOT_APPLICABLE without volume or if cumulative volume is zero" },
  vwapDistancePct: { interval: "source", lookback: "session", reset: "SESSION", units: "percent", normalization: "(close-sessionVwap)/sessionVwap*100", minObservations: 1, missing: "inherits sessionVwap quality" },
  aboveVwap: { interval: "source", lookback: "session", reset: "SESSION", units: "boolean", normalization: "close>sessionVwap; equality is false", minObservations: 1, missing: "inherits sessionVwap quality" },
  atr: { interval: "source", lookback: ATR_PERIOD_9A, reset: "SESSION", units: "price", normalization: "simple mean of last 14 true ranges; first true range is high-low, subsequent use prior observed close", minObservations: ATR_PERIOD_9A, missing: "INSUFFICIENT_HISTORY before 14; DATA_GAP after missing bar" },
  atrPct: { interval: "source", lookback: ATR_PERIOD_9A, reset: "SESSION", units: "percent", normalization: "ATR/close*100", minObservations: ATR_PERIOD_9A, missing: "inherits ATR quality" },
  gapPct: { interval: "source", lookback: 1, reset: "SESSION", units: "percent", normalization: "(session opening price-previous session close)/previous session close*100", minObservations: 1, missing: "INSUFFICIENT_HISTORY without previous close; DATA_GAP if opening candle absent" },
  cumulativeVolume: { interval: "source", lookback: "session", reset: "SESSION", units: "shares", normalization: "sum per-bar volume", minObservations: 1, missing: "NOT_APPLICABLE if any bar lacks volume; DATA_GAP if bar missing" },
  minutesSinceMarketOpen: { interval: "source", lookback: 1, reset: "SESSION", units: "minutes", normalization: "candle close minus official session open", minObservations: 1, missing: "UNSUPPORTED outside modeled session" },
  timeOfDayBucket: { interval: "source", lookback: 1, reset: "SESSION", units: "bucket", normalization: "OPEN first 60m; CLOSE final 60m; otherwise MID", minObservations: 1, missing: "UNSUPPORTED outside modeled session" },
  realizedVolatility: unavailable("percent"), recentRangeExpansion: unavailable("ratio"), relativeVolume: unavailable("ratio"), volumeAcceleration: unavailable("ratio"),
  openingRangeHigh: unavailable("price"), openingRangeLow: unavailable("price"), openingRangePosition: unavailable("ratio"), openingRangeBreakState: unavailable("bucket"),
  marketRelativeStrength: unavailable("percent"), sectorRelativeStrength: unavailable("percent"), benchmarkRelativeReturn: unavailable("percent"),
  marketBreadth: unavailable("ratio"), marketTrend: unavailable("bucket"), marketVolatilityContext: unavailable("percent"),
  sectorTrend: unavailable("bucket"), sectorBreadth: unavailable("ratio")
});

export const featureDefinitionVersion = FEATURE_DEFINITIONS_VERSION;
