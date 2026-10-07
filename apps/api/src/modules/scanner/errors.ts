export class ScannerError extends Error {
  constructor(
    public readonly code:
      | "SCANNER_BUSY"
      | "SCANNER_FAILED"
      | "SCANNER_NOT_RUNNING"
      | "INVALID_SCANNER_REQUEST",
    message: string,
    public readonly httpStatus = code === "SCANNER_BUSY" ? 409 : code === "INVALID_SCANNER_REQUEST" ? 400 : code === "SCANNER_NOT_RUNNING" ? 404 : 502
  ) {
    super(message);
    this.name = "ScannerError";
  }
}
