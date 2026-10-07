import { env } from "../../config/env";

/**
 * Indian cash-market session dates. Asia/Kolkata has no DST, so IST is always UTC+05:30.
 * Scanner sessionDate still uses utcSessionDate; account/risk uses this helper only.
 */
export function getMarketTimezone() {
  return env.MARKET_TIMEZONE || "Asia/Kolkata";
}

export function getTradingDate(at = new Date(), timeZone = getMarketTimezone()) {
  // India Standard Time is permanently UTC+05:30; avoid an Intl allocation per candle.
  if (timeZone === "Asia/Kolkata") {
    return new Date(at.getTime() + 19_800_000).toISOString().slice(0, 10);
  }
  const parts = formatterFor(timeZone).formatToParts(at);
  const year = parts.find((part) => part.type === "year")?.value;
  const month = parts.find((part) => part.type === "month")?.value;
  const day = parts.find((part) => part.type === "day")?.value;

  return `${year}-${month}-${day}`;
}

const formatters = new Map<string, Intl.DateTimeFormat>();

function formatterFor(timeZone: string) {
  let formatter = formatters.get(timeZone);
  if (!formatter) {
    formatter = new Intl.DateTimeFormat("en-CA", { timeZone, year: "numeric", month: "2-digit", day: "2-digit" });
    formatters.set(timeZone, formatter);
  }
  return formatter;
}

export function getTradingDayBounds(tradingDate = getTradingDate()) {
  const from = new Date(`${tradingDate}T00:00:00+05:30`);
  const to = new Date(`${addCalendarDay(tradingDate)}T00:00:00+05:30`);

  return { from, to };
}

export function isTimestampOnTradingDate(value: Date, tradingDate = getTradingDate()) {
  const { from, to } = getTradingDayBounds(tradingDate);

  return value >= from && value < to;
}

function addCalendarDay(isoDate: string) {
  const [year, month, day] = isoDate.split("-").map(Number);
  const utc = Date.UTC(year, month - 1, day + 1);

  return new Date(utc).toISOString().slice(0, 10);
}

export function money(value: number) {
  return Number(value.toFixed(2));
}
