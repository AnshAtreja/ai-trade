import type { NextFunction, Request, Response } from "express";

import { KiteAccountError, httpStatusForKiteError } from "../../modules/broker/account/errors";
import { MarketDataError, httpStatusForMarketError } from "../../modules/market-data/errors";
import { ScannerError } from "../../modules/scanner/errors";

export function errorHandler(error: Error, _req: Request, res: Response, _next: NextFunction) {
  if (error instanceof ScannerError) {
    return res.status(error.httpStatus).json({
      code: error.code,
      message: error.message
    });
  }

  if (error instanceof MarketDataError) {
    return res.status(httpStatusForMarketError(error.code)).json({
      code: error.code,
      message: error.message
    });
  }

  if (error instanceof KiteAccountError) {
    return res.status(httpStatusForKiteError(error.code)).json({
      code: error.code,
      message: error.message
    });
  }

  const statusCode = error.message.toLowerCase().includes("permission") ? 403 : 500;

  return res.status(statusCode).json({
    message: error.message || "Internal server error"
  });
}
