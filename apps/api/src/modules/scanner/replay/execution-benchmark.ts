import { createHash } from "node:crypto";
import { performance } from "node:perf_hooks";
import { HistoricalPaperExecutionEngine } from "./historical-paper-execution";
import { BacktestAnalyticsAccumulator } from "./backtest-analytics";
import type { HistoricalReplayResult, ReplayCandleEvent } from "./types";

// Execution stress fixture only. No canonical market data is created or persisted.
export function executionStressFixture(orders = 74_000): ReplayCandleEvent {
  const timestamp = "2026-09-15T03:45:00.000Z";
  return {
    type: "CANDLE", replayTimestamp: timestamp, instrumentToken: "738561",
    candle: { timestamp, interval: "1m", open: 100, high: 101, low: 99, close: 100, volume: 10000, openInterest: null },
    tick: {} as ReplayCandleEvent["tick"],
    marketState: { recentTickCount: 1, candles1mCount: 1, candles5mCount: 0, latestAvailableTimestamp: timestamp },
    scanner: { status: "COMPLETE", stats: {} as ReplayCandleEvent["scanner"]["stats"], candidates: [] },
    strategy: { evaluationCount: orders, setupCount: orders, statuses: { NO_SETUP: 0, SETUP_DETECTED: orders, SETUP_INVALID: 0, DATA_UNAVAILABLE: 0 },
      evaluations: Array.from({ length: orders }, (_, i) => ({
        strategyId: "execution-stress", strategyVersion: "1", setupIdentity: `stress-${i}`,
        instrumentToken: "738561", tradingSymbol: "FIXTURE", exchange: "NSE", instrumentId: null,
        status: "SETUP_DETECTED", direction: "BEARISH", confidence: null, confidenceComponents: null,
        conditions: [], reasons: [], entry: { type: "MARKET", price: 100 }, stopLoss: 102, target: 96,
        rewardRisk: 2, riskPerUnit: 2, invalidation: null, scannerSignalId: null,
        marketDataTimestamp: timestamp, marketSession: "OPENING", timestamp
      })) }
  };
}

export function benchmarkExecution(indexPendingOrders: boolean, orders = 74_000, candles = 5000) {
  const initial = executionStressFixture(orders);
  const accumulator = new BacktestAnalyticsAccumulator();
  const profile = { orderRowsVisited: 0, processCandleNs: 0 };
  const engine = new HistoricalPaperExecutionEngine({ indexPendingOrders, profile, collectSnapshots: false, collectEquityCurve: false });
  const observe = (event: ReplayCandleEvent) => {
    engine.processEvent(event);
    const a = engine.snapshot();
    accumulator.observe({ timestamp: event.replayTimestamp, cash: a.cash, realisedPnl: a.realisedPnl, unrealisedPnl: a.unrealisedPnl, equity: a.equity, exposure: a.capitalExposure });
  };
  const started = performance.now();
  observe(initial);
  const seeded = performance.now();
  for (let i = 1; i <= candles; i++) {
    const timestamp = new Date(Date.parse(initial.replayTimestamp) + i * 60000).toISOString();
    observe({ ...initial, replayTimestamp: timestamp, candle: { ...initial.candle, timestamp }, strategy: { ...initial.strategy, evaluationCount: 0, setupCount: 0, statuses: { NO_SETUP: 0, SETUP_DETECTED: 0, SETUP_INVALID: 0, DATA_UNAVAILABLE: 0 }, evaluations: [] } });
  }
  const loopMs = performance.now() - seeded;
  const summary: HistoricalReplayResult["summary"] = { deterministicRunId: "execution-stress", instrumentCount: 1, candleCountProcessed: candles + 1, replayStart: initial.replayTimestamp, replayEnd: new Date(Date.parse(initial.replayTimestamp) + (candles + 1) * 60000).toISOString(), replayDurationMs: (candles + 1) * 60000, scannerEvaluations: candles + 1, strategyEvaluations: orders, setupsDetected: orders, invalidSetups: 0, unavailableEvents: 0, dataGapEvents: 0, duplicateCandleEvents: 0 };
  const execution = engine.complete(summary);
  const analytics = accumulator.complete(execution);
  const digest = createHash("sha256").update(JSON.stringify({ execution, analytics })).digest("hex");
  return { mode: indexPendingOrders ? "PENDING_INDEX" : "LEGACY_SCAN", orders, candles, digest, loopMs, totalMs: performance.now() - started, profile, peakRssKiB: process.resourceUsage().maxRSS };
}

if (require.main === module) {
  const legacy = benchmarkExecution(false);
  const indexed = benchmarkExecution(true);
  if (legacy.digest !== indexed.digest) throw new Error("Execution/analytics equivalence failed.");
  console.log(JSON.stringify({ legacy, indexed, loopSpeedup: legacy.loopMs / indexed.loopMs, equivalence: "PASS" }, null, 2));
}
