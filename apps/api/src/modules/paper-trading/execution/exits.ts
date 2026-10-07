import type { PaperExecutionConfig } from "./config";
import type { ExecutionMarketView } from "./types";
import { round4 } from "./types";

export type ExitTriggerReason = "STOP_LOSS" | "TARGET" | "SQUARE_OFF" | "MANUAL";

export interface ExitDecision {
  reason: ExitTriggerReason;
  triggerPrice: number;
  exitPrice: number;
  gapAmount: number;
  ambiguous: boolean;
  policy: string;
}

/** Point-tick exit with gap-through-stop support. */
export function evaluateLiveExit(input: {
  side: "BUY" | "SELL";
  stopLoss: number | null;
  targetPrice: number | null;
  market: ExecutionMarketView;
  config: PaperExecutionConfig;
}): ExitDecision | null {
  const mark = markPrice(input.side, input.market, input.config);
  if (mark == null) {
    return null;
  }

  if (input.side === "BUY") {
    const stopHit = input.stopLoss != null && mark <= input.stopLoss;
    const targetHit = input.targetPrice != null && mark >= input.targetPrice;
    if (stopHit && targetHit) {
      return resolveAmbiguous("BUY", mark, input.stopLoss!, input.targetPrice!, input.config);
    }
    if (stopHit) {
      return stopExit("BUY", mark, input.stopLoss!, input.config);
    }
    if (targetHit) {
      return {
        reason: "TARGET",
        triggerPrice: input.targetPrice!,
        exitPrice: mark,
        gapAmount: round4(mark - input.targetPrice!),
        ambiguous: false,
        policy: "tick_chronology"
      };
    }
    return null;
  }

  const stopHit = input.stopLoss != null && mark >= input.stopLoss;
  const targetHit = input.targetPrice != null && mark <= input.targetPrice;
  if (stopHit && targetHit) {
    return resolveAmbiguous("SELL", mark, input.stopLoss!, input.targetPrice!, input.config);
  }
  if (stopHit) {
    return stopExit("SELL", mark, input.stopLoss!, input.config);
  }
  if (targetHit) {
    return {
      reason: "TARGET",
      triggerPrice: input.targetPrice!,
      exitPrice: mark,
      gapAmount: round4(input.targetPrice! - mark),
      ambiguous: false,
      policy: "tick_chronology"
    };
  }
  return null;
}

/** Range/candle ambiguity when chronological ticks are unavailable. */
export function evaluateRangeExitPolicy(input: {
  side: "BUY" | "SELL";
  stopLoss: number;
  targetPrice: number;
  high: number;
  low: number;
  config: PaperExecutionConfig;
}): ExitDecision | null {
  const stopHit =
    input.side === "BUY" ? input.low <= input.stopLoss : input.high >= input.stopLoss;
  const targetHit =
    input.side === "BUY" ? input.high >= input.targetPrice : input.low <= input.targetPrice;

  if (stopHit && targetHit) {
    const mark = input.side === "BUY" ? input.low : input.high;
    return resolveAmbiguous(input.side, mark, input.stopLoss, input.targetPrice, input.config);
  }

  if (stopHit) {
    const trigger = input.side === "BUY" ? Math.min(input.low, input.stopLoss) : Math.max(input.high, input.stopLoss);
    return stopExit(input.side, trigger, input.stopLoss, input.config);
  }

  if (targetHit) {
    return {
      reason: "TARGET",
      triggerPrice: input.targetPrice,
      exitPrice: input.targetPrice,
      gapAmount: 0,
      ambiguous: false,
      policy: "range_unambiguous"
    };
  }

  return null;
}

export function markPrice(
  side: "BUY" | "SELL",
  market: ExecutionMarketView,
  config: PaperExecutionConfig
): number | null {
  if (config.markPricePolicy === "LTP") {
    return market.ltp;
  }
  // Conservative: long marked on bid, short on ask when available.
  if (side === "BUY") {
    return market.bid ?? market.ltp;
  }
  return market.ask ?? market.ltp;
}

function stopExit(
  side: "BUY" | "SELL",
  triggerPrice: number,
  stopLoss: number,
  config: PaperExecutionConfig
): ExitDecision {
  const exitPrice =
    config.stopGapPolicy === "FILL_AT_STOP" ? stopLoss : triggerPrice;
  return {
    reason: "STOP_LOSS",
    triggerPrice: stopLoss,
    exitPrice: round4(exitPrice),
    gapAmount: round4(Math.abs(exitPrice - stopLoss)),
    ambiguous: false,
    policy: config.stopGapPolicy
  };
}

function resolveAmbiguous(
  side: "BUY" | "SELL",
  mark: number,
  stopLoss: number,
  targetPrice: number,
  config: PaperExecutionConfig
): ExitDecision {
  if (config.ambiguousExitPolicy === "CONSERVATIVE_TARGET") {
    return {
      reason: "TARGET",
      triggerPrice: targetPrice,
      exitPrice: targetPrice,
      gapAmount: 0,
      ambiguous: true,
      policy: "CONSERVATIVE_TARGET"
    };
  }
  const stop = stopExit(side, mark, stopLoss, config);
  return { ...stop, ambiguous: true, policy: "CONSERVATIVE_STOP" };
}

export function isPastSquareOff(at: Date, squareOffTimeIst: string): boolean {
  const parts = new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Kolkata",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
    weekday: "short"
  }).formatToParts(at);
  const weekday = parts.find((p) => p.type === "weekday")?.value ?? "";
  if (weekday === "Sat" || weekday === "Sun") {
    return true;
  }
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? "0");
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? "0");
  const [sh, sm] = squareOffTimeIst.split(":").map(Number);
  return hour * 60 + minute >= (sh ?? 15) * 60 + (sm ?? 15);
}
