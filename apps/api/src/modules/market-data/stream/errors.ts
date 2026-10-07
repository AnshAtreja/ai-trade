import { MarketDataError } from "../errors";

export type MarketStreamErrorCode =
  | "MARKET_STREAM_NOT_STARTED"
  | "MARKET_STREAM_AUTH_FAILED"
  | "MARKET_STREAM_ERROR"
  | "UNKNOWN_INSTRUMENT_TOKEN"
  | "INVALID_STREAM_REQUEST";

export class MarketStreamError extends MarketDataError {
  constructor(code: MarketStreamErrorCode | ConstructorParameters<typeof MarketDataError>[0], message: string, httpStatus?: number) {
    super(code, message, httpStatus ?? statusForStream(code));
    this.name = "MarketStreamError";
  }
}

function statusForStream(code: string) {
  switch (code) {
    case "MARKET_STREAM_NOT_STARTED":
    case "UNKNOWN_INSTRUMENT_TOKEN":
      return 404;
    case "INVALID_STREAM_REQUEST":
      return 400;
    case "MARKET_STREAM_AUTH_FAILED":
    case "KITE_NOT_AUTHENTICATED":
    case "KITE_AUTH_EXPIRED":
      return 401;
    default:
      return 502;
  }
}
