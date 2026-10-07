/**
 * NSE cash equity session boundaries (Asia/Kolkata).
 * Centralize here — scanner/scheduler must not invent their own hours.
 */
import { getMarketTimezone, getTradingDate } from "./trading-date";

export type MarketSessionState =
  | "PRE_MARKET"
  | "OPENING"
  | "REGULAR"
  | "CLOSING"
  | "POST_MARKET"
  | "CLOSED";

/** NSE cash: 09:00–09:15 opening; 09:15–15:15 regular; 15:15–15:30 closing; 15:40–16:00 post. */
const SESSION_WINDOWS = {
  preMarketStart: { h: 9, m: 0 },
  openingEnd: { h: 9, m: 15 },
  regularEnd: { h: 15, m: 15 },
  closingEnd: { h: 15, m: 30 },
  postMarketEnd: { h: 16, m: 0 }
} as const;

export function getMarketSessionState(at = new Date(), timeZone = getMarketTimezone()): MarketSessionState {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone,
    weekday: "short",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23"
  }).formatToParts(at);

  const weekday = parts.find((part) => part.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") {
    return "CLOSED";
  }

  const hour = Number(parts.find((part) => part.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((part) => part.type === "minute")?.value ?? "0");
  const mins = hour * 60 + minute;

  const pre = SESSION_WINDOWS.preMarketStart.h * 60 + SESSION_WINDOWS.preMarketStart.m;
  const openEnd = SESSION_WINDOWS.openingEnd.h * 60 + SESSION_WINDOWS.openingEnd.m;
  const regularEnd = SESSION_WINDOWS.regularEnd.h * 60 + SESSION_WINDOWS.regularEnd.m;
  const closingEnd = SESSION_WINDOWS.closingEnd.h * 60 + SESSION_WINDOWS.closingEnd.m;
  const postEnd = SESSION_WINDOWS.postMarketEnd.h * 60 + SESSION_WINDOWS.postMarketEnd.m;
  /** Soft pre-open window before continuous trading. */
  const preMarketEnd = pre + 8;

  if (mins < pre) {
    return "CLOSED";
  }
  if (mins < preMarketEnd) {
    return "PRE_MARKET";
  }
  if (mins < openEnd) {
    return "OPENING";
  }
  if (mins < regularEnd) {
    return "REGULAR";
  }
  if (mins < closingEnd) {
    return "CLOSING";
  }
  if (mins < postEnd) {
    return "POST_MARKET";
  }

  return "CLOSED";
}

/** Sessions where the continuous scanner may run by default. */
export function isScannerTradingSession(state: MarketSessionState = getMarketSessionState()) {
  return state === "OPENING" || state === "REGULAR" || state === "CLOSING";
}

export function marketSessionMeta(at = new Date()) {
  return {
    marketSession: getMarketSessionState(at),
    tradingDate: getTradingDate(at),
    timezone: getMarketTimezone()
  };
}
