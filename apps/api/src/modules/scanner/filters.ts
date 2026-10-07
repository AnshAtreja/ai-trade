import type { ScannerConfig } from "./config";
import type { ScannerFeatures, ScannerMarketObservation } from "./production-types";

export type FilterDecision =
  | { ok: true }
  | { ok: false; reason: "MISSING_PRICE" | "STALE" | "NO_MARKET_DATA" | "PRICE_BOUNDS" | "LIQUIDITY" | "VOLATILITY" | "INACTIVE" };

export function applyScannerFilters(input: {
  observation: ScannerMarketObservation;
  features: ScannerFeatures;
  config: ScannerConfig;
  isActive: boolean;
}): FilterDecision {
  const { observation, features, config, isActive } = input;

  if (!isActive) {
    return { ok: false, reason: "INACTIVE" };
  }

  if (observation.missing || observation.lastPrice == null) {
    return { ok: false, reason: observation.missing ? "NO_MARKET_DATA" : "MISSING_PRICE" };
  }

  if (observation.lastPrice <= 0) {
    return { ok: false, reason: "MISSING_PRICE" };
  }

  if (observation.stale) {
    return { ok: false, reason: "STALE" };
  }

  if (observation.lastPrice < config.minPrice || observation.lastPrice > config.maxPrice) {
    return { ok: false, reason: "PRICE_BOUNDS" };
  }

  if (observation.volume != null && observation.volume < config.minVolume) {
    return { ok: false, reason: "LIQUIDITY" };
  }

  // If volume is missing, do not invent liquidity — skip on absolute min only when present.
  // Instruments without volume still pass liquidity when volume is UNAVAILABLE (LTP-only mode).

  if (features.volatilityPercent != null) {
    if (
      features.volatilityPercent < config.minVolatilityPercent ||
      features.volatilityPercent > config.maxVolatilityPercent
    ) {
      return { ok: false, reason: "VOLATILITY" };
    }
  }

  return { ok: true };
}
