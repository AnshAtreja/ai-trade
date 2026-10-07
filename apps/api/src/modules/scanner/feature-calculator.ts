import type { ScannerConfig } from "./config";
import type { ScannerFeatures, ScannerMarketObservation } from "./production-types";

export function calculateFeatures(
  observation: ScannerMarketObservation,
  config: ScannerConfig
): ScannerFeatures {
  const price = observation.lastPrice;
  const open = observation.open;
  const high = observation.high;
  const low = observation.low;
  const previousClose = observation.close;
  const nearPct = config.nearHighLowPercent / 100;
  const breakPct = config.breakoutTolerancePercent / 100;

  const changeFromOpenPercent =
    price != null && open != null && open > 0 ? percentChange(price, open) : null;
  const changeFromPreviousClosePercent =
    price != null && previousClose != null && previousClose > 0 ? percentChange(price, previousClose) : null;

  const intradayRangePercent =
    high != null && low != null && open != null && open > 0 && high >= low
      ? ((high - low) / open) * 100
      : high != null && low != null && price != null && price > 0 && high >= low
        ? ((high - low) / price) * 100
        : null;

  const distanceFromDayHighPercent =
    price != null && high != null && high > 0 ? ((high - price) / high) * 100 : null;
  const distanceFromDayLowPercent =
    price != null && low != null && low > 0 ? ((price - low) / low) * 100 : null;

  const nearDayHigh =
    price != null && high != null && high > 0 ? price >= high * (1 - nearPct) : null;
  const nearDayLow =
    price != null && low != null && low > 0 ? price <= low * (1 + nearPct) : null;
  const breakingDayHigh =
    price != null && high != null && high > 0 ? price >= high * (1 - breakPct) : null;
  const breakingDayLow =
    price != null && low != null && low > 0 ? price <= low * (1 + breakPct) : null;

  const momentumBias = resolveMomentumBias(changeFromOpenPercent, config.momentumMinPercent);

  return {
    changeFromOpenPercent: roundNullable(changeFromOpenPercent),
    changeFromPreviousClosePercent: roundNullable(changeFromPreviousClosePercent),
    intradayRangePercent: roundNullable(intradayRangePercent),
    distanceFromDayHighPercent: roundNullable(distanceFromDayHighPercent),
    distanceFromDayLowPercent: roundNullable(distanceFromDayLowPercent),
    nearDayHigh,
    nearDayLow,
    breakingDayHigh,
    breakingDayLow,
    volume: observation.volume,
    volumeActivity: observation.volume != null ? "AVAILABLE" : "UNAVAILABLE",
    // Historical reference volume is not available until Phase 8 history exists.
    volumeSpike: "UNKNOWN",
    volumeSpikeRatio: null,
    volatilityPercent: roundNullable(intradayRangePercent),
    momentumBias
  };
}

function resolveMomentumBias(
  changeFromOpenPercent: number | null,
  minPercent: number
): ScannerFeatures["momentumBias"] {
  if (changeFromOpenPercent == null) {
    return "UNKNOWN";
  }
  if (changeFromOpenPercent >= minPercent) {
    return "UP";
  }
  if (changeFromOpenPercent <= -minPercent) {
    return "DOWN";
  }
  return "FLAT";
}

function percentChange(value: number, baseline: number) {
  return ((value - baseline) / baseline) * 100;
}

function roundNullable(value: number | null) {
  return value == null ? null : Number(value.toFixed(4));
}
