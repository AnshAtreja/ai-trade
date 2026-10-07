import { describe, expect, it } from "vitest";
import { analyzeBacktest, BacktestAnalyticsAccumulator } from "./backtest-analytics";
import type { HistoricalPaperExecutionResult, HistoricalPaperTrade } from "./historical-paper-execution";

function trade(index: number, netPnl: number, overrides: Partial<HistoricalPaperTrade> = {}): HistoricalPaperTrade {
  const entry = `2026-09-${String(15 + index).padStart(2, "0")}T04:00:00.000Z`;
  const exit = `2026-09-${String(15 + index).padStart(2, "0")}T05:00:00.000Z`;
  return { tradeId: `t${index}`, instrumentToken: "738561", tradingSymbol: "TEST", strategyId: index % 2 ? "momentum" : "breakout", strategyVersion: "1", setupId: `s${index}`, direction: "LONG", quantity: 10, setupTimestamp: entry, orderTimestamp: entry, entryTimestamp: entry, entryPrice: 100, stopPrice: 98, targetPrice: 104, exitTimestamp: exit, exitPrice: 100 + netPnl / 10, exitReason: netPnl >= 0 ? "TARGET" : "STOP_LOSS", grossPnl: netPnl, charges: 0, netPnl, status: "CLOSED", slippage: 0, partialFillCount: 0, intrabarAmbiguity: false, gapExecution: false, lastPrice: 100, ...overrides };
}
function fixture(trades: HistoricalPaperTrade[], equities = [100000, 105000, 103000, 95000, 98000, 110000]): HistoricalPaperExecutionResult {
  const snapshots = equities.map((equity, index) => ({ timestamp: `2026-09-${String(15 + index).padStart(2, "0")}T10:00:00.000Z`, account: { startingCapital: 100000, cash: equity, availableCapital: equity, equity, realisedPnl: equity - 100000, unrealisedPnl: 0, capitalExposure: 0, openPositions: 0, closedTrades: 0, orders: 0, fills: 0, charges: 0 } }));
  return { runId: "run", replayRunId: "replay", source: { startTimestamp: snapshots[0]!.timestamp, endTimestamp: snapshots.at(-1)!.timestamp, duplicateCandleEvents: 0, dataGapEvents: 0 }, orders: [], fills: [], trades, account: snapshots.at(-1)!.account, snapshots, summary: { instrumentCount: 1, candlesProcessed: 6, setupsDetected: trades.length, ordersCreated: trades.length, ordersFilled: trades.length, ordersExpired: 0, positionsOpened: trades.length, positionsClosed: trades.length, positionsIncomplete: 0, fills: trades.length, grossPnl: trades.reduce((s, t) => s + t.grossPnl, 0), charges: 0, netPnl: trades.reduce((s, t) => s + t.netPnl, 0), endingCash: 110000, endingEquity: 110000, dataGapEvents: 0, ambiguousIntrabarEvents: 0, classificationMetrics: { closedTradeCount: trades.length, sumNetPnl: trades.reduce((s, t) => s + t.netPnl, 0), expectancyPnl: trades.length ? trades.reduce((s, t) => s + t.netPnl, 0) / trades.length : null, validRTradeCount: trades.length, sumR: 0, expectancyR: 0 } }, limitations: [] };
}

describe("analyzeBacktest", () => {
  it("calculates closed-trade P&L, rates, profit factor, expectancy, and R without mutation", () => {
    const input = fixture([trade(0, 100), trade(1, -50), trade(2, 0)]); const before = JSON.stringify(input);
    const result = analyzeBacktest(input);
    expect(JSON.stringify(input)).toBe(before); expect(result.pnl.netPnl).toBe(50); expect(result.pnl.grossProfit).toBe(100); expect(result.pnl.grossLoss).toBe(-50); expect(result.pnl.profitFactor).toBe(2); expect(result.trades).toMatchObject({ winningTrades: 1, losingTrades: 1, breakevenTrades: 1, winRate: 1 / 3 }); expect(result.pnl.averageR).not.toBeNull();
  });
  it("returns safe null metrics for zero trades and insufficient return observations", () => { const result = analyzeBacktest(fixture([], [100000])); expect(result.pnl.averageTradePnl).toBeNull(); expect(result.pnl.profitFactor).toBe(0); expect(result.riskAdjusted.sharpeRatio).toBeNull(); expect(JSON.stringify(result)).not.toMatch(/NaN|Infinity/); });
  it("calculates known maximum drawdown and recovery", () => { const result = analyzeBacktest(fixture([])); expect(result.drawdown.maxDrawdownAmount).toBe(10000); expect(result.drawdown.maxDrawdownPercent).toBeCloseTo(9.5238, 3); expect(result.drawdown.recoveryTimestamp).toBe("2026-09-20T10:00:00.000Z"); });
  it("groups deterministically and carries data-quality diagnostics", () => { const input = fixture([trade(0, 100), trade(1, -50, { direction: "SHORT", intrabarAmbiguity: true, gapExecution: true })]); input.source.dataGapEvents = 2; input.summary.ambiguousIntrabarEvents = 1; const result = analyzeBacktest(input); expect(result.byStrategy.map((x) => x.strategyId)).toEqual(["breakout", "momentum"]); expect(result.byDirection.map((x) => x.direction)).toEqual(["LONG", "SHORT"]); expect(result.diagnostics.map((x) => x.code)).toContain("DATA_GAPS_PRESENT"); });
  it("is deterministic across repeated analysis", () => { const input = fixture([trade(0, 100), trade(1, -50)]); expect(analyzeBacktest(input)).toEqual(analyzeBacktest(input)); });
  it("matches full-history analytics with exact online accumulation while omitting only intraday series", () => {
    const input = fixture([trade(0, 100), trade(1, -50)]);
    const reference = analyzeBacktest(input);
    const accumulator = new BacktestAnalyticsAccumulator();
    for (const snapshot of input.snapshots) accumulator.observe({ timestamp: snapshot.timestamp, cash: snapshot.account.cash, realisedPnl: snapshot.account.realisedPnl, unrealisedPnl: snapshot.account.unrealisedPnl, equity: snapshot.account.equity, exposure: snapshot.account.capitalExposure });
    const compact = accumulator.complete(input);
    expect(compact.equityCurve).toEqual([]);
    expect(compact.drawdown.points).toEqual([]);
    expect({ ...compact, equityCurve: reference.equityCurve, drawdown: { ...compact.drawdown, points: reference.drawdown.points } }).toEqual(reference);
  });
});
