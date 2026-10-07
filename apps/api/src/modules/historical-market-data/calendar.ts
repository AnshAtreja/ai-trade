import { getTradingDate } from "../../common/utils/trading-date";

export type TradingDayKind = "NORMAL" | "WEEKEND" | "HOLIDAY" | "SPECIAL_SESSION" | "UNKNOWN";
export interface TradingSession { openTimeIst: string; closeTimeIst: string; }
export interface TradingDay { date: string; type: TradingDayKind; session: TradingSession | null; timezone: "Asia/Kolkata"; source: string; note?: string; }
export interface ExchangeTradingCalendar { version: string; exchange: "NSE"; segment: "CASH_EQUITY"; timezone: "Asia/Kolkata"; supportedFrom: string; supportedToExclusive: string; source: string; classify(date: string): TradingDayKind; getDay(date: string): TradingDay; isTradingDay(date: string): boolean; getSession(date: string): TradingSession | null; }

export const NSE_CASH_CALENDAR_VERSION = "NSE_CASH_2025_2026_V2";
export const NSE_CASH_CALENDAR_SUPPORTED_FROM = "2025-01-01";
export const NSE_CASH_CALENDAR_SUPPORTED_TO_EXCLUSIVE = "2027-01-01";

const CALENDAR_SOURCE = "2025: NSE/CMTR/65587 (13-Dec-2024), supplemented by NSE/CMTR/65729 (23-Dec-2024) and NSE/CMTR/70319 (22-Sep-2025); 2026: NSE official Market Timings & Holidays, Capital Market / Equities, supplemented by NSE/CMTR/72349 (Circular Ref. 11/2026, 16-Jan-2026) for the Union Budget live session";
export const NSE_CASH_HOLIDAYS_2025 = new Set(["2025-02-26", "2025-03-14", "2025-03-31", "2025-04-10", "2025-04-14", "2025-04-18", "2025-05-01", "2025-08-15", "2025-08-27", "2025-10-02", "2025-10-22", "2025-11-05", "2025-12-25"]);
export const NSE_CASH_HOLIDAYS_2026 = new Set(["2026-01-15", "2026-01-26", "2026-02-19", "2026-03-03", "2026-03-19", "2026-03-26", "2026-03-31", "2026-04-01", "2026-04-03", "2026-04-14", "2026-05-01", "2026-05-28", "2026-06-26", "2026-08-26", "2026-09-14", "2026-10-02", "2026-10-20", "2026-11-10", "2026-11-24", "2026-12-25"]);

const SPECIAL_SESSIONS: Record<string, { session: TradingSession | null; note: string }> = {
  "2025-02-01": { session: { openTimeIst: "09:15", closeTimeIst: "15:30" }, note: "Union Budget live trading session; standard normal-market hours under NSE/CMTR/65729." },
  "2025-10-21": { session: { openTimeIst: "13:45", closeTimeIst: "14:45" }, note: "Diwali Muhurat normal-market session under NSE/CMTR/70319." },
  "2026-02-01": { session: { openTimeIst: "09:15", closeTimeIst: "15:30" }, note: "Union Budget live trading session under NSE/CMTR/72349, Circular Ref. 11/2026 dated 16-Jan-2026; pre-open 09:00–09:08 is metadata only." },
  "2026-11-08": { session: null, note: "Muhurat Trading is scheduled; official session timings are pending a separate NSE circular." }
};

function isSupportedDate(date: string) {
  if (!/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12][0-9]|3[01])$/.test(date)) return false;
  if (date < NSE_CASH_CALENDAR_SUPPORTED_FROM || date >= NSE_CASH_CALENDAR_SUPPORTED_TO_EXCLUSIVE) return false;
  const parsed = new Date(`${date}T12:00:00+05:30`);
  return parsed.toISOString().slice(0, 10) === date;
}

function dayOfWeek(date: string) { return new Date(`${date}T12:00:00+05:30`).getDay(); }
function isHoliday(date: string) { return NSE_CASH_HOLIDAYS_2025.has(date) || NSE_CASH_HOLIDAYS_2026.has(date); }

export const nseCashCalendar: ExchangeTradingCalendar = {
  version: NSE_CASH_CALENDAR_VERSION,
  exchange: "NSE",
  segment: "CASH_EQUITY",
  timezone: "Asia/Kolkata",
  supportedFrom: NSE_CASH_CALENDAR_SUPPORTED_FROM,
  supportedToExclusive: NSE_CASH_CALENDAR_SUPPORTED_TO_EXCLUSIVE,
  source: CALENDAR_SOURCE,
  classify(date) {
    if (!isSupportedDate(date)) return "UNKNOWN";
    if (SPECIAL_SESSIONS[date]) return "SPECIAL_SESSION";
    const day = dayOfWeek(date);
    if (day === 0 || day === 6) return "WEEKEND";
    return isHoliday(date) ? "HOLIDAY" : "NORMAL";
  },
  getDay(date) {
    const type = this.classify(date);
    if (type === "NORMAL") return { date, type, session: { openTimeIst: "09:15", closeTimeIst: "15:30" }, timezone: "Asia/Kolkata", source: CALENDAR_SOURCE };
    if (type === "SPECIAL_SESSION") {
      const special = SPECIAL_SESSIONS[date]!;
      return { date, type, session: special.session, timezone: "Asia/Kolkata", source: CALENDAR_SOURCE, note: special.note };
    }
    return { date, type, session: null, timezone: "Asia/Kolkata", source: CALENDAR_SOURCE };
  },
  isTradingDay(date) { const day = this.getDay(date); return day.type === "NORMAL" || (day.type === "SPECIAL_SESSION" && day.session !== null); },
  getSession(date) { return this.getDay(date).session; }
};

export function tradingDateFor(at: Date) { return getTradingDate(at); }
