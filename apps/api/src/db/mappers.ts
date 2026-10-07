export function toNumber(value: { toNumber?: () => number } | number | string | null | undefined, fallback = 0) {
  if (value == null) {
    return fallback;
  }

  if (typeof value === "number") {
    return value;
  }

  if (typeof value === "object" && typeof value.toNumber === "function") {
    return value.toNumber();
  }

  return Number(value);
}

export function toNumberOrNull(value: { toNumber?: () => number } | number | string | null | undefined) {
  if (value == null) {
    return null;
  }

  return toNumber(value);
}

export function utcSessionDate(date = new Date()) {
  return date.toISOString().slice(0, 10);
}

export function buildScannerDedupeKey(input: {
  userId: string;
  tradingMode: string;
  sessionDate: string;
  symbol: string;
  direction: string;
}) {
  return [input.userId, input.tradingMode, input.sessionDate, input.symbol.toUpperCase(), input.direction].join("|");
}

export function createId(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}${Date.now().toString(36)}`;
}
