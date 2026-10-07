import { getTradingDate } from "../../../common/utils/trading-date";
import type { HistoricalPaperExecutionResult, HistoricalPaperTrade, HistoricalPortfolioSnapshot } from "./historical-paper-execution";

export const BACKTEST_ANALYTICS_VERSION = "8D.1";

export interface BacktestAnalyticsResult {
  metadata: { runId: string; analyticsVersion: string; startTimestamp: string; endTimestamp: string; startingCapital: number; endingEquity: number; instrumentCount: number; candleCount: number; setupCount: number; orderCount: number; fillCount: number; closedTradeCount: number; openTradeCount: number; incompleteTradeCount: number; dataGapCount: number; duplicateCandleCount: number; intrabarAmbiguityCount: number; gapExecutionCount: number };
  pnl: { grossPnl: number; totalCharges: number; netPnl: number; grossProfit: number; grossLoss: number; averageTradePnl: number | null; medianTradePnl: number | null; largestWinningTrade: number | null; largestLosingTrade: number | null; profitFactor: number | null; profitFactorReason: string | null; expectancy: number | null; directMeanExpectancy: number | null; averageR: number | null; medianR: number | null; bestR: number | null; worstR: number | null };
  trades: { winningTrades: number; losingTrades: number; breakevenTrades: number; winRate: number | null; lossRate: number | null; breakevenRate: number | null; maxConsecutiveWins: number; maxConsecutiveLosses: number };
  returns: { netReturnPercent: number | null; realisedReturnPercent: number | null };
  holdingTime: { averageMs: number | null; medianMs: number | null; minMs: number | null; maxMs: number | null };
  equityCurve: Array<{ timestamp: string; cash: number; realisedPnl: number; unrealisedPnl: number; equity: number; exposure: number }>;
  drawdown: { maxDrawdownAmount: number; maxDrawdownPercent: number; maxDrawdownPeakTimestamp: string | null; maxDrawdownTroughTimestamp: string | null; recoveryTimestamp: string | null; points: Array<{ timestamp: string; runningPeak: number; drawdownAmount: number; drawdownPercent: number }> };
  riskAdjusted: { sharpeRatio: number | null; sortinoRatio: number | null; reason: string | null; returnFrequency: "DAILY" };
  dailyReturns: Array<{ tradingDate: string; startingEquity: number; endingEquity: number; netPnl: number; returnPercent: number; partial: boolean }>;
  byStrategy: Breakdown[];
  byInstrument: Array<Breakdown & { instrumentToken: string; tradingSymbol: string }>;
  byDirection: Array<Breakdown & { direction: "LONG" | "SHORT" }>;
  byExitReason: Array<{ exitReason: string; tradeCount: number; netPnl: number }>;
  diagnostics: Array<{ code: string; severity: "INFO" | "WARNING"; message: string; affectedCount: number }>;
}

export interface Breakdown { strategyId: string; strategyVersion: string; setupCount: number; executedTradeCount: number; closedTradeCount: number; grossPnl: number; charges: number; netPnl: number; wins: number; losses: number; breakeven: number; winRate: number | null; averageTradePnl: number | null; averageR: number | null; }

/** Pure Phase 8D measurement over an already-completed historical execution. */
export function analyzeBacktest(input: HistoricalPaperExecutionResult): BacktestAnalyticsResult {
  const accumulator = new BacktestAnalyticsAccumulator({ retainIntradaySeries: true });
  const source = input.equityCurve ?? input.snapshots.map(point);
  for (const equityPoint of source.slice().sort((a, b) => a.timestamp.localeCompare(b.timestamp))) accumulator.observe(equityPoint);
  return accumulator.complete(input);
}

/**
 * Exact online analytics for Phase 8E. It retains only daily closes and scalar
 * drawdown state unless an explicit full Phase 8D intraday series is requested.
 */
export class BacktestAnalyticsAccumulator {
  private readonly equityCurve: BacktestAnalyticsResult["equityCurve"] = [];
  private readonly drawdownPoints: BacktestAnalyticsResult["drawdown"]["points"] = [];
  private readonly daily = new Map<string, { first: number; last: number }>();
  private readonly dailyOrder: string[] = [];
  private peak = -Infinity;
  private peakTime: string | null = null;
  private maxDrawdown = 0;
  private maxDrawdownPercent = 0;
  private maxDrawdownPeakTimestamp: string | null = null;
  private maxDrawdownTroughTimestamp: string | null = null;
  private recoveryTimestamp: string | null = null;

  constructor(private readonly options: { retainIntradaySeries?: boolean } = {}) {}

  observe(point: BacktestAnalyticsResult["equityCurve"][number]) {
    const retain = this.options.retainIntradaySeries ?? false;
    if (retain) this.equityCurve.push(point);
    if (point.equity > this.peak) {
      this.peak = point.equity;
      this.peakTime = point.timestamp;
    }
    const amount = point.equity - this.peak;
    const percent = this.peak ? amount / this.peak * 100 : 0;
    if (amount < this.maxDrawdown) {
      this.maxDrawdown = amount;
      this.maxDrawdownPercent = percent;
      this.maxDrawdownPeakTimestamp = this.peakTime;
      this.maxDrawdownTroughTimestamp = point.timestamp;
      this.recoveryTimestamp = null;
    } else if (this.maxDrawdown < 0 && this.recoveryTimestamp == null && point.equity >= this.peak) {
      this.recoveryTimestamp = point.timestamp;
    }
    if (retain) this.drawdownPoints.push({ timestamp: point.timestamp, runningPeak: this.peak, drawdownAmount: amount, drawdownPercent: percent });
    const tradingDate = getTradingDate(new Date(point.timestamp));
    const day = this.daily.get(tradingDate);
    if (day) day.last = point.equity;
    else {
      this.daily.set(tradingDate, { first: point.equity, last: point.equity });
      this.dailyOrder.push(tradingDate);
    }
  }

  complete(input: HistoricalPaperExecutionResult): BacktestAnalyticsResult {
    const dailyReturns = this.dailyOrder.map((tradingDate, index) => {
      const day = this.daily.get(tradingDate)!;
      const startingEquity = index === 0 ? input.account.startingCapital : day.first;
      const endingEquity = day.last;
      return { tradingDate, startingEquity, endingEquity, netPnl: endingEquity - startingEquity, returnPercent: percent(endingEquity - startingEquity, startingEquity) ?? 0, partial: input.source.dataGapEvents > 0 || input.trades.some((trade) => trade.status === "INCOMPLETE_DATA") };
    });
    const drawdown = {
      maxDrawdownAmount: Math.abs(this.maxDrawdown),
      maxDrawdownPercent: Math.abs(this.maxDrawdownPercent),
      maxDrawdownPeakTimestamp: this.maxDrawdownPeakTimestamp,
      maxDrawdownTroughTimestamp: this.maxDrawdownTroughTimestamp,
      recoveryTimestamp: this.recoveryTimestamp,
      points: this.drawdownPoints
    };
    return buildAnalytics(input, this.equityCurve, drawdown, dailyReturns);
  }
}

function buildAnalytics(input: HistoricalPaperExecutionResult, equityCurve: BacktestAnalyticsResult["equityCurve"], drawdown: BacktestAnalyticsResult["drawdown"], dailyReturns: BacktestAnalyticsResult["dailyReturns"]): BacktestAnalyticsResult {
  const closed = input.trades.filter((trade) => trade.status === "CLOSED").sort(byExitTime);
  const pnls = closed.map((trade) => trade.netPnl);
  const wins = closed.filter((trade) => trade.netPnl > 0); const losses = closed.filter((trade) => trade.netPnl < 0); const flat = closed.filter((trade) => trade.netPnl === 0);
  const grossProfit = sum(wins.map((trade) => trade.netPnl)); const grossLoss = sum(losses.map((trade) => trade.netPnl));
  const rValues = closed.map(tradeR).filter((value): value is number => value != null);
  const rates = closed.length ? { win: wins.length / closed.length, loss: losses.length / closed.length, flat: flat.length / closed.length } : null;
  const profitFactor = grossLoss < 0 ? grossProfit / Math.abs(grossLoss) : grossProfit > 0 ? null : 0;
  const profitFactorReason = grossLoss < 0 || grossProfit === 0 ? null : "NO_GROSS_LOSSES";
  const averageWin = avg(wins.map((trade) => trade.netPnl)); const averageLoss = avg(losses.map((trade) => trade.netPnl));
  const daily = dailyReturns.map((item) => item.returnPercent / 100);
  const riskAdjusted = ratios(daily);
  const diagnostics = diagnosticsFor(input, closed.length, dailyReturns);
  return {
    metadata: { runId: input.runId, analyticsVersion: BACKTEST_ANALYTICS_VERSION, startTimestamp: input.source.startTimestamp, endTimestamp: input.source.endTimestamp, startingCapital: input.account.startingCapital, endingEquity: input.account.equity, instrumentCount: input.summary.instrumentCount, candleCount: input.summary.candlesProcessed, setupCount: input.summary.setupsDetected, orderCount: input.orders.length, fillCount: input.fills.length, closedTradeCount: closed.length, openTradeCount: input.trades.filter((t) => t.status === "OPEN").length, incompleteTradeCount: input.trades.filter((t) => t.status === "INCOMPLETE_DATA").length, dataGapCount: input.source.dataGapEvents, duplicateCandleCount: input.source.duplicateCandleEvents, intrabarAmbiguityCount: input.trades.filter((t) => t.intrabarAmbiguity).length, gapExecutionCount: input.trades.filter((t) => t.gapExecution).length },
    pnl: { grossPnl: sum(closed.map((t) => t.grossPnl)), totalCharges: sum(closed.map((t) => t.charges)), netPnl: sum(pnls), grossProfit, grossLoss, averageTradePnl: avg(pnls), medianTradePnl: median(pnls), largestWinningTrade: wins.length ? Math.max(...wins.map((t) => t.netPnl)) : null, largestLosingTrade: losses.length ? Math.min(...losses.map((t) => t.netPnl)) : null, profitFactor, profitFactorReason, expectancy: rates ? rates.win * (averageWin ?? 0) + rates.loss * (averageLoss ?? 0) : null, directMeanExpectancy: avg(pnls), averageR: avg(rValues), medianR: median(rValues), bestR: rValues.length ? Math.max(...rValues) : null, worstR: rValues.length ? Math.min(...rValues) : null },
    trades: { winningTrades: wins.length, losingTrades: losses.length, breakevenTrades: flat.length, winRate: rates?.win ?? null, lossRate: rates?.loss ?? null, breakevenRate: rates?.flat ?? null, ...streaks(closed) },
    returns: { netReturnPercent: percent(input.account.equity - input.account.startingCapital, input.account.startingCapital), realisedReturnPercent: percent(input.account.realisedPnl, input.account.startingCapital) }, holdingTime: durations(closed), equityCurve, drawdown, riskAdjusted, dailyReturns,
    byStrategy: group(closed, (t) => `${t.strategyId}|${t.strategyVersion}`, (key) => { const [strategyId, strategyVersion] = key.split("|"); return { strategyId, strategyVersion }; }),
    byInstrument: group(closed, (t) => `${t.instrumentToken}|${t.tradingSymbol}`, (key) => { const [instrumentToken, tradingSymbol] = key.split("|"); return { strategyId: "", strategyVersion: "", instrumentToken, tradingSymbol }; }),
    byDirection: group(closed, (t) => t.direction, (direction) => ({ strategyId: "", strategyVersion: "", direction: direction as "LONG" | "SHORT" })),
    byExitReason: [...new Map(closed.map((t) => [t.exitReason!, closed.filter((x) => x.exitReason === t.exitReason)])).entries()].sort(([a], [b]) => a.localeCompare(b)).map(([exitReason, trades]) => ({ exitReason, tradeCount: trades.length, netPnl: sum(trades.map((t) => t.netPnl)) })), diagnostics
  };
}

function point(item: { timestamp: string; account: HistoricalPortfolioSnapshot }) { return { timestamp: item.timestamp, cash: item.account.cash, realisedPnl: item.account.realisedPnl, unrealisedPnl: item.account.unrealisedPnl, equity: item.account.equity, exposure: item.account.capitalExposure }; }
function group<T extends Pick<Breakdown, "strategyId" | "strategyVersion">>(trades: HistoricalPaperTrade[], key: (trade: HistoricalPaperTrade) => string, identity: (key: string) => T): Array<Breakdown & T> { const groups = new Map<string, HistoricalPaperTrade[]>(); for (const trade of trades) groups.set(key(trade), [...(groups.get(key(trade)) ?? []), trade]); return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([id, list]) => { const wins = list.filter((t) => t.netPnl > 0); const losses = list.filter((t) => t.netPnl < 0); const flat = list.filter((t) => t.netPnl === 0); return { ...identity(id), setupCount: list.length, executedTradeCount: list.length, closedTradeCount: list.length, grossPnl: sum(list.map((t) => t.grossPnl)), charges: sum(list.map((t) => t.charges)), netPnl: sum(list.map((t) => t.netPnl)), wins: wins.length, losses: losses.length, breakeven: flat.length, winRate: list.length ? wins.length / list.length : null, averageTradePnl: avg(list.map((t) => t.netPnl)), averageR: avg(list.map(tradeR).filter((v): v is number => v != null)) }; }); }
function ratios(returns: number[]) { if (returns.length < 2) return { sharpeRatio: null, sortinoRatio: null, reason: "INSUFFICIENT_OBSERVATIONS", returnFrequency: "DAILY" as const }; const mean = avg(returns)!; const deviation = stdev(returns); const downside = stdev(returns.filter((r) => r < 0)); return { sharpeRatio: deviation ? mean / deviation : null, sortinoRatio: downside ? mean / downside : null, reason: deviation && downside ? null : "INSUFFICIENT_VARIATION", returnFrequency: "DAILY" as const }; }
function diagnosticsFor(input: HistoricalPaperExecutionResult, closed: number, daily: BacktestAnalyticsResult["dailyReturns"]) { const out: BacktestAnalyticsResult["diagnostics"] = []; if (input.source.dataGapEvents) out.push({ code: "DATA_GAPS_PRESENT", severity: "WARNING", message: "Historical replay contains explicit missing-candle events.", affectedCount: input.source.dataGapEvents }); if (input.trades.some((t) => t.status === "INCOMPLETE_DATA")) out.push({ code: "INCOMPLETE_TRADES", severity: "WARNING", message: "Open trades could not be resolved from available historical data.", affectedCount: input.trades.filter((t) => t.status === "INCOMPLETE_DATA").length }); if (input.summary.ambiguousIntrabarEvents) out.push({ code: "INTRABAR_AMBIGUITY", severity: "WARNING", message: "Conservative OHLC ambiguity resolution affected exits.", affectedCount: input.summary.ambiguousIntrabarEvents }); if (closed < 30) out.push({ code: "INSUFFICIENT_TRADES", severity: "INFO", message: "Trade sample is too small for statistical interpretation.", affectedCount: closed }); if (daily.length < 2) out.push({ code: "INSUFFICIENT_DAILY_RETURNS", severity: "INFO", message: "At least two daily returns are required for risk-adjusted metrics.", affectedCount: daily.length }); if (daily.some((d) => d.partial)) out.push({ code: "PARTIAL_SESSION", severity: "WARNING", message: "One or more trading days are partial or contain data gaps.", affectedCount: daily.filter((d) => d.partial).length }); return out; }
function streaks(trades: HistoricalPaperTrade[]) { let w = 0, l = 0, maxW = 0, maxL = 0; for (const t of trades) { if (t.netPnl > 0) { w++; l = 0; } else if (t.netPnl < 0) { l++; w = 0; } else { w = 0; l = 0; } maxW = Math.max(maxW, w); maxL = Math.max(maxL, l); } return { maxConsecutiveWins: maxW, maxConsecutiveLosses: maxL }; }
function durations(trades: HistoricalPaperTrade[]) { const values = trades.map((t) => Date.parse(t.exitTimestamp!) - Date.parse(t.entryTimestamp)); return { averageMs: avg(values), medianMs: median(values), minMs: values.length ? Math.min(...values) : null, maxMs: values.length ? Math.max(...values) : null }; }
export function tradeR(t: HistoricalPaperTrade) { const risk = Math.abs(t.entryPrice - t.stopPrice) * t.quantity; return risk > 0 ? t.netPnl / risk : null; }
function sum(values: number[]) { return values.reduce((a, b) => a + b, 0); } function avg(values: number[]) { return values.length ? sum(values) / values.length : null; } function median(values: number[]) { if (!values.length) return null; const v = [...values].sort((a, b) => a - b); const i = Math.floor(v.length / 2); return v.length % 2 ? v[i]! : (v[i - 1]! + v[i]!) / 2; } function percent(n: number, d: number) { return d ? n / d * 100 : null; } function stdev(values: number[]) { if (values.length < 2) return null; const m = avg(values)!; return Math.sqrt(sum(values.map((v) => (v - m) ** 2)) / (values.length - 1)); } function byExitTime(a: HistoricalPaperTrade, b: HistoricalPaperTrade) { return a.exitTimestamp!.localeCompare(b.exitTimestamp!); }
