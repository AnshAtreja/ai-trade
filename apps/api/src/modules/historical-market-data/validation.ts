import { candleIntervalMs, floorToCandleBucket } from "../../common/utils/candle-buckets";
import { getMarketSessionState, isScannerTradingSession } from "../../common/utils/market-session";
import { getTradingDate } from "../../common/utils/trading-date";
import type { HistoricalCandleIntervalCode } from "../../db/domain";
import type { NormalizedHistoricalCandle, ValidationIssue, ValidationReport } from "./types";
import { nseCashCalendar } from "./calendar";
import type { InstrumentIdentity, InstrumentSessionPolicy } from "./session-policy";

/**
 * Validates candle integrity. Does NOT fabricate missing candles.
 *
 * This lower-level validator is retained for raw candle continuity checks. The dataset validator
 * adds the versioned NSE cash-equity calendar and should be used for holiday-aware coverage.
 */
export function validateHistoricalCandles(input: {
  instrumentToken: string;
  interval: HistoricalCandleIntervalCode;
  from: Date;
  to: Date;
  candles: NormalizedHistoricalCandle[];
  instrument?: InstrumentIdentity;
  sessionPolicy?: InstrumentSessionPolicy;
}): ValidationReport {
  const issues: ValidationIssue[] = [];
  const raw = [...input.candles];
  for (let i = 1; i < raw.length; i += 1) {
    if (raw[i]!.timestamp.getTime() < raw[i - 1]!.timestamp.getTime()) {
      issues.push({
        kind: "OUT_OF_ORDER",
        timestamp: raw[i]!.timestamp.toISOString(),
        detail: "Timestamp precedes previous candle in input series"
      });
    }
  }

  const sorted = [...raw].sort((a, b) => a.timestamp.getTime() - b.timestamp.getTime());
  const seen = new Set<number>();
  let previousMs: number | null = null;
  const step = candleIntervalMs(input.interval);

  for (const candle of sorted) {
    const ts = candle.timestamp.getTime();
    if (!Number.isFinite(ts)) {
      issues.push({ kind: "INVALID_SOURCE_RECORD", detail: "Non-finite timestamp" });
      continue;
    }

    if (floorToCandleBucket(ts, input.interval) !== ts) {
      issues.push({
        kind: "INTERVAL_MISALIGNED",
        timestamp: candle.timestamp.toISOString(),
        detail: `timestamp not aligned to ${input.interval}`
      });
    }

    if (seen.has(ts)) {
      issues.push({
        kind: "DUPLICATE_TIMESTAMP",
        timestamp: candle.timestamp.toISOString(),
        detail: "Duplicate candle timestamp"
      });
    }
    seen.add(ts);

    if (!(candle.open > 0 && candle.high > 0 && candle.low > 0 && candle.close > 0)) {
      issues.push({
        kind: "NON_POSITIVE_PRICE",
        timestamp: candle.timestamp.toISOString(),
        detail: "OHLC must be positive"
      });
    }

    if (candle.volume < 0) {
      issues.push({
        kind: "NEGATIVE_VOLUME",
        timestamp: candle.timestamp.toISOString(),
        detail: "Volume must be non-negative"
      });
    }

    const maxOc = Math.max(candle.open, candle.close);
    const minOc = Math.min(candle.open, candle.close);
    if (candle.high < maxOc || candle.low > minOc || candle.high < candle.low) {
      issues.push({
        kind: "INVALID_OHLC",
        timestamp: candle.timestamp.toISOString(),
        detail: `high=${candle.high} low=${candle.low} open=${candle.open} close=${candle.close}`
      });
    }

    if (previousMs != null) {
      const expectedNext = previousMs + step;
      if (ts > expectedNext) {
        for (let cursor = expectedNext; cursor < ts; cursor += step) {
          const at = new Date(cursor);
          if (input.instrument && input.sessionPolicy) {
            if (isExpectedContinuousCandle(at, input.instrument, input.sessionPolicy)) {
              issues.push({ kind: "MISSING_CANDLE", timestamp: at.toISOString(), detail: `Missing ${input.interval} during continuous session on ${getTradingDate(at)}` });
            }
          } else {
            const session = getMarketSessionState(at);
            if (isScannerTradingSession(session)) {
              issues.push({
                kind: "MISSING_CANDLE",
                timestamp: at.toISOString(),
                detail: `Missing ${input.interval} during ${session} on ${getTradingDate(at)}`
              });
            } else {
              issues.push({
                kind: "EXPECTED_SESSION_GAP",
                timestamp: at.toISOString(),
                detail: `Expected gap (${session})`
              });
            }
          }
        }
      }
    }

    previousMs = ts;
  }

  if (input.instrument && input.sessionPolicy) {
    appendPolicyBoundaryGaps(issues, { ...input, instrument: input.instrument, sessionPolicy: input.sessionPolicy });
  }

  // Cap expected-gap noise — keep all MISSING/INVALID, limit EXPECTED_SESSION_GAP samples
  const expectedGaps = issues.filter((i) => i.kind === "EXPECTED_SESSION_GAP");
  const other = issues.filter((i) => i.kind !== "EXPECTED_SESSION_GAP");
  const trimmed = [...other, ...expectedGaps.slice(0, 20)];
  if (expectedGaps.length > 20) {
    trimmed.push({
      kind: "EXPECTED_SESSION_GAP",
      detail: `…and ${expectedGaps.length - 20} additional expected session gaps`
    });
  }

  const blocking = trimmed.filter((i) => i.kind !== "EXPECTED_SESSION_GAP");

  return {
    instrumentToken: input.instrumentToken,
    interval: input.interval,
    from: input.from.toISOString(),
    to: input.to.toISOString(),
    candleCount: sorted.length,
    valid: blocking.length === 0,
    issues: trimmed
  };
}

function appendPolicyBoundaryGaps(issues: ValidationIssue[], input: { instrument: InstrumentIdentity; sessionPolicy: InstrumentSessionPolicy; interval: HistoricalCandleIntervalCode; from: Date; to: Date; candles: NormalizedHistoricalCandle[] }) {
  const step = candleIntervalMs(input.interval);
  const present = new Set(input.candles.map((candle) => candle.timestamp.getTime()));
  const reported = new Set(issues.filter((issue) => issue.kind === "MISSING_CANDLE" && issue.timestamp).map((issue) => issue.timestamp));
  for (let cursor = new Date(`${getTradingDate(input.from)}T00:00:00+05:30`).getTime(); cursor < input.to.getTime(); cursor += 86_400_000) {
    const date = getTradingDate(new Date(cursor));
    const day = nseCashCalendar.getDay(date);
    if (!day.session) continue;
    const session = input.sessionPolicy.getSession(input.instrument, date);
    if (session.eligibility === "UNKNOWN" || !session.continuousSession) continue;
    const open = new Date(`${date}T${session.continuousSession.openTimeIst}:00+05:30`).getTime();
    const close = new Date(`${date}T${session.continuousSession.closeTimeIst}:00+05:30`).getTime();
    for (let timestamp = Math.max(input.from.getTime(), open); timestamp < Math.min(input.to.getTime(), close); timestamp += step) {
      const iso = new Date(timestamp).toISOString();
      if (!present.has(timestamp) && !reported.has(iso)) {
        issues.push({ kind: "MISSING_CANDLE", timestamp: iso, detail: `Missing ${input.interval} during continuous session on ${date}` });
      }
    }
  }
}

function isExpectedContinuousCandle(at: Date, instrument: InstrumentIdentity, policy: InstrumentSessionPolicy) {
  const date = getTradingDate(at);
  const day = nseCashCalendar.getDay(date);
  if (!day.session) return false;
  const session = policy.getSession(instrument, date);
  if (session.eligibility === "UNKNOWN") return false;
  const open = new Date(`${date}T${session.continuousSession?.openTimeIst}:00+05:30`).getTime();
  const close = new Date(`${date}T${session.continuousSession?.closeTimeIst}:00+05:30`).getTime();
  return Boolean(session.continuousSession) && at.getTime() >= open && at.getTime() < close;
}

export function detectMissingRanges(input: {
  interval: HistoricalCandleIntervalCode;
  from: Date;
  to: Date;
  candles: NormalizedHistoricalCandle[];
}): Array<{ from: string; to: string; reason: string }> {
  const step = candleIntervalMs(input.interval);
  const present = new Set(input.candles.map((c) => c.timestamp.getTime()));
  const missing: Array<{ from: string; to: string; reason: string }> = [];
  let runStart: number | null = null;

  const start = floorToCandleBucket(input.from.getTime(), input.interval);
  for (let cursor = start; cursor < input.to.getTime(); cursor += step) {
    const at = new Date(cursor);
    const session = getMarketSessionState(at);
    const shouldExist = isScannerTradingSession(session);
    const exists = present.has(cursor);
    if (shouldExist && !exists) {
      if (runStart == null) runStart = cursor;
    } else if (runStart != null) {
      missing.push({
        from: new Date(runStart).toISOString(),
        to: new Date(cursor).toISOString(),
        reason: "MISSING_CANDLE during trading session (holidays not fully modeled)"
      });
      runStart = null;
    }
  }
  if (runStart != null) {
    missing.push({
      from: new Date(runStart).toISOString(),
      to: input.to.toISOString(),
      reason: "MISSING_CANDLE during trading session (holidays not fully modeled)"
    });
  }
  return missing;
}
