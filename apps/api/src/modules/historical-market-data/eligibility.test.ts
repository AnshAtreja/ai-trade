import { describe, expect, it } from "vitest";
import { datasetManifest, sessionCoverage } from "./dataset";
import { selectResearchCandles } from "./eligibility";
import type { NormalizedHistoricalCandle } from "./types";

function candle(timestamp: string, interval: "1m" | "5m" = "1m"): NormalizedHistoricalCandle {
  return { instrumentId: null, instrumentToken: "738561", exchange: "NSE", tradingSymbol: "RELIANCE", interval, timestamp: new Date(timestamp), open: 100, high: 101, low: 99, close: 100, volume: 1, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: new Date(timestamp) };
}

function report(candles: NormalizedHistoricalCandle[], interval: "1m" | "5m" = "1m") {
  const from = new Date("2025-09-18T03:45:00.000Z");
  const to = new Date(interval === "1m" ? "2025-09-18T10:00:00.000Z" : "2025-09-18T10:00:00.000Z");
  return sessionCoverage({ from, to, interval, candles });
}

describe("research data eligibility contract", () => {
  it("classifies complete, incomplete, missing, and unknown-policy sessions", () => {
    const full = Array.from({ length: 375 }, (_, i) => candle(new Date(Date.parse("2025-09-18T03:45:00.000Z") + i * 60_000).toISOString()));
    expect(report(full)[0]?.classification).toBe("COMPLETE");
    expect(report(full.slice(0, 374))[0]?.classification).toBe("INCOMPLETE");
    expect(report([])[0]?.classification).toBe("MISSING");
    expect(sessionCoverage({ from: new Date("2026-11-08T00:00:00.000Z"), to: new Date("2026-11-09T00:00:00.000Z"), interval: "1m", candles: [] })[0]?.classification).toBe("UNKNOWN_POLICY");
  });

  it("supports interval-aware eligibility, including a complete 5m view beside incomplete 1m data", () => {
    const oneMinute = Array.from({ length: 375 }, (_, i) => candle(new Date(Date.parse("2025-09-18T03:45:00.000Z") + i * 60_000).toISOString())).filter((_, i) => i !== 120);
    const fiveMinute = Array.from({ length: 75 }, (_, i) => candle(new Date(Date.parse("2025-09-18T03:45:00.000Z") + i * 5 * 60_000).toISOString(), "5m"));
    expect(report(oneMinute)[0]?.classification).toBe("INCOMPLETE");
    expect(report(fiveMinute, "5m")[0]?.classification).toBe("COMPLETE");
  });

  it("requires an explicit consumer choice and emits DATA_GAP for strict views", () => {
    const full = Array.from({ length: 375 }, (_, i) => candle(new Date(Date.parse("2025-09-18T03:45:00.000Z") + i * 60_000).toISOString()));
    const sessions = report(full.slice(0, 374));
    const strict = selectResearchCandles({ candles: full.slice(0, 374), sessions, interval: "1m", requireCompleteSession: true });
    const permissive = selectResearchCandles({ candles: full.slice(0, 374), sessions, interval: "1m", requireCompleteSession: false });
    expect(strict.candles).toHaveLength(0);
    expect(strict.rejectedSessions[0]).toMatchObject({ classification: "INCOMPLETE", reason: "DATA_GAP" });
    expect(permissive.candles).toHaveLength(374);
    expect(permissive.rejectedSessions).toHaveLength(0);
  });

  it("excludes holiday raw observations from policy-valid research views", () => {
    const holiday = candle("2026-02-19T03:45:00.000Z");
    const sessions = sessionCoverage({ from: new Date("2026-02-19T00:00:00.000Z"), to: new Date("2026-02-20T00:00:00.000Z"), interval: "1m", candles: [holiday] });
    expect(sessions).toHaveLength(0);
    expect(selectResearchCandles({ candles: [holiday], sessions, interval: "1m", requireCompleteSession: true }).candles).toHaveLength(0);
  });

  it("does not change the canonical dataset identity when filtering eligibility", () => {
    const from = new Date("2025-09-18T03:45:00.000Z");
    const to = new Date("2025-09-18T10:00:00.000Z");
    const candles = Array.from({ length: 375 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    const sessions = sessionCoverage({ from, to, interval: "1m", candles });
    const one = datasetManifest({ instruments: [{ instrumentToken: "738561" }], from, to, interval: "1m", coverage: [{ instrumentToken: "738561", candles, sessions }] });
    const strict = selectResearchCandles({ candles, sessions, interval: "1m", requireCompleteSession: true });
    const two = datasetManifest({ instruments: [{ instrumentToken: "738561" }], from, to, interval: "1m", coverage: [{ instrumentToken: "738561", candles: strict.candles, sessions }] });
    expect(one.datasetId).toBe(two.datasetId);
  });
});
