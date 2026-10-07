export type PaperTradingErrorCode =
  | "NOT_FOUND"
  | "INVALID_TRANSITION"
  | "ALREADY_CLOSED"
  | "EXIT_IN_PROGRESS"
  | "LIVE_TRADING_DISABLED"
  | "MISSING_EXIT_PRICE"
  | "RISK_REJECTED";

export class PaperTradingError extends Error {
  constructor(
    public readonly code: PaperTradingErrorCode,
    message: string
  ) {
    super(message);
    this.name = "PaperTradingError";
  }
}

export function httpStatusForPaperError(code: PaperTradingErrorCode) {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "INVALID_TRANSITION":
    case "ALREADY_CLOSED":
    case "EXIT_IN_PROGRESS":
      return 409;
    case "LIVE_TRADING_DISABLED":
      return 403;
    case "MISSING_EXIT_PRICE":
      return 400;
    case "RISK_REJECTED":
      return 422;
    default:
      return 400;
  }
}
