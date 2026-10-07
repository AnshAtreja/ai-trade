export type KiteAccountErrorCode =
  | "KITE_NOT_AUTHENTICATED"
  | "KITE_AUTH_EXPIRED"
  | "KITE_API_ERROR"
  | "KITE_RATE_LIMITED"
  | "KITE_ACCOUNT_REFRESH_FAILED"
  | "KITE_ACCOUNT_NOT_REFRESHED"
  | "KITE_MALFORMED_RESPONSE";

export class KiteAccountError extends Error {
  constructor(
    public readonly code: KiteAccountErrorCode,
    message: string,
    public readonly httpStatus = httpStatusForKiteError(code)
  ) {
    super(message);
    this.name = "KiteAccountError";
  }
}

export function httpStatusForKiteError(code: KiteAccountErrorCode) {
  switch (code) {
    case "KITE_NOT_AUTHENTICATED":
    case "KITE_AUTH_EXPIRED":
      return 401;
    case "KITE_RATE_LIMITED":
      return 429;
    case "KITE_ACCOUNT_NOT_REFRESHED":
      return 404;
    case "KITE_MALFORMED_RESPONSE":
    case "KITE_API_ERROR":
    case "KITE_ACCOUNT_REFRESH_FAILED":
      return 502;
    default:
      return 400;
  }
}

export function kiteErrorFromHttp(status: number, message: string, errorType?: string) {
  const safeMessage = sanitizeBrokerMessage(message);

  if (status === 429) {
    return new KiteAccountError("KITE_RATE_LIMITED", safeMessage || "Kite rate limit reached.");
  }

  if (errorType === "TokenException" || status === 403) {
    return new KiteAccountError("KITE_AUTH_EXPIRED", safeMessage || "Kite access token is invalid or expired.");
  }

  if (status === 401) {
    return new KiteAccountError("KITE_NOT_AUTHENTICATED", safeMessage || "Kite authentication is required.");
  }

  return new KiteAccountError("KITE_API_ERROR", safeMessage || `Kite request failed with status ${status}.`);
}

export function sanitizeBrokerMessage(value: string) {
  return value
    .replace(/token\s+[^\s]+/gi, "token [redacted]")
    .replace(/access[_-]?token[=:]\s*[^\s]+/gi, "access_token=[redacted]")
    .replace(/request[_-]?token[=:]\s*[^\s]+/gi, "request_token=[redacted]")
    .replace(/Authorization:\s*[^\s]+/gi, "Authorization: [redacted]");
}
