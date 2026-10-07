export type HistoricalMarketDataErrorCode =
  | "HISTORICAL_INVALID_REQUEST"
  | "HISTORICAL_AUTH"
  | "HISTORICAL_RATE_LIMITED"
  | "HISTORICAL_PROVIDER_ERROR"
  | "HISTORICAL_MALFORMED"
  | "HISTORICAL_VALIDATION_FAILED"
  | "HISTORICAL_BUSY"
  | "HISTORICAL_NOT_FOUND";

export class HistoricalMarketDataError extends Error {
  constructor(
    public readonly code: HistoricalMarketDataErrorCode,
    message: string
  ) {
    super(message);
    this.name = "HistoricalMarketDataError";
  }
}

export function httpStatusForHistoricalError(code: HistoricalMarketDataErrorCode) {
  switch (code) {
    case "HISTORICAL_INVALID_REQUEST":
    case "HISTORICAL_VALIDATION_FAILED":
      return 400;
    case "HISTORICAL_AUTH":
      return 401;
    case "HISTORICAL_NOT_FOUND":
      return 404;
    case "HISTORICAL_BUSY":
      return 409;
    case "HISTORICAL_RATE_LIMITED":
      return 429;
    default:
      return 502;
  }
}
