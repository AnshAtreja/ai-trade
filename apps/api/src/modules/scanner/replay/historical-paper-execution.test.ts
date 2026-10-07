import { describe, expect, it } from "vitest";
import { executeHistoricalPaperReplay, HistoricalPaperExecutionEngine } from "./historical-paper-execution";
import { analyzeBacktest } from "./backtest-analytics";
import type { HistoricalReplayResult, ReplayCandleEvent } from "./types";
import { benchmarkExecution } from "./execution-benchmark";

const START = "2026-09-15T03:45:00.000Z";

function candle(minute: number, overrides: Partial<ReplayCandleEvent["candle"]> = {}, setup: false | { direction?: "BULLISH" | "BEARISH"; entryType?: "MARKET" | "BREAKOUT_PRICE"; entryPrice?: number; stop?: number; target?: number } = false): ReplayCandleEvent {
  const timestamp = new Date(Date.parse(START) + minute * 60_000).toISOString();
  return {
    type: "CANDLE", replayTimestamp: timestamp, instrumentToken: "738561",
    candle: { timestamp, interval: "1m", open: 100, high: 101, low: 99, close: 100, volume: 10_000, openInterest: null, ...overrides },
    tick: {} as ReplayCandleEvent["tick"], marketState: { recentTickCount: minute + 1, candles1mCount: minute + 1, candles5mCount: 0, latestAvailableTimestamp: timestamp },
    scanner: { status: "COMPLETE", stats: {} as ReplayCandleEvent["scanner"]["stats"], candidates: [] },
    strategy: {
      evaluationCount: setup ? 1 : 0, setupCount: setup ? 1 : 0, statuses: { NO_SETUP: 0, SETUP_DETECTED: setup ? 1 : 0, SETUP_INVALID: 0, DATA_UNAVAILABLE: 0 },
      evaluations: setup ? [{ strategyId: "test", strategyVersion: "1", setupIdentity: `setup-${minute}`, instrumentToken: "738561", tradingSymbol: "TEST", exchange: "NSE", instrumentId: null, status: "SETUP_DETECTED", direction: setup.direction ?? "BULLISH", confidence: null, confidenceComponents: null, conditions: [], reasons: [], entry: { type: setup.entryType ?? "MARKET", price: setup.entryPrice ?? 100 }, stopLoss: setup.stop ?? (setup.direction === "BEARISH" ? 102 : 98), target: setup.target ?? (setup.direction === "BEARISH" ? 96 : 104), rewardRisk: 2, riskPerUnit: 2, invalidation: null, scannerSignalId: null, marketDataTimestamp: timestamp, marketSession: "REGULAR", timestamp }] : []
    }
  };
}

function replay(events: ReplayCandleEvent[]): HistoricalReplayResult {
  return { request: { instruments: [{ instrumentToken: "738561", tradingSymbol: "TEST", exchange: "NSE" }], from: START, to: new Date(Date.parse(START) + events.length * 60_000).toISOString(), interval: "1m", strategyIds: null }, summary: { deterministicRunId: "replay-test", instrumentCount: 1, candleCountProcessed: events.length, replayStart: START, replayEnd: new Date(Date.parse(START) + events.length * 60_000).toISOString(), replayDurationMs: events.length * 60_000, scannerEvaluations: events.length, strategyEvaluations: events.reduce((sum, event) => sum + event.strategy.evaluationCount, 0), setupsDetected: events.reduce((sum, event) => sum + event.strategy.setupCount, 0), invalidSetups: 0, unavailableEvents: 0, dataGapEvents: 0, duplicateCandleEvents: 0 }, validationIssues: [], events, limitations: [] };
}

describe("HistoricalPaperExecutionEngine", () => {
  it("keeps indexed pending orders exactly equivalent across fills, gaps, rejection, expiry and instruments", () => {
    const events = [
      candle(0, {}, {}), candle(0, {}, { direction: "BEARISH" }),
      candle(0, {}, { entryType: "BREAKOUT_PRICE", entryPrice: 95, stop: 93, target: 99 }),
      { ...candle(1), instrumentToken: "408065" },
      candle(1, { volume: 5 }), candle(2, { volume: 1000 }),
      candle(3, { open: 96, low: 90, high: 106 }), candle(4),
      candle(5, {}, {}), candle(6), candle(7, { high: 110 }),
      candle(8, {}, { entryType: "BREAKOUT_PRICE", entryPrice: 80, stop: 78, target: 85 })
    ];
    const input = replay(events);
    for (const allowShortSelling of [false, true]) {
      const options = { riskProfile: { allowShortSelling, maxOpenPositions: 20, maxTradesPerDay: 100 }, executionConfig: { slippagePolicy: "BPS" as const, slippageBps: 4 } };
      const legacy = executeHistoricalPaperReplay(input, { ...options, indexPendingOrders: false });
      const indexed = executeHistoricalPaperReplay(input, { ...options, indexPendingOrders: true });
      expect(indexed).toEqual(legacy);
      expect(analyzeBacktest(indexed)).toEqual(analyzeBacktest(legacy));
      expect(indexed.fills.length).toBeGreaterThan(0);
      expect(indexed.trades.length).toBeGreaterThan(0);
    }
    const unfilled = replay([candle(0, {}, { entryType: "BREAKOUT_PRICE", entryPrice: 95, stop: 93, target: 99 }), candle(1, { low: 96 })]);
    const indexed = executeHistoricalPaperReplay(unfilled);
    expect(indexed).toEqual(executeHistoricalPaperReplay(unfilled, { indexPendingOrders: false }));
    expect(indexed.orders[0]?.status).toBe("EXPIRED");
  });

  it("does no terminal-order scans on subsequent candles and preserves complete output identity", () => {
    const legacy = benchmarkExecution(false, 1500, 100);
    const indexed = benchmarkExecution(true, 1500, 100);
    expect(legacy.profile.orderRowsVisited).toBe(150000);
    expect(indexed.profile.orderRowsVisited).toBe(0);
    expect(indexed.digest).toBe(legacy.digest);
  });
  it("creates a setup order at T and fills it only on T+1", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {}), candle(1, { open: 101 })]));
    expect(result.orders[0]?.orderTimestamp).toBe(START);
    expect(result.orders[0]?.eligibleAfter).toBe(candle(1).replayTimestamp);
    expect(result.fills).toHaveLength(1);
    expect(result.fills[0]?.timestamp).toBe(candle(1).replayTimestamp);
    expect(result.fills[0]?.rawExecutablePrice).toBe(101);
  });

  it("uses the adverse stop outcome when target and stop share an OHLC candle", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {}), candle(1), candle(2, { open: 100, high: 105, low: 97, close: 103 })]));
    const trade = result.trades[0]!;
    expect(trade.exitReason).toBe("STOP_LOSS");
    expect(trade.exitPrice).toBe(97);
    expect(trade.intrabarAmbiguity).toBe(true);
  });

  it("fills a stop gap through at the next candle open", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {}), candle(1), candle(2, { open: 96, high: 98, low: 95, close: 97 })]));
    expect(result.trades[0]?.exitPrice).toBe(96);
    expect(result.trades[0]?.gapExecution).toBe(true);
  });

  it("is deterministic and isolates each simulated account", () => {
    const input = replay([candle(0, {}, {}), candle(1), candle(2, { high: 105, low: 99, close: 104 })]);
    const first = executeHistoricalPaperReplay(input, { startingCapital: 50000 });
    const second = executeHistoricalPaperReplay(input, { startingCapital: 50000 });
    expect(second).toEqual(first);
    expect(first.account.startingCapital).toBe(50000);
  });

  it("keeps bounded analytics points equivalent to legacy full snapshots", () => {
    const input = replay([candle(0, {}, {}), candle(1, { open: 101 }), candle(2, { high: 105, low: 97, close: 103 }), candle(3)]);
    const legacy = executeHistoricalPaperReplay(input);
    const bounded = executeHistoricalPaperReplay(input, { collectSnapshots: false });

    expect(bounded.snapshots).toEqual([]);
    expect(bounded.equityCurve).toHaveLength(legacy.snapshots.length);
    expect(bounded.runId).toBe(legacy.runId);
    expect({ orders: bounded.orders, fills: bounded.fills, trades: bounded.trades, account: bounded.account, summary: bounded.summary })
      .toEqual({ orders: legacy.orders, fills: legacy.fills, trades: legacy.trades, account: legacy.account, summary: legacy.summary });
    expect(analyzeBacktest(bounded)).toEqual(analyzeBacktest(legacy));
  });

  it("streams exact equity points to research analytics without retaining an intraday curve", () => {
    const input = replay([candle(0, {}, {}), candle(1, { open: 101 }), candle(2, { high: 105, low: 97, close: 103 })]);
    const points: Array<{ timestamp: string; equity: number }> = [];
    const engine = new HistoricalPaperExecutionEngine({ collectSnapshots: false, collectEquityCurve: false, onEquityPoint: (point) => points.push({ timestamp: point.timestamp, equity: point.equity }) });
    for (const event of input.events) engine.processEvent(event);
    const streamed = engine.complete(input.summary);
    const bounded = executeHistoricalPaperReplay(input, { collectSnapshots: false });
    expect(streamed.equityCurve).toEqual([]);
    expect(points).toEqual(bounded.equityCurve!.map((point) => ({ timestamp: point.timestamp, equity: point.equity })));
    expect({ orders: streamed.orders, fills: streamed.fills, trades: streamed.trades, account: streamed.account, summary: streamed.summary })
      .toEqual({ orders: bounded.orders, fills: bounded.fills, trades: bounded.trades, account: bounded.account, summary: bounded.summary });
  });

  it("does not let later candles alter account state through T+1", () => {
    const early = replay([candle(0, {}, {}), candle(1, { open: 101 }), candle(2, { high: 102, low: 100 })]);
    const changed = replay([candle(0, {}, {}), candle(1, { open: 101 }), candle(2, { high: 1000, low: 1 })]);
    expect(executeHistoricalPaperReplay(early).snapshots.slice(0, 2)).toEqual(executeHistoricalPaperReplay(changed).snapshots.slice(0, 2));
  });

  it("marks open positions incomplete when replay ends before session close", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {}), candle(1)]));
    expect(result.trades[0]?.status).toBe("INCOMPLETE_DATA");
    expect(result.summary.positionsIncomplete).toBe(1);
  });

  it("keeps a non-crossed limit order unfilled and expires it at data end", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, { entryType: "BREAKOUT_PRICE", entryPrice: 95, stop: 93, target: 99 }), candle(1, { low: 96, high: 102 })]));
    expect(result.orders[0]?.status).toBe("EXPIRED");
    expect(result.fills).toHaveLength(0);
  });

  it("uses available historical volume for deterministic partial fills", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {}), candle(1, { volume: 5 })]));
    expect(result.orders[0]?.status).toBe("EXPIRED");
    expect(result.orders[0]?.filledQuantity).toBe(5);
    expect(result.trades[0]?.partialFillCount).toBe(0);
  });

  it("applies adverse configured slippage and tracks turnover charges on close", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {}), candle(1), candle(2, { high: 105, low: 99 })]), {
      executionConfig: { slippagePolicy: "BPS", slippageBps: 10, chargeRateBps: 10, minCharge: 0 }
    });
    expect(result.fills[0]?.fillPrice).toBeGreaterThan(100);
    expect(result.trades[0]?.charges).toBeGreaterThan(0);
    expect(result.trades[0]?.netPnl).toBeLessThan(result.trades[0]?.grossPnl ?? 0);
  });

  it("keeps exact online monetary and R expectancy accumulators", () => {
    const result = executeHistoricalPaperReplay(replay([
      candle(0, {}, {}),
      candle(1, { open: 101 }),
      candle(2, { high: 106, low: 100 })
    ]));
    const analytics = analyzeBacktest(result);
    expect(result.summary.classificationMetrics.closedTradeCount).toBe(analytics.metadata.closedTradeCount);
    expect(result.summary.classificationMetrics.expectancyPnl).toBe(analytics.pnl.expectancy);
    expect(result.summary.classificationMetrics.expectancyR).toBe(analytics.pnl.averageR);
    expect(result.summary.classificationMetrics.validRTradeCount).toBe(1);
  });

  it("supports short execution only when the isolated risk profile permits it", () => {
    const input = replay([candle(0, {}, { direction: "BEARISH" }), candle(1), candle(2, { high: 103, low: 99 })]);
    expect(executeHistoricalPaperReplay(input).orders[0]?.status).toBe("REJECTED");
    const allowed = executeHistoricalPaperReplay(input, { riskProfile: { allowShortSelling: true } });
    expect(allowed.trades[0]?.direction).toBe("SHORT");
    expect(allowed.trades[0]?.exitReason).toBe("STOP_LOSS");
  });

  it("rejects a risk-sized order that would exceed isolated portfolio exposure", () => {
    const result = executeHistoricalPaperReplay(replay([candle(0, {}, {})]), {
      riskProfile: { maxCapitalExposure: 100, maxPositionSize: 100000 }
    });
    expect(result.orders[0]?.status).toBe("REJECTED");
    expect(result.orders[0]?.rejectionReasons).toContain("MAX_CAPITAL_EXPOSURE_EXCEEDED");
  });
});
