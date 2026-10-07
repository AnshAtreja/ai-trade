import type {
  IntradayDirection,
  IntradayInstrumentInput,
  IntradayScannerOptions,
  IntradaySignal,
  IntradayWatchlistCandidate
} from "./types";

interface SignalResult {
  signal: IntradaySignal;
  direction: Exclude<IntradayDirection, "NEUTRAL">;
  points: number;
  detail: string;
}

const defaultScannerOptions: Required<IntradayScannerOptions> = {
  gapThresholdPercent: 1,
  volumeSpikeThreshold: 1.5,
  nearHighLowThresholdPercent: 0.5
};

export class IntradayScannerEngine {
  scan(
    instruments: IntradayInstrumentInput[],
    options: IntradayScannerOptions = {}
  ): IntradayWatchlistCandidate[] {
    const resolvedOptions = { ...defaultScannerOptions, ...options };

    return instruments
      .map((instrument) => this.scoreInstrument(instrument, resolvedOptions))
      .sort((a, b) => b.score - a.score || a.symbol.localeCompare(b.symbol));
  }

  private scoreInstrument(
    instrument: IntradayInstrumentInput,
    options: Required<IntradayScannerOptions>
  ): IntradayWatchlistCandidate {
    const signals = this.detectSignals(instrument, options);
    const bullishPoints = this.sumDirection(signals, "BULLISH");
    const bearishPoints = this.sumDirection(signals, "BEARISH");
    const direction = this.resolveDirection(bullishPoints, bearishPoints);
    const dominantPoints = Math.max(bullishPoints, bearishPoints);
    const conflictPenalty = Math.min(bullishPoints, bearishPoints) * 0.35;
    const vwapBoost = this.getVwapAlignmentBoost(instrument, direction);
    const score = clampScore(Math.round(dominantPoints - conflictPenalty + vwapBoost));

    return {
      symbol: instrument.symbol.toUpperCase(),
      direction,
      score,
      matchedSignals: signals.map((signal) => signal.signal),
      explanation: this.buildExplanation(instrument, signals, direction, score)
    };
  }

  private detectSignals(
    instrument: IntradayInstrumentInput,
    options: Required<IntradayScannerOptions>
  ): SignalResult[] {
    const signals: SignalResult[] = [];
    const gapPercent = percentChange(instrument.openPrice, instrument.previousClose);
    const volumeSpikeRatio = safeRatio(instrument.currentVolume, instrument.averageVolume);
    const nearRangePercent = options.nearHighLowThresholdPercent / 100;

    if (gapPercent >= options.gapThresholdPercent) {
      signals.push({
        signal: "GAP_UP",
        direction: "BULLISH",
        points: 18,
        detail: `gap up ${formatPercent(gapPercent)}`
      });
    }

    if (gapPercent <= -options.gapThresholdPercent) {
      signals.push({
        signal: "GAP_DOWN",
        direction: "BEARISH",
        points: 18,
        detail: `gap down ${formatPercent(Math.abs(gapPercent))}`
      });
    }

    if (volumeSpikeRatio >= options.volumeSpikeThreshold) {
      signals.push({
        signal: "VOLUME_SPIKE",
        direction: instrument.currentPrice >= instrument.openPrice ? "BULLISH" : "BEARISH",
        points: 20,
        detail: `volume ${volumeSpikeRatio.toFixed(2)}x average`
      });
    }

    if (instrument.dayHigh > 0 && instrument.currentPrice >= instrument.dayHigh * (1 - nearRangePercent)) {
      signals.push({
        signal: "PRICE_NEAR_DAY_HIGH",
        direction: "BULLISH",
        points: 14,
        detail: `trading near day high ${formatPrice(instrument.dayHigh)}`
      });
    }

    if (instrument.dayLow > 0 && instrument.currentPrice <= instrument.dayLow * (1 + nearRangePercent)) {
      signals.push({
        signal: "PRICE_NEAR_DAY_LOW",
        direction: "BEARISH",
        points: 14,
        detail: `trading near day low ${formatPrice(instrument.dayLow)}`
      });
    }

    if (instrument.previousHigh && instrument.currentPrice > instrument.previousHigh) {
      signals.push({
        signal: "BREAKOUT_ABOVE_PREVIOUS_HIGH",
        direction: "BULLISH",
        points: 28,
        detail: `above previous high ${formatPrice(instrument.previousHigh)}`
      });
    }

    if (instrument.previousLow && instrument.currentPrice < instrument.previousLow) {
      signals.push({
        signal: "BREAKDOWN_BELOW_PREVIOUS_LOW",
        direction: "BEARISH",
        points: 28,
        detail: `below previous low ${formatPrice(instrument.previousLow)}`
      });
    }

    return signals;
  }

  private sumDirection(signals: SignalResult[], direction: Exclude<IntradayDirection, "NEUTRAL">) {
    return signals
      .filter((signal) => signal.direction === direction)
      .reduce((total, signal) => total + signal.points, 0);
  }

  private resolveDirection(bullishPoints: number, bearishPoints: number): IntradayDirection {
    if (bullishPoints === 0 && bearishPoints === 0) {
      return "NEUTRAL";
    }

    if (Math.abs(bullishPoints - bearishPoints) < 12) {
      return "NEUTRAL";
    }

    return bullishPoints > bearishPoints ? "BULLISH" : "BEARISH";
  }

  private getVwapAlignmentBoost(instrument: IntradayInstrumentInput, direction: IntradayDirection) {
    if (!instrument.vwap || direction === "NEUTRAL") {
      return 0;
    }

    if (direction === "BULLISH" && instrument.currentPrice >= instrument.vwap) {
      return 6;
    }

    if (direction === "BEARISH" && instrument.currentPrice <= instrument.vwap) {
      return 6;
    }

    return -6;
  }

  private buildExplanation(
    instrument: IntradayInstrumentInput,
    signals: SignalResult[],
    direction: IntradayDirection,
    score: number
  ) {
    if (signals.length === 0) {
      return `${instrument.symbol.toUpperCase()} has no strong intraday scanner signals, so it remains neutral with a ${score}/100 score.`;
    }

    const signalText = signals.map((signal) => signal.detail).join(", ");
    const vwapText = instrument.vwap
      ? ` Price is ${instrument.currentPrice >= instrument.vwap ? "above" : "below"} VWAP ${formatPrice(instrument.vwap)}.`
      : "";

    return `${instrument.symbol.toUpperCase()} is ranked ${direction.toLowerCase()} with a ${score}/100 score because it shows ${signalText}.${vwapText}`;
  }
}

function percentChange(value: number, baseline: number) {
  if (baseline <= 0) {
    return 0;
  }

  return ((value - baseline) / baseline) * 100;
}

function safeRatio(value: number, baseline: number) {
  if (baseline <= 0) {
    return 0;
  }

  return value / baseline;
}

function clampScore(score: number) {
  return Math.max(0, Math.min(100, score));
}

function formatPercent(value: number) {
  return `${value.toFixed(2)}%`;
}

function formatPrice(value: number) {
  return `$${value.toFixed(2)}`;
}

export const intradayScannerEngine = new IntradayScannerEngine();
