import type { HistoricalCandleIntervalCode } from "../../db/domain";
import { getTradingDate } from "../../common/utils/trading-date";
import type { NormalizedHistoricalCandle } from "./types";
import type { SessionCompleteness, SessionCoverage } from "./dataset";

export type ResearchEligibilityReason = "DATA_GAP" | "MISSING_SESSION" | "UNKNOWN_SESSION_POLICY";

export interface ResearchSessionEligibility {
  tradingDate: string;
  interval: HistoricalCandleIntervalCode;
  classification: SessionCompleteness;
  eligible: boolean;
  reason: ResearchEligibilityReason | null;
}

export interface ResearchCandleEligibilityResult {
  requireCompleteSession: boolean;
  candles: NormalizedHistoricalCandle[];
  sessions: SessionCoverage[];
  eligibility: ResearchSessionEligibility[];
  rejectedSessions: ResearchSessionEligibility[];
}

export function evaluateResearchSession(session: SessionCoverage, interval: HistoricalCandleIntervalCode, requireCompleteSession: boolean): ResearchSessionEligibility {
  if (session.classification === "COMPLETE") return { tradingDate: session.tradingDate, interval, classification: session.classification, eligible: true, reason: null };
  if (session.classification === "INCOMPLETE") return { tradingDate: session.tradingDate, interval, classification: session.classification, eligible: !requireCompleteSession, reason: requireCompleteSession ? "DATA_GAP" : null };
  if (session.classification === "MISSING") return { tradingDate: session.tradingDate, interval, classification: session.classification, eligible: false, reason: "MISSING_SESSION" };
  return { tradingDate: session.tradingDate, interval, classification: "UNKNOWN_POLICY", eligible: false, reason: "UNKNOWN_SESSION_POLICY" };
}

export function selectResearchCandles(input: { candles: NormalizedHistoricalCandle[]; sessions: SessionCoverage[]; interval: HistoricalCandleIntervalCode; requireCompleteSession: boolean }): ResearchCandleEligibilityResult {
  const eligibility = input.sessions.map((session) => evaluateResearchSession(session, input.interval, input.requireCompleteSession));
  const acceptedDates = new Set(eligibility.filter((item) => item.eligible).map((item) => item.tradingDate));
  const candles = input.candles.filter((candle) => acceptedDates.has(getTradingDate(candle.timestamp)));
  return { requireCompleteSession: input.requireCompleteSession, candles, sessions: input.sessions, eligibility, rejectedSessions: eligibility.filter((item) => !item.eligible) };
}
