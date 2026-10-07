import { createHash } from "node:crypto";
import { candleIntervalMs } from "../../common/utils/candle-buckets";
import { getTradingDate } from "../../common/utils/trading-date";
import type { HistoricalCandleIntervalCode } from "../../db/domain";
import type { NormalizedHistoricalCandle } from "./types";
import { nseCashCalendar, type ExchangeTradingCalendar } from "./calendar";
import { legacyGlobalSessionPolicy, type InstrumentIdentity, type InstrumentSessionPolicy } from "./session-policy";

export type SessionCompleteness = "COMPLETE" | "INCOMPLETE" | "MISSING" | "UNKNOWN_POLICY";
export type SessionDiagnostic = "SPECIAL_SESSION_TIMES_UNKNOWN";

export interface SessionCoverage {
  tradingDate: string;
  classification: SessionCompleteness;
  expectedCandles: number | null;
  actualCandles: number;
  missingCandles: number;
  coveragePercent: number | null;
  firstCandle: string | null;
  lastCandle: string | null;
  openingGap: number;
  closingGap: number;
  internalGaps: number;
  continuousOpenTimeIst?: string;
  continuousCloseTimeIst?: string;
  auctionApplicable?: boolean;
  eligibility?: string;
  eligibilitySource?: string;
  sessionPolicyVersion?: string;
  eligibilityDatasetVersion?: string;
  diagnostic?: SessionDiagnostic;
}

export function sessionCoverage(input: {
  from: Date;
  to: Date;
  interval: HistoricalCandleIntervalCode;
  candles: NormalizedHistoricalCandle[];
  calendar?: ExchangeTradingCalendar;
  instrument?: InstrumentIdentity;
  sessionPolicy?: InstrumentSessionPolicy;
}): SessionCoverage[] {
  const calendar = input.calendar ?? nseCashCalendar;
  const policy = input.sessionPolicy ?? legacyGlobalSessionPolicy;
  const step = candleIntervalMs(input.interval);
  const out: SessionCoverage[] = [];
  const candlesByTradingDate = new Map<string, NormalizedHistoricalCandle[]>();
  for (const candle of input.candles) {
    const date = getTradingDate(candle.timestamp);
    const bucket = candlesByTradingDate.get(date) ?? [];
    bucket.push(candle);
    candlesByTradingDate.set(date, bucket);
  }
  for (const candles of candlesByTradingDate.values()) candles.sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());

  for (let cursor = dayStart(input.from); cursor < input.to.getTime(); cursor += 86_400_000) {
    const date = getTradingDate(new Date(cursor));
    const day = calendar.getDay(date);
    if (day.type === "UNKNOWN") {
      out.push(empty(date, "UNKNOWN_POLICY"));
      continue;
    }
    if (day.type === "SPECIAL_SESSION" && !day.session) {
      out.push({ ...empty(date, "UNKNOWN_POLICY"), diagnostic: "SPECIAL_SESSION_TIMES_UNKNOWN" });
      continue;
    }
    if (!day.session) continue;

    const identity = input.instrument ?? { instrumentToken: "unknown", tradingSymbol: "unknown", exchange: "NSE", eligibility: "UNKNOWN" as const, eligibilitySource: "No instrument identity supplied" };
    const basePolicySession = input.instrument ? policy.getSession(identity, date) : legacyGlobalSessionPolicy.getSession(identity, date);
    // Exchange-published special windows supersede regular and CAS continuous-session templates.
    const policySession = day.type === "SPECIAL_SESSION" && day.session
      ? {
          ...basePolicySession,
          continuousSession: day.session,
          closingAuctionSession: { applicable: false, openTimeIst: null, closeTimeIst: null, source: "Calendar-defined special trading session" }
        }
      : basePolicySession;
    const continuous = policySession.continuousSession;
    if (!continuous) {
      out.push(empty(date, "UNKNOWN_POLICY"));
      continue;
    }

    const start = new Date(`${date}T${continuous.openTimeIst}:00+05:30`).getTime();
    const end = new Date(`${date}T${continuous.closeTimeIst}:00+05:30`).getTime();
    const expected = new Set<number>();
    for (let timestamp = start; timestamp < end; timestamp += step) {
      if (timestamp >= input.from.getTime() && timestamp < input.to.getTime()) expected.add(timestamp);
    }
    if (!expected.size) continue;

    const dayCandles = candlesByTradingDate.get(date) ?? [];
    const actual = dayCandles.filter((candle) => expected.has(candle.timestamp.getTime()));
    if (input.instrument && policySession.eligibility === "UNKNOWN") {
      const policyWindow = dayCandles.filter((candle) => candle.timestamp.getTime() >= start && candle.timestamp.getTime() < Math.min(end, input.to.getTime()));
      out.push({ ...empty(date, "UNKNOWN_POLICY"), actualCandles: policyWindow.length, firstCandle: policyWindow[0]?.timestamp.toISOString() ?? null, lastCandle: policyWindow.at(-1)?.timestamp.toISOString() ?? null, continuousOpenTimeIst: continuous.openTimeIst, continuousCloseTimeIst: continuous.closeTimeIst, auctionApplicable: false, eligibility: policySession.eligibility, eligibilitySource: policySession.eligibilitySource, sessionPolicyVersion: policySession.policyVersion, eligibilityDatasetVersion: policySession.eligibilityDatasetVersion });
      continue;
    }

    const present = new Set(actual.map((candle) => candle.timestamp.getTime()));
    const missing = [...expected].filter((timestamp) => !present.has(timestamp)).sort((a, b) => a - b);
    const openingGap = missing.filter((timestamp) => timestamp < (actual[0]?.timestamp.getTime() ?? Infinity)).length;
    const closingGap = missing.filter((timestamp) => timestamp > (actual.at(-1)?.timestamp.getTime() ?? -Infinity)).length;
    const classification: SessionCompleteness = !actual.length ? "MISSING" : missing.length ? "INCOMPLETE" : "COMPLETE";
    out.push({ tradingDate: date, classification, expectedCandles: expected.size, actualCandles: actual.length, missingCandles: missing.length, coveragePercent: actual.length / expected.size * 100, firstCandle: actual[0]?.timestamp.toISOString() ?? null, lastCandle: actual.at(-1)?.timestamp.toISOString() ?? null, openingGap, closingGap, internalGaps: Math.max(0, missing.length - openingGap - closingGap), continuousOpenTimeIst: continuous.openTimeIst, continuousCloseTimeIst: continuous.closeTimeIst, auctionApplicable: policySession.closingAuctionSession.applicable, eligibility: policySession.eligibility, eligibilitySource: policySession.eligibilitySource, sessionPolicyVersion: policySession.policyVersion, eligibilityDatasetVersion: policySession.eligibilityDatasetVersion });
  }
  return out;
}

export function datasetManifest(input: { instruments: Array<{ instrumentToken: string; tradingSymbol?: string; identity?: InstrumentIdentity }>; from: Date; to: Date; interval: HistoricalCandleIntervalCode; coverage: Array<{ instrumentToken: string; sessions: SessionCoverage[]; candles: NormalizedHistoricalCandle[] }> }) {
  const material = input.coverage.map((item) => ({ token: item.instrumentToken, times: item.candles.map((candle) => candle.timestamp.toISOString()) })).sort((a, b) => a.token.localeCompare(b.token));
  const eligibilityMetadata = input.instruments.map((instrument) => {
    const sessions = input.coverage.find((item) => item.instrumentToken === instrument.instrumentToken)?.sessions ?? [];
    const eligibilities = [...new Set(sessions.map((session) => session.eligibility ?? instrument.identity?.eligibility ?? "UNKNOWN"))];
    const sources = [...new Set(sessions.map((session) => session.eligibilitySource).filter(Boolean))];
    return { instrumentToken: instrument.instrumentToken, eligibility: eligibilities.length === 1 ? eligibilities[0] : "UNKNOWN", eligibilitySource: sources.length === 1 ? sources[0] : instrument.identity?.eligibilitySource ?? "No instrument identity supplied" };
  }).sort((a, b) => a.instrumentToken.localeCompare(b.instrumentToken));
  const sessionPolicyVersion = input.coverage.flatMap((item) => item.sessions).find((session) => session.sessionPolicyVersion)?.sessionPolicyVersion ?? legacyGlobalSessionPolicy.version;
  const eligibilityDatasetVersion = input.coverage.flatMap((item) => item.sessions).find((session) => session.eligibilityDatasetVersion)?.eligibilityDatasetVersion ?? "UNKNOWN";
  const datasetId = createHash("sha256").update(JSON.stringify({ instruments: input.instruments.map((instrument) => instrument.instrumentToken).sort(), from: input.from.toISOString(), to: input.to.toISOString(), interval: input.interval, calendarVersion: nseCashCalendar.version, sessionPolicyVersion, eligibilityDatasetVersion, eligibilityMetadata, material })).digest("hex").slice(0, 16);
  const sessions = input.coverage.flatMap((item) => item.sessions);
  const expected = sessions.reduce((sum, session) => sum + (session.expectedCandles ?? 0), 0);
  const actual = sessions.reduce((sum, session) => sum + session.actualCandles, 0);
  return { datasetId, generatedAt: new Date().toISOString(), exchange: "NSE", segment: "CASH_EQUITY", timezone: "Asia/Kolkata", interval: input.interval, requestedFrom: input.from.toISOString(), requestedTo: input.to.toISOString(), instrumentTokens: input.instruments.map((instrument) => instrument.instrumentToken).sort(), instrumentCount: input.instruments.length, expectedTradingDays: sessions.length, completeTradingDays: sessions.filter((session) => session.classification === "COMPLETE").length, incompleteTradingDays: sessions.filter((session) => session.classification === "INCOMPLETE").length, unknownPolicyTradingDays: sessions.filter((session) => session.classification === "UNKNOWN_POLICY").length, missingTradingDays: sessions.filter((session) => session.classification === "MISSING").length, expectedCandles: expected, actualCandles: actual, coveragePercent: expected ? actual / expected * 100 : null, dataGapCount: sessions.reduce((sum, session) => sum + session.missingCandles, 0), calendarVersion: nseCashCalendar.version, calendarSource: nseCashCalendar.source, sessionPolicyVersion, eligibilityDatasetVersion, casEffectiveDate: "2026-08-03", eligibilityMetadata, instruments: input.coverage.map((item) => { const itemExpected = item.sessions.reduce((sum, session) => sum + (session.expectedCandles ?? 0), 0); const itemActual = item.sessions.reduce((sum, session) => sum + session.actualCandles, 0); return { instrumentToken: item.instrumentToken, tradingSymbol: input.instruments.find((instrument) => instrument.instrumentToken === item.instrumentToken)?.tradingSymbol ?? null, expectedSessions: item.sessions.length, completeSessions: item.sessions.filter((session) => session.classification === "COMPLETE").length, incompleteSessions: item.sessions.filter((session) => session.classification === "INCOMPLETE").length, unknownPolicySessions: item.sessions.filter((session) => session.classification === "UNKNOWN_POLICY").length, missingSessions: item.sessions.filter((session) => session.classification === "MISSING").length, expectedCandles: itemExpected, actualCandles: itemActual, coveragePercent: item.sessions.some((session) => session.expectedCandles == null) ? null : itemExpected ? itemActual / itemExpected * 100 : null, eligibilityByDate: item.sessions.map((session) => ({ tradingDate: session.tradingDate, eligibility: session.eligibility ?? "UNKNOWN", eligibilitySource: session.eligibilitySource ?? "No session policy metadata" })), missingRanges: missingRanges(item.sessions) }; }) };
}

function dayStart(at: Date) { return new Date(`${getTradingDate(at)}T00:00:00+05:30`).getTime(); }
function empty(tradingDate: string, classification: SessionCompleteness): SessionCoverage { return { tradingDate, classification, expectedCandles: classification === "UNKNOWN_POLICY" ? null : 0, actualCandles: 0, missingCandles: 0, coveragePercent: null, firstCandle: null, lastCandle: null, openingGap: 0, closingGap: 0, internalGaps: 0 }; }
function missingRanges(sessions: SessionCoverage[]) { return sessions.filter((session) => session.missingCandles).map((session) => ({ tradingDate: session.tradingDate, missingCandles: session.missingCandles, classification: session.classification })); }
