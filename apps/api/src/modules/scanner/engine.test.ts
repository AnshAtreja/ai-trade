import { describe, expect, it } from "vitest";
import { intradayScannerEngine } from "./engine";
import { mockIntradayInstruments } from "./mock-data";
import type { IntradayInstrumentInput, IntradayWatchlistCandidate } from "./types";

function getInstrument(symbol: string): IntradayInstrumentInput {
  const instrument = mockIntradayInstruments.find((item) => item.symbol === symbol);

  if (!instrument) {
    throw new Error(`Missing mock instrument ${symbol}`);
  }

  return { ...instrument };
}

function scanOne(instrument: IntradayInstrumentInput): IntradayWatchlistCandidate {
  return intradayScannerEngine.scan([instrument])[0];
}

describe("IntradayScannerEngine", () => {
  it("returns NVDA as bullish with volume spike and breakout signals", () => {
    const result = scanOne(getInstrument("NVDA"));

    expect(result.symbol).toBe("NVDA");
    expect(result.direction).toBe("BULLISH");
    expect(result.matchedSignals).toContain("VOLUME_SPIKE");
    expect(result.matchedSignals).toContain("BREAKOUT_ABOVE_PREVIOUS_HIGH");
  });

  it("removes NVDA volume spike and lowers score when volume drops below average", () => {
    const baseline = scanOne(getInstrument("NVDA"));
    const lowVolumeNvda = {
      ...getInstrument("NVDA"),
      currentVolume: 10_000_000
    };
    const result = scanOne(lowVolumeNvda);

    expect(result.matchedSignals).not.toContain("VOLUME_SPIKE");
    expect(result.score).toBeLessThan(baseline.score);
  });

  it("removes NVDA breakout signal when current price is below previous high", () => {
    const nvdaBelowPreviousHigh = {
      ...getInstrument("NVDA"),
      currentPrice: 1038
    };
    const result = scanOne(nvdaBelowPreviousHigh);

    expect(result.matchedSignals).not.toContain("BREAKOUT_ABOVE_PREVIOUS_HIGH");
  });

  it("keeps AAPL lower conviction because of low volume", () => {
    const result = scanOne(getInstrument("AAPL"));

    expect(result.matchedSignals).not.toContain("VOLUME_SPIKE");
    expect(result.score).toBeLessThan(50);
    expect(["NEUTRAL", "BULLISH"]).toContain(result.direction);
  });

  it("returns TSLA as bearish with breakdown below previous low", () => {
    const result = scanOne(getInstrument("TSLA"));

    expect(result.symbol).toBe("TSLA");
    expect(result.direction).toBe("BEARISH");
    expect(result.matchedSignals).toContain("BREAKDOWN_BELOW_PREVIOUS_LOW");
  });

  it("ranks strongest setup first and weak or neutral setups lower", () => {
    const results = intradayScannerEngine.scan(mockIntradayInstruments);

    expect(results[0].symbol).toBe("NVDA");

    const nvda = results.find((result) => result.symbol === "NVDA");
    const aapl = results.find((result) => result.symbol === "AAPL");

    expect(nvda).toBeDefined();
    expect(aapl).toBeDefined();
    expect(aapl!.score).toBeLessThan(nvda!.score);
    expect(results.at(-1)?.symbol).toBe("AAPL");
  });
});
