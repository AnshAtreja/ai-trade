import { describe, expect, it } from "vitest";
import { NSE_CASH_CALENDAR_VERSION, NSE_CASH_HOLIDAYS_2025, nseCashCalendar } from "./calendar";
import { datasetManifest, sessionCoverage } from "./dataset";
import type { NormalizedHistoricalCandle } from "./types";
import { EffectiveDatedCasEligibilityDataset, NseCashInstrumentSessionPolicy, type InstrumentIdentity } from "./session-policy";

function candle(timestamp: string): NormalizedHistoricalCandle { return { instrumentId: null, instrumentToken: "738561", exchange: "NSE", tradingSymbol: "TEST", interval: "1m", timestamp: new Date(timestamp), open: 100, high: 101, low: 99, close: 100, volume: 1, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: new Date(timestamp) }; }
function identity(eligibility: InstrumentIdentity["eligibility"], token = "738561"): InstrumentIdentity { return { instrumentToken: token, tradingSymbol: "TEST", exchange: "NSE", eligibility, eligibilitySource: "test fixture" }; }

describe("NSE dataset readiness", () => {
  it("classifies weekdays, weekends, reconciled holidays, and supported dates", () => {
    expect(nseCashCalendar.classify("2026-09-15")).toBe("NORMAL");
    expect(nseCashCalendar.classify("2026-09-19")).toBe("WEEKEND");
    expect(nseCashCalendar.classify("2026-09-20")).toBe("WEEKEND");
    expect(nseCashCalendar.classify("2026-09-14")).toBe("HOLIDAY");
    expect(nseCashCalendar.isTradingDay("2026-09-15")).toBe(true);
    expect(nseCashCalendar.isTradingDay("2026-09-14")).toBe(false);
  });

  it("covers the authoritative 2025 calendar, including the Budget and Muhurat special sessions", () => {
    expect(nseCashCalendar.version).toBe(NSE_CASH_CALENDAR_VERSION);
    expect(nseCashCalendar.classify("2025-09-18")).toBe("NORMAL");
    expect(nseCashCalendar.classify("2025-09-20")).toBe("WEEKEND");
    for (const date of NSE_CASH_HOLIDAYS_2025) expect(nseCashCalendar.classify(date), date).toBe("HOLIDAY");
    expect(nseCashCalendar.getDay("2025-02-01")).toMatchObject({ type: "SPECIAL_SESSION", session: { openTimeIst: "09:15", closeTimeIst: "15:30" } });
    expect(nseCashCalendar.getDay("2025-10-21")).toMatchObject({ type: "SPECIAL_SESSION", session: { openTimeIst: "13:45", closeTimeIst: "14:45" } });
    expect(nseCashCalendar.getDay("2026-02-01")).toMatchObject({ type: "SPECIAL_SESSION", session: { openTimeIst: "09:15", closeTimeIst: "15:30" } });
  });

  it("represents Muhurat Trading as a special session without assuming normal timings", () => {
    expect(nseCashCalendar.classify("2026-11-08")).toBe("SPECIAL_SESSION");
    expect(nseCashCalendar.getDay("2026-11-08")).toMatchObject({ type: "SPECIAL_SESSION", session: null });
    expect(sessionCoverage({ from: new Date("2026-11-08T00:00:00.000Z"), to: new Date("2026-11-09T00:00:00.000Z"), interval: "1m", candles: [] })).toEqual([expect.objectContaining({ classification: "UNKNOWN_POLICY", expectedCandles: null, missingCandles: 0, diagnostic: "SPECIAL_SESSION_TIMES_UNKNOWN" })]);
  });

  it("does not extrapolate outside its authoritative supported range", () => {
    expect(nseCashCalendar.classify("2024-12-31")).toBe("UNKNOWN");
    expect(nseCashCalendar.classify("2027-01-01")).toBe("UNKNOWN");
    expect(nseCashCalendar.classify("2025-02-30")).toBe("UNKNOWN");
    expect(nseCashCalendar.getSession("2024-12-31")).toBeNull();
  });

  it("retains ordinary 2025 continuous-session boundaries before CAS", () => {
    const from = new Date("2025-09-18T03:45:00.000Z");
    const to = new Date("2025-09-18T10:00:00.000Z");
    const candles = Array.from({ length: 375 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    expect(sessionCoverage({ from, to, interval: "1m", candles, instrument: identity("ELIGIBLE"), sessionPolicy: new NseCashInstrumentSessionPolicy() })[0]).toMatchObject({ classification: "COMPLETE", expectedCandles: 375, continuousOpenTimeIst: "09:15", continuousCloseTimeIst: "15:30", auctionApplicable: false });
  });

  it("uses the published 2025 Muhurat window rather than regular-session hours", () => {
    const from = new Date("2025-10-21T08:15:00.000Z");
    const to = new Date("2025-10-21T09:15:00.000Z");
    const candles = Array.from({ length: 60 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    const report = sessionCoverage({ from, to, interval: "1m", candles, instrument: identity("ELIGIBLE"), sessionPolicy: new NseCashInstrumentSessionPolicy() });
    expect(report[0]).toMatchObject({ classification: "COMPLETE", expectedCandles: 60, actualCandles: 60, continuousOpenTimeIst: "13:45", continuousCloseTimeIst: "14:45", auctionApplicable: false });
  });

  it("has zero unknown dates across the frozen research period", () => {
    const counts = new Map<string, number>();
    for (let timestamp = Date.parse("2025-09-18T00:00:00.000Z"); timestamp < Date.parse("2026-09-18T00:00:00.000Z"); timestamp += 86_400_000) {
      const kind = nseCashCalendar.classify(new Date(timestamp).toISOString().slice(0, 10));
      counts.set(kind, (counts.get(kind) ?? 0) + 1);
    }
    expect(Object.fromEntries(counts)).toEqual({ NORMAL: 241, HOLIDAY: 19, WEEKEND: 103, SPECIAL_SESSION: 2 });
    expect(counts.get("UNKNOWN") ?? 0).toBe(0);
  });

  it("derives a normal session from boundaries and preserves the 738561 partial result", () => {
    const from = new Date("2026-09-15T03:45:00.000Z"), to = new Date("2026-09-15T10:00:00.000Z");
    const full = Array.from({ length: 375 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    expect(sessionCoverage({ from, to, interval: "1m", candles: full })[0]).toMatchObject({ classification: "COMPLETE", expectedCandles: 375, actualCandles: 375 });
    expect(sessionCoverage({ from, to, interval: "1m", candles: full.slice(0, 360) })[0]).toMatchObject({ classification: "INCOMPLETE", expectedCandles: 375, actualCandles: 360, closingGap: 15, internalGaps: 0 });
  });

  it("applies CAS only after its effective date and derives 360 candles", () => {
    const from = new Date("2026-09-07T03:45:00.000Z"), to = new Date("2026-09-07T10:00:00.000Z");
    const full = Array.from({ length: 375 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    const policy = new NseCashInstrumentSessionPolicy();
    const cas = sessionCoverage({ from, to, interval: "1m", candles: full, instrument: identity("ELIGIBLE"), sessionPolicy: policy });
    const before = sessionCoverage({ from: new Date("2026-07-31T03:45:00.000Z"), to: new Date("2026-07-31T10:00:00.000Z"), interval: "1m", candles: full, instrument: identity("ELIGIBLE"), sessionPolicy: policy });
    expect(cas[0]).toMatchObject({ classification: "COMPLETE", expectedCandles: 360, actualCandles: 360, continuousCloseTimeIst: "15:15", auctionApplicable: true });
    expect(before[0]?.expectedCandles).toBe(375);
  });

  it("keeps non-CAS at 15:30 and makes unknown eligibility explicit", () => {
    const from = new Date("2026-09-07T03:45:00.000Z"), to = new Date("2026-09-07T10:00:00.000Z");
    const full = Array.from({ length: 375 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    const policy = new NseCashInstrumentSessionPolicy();
    const nonCas = sessionCoverage({ from, to, interval: "1m", candles: full, instrument: identity("NOT_ELIGIBLE", "408065"), sessionPolicy: policy });
    const unknown = sessionCoverage({ from, to, interval: "1m", candles: full.slice(0, 360), instrument: identity("UNKNOWN", "999"), sessionPolicy: policy });
    expect(nonCas[0]).toMatchObject({ expectedCandles: 375, classification: "COMPLETE", auctionApplicable: false });
    expect(unknown[0]).toMatchObject({ classification: "UNKNOWN_POLICY", expectedCandles: null, missingCandles: 0 });
  });

  it("detects a real gap inside a CAS continuous session", () => {
    const from = new Date("2026-09-07T03:45:00.000Z"), to = new Date("2026-09-07T10:00:00.000Z");
    const full = Array.from({ length: 360 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString())).filter((_, i) => i !== 120);
    const report = sessionCoverage({ from, to, interval: "1m", candles: full, instrument: identity("ELIGIBLE"), sessionPolicy: new NseCashInstrumentSessionPolicy() });
    expect(report[0]).toMatchObject({ classification: "INCOMPLETE", expectedCandles: 360, actualCandles: 359, missingCandles: 1, internalGaps: 1, closingGap: 0 });
  });

  it("includes calendar provenance in a deterministic dataset manifest", () => {
    const from = new Date("2026-09-15T03:45:00.000Z"), to = new Date("2026-09-15T03:47:00.000Z"), candles = [candle(from.toISOString()), candle(new Date(from.getTime() + 60_000).toISOString())];
    const coverage = [{ instrumentToken: "738561", candles, sessions: sessionCoverage({ from, to, interval: "1m", candles }) }];
    const one = datasetManifest({ instruments: [{ instrumentToken: "738561" }], from, to, interval: "1m", coverage });
    const two = datasetManifest({ instruments: [{ instrumentToken: "738561" }], from, to, interval: "1m", coverage });
    expect(one.datasetId).toBe(two.datasetId);
    expect(one).toMatchObject({ exchange: "NSE", segment: "CASH_EQUITY", timezone: "Asia/Kolkata", calendarVersion: "NSE_CASH_2025_2026_V2", sessionPolicyVersion: "NSE_CASH_LEGACY_GLOBAL_SESSION_V1", casEffectiveDate: "2026-08-03" });
    expect(one.instruments[0]?.actualCandles).toBe(2);
  });

  it("includes the historical eligibility dataset version in the manifest identity", () => {
    const from = new Date("2026-09-15T03:45:00.000Z"), to = new Date("2026-09-15T10:00:00.000Z");
    const candles = Array.from({ length: 360 }, (_, i) => candle(new Date(from.getTime() + i * 60_000).toISOString()));
    const identityValue = identity("UNKNOWN");
    const firstPolicy = new NseCashInstrumentSessionPolicy(new EffectiveDatedCasEligibilityDataset("CAS_HISTORY_A", []));
    const secondPolicy = new NseCashInstrumentSessionPolicy(new EffectiveDatedCasEligibilityDataset("CAS_HISTORY_B", []));
    const firstSessions = sessionCoverage({ from, to, interval: "1m", candles, instrument: identityValue, sessionPolicy: firstPolicy });
    const secondSessions = sessionCoverage({ from, to, interval: "1m", candles, instrument: identityValue, sessionPolicy: secondPolicy });
    const first = datasetManifest({ instruments: [{ instrumentToken: "738561", identity: identityValue }], from, to, interval: "1m", coverage: [{ instrumentToken: "738561", candles, sessions: firstSessions }] });
    const second = datasetManifest({ instruments: [{ instrumentToken: "738561", identity: identityValue }], from, to, interval: "1m", coverage: [{ instrumentToken: "738561", candles, sessions: secondSessions }] });
    expect(first.eligibilityDatasetVersion).toBe("CAS_HISTORY_A");
    expect(first.datasetId).not.toBe(second.datasetId);
  });
});
