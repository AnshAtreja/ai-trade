import { z } from "zod";
import { env } from "../../../config/env";

const paperExecutionConfigSchema = z.object({
  autoPaperExecution: z.boolean(),
  maxLatencyMs: z.number().int().nonnegative().max(60_000),
  slippagePolicy: z.enum(["NONE", "BPS", "TICKS"]),
  slippageBps: z.number().nonnegative().max(500),
  slippageTicks: z.number().nonnegative().max(50),
  tickSize: z.number().positive(),
  fallbackHalfSpreadBps: z.number().nonnegative().max(200),
  allowLtpFallback: z.boolean(),
  liquidityPolicy: z.enum(["FILL_AVAILABLE_LIQUIDITY", "REJECT", "KEEP_OPEN", "PARTIAL_THEN_CANCEL"]),
  orderTimeoutMs: z.number().int().positive().max(3_600_000),
  maxDataAgeMs: z.number().int().positive(),
  markPricePolicy: z.enum(["LTP", "CONSERVATIVE_BID_ASK"]),
  stopGapPolicy: z.enum(["FILL_AT_TRIGGER_PRICE", "FILL_AT_STOP"]),
  ambiguousExitPolicy: z.enum(["CONSERVATIVE_STOP", "CONSERVATIVE_TARGET"]),
  squareOffTimeIst: z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/),
  blockEntriesAfterSquareOff: z.boolean(),
  setupMaxAgeMs: z.number().int().positive(),
  chargeRateBps: z.number().nonnegative().max(100),
  minCharge: z.number().nonnegative(),
  reconcileIntervalMs: z.number().int().positive()
});

export type PaperExecutionConfig = z.infer<typeof paperExecutionConfigSchema>;

export function getPaperExecutionConfig(overrides: Partial<PaperExecutionConfig> = {}): PaperExecutionConfig {
  const base: PaperExecutionConfig = {
    autoPaperExecution: env.PAPER_AUTO_EXECUTION,
    maxLatencyMs: env.PAPER_EXECUTION_LATENCY_MS,
    slippagePolicy: env.PAPER_SLIPPAGE_POLICY,
    slippageBps: env.PAPER_SLIPPAGE_BPS,
    slippageTicks: env.PAPER_SLIPPAGE_TICKS,
    tickSize: env.PAPER_TICK_SIZE,
    fallbackHalfSpreadBps: env.PAPER_FALLBACK_HALF_SPREAD_BPS,
    allowLtpFallback: env.PAPER_ALLOW_LTP_FALLBACK,
    liquidityPolicy: env.PAPER_LIQUIDITY_POLICY,
    orderTimeoutMs: env.PAPER_ORDER_TIMEOUT_MS,
    maxDataAgeMs: env.PAPER_MAX_DATA_AGE_MS,
    markPricePolicy: env.PAPER_MARK_PRICE_POLICY,
    stopGapPolicy: env.PAPER_STOP_GAP_POLICY,
    ambiguousExitPolicy: env.PAPER_AMBIGUOUS_EXIT_POLICY,
    squareOffTimeIst: env.PAPER_SQUARE_OFF_TIME_IST,
    blockEntriesAfterSquareOff: env.PAPER_BLOCK_ENTRIES_AFTER_SQUARE_OFF,
    setupMaxAgeMs: env.PAPER_SETUP_MAX_AGE_MS,
    chargeRateBps: env.PAPER_CHARGE_RATE_BPS,
    minCharge: env.PAPER_MIN_CHARGE,
    reconcileIntervalMs: env.PAPER_RECONCILE_INTERVAL_MS
  };

  return paperExecutionConfigSchema.parse({ ...base, ...overrides });
}
