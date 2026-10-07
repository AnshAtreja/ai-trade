import { KiteAccountError, httpStatusForKiteError, type KiteAccountErrorCode } from "../broker/account/errors";

export type MarketDataErrorCode =
  | KiteAccountErrorCode
  | "INSTRUMENT_SYNC_FAILED"
  | "MARKET_DATA_FETCH_FAILED"
  | "INSTRUMENT_NOT_FOUND"
  | "INVALID_MARKET_UNIVERSE"
  | "MARKET_STREAM_NOT_STARTED"
  | "MARKET_STREAM_AUTH_FAILED"
  | "MARKET_STREAM_ERROR"
  | "UNKNOWN_INSTRUMENT_TOKEN"
  | "INVALID_STREAM_REQUEST";

export class MarketDataError extends Error {
  constructor(
    public readonly code: MarketDataErrorCode,
    message: string,
    public readonly httpStatus = httpStatusForMarketError(code)
  ) {
    super(message);
    this.name = "MarketDataError";
  }
}

export function httpStatusForMarketError(code: MarketDataErrorCode) {
  switch (code) {
    case "INSTRUMENT_NOT_FOUND":
    case "MARKET_STREAM_NOT_STARTED":
    case "UNKNOWN_INSTRUMENT_TOKEN":
      return 404;
    case "INVALID_MARKET_UNIVERSE":
    case "INVALID_STREAM_REQUEST":
      return 400;
    case "MARKET_STREAM_AUTH_FAILED":
      return 401;
    case "INSTRUMENT_SYNC_FAILED":
    case "MARKET_DATA_FETCH_FAILED":
    case "MARKET_STREAM_ERROR":
      return 502;
    default:
      return httpStatusForKiteError(code as KiteAccountErrorCode);
  }
}

export function wrapBrokerError(error: unknown, fallback: MarketDataErrorCode): never {
  if (error instanceof MarketDataError) {
    throw error;
  }

  if (error instanceof KiteAccountError) {
    throw new MarketDataError(error.code, error.message, error.httpStatus);
  }

  throw new MarketDataError(fallback, error instanceof Error ? error.message : "Market-data operation failed.");
}
