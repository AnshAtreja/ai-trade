import type { PaperExecutionConfig } from "./config";
import { round2 } from "./types";

/**
 * Configurable paper charge model.
 * Default is a simple turnover-based proxy — not a Zerodha contract note.
 * Rates should be verified before using for financial decisions.
 */
export function calculatePaperCharges(input: {
  turnover: number;
  config: PaperExecutionConfig;
}): { charges: number; rateBps: number; model: string } {
  const raw = (input.turnover * input.config.chargeRateBps) / 10_000;
  const charges = round2(Math.max(input.config.minCharge, raw));
  return {
    charges,
    rateBps: input.config.chargeRateBps,
    model: "simple_turnover_bps_v1"
  };
}

export function netPnlFromGross(grossPnl: number, charges: number) {
  return round2(grossPnl - charges);
}
