import path from "node:path";
import { config } from "dotenv";
import { z } from "zod";

config({ path: path.resolve(process.cwd(), ".env") });
config({ path: path.resolve(process.cwd(), "../.env"), override: false });
config({ path: path.resolve(process.cwd(), "../../.env"), override: false });

// Prisma CLI reads DATABASE_URL. DATARL is the TradePilot alias for the same PostgreSQL URL.
if (!process.env.DATABASE_URL && process.env.DATARL) {
  process.env.DATABASE_URL = process.env.DATARL;
}

const envSchema = z.object({
  PORT: z.coerce.number().default(4000),
  PERSISTENCE_MODE: z.enum(["mock", "database"]).default("mock"),
  DATARL: z.string().optional(),
  DATABASE_URL: z
    .string()
    .default("postgresql://postgres:postgres@localhost:5432/trade_pilot_ai?schema=public"),
  KITE_API_KEY: z.string().default(""),
  KITE_API_SECRET: z.string().default(""),
  KITE_REDIRECT_URL: z.string().default("http://127.0.0.1:4000/api/broker/kite/callback"),
  WEB_APP_URL: z.string().default("http://127.0.0.1:5173"),
  MARKET_TIMEZONE: z.string().default("Asia/Kolkata"),
  PAPER_STARTING_CAPITAL: z.coerce.number().positive().default(100000),
  PAPER_MAX_RISK_PER_TRADE_PERCENT: z.coerce.number().positive().default(1),
  PAPER_MAX_DAILY_LOSS_PERCENT: z.coerce.number().positive().default(3),
  PAPER_MAX_TRADES_PER_DAY: z.coerce.number().int().positive().default(8),
  PAPER_MAX_POSITION_SIZE: z.coerce.number().positive().default(25000),
  PAPER_MAX_OPEN_POSITIONS: z.coerce.number().int().positive().default(5),
  PAPER_MAX_CAPITAL_EXPOSURE: z.coerce.number().positive().optional(),
  PAPER_ALLOW_SHORT_SELLING: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  KITE_ACCOUNT_REFRESH_MIN_INTERVAL_MS: z.coerce.number().int().nonnegative().default(5000),
  KITE_QUOTE_BATCH_SIZE: z.coerce.number().int().positive().default(400),
  MARKET_WS_RECONNECT_BASE_MS: z.coerce.number().int().positive().default(1000),
  MARKET_WS_RECONNECT_MAX_MS: z.coerce.number().int().positive().default(30000),
  MARKET_TICK_STALE_MS: z.coerce.number().int().positive().default(15000),
  MARKET_SNAPSHOT_INTERVAL_MS: z.coerce.number().int().nonnegative().default(0),
  NSE_LIVE_CAS_CM_SECURITY_URL_TEMPLATE: z.string().url().optional(),
  NSE_LIVE_CAS_FO_REPORT_URL_TEMPLATE: z.string().url().optional(),
  SCANNER_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  SCANNER_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  SCANNER_MAX_CANDIDATES: z.coerce.number().int().positive().default(25),
  SCANNER_MIN_SCORE: z.coerce.number().int().min(0).max(100).default(40),
  SCANNER_MIN_PRICE: z.coerce.number().nonnegative().default(20),
  SCANNER_MAX_PRICE: z.coerce.number().positive().default(100000),
  SCANNER_MIN_VOLUME: z.coerce.number().nonnegative().default(1000),
  SCANNER_VOLUME_SPIKE_THRESHOLD: z.coerce.number().positive().default(1.5),
  SCANNER_MIN_VOLATILITY: z.coerce.number().nonnegative().default(0.15),
  SCANNER_MAX_VOLATILITY: z.coerce.number().positive().default(12),
  SCANNER_MAX_DATA_AGE_MS: z.coerce.number().int().positive().default(30000),
  SCANNER_NEAR_HIGH_LOW_PERCENT: z.coerce.number().positive().default(0.5),
  SCANNER_BREAKOUT_TOLERANCE_PERCENT: z.coerce.number().nonnegative().default(0.05),
  SCANNER_MOMENTUM_MIN_PERCENT: z.coerce.number().positive().default(0.35),
  STRATEGY_ENABLED: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  STRATEGY_INTERVAL_MS: z.coerce.number().int().positive().default(60000),
  STRATEGY_TICK_HISTORY_SIZE: z.coerce.number().int().positive().default(120),
  STRATEGY_MAX_DATA_AGE_MS: z.coerce.number().int().positive().default(30000),
  STRATEGY_MIN_REWARD_RISK: z.coerce.number().positive().default(1.5),
  STRATEGY_ENABLED_IDS: z
    .string()
    .default("breakout,breakdown,momentum,opening-momentum"),
  PAPER_AUTO_EXECUTION: z
    .enum(["true", "false"])
    .default("false")
    .transform((value) => value === "true"),
  PAPER_EXECUTION_LATENCY_MS: z.coerce.number().int().nonnegative().default(250),
  PAPER_SLIPPAGE_POLICY: z.enum(["NONE", "BPS", "TICKS"]).default("BPS"),
  PAPER_SLIPPAGE_BPS: z.coerce.number().nonnegative().default(2),
  PAPER_SLIPPAGE_TICKS: z.coerce.number().nonnegative().default(1),
  PAPER_TICK_SIZE: z.coerce.number().positive().default(0.05),
  PAPER_FALLBACK_HALF_SPREAD_BPS: z.coerce.number().nonnegative().default(5),
  PAPER_ALLOW_LTP_FALLBACK: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  PAPER_LIQUIDITY_POLICY: z
    .enum(["FILL_AVAILABLE_LIQUIDITY", "REJECT", "KEEP_OPEN", "PARTIAL_THEN_CANCEL"])
    .default("FILL_AVAILABLE_LIQUIDITY"),
  PAPER_ORDER_TIMEOUT_MS: z.coerce.number().int().positive().default(60_000),
  PAPER_MAX_DATA_AGE_MS: z.coerce.number().int().positive().default(15_000),
  PAPER_MARK_PRICE_POLICY: z.enum(["LTP", "CONSERVATIVE_BID_ASK"]).default("CONSERVATIVE_BID_ASK"),
  PAPER_STOP_GAP_POLICY: z.enum(["FILL_AT_TRIGGER_PRICE", "FILL_AT_STOP"]).default("FILL_AT_TRIGGER_PRICE"),
  PAPER_AMBIGUOUS_EXIT_POLICY: z.enum(["CONSERVATIVE_STOP", "CONSERVATIVE_TARGET"]).default("CONSERVATIVE_STOP"),
  PAPER_SQUARE_OFF_TIME_IST: z.string().default("15:15"),
  PAPER_BLOCK_ENTRIES_AFTER_SQUARE_OFF: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  PAPER_SETUP_MAX_AGE_MS: z.coerce.number().int().positive().default(120_000),
  PAPER_CHARGE_RATE_BPS: z.coerce.number().nonnegative().default(3),
  PAPER_MIN_CHARGE: z.coerce.number().nonnegative().default(5),
  PAPER_RECONCILE_INTERVAL_MS: z.coerce.number().int().positive().default(5_000),
  HISTORICAL_PROVIDER: z.enum(["kite", "mock"]).default("mock"),
  HISTORICAL_PERSISTENCE_ENABLED: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  /** Conservative throttle under Kite's documented ~3 historical req/s. */
  HISTORICAL_THROTTLE_MS: z.coerce.number().int().positive().default(400),
  HISTORICAL_MAX_RETRIES: z.coerce.number().int().nonnegative().default(3),
  HISTORICAL_RETRY_BACKOFF_MS: z.coerce.number().int().positive().default(750),
  HISTORICAL_CHUNK_DAYS_1M: z.coerce.number().int().positive().default(5),
  HISTORICAL_CHUNK_OVERLAP_MINUTES: z.coerce.number().int().nonnegative().default(1),
  HISTORICAL_VALIDATE_ON_PERSIST: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true"),
  HISTORICAL_PERSIST_DERIVED_5M: z
    .enum(["true", "false"])
    .default("true")
    .transform((value) => value === "true")
});

export const env = envSchema.parse(process.env);

export function isDatabasePersistenceEnabled() {
  return env.PERSISTENCE_MODE === "database";
}
