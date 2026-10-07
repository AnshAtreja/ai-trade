import { describe, expect, it } from "vitest";
import { executeHistoricalPaperReplay } from "./historical-paper-execution";
import { analyzeBacktest } from "./backtest-analytics";
import { buildClassificationRecoveryRow } from "./robustness-recovery";
import type { HistoricalReplayResult, ReplayCandleEvent } from "./types";

const start = "2026-09-15T03:45:00.000Z";

function event(minute: number, setup = false): ReplayCandleEvent {
  const timestamp = new Date(Date.parse(start) + minute * 60_000).toISOString();
  return {
    type: "CANDLE", replayTimestamp: timestamp, instrumentToken: "738561",
    candle: { timestamp, interval: "1m", open: 100, high: minute === 2 ? 106 : 101, low: 99, close: 100, volume: 10_000, openInterest: null }, tick: {} as ReplayCandleEvent["tick"], marketState: { recentTickCount: minute + 1, candles1mCount: minute + 1, candles5mCount: 0, latestAvailableTimestamp: timestamp }, scanner: { status: "COMPLETE", stats: {} as ReplayCandleEvent["scanner"]["stats"], candidates: [] },
    strategy: { evaluationCount: setup ? 1 : 0, setupCount: setup ? 1 : 0, statuses: { NO_SETUP: 0, SETUP_DETECTED: setup ? 1 : 0, SETUP_INVALID: 0, DATA_UNAVAILABLE: 0 }, evaluations: setup ? [{ strategyId: "breakout", strategyVersion: "1", setupIdentity: "recovery-setup", instrumentToken: "738561", tradingSymbol: "TEST", exchange: "NSE", instrumentId: null, status: "SETUP_DETECTED", direction: "BULLISH", confidence: null, confidenceComponents: null, conditions: [], reasons: [], entry: { type: "MARKET", price: 100 }, stopLoss: 98, target: 104, rewardRisk: 2, riskPerUnit: 2, invalidation: null, scannerSignalId: null, marketDataTimestamp: timestamp, marketSession: "REGULAR", timestamp }] : [] }
  };
}

function replay(events: ReplayCandleEvent[]): HistoricalReplayResult {
  return { request: { instruments: [{ instrumentToken: "738561", tradingSymbol: "TEST", exchange: "NSE" }], from: start, to: new Date(Date.parse(start) + events.length * 60_000).toISOString(), interval: "1m", strategyIds: null }, summary: { deterministicRunId: "recovery-proof", instrumentCount: 1, candleCountProcessed: events.length, replayStart: start, replayEnd: new Date(Date.parse(start) + events.length * 60_000).toISOString(), replayDurationMs: events.length * 60_000, scannerEvaluations: events.length, strategyEvaluations: 1, setupsDetected: 1, invalidSetups: 0, unavailableEvents: 0, dataGapEvents: 0, duplicateCandleEvents: 0 }, validationIssues: [], events, limitations: [] };
}

describe("Phase 8F.2 classification recovery", () => {
  it("enriches a closed-trade row without changing persisted execution metrics", () => {
    const recovered = executeHistoricalPaperReplay(replay([event(0, true), event(1), event(2)]));
    const analytics = analyzeBacktest(recovered);
    const row = buildClassificationRecoveryRow(
      { specHash: "frozen", baselineRunId: "baseline", strategy: "breakout:v1", foldId: "fold-01", partition: "TRAIN", variantId: "breakout.minVolume.M10" },
      { positionsClosed: recovered.summary.positionsClosed, ordersFilled: recovered.summary.ordersFilled, grossPnl: recovered.summary.grossPnl, charges: recovered.summary.charges, netPnl: recovered.summary.netPnl },
      recovered,
      analytics.drawdown.maxDrawdownAmount
    );
    expect(row.classificationMetrics.closedTradeCount).toBe(1);
    expect(row.classificationMetrics.expectancyPnl).toBe(analytics.pnl.expectancy);
    expect(row.classificationMetrics.expectancyR).toBe(analytics.pnl.averageR);
    expect(() => buildClassificationRecoveryRow(row.sourceIdentity, { positionsClosed: 2, ordersFilled: 1, grossPnl: recovered.summary.grossPnl, charges: recovered.summary.charges, netPnl: recovered.summary.netPnl }, recovered, 0)).toThrow(/positionsClosed/);
  });

  it("keeps zero-trade rows explicit without inventing an R value", () => {
    const recovered = executeHistoricalPaperReplay(replay([event(0)]));
    const row = buildClassificationRecoveryRow(
      { specHash: "frozen", baselineRunId: "baseline", strategy: "breakdown:v1", foldId: "fold-01", partition: "TRAIN", variantId: "breakdown.minVolume.M10" },
      { positionsClosed: 0, ordersFilled: 0, grossPnl: 0, charges: 0, netPnl: 0 },
      recovered,
      0
    );
    expect(row.classificationMetrics).toMatchObject({ closedTradeCount: 0, expectancyPnl: null, expectancyR: null, validRTradeCount: 0 });
  });
});
