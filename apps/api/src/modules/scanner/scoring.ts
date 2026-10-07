import type { ScannerConfig } from "./config";
import type {
  ScannerDirection,
  ScannerFeatures,
  ScannerScoreComponents
} from "./production-types";

export function scoreCandidate(
  features: ScannerFeatures,
  config: ScannerConfig
): { score: number; scoreComponents: ScannerScoreComponents; direction: ScannerDirection; reasons: string[] } {
  const weights = config.scoreWeights;
  const volumeActivity = scoreVolumeActivity(features, weights.volumeActivity, config.minVolume);
  const momentum = scoreMomentum(features, weights.momentum);
  const rangeExpansion = scoreRange(features, weights.rangeExpansion, config);
  const dayExtremumProximity = scoreDayExtremum(features, weights.dayExtremumProximity);
  const priceMovement = scorePriceMovement(features, weights.priceMovement);

  const scoreComponents: ScannerScoreComponents = {
    volumeActivity,
    momentum,
    rangeExpansion,
    dayExtremumProximity,
    priceMovement
  };

  const score = clamp(
    Math.round(
      scoreComponents.volumeActivity +
        scoreComponents.momentum +
        scoreComponents.rangeExpansion +
        scoreComponents.dayExtremumProximity +
        scoreComponents.priceMovement
    )
  );

  const direction = resolveDirection(features);
  const reasons = buildReasons(features, scoreComponents);

  return { score, scoreComponents, direction, reasons };
}

function scoreVolumeActivity(features: ScannerFeatures, maxPoints: number, minVolume: number) {
  if (features.volumeActivity !== "AVAILABLE" || features.volume == null) {
    return 0;
  }

  const ratio = features.volume / Math.max(minVolume, 1);
  if (ratio >= 10) {
    return maxPoints;
  }
  if (ratio >= 5) {
    return Math.round(maxPoints * 0.8);
  }
  if (ratio >= 2) {
    return Math.round(maxPoints * 0.55);
  }
  if (ratio >= 1) {
    return Math.round(maxPoints * 0.35);
  }
  return Math.round(maxPoints * 0.15);
}

function scoreMomentum(features: ScannerFeatures, maxPoints: number) {
  const move = features.changeFromOpenPercent;
  if (move == null) {
    return 0;
  }

  const abs = Math.abs(move);
  if (abs >= 2) {
    return maxPoints;
  }
  if (abs >= 1) {
    return Math.round(maxPoints * 0.75);
  }
  if (abs >= 0.5) {
    return Math.round(maxPoints * 0.5);
  }
  if (abs >= 0.25) {
    return Math.round(maxPoints * 0.3);
  }
  return 0;
}

function scoreRange(features: ScannerFeatures, maxPoints: number, config: ScannerConfig) {
  const range = features.intradayRangePercent;
  if (range == null) {
    return 0;
  }

  if (range < config.minVolatilityPercent) {
    return 0;
  }

  if (range >= 3) {
    return maxPoints;
  }
  if (range >= 1.5) {
    return Math.round(maxPoints * 0.7);
  }
  if (range >= 0.75) {
    return Math.round(maxPoints * 0.45);
  }
  return Math.round(maxPoints * 0.2);
}

function scoreDayExtremum(features: ScannerFeatures, maxPoints: number) {
  if (features.breakingDayHigh || features.breakingDayLow) {
    return maxPoints;
  }
  if (features.nearDayHigh || features.nearDayLow) {
    return Math.round(maxPoints * 0.7);
  }
  return 0;
}

function scorePriceMovement(features: ScannerFeatures, maxPoints: number) {
  const move = features.changeFromPreviousClosePercent ?? features.changeFromOpenPercent;
  if (move == null) {
    return 0;
  }
  const abs = Math.abs(move);
  if (abs >= 1.5) {
    return maxPoints;
  }
  if (abs >= 0.75) {
    return Math.round(maxPoints * 0.6);
  }
  if (abs >= 0.3) {
    return Math.round(maxPoints * 0.3);
  }
  return 0;
}

function resolveDirection(features: ScannerFeatures): ScannerDirection {
  let bullish = 0;
  let bearish = 0;

  if (features.momentumBias === "UP") {
    bullish += 2;
  }
  if (features.momentumBias === "DOWN") {
    bearish += 2;
  }
  if (features.nearDayHigh || features.breakingDayHigh) {
    bullish += 2;
  }
  if (features.nearDayLow || features.breakingDayLow) {
    bearish += 2;
  }
  if ((features.changeFromPreviousClosePercent ?? 0) > 0.2) {
    bullish += 1;
  }
  if ((features.changeFromPreviousClosePercent ?? 0) < -0.2) {
    bearish += 1;
  }

  if (bullish === 0 && bearish === 0) {
    return "NEUTRAL";
  }

  if (bullish > 0 && bearish > 0 && Math.abs(bullish - bearish) <= 1) {
    return "NEUTRAL";
  }

  return bullish > bearish ? "BULLISH" : "BEARISH";
}

function buildReasons(features: ScannerFeatures, components: ScannerScoreComponents): string[] {
  const reasons: string[] = [];

  if (features.momentumBias === "UP" && components.momentum > 0) {
    reasons.push("positive intraday momentum");
  }
  if (features.momentumBias === "DOWN" && components.momentum > 0) {
    reasons.push("negative intraday momentum");
  }
  if (features.volumeActivity === "AVAILABLE" && components.volumeActivity > 0) {
    reasons.push("elevated volume activity");
  }
  if (features.volumeSpike === "UNKNOWN") {
    // Do not claim a volume spike without a historical baseline.
  }
  if (features.nearDayHigh) {
    reasons.push("near day high");
  }
  if (features.nearDayLow) {
    reasons.push("near day low");
  }
  if (features.breakingDayHigh) {
    reasons.push("breaking day high");
  }
  if (features.breakingDayLow) {
    reasons.push("breaking day low");
  }
  if (features.intradayRangePercent != null && components.rangeExpansion > 0) {
    reasons.push("range expansion");
  }
  if (
    features.changeFromPreviousClosePercent != null &&
    Math.abs(features.changeFromPreviousClosePercent) >= 0.3 &&
    components.priceMovement > 0
  ) {
    reasons.push(
      features.changeFromPreviousClosePercent >= 0
        ? "positive change from previous close"
        : "negative change from previous close"
    );
  }

  return reasons;
}

function clamp(score: number) {
  return Math.max(0, Math.min(100, score));
}
