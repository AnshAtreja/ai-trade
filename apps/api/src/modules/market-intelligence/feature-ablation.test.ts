import { createHash } from "node:crypto";
import { describe, expect, it } from "vitest";
import type { BacktestAnalyticsResult } from "../scanner/replay/backtest-analytics";
import type { HistoricalPaperTrade } from "../scanner/replay/historical-paper-execution";
import type { FeatureSession, FeatureSnapshot } from "./feature-types";
import type { InstrumentMarketContext } from "./context-types";
import type { InstrumentRegimeContext } from "./regime-types";
import { effectVsComplement, researchSampleStatus, summarizeClosedTradeGroup } from "./feature-ablation-analysis";
import { compareFrozenAnalytics, validateCapture, type FeatureAblationCapture } from "./feature-ablation-capture";
import { distinctCapturedSetups, setupJoinKey } from "./feature-ablation-join";
import { assertFeatureAblationSources, featureAblationSpec, featureAblationSpecHash } from "./feature-ablation-spec";
import { extractResearchFeatures, registeredFeatureNames, semanticBin, sessionProgressFifth } from "./feature-ablation-values";

const start = "2026-02-01T03:45:00.000Z";
const at = "2026-02-01T03:46:00.000Z";
const later = "2026-02-01T03:47:00.000Z";
const session: FeatureSession = {
  tradeDate: "2026-02-01", openTime: start, closeTime: "2026-02-01T10:00:00.000Z",
  calendarVersion: "NSE_CASH_2025_2026_V2", sessionPolicyVersion: "NSE_CASH_SESSION_V1",
  casEligibilityVersion: "NSE_CAS_ELIGIBILITY_2026_V2"
};

function featureInputs() {
  const metric = (valuePct: number | null, observedAt = at, quality = "AVAILABLE") => ({ valuePct, observedAt, quality });
  const horizons = { "5m": metric(0.1), "15m": metric(0.2), "30m": metric(0.3), "60m": metric(0.4) };
  const relative = Object.fromEntries(Object.keys(horizons).map((horizon) =>
    [horizon, { ...metric(0.2), benchmarkObservedAt: at }]));
  const benchmark = { observedAt: at, horizonReturns: horizons, distanceFromSessionHighPct: metric(0.2),
    distanceFromSessionLowPct: metric(1.2) };
  const instrument = { instrumentToken: "738561", timestamp: at,
    values: { vwapDistancePct: 0.1, atrPct: 0.4, distanceFromSessionHighPct: 0.2,
      distanceFromSessionLowPct: 1.2, gapPct: -0.1, minutesSinceMarketOpen: 1, aboveVwap: true },
    quality: { vwapDistancePct: "AVAILABLE", atrPct: "AVAILABLE", distanceFromSessionHighPct: "AVAILABLE",
      distanceFromSessionLowPct: "AVAILABLE", gapPct: "AVAILABLE", minutesSinceMarketOpen: "AVAILABLE",
      aboveVwap: "AVAILABLE" } } as unknown as FeatureSnapshot;
  const context = { instrumentToken: "738561", timestamp: at,
    market: { benchmark }, sector: { benchmark, benchmarkQuality: "AVAILABLE",
      breadth: { advancePct: 60, aboveVwapPct: 40, quality: "AVAILABLE", aboveVwapQuality: "AVAILABLE" } },
    relative: { instrumentVsMarket: relative, instrumentVsSector: relative }
  } as unknown as InstrumentMarketContext;
  const regime = { market: { timestamp: at, trend: { state: "TRENDING_UP", quality: "AVAILABLE" },
    volatility: { state: "LOW", quality: "AVAILABLE" }, breadth: { state: "CONFIRMING", quality: "AVAILABLE" } },
  sector: { timestamp: at, trend: { state: "TRENDING_UP", quality: "AVAILABLE" },
    volatility: { state: "NORMAL", quality: "AVAILABLE" }, relativeToMarket: "OUTPERFORMING_MARKET" }
  } as unknown as InstrumentRegimeContext;
  return { asOf: at, session, instrument, context, regime };
}

function trade(id: string, netPnl: number, foldId = "fold-01"): { trade: HistoricalPaperTrade; foldId: string;
  sector: string; timeBucket: string; direction: string } {
  const value = { tradeId: id, instrumentToken: id.endsWith("2") ? "408065" : "738561", tradingSymbol: "RELIANCE",
    strategyId: "momentum", strategyVersion: "v1", setupId: id, direction: "LONG", quantity: 1,
    setupTimestamp: start, orderTimestamp: at, entryTimestamp: at, entryPrice: 100,
    stopPrice: 99, targetPrice: 102, exitTimestamp: later, exitPrice: 100 + netPnl,
    exitReason: "TARGET", grossPnl: netPnl + 1, charges: 1, netPnl, status: "CLOSED",
    slippage: 0, partialFillCount: 0, intrabarAmbiguity: false, gapExecution: false, lastPrice: 100 + netPnl
  } as HistoricalPaperTrade;
  return { trade: value, foldId, sector: id.endsWith("2") ? "IT" : "ENERGY", timeBucket: "OPEN", direction: "LONG" };
}

describe("Phase 9D frozen feature-ablation contract", () => {
  it("pins source identities and forbids TEST selection or strategy mutation", () => {
    assertFeatureAblationSources();
    expect(featureAblationSpec.sources.phase8Baseline.runId).toBe("1fd46d5ef1f0e98f");
    expect(featureAblationSpec.strategies).toEqual(["breakout:v1", "breakdown:v1", "momentum:v1", "opening-momentum:v1"]);
    expect(featureAblationSpec.population.primary).toContain("TEST is retrospective audit only");
    expect(featureAblationSpec.noMutation).toContain("strategy parameters");
    expect(featureAblationSpecHash).toHaveLength(64);
  });

  it("joins only completed-candle context at the decision time and rejects later observations", () => {
    const input = featureInputs();
    const features = extractResearchFeatures(input);
    expect(features["market.trend"]).toEqual({ value: "TRENDING_UP", quality: "AVAILABLE" });
    expect(features["market.volatility"]).toEqual({ value: "LOW", quality: "AVAILABLE" });
    expect(features["market.return.15m"]).toEqual({ value: 0.2, quality: "AVAILABLE" });
    expect(features["sector.breadth.advancePct"]).toEqual({ value: 60, quality: "AVAILABLE" });
    expect(features["instrumentVsSector.15m"]).toEqual({ value: 0.2, quality: "AVAILABLE" });
    expect(registeredFeatureNames.every((name) => name in features)).toBe(true);
    expect(setupJoinKey(start, "738561")).toBe(`${start}|738561`);
    expect(() => extractResearchFeatures({ ...input, asOf: start })).toThrow(/Future Phase 9/);
    const future = featureInputs();
    (future.context.market.benchmark.horizonReturns["15m"] as { observedAt: string }).observedAt = later;
    expect(() => extractResearchFeatures(future)).toThrow(/Future Phase 9 context/);
    const futureRelative = featureInputs();
    (futureRelative.context.relative.instrumentVsSector["15m"] as { benchmarkObservedAt: string }).benchmarkObservedAt = later;
    expect(() => extractResearchFeatures(futureRelative)).toThrow(/Future Phase 9 context/);
  });

  it("keeps missing feature quality explicit and uses frozen semantic bins", () => {
    const input = featureInputs();
    (input.instrument.quality as Record<string, string>).gapPct = "DATA_GAP";
    const features = extractResearchFeatures(input);
    expect(features["instrument.gapPct"]).toEqual({ value: null, quality: "DATA_GAP" });
    expect(features["market.indexVwap.UNSUPPORTED_ZERO_VOLUME"]).toEqual({ value: null, quality: "NOT_APPLICABLE" });
    expect(semanticBin("instrument.gapPct", features["instrument.gapPct"]!)).toBe("QUALITY:DATA_GAP");
    expect(semanticBin("market.return.15m", { value: -0.01, quality: "AVAILABLE" })).toBe("NEGATIVE");
    expect(semanticBin("instrument.atrPct", { value: 0.5, quality: "AVAILABLE" })).toBe("MEDIUM");
    expect(semanticBin("sector.breadth.advancePct", { value: 60, quality: "AVAILABLE" })).toBe("BALANCED");
    expect(semanticBin("sector.breadth.advancePct", { value: 60.01, quality: "AVAILABLE" })).toBe("HIGH");
    expect(semanticBin("instrument.session.highDistancePct", { value: 0.5, quality: "AVAILABLE" })).toBe("NEAR");
  });

  it("uses the authoritative special-session duration for coarse time buckets", () => {
    expect(sessionProgressFifth(at, session)).toBe("OPEN");
    expect(sessionProgressFifth("2026-02-01T05:00:00.000Z", session)).toBe("MORNING");
    expect(sessionProgressFifth("2026-02-01T06:15:00.000Z", session)).toBe("MIDDAY");
    expect(sessionProgressFifth("2026-02-01T07:30:00.000Z", session)).toBe("AFTERNOON");
    expect(sessionProgressFifth("2026-02-01T08:45:00.000Z", session)).toBe("CLOSE");
    const muhurat = { ...session, tradeDate: "2025-10-21", openTime: "2025-10-21T08:15:00.000Z",
      closeTime: "2025-10-21T09:15:00.000Z" };
    expect(sessionProgressFifth("2025-10-21T09:02:00.000Z", muhurat)).toBe("AFTERNOON");
    expect(sessionProgressFifth("2025-10-21T09:03:00.000Z", muhurat)).toBe("CLOSE");
    expect(() => sessionProgressFifth("2025-10-21T09:16:00.000Z", muhurat)).toThrow(/Invalid session-relative time/);
  });

  it("deduplicates repeated setup evaluations without losing identity conflicts", () => {
    const setup = { setupId: "s1", setupTimestamp: at, replayTimestamp: start, instrumentToken: "738561", direction: "LONG" };
    expect(distinctCapturedSetups([setup, { ...setup }])).toEqual([setup]);
    expect(() => distinctCapturedSetups([setup, { ...setup, instrumentToken: "408065" }])).toThrow(/Conflicting repeated setup/);
  });

  it("enforces the pre-registered activity gate with fold provenance", () => {
    expect(researchSampleStatus(0, new Map(), 0)).toBe("NO_ACTIVITY_FOR_FEATURE_ABLATION");
    expect(researchSampleStatus(0, new Map(), 10)).toBe("NO_SAMPLE");
    expect(researchSampleStatus(30, new Map([["fold-01", 30]]), 40)).toBe("LOW_SAMPLE");
    expect(researchSampleStatus(30, new Map([["fold-01", 15], ["fold-02", 15]]), 40)).toBe("SUFFICIENT_SAMPLE");
  });

  it("keeps trades separate from setup-evaluation multiplicity and computes exact descriptive effects", () => {
    const baseline = summarizeClosedTradeGroup({ strategy: "momentum:v1", foldId: "ALL_FOLDS", partition: "TRAIN",
      feature: "BASELINE", bin: "ALL", setupEvaluations: 25, distinctSetups: 2,
      trades: [trade("t1", 10), trade("t2", -5, "fold-02")] }, 2);
    const slice = summarizeClosedTradeGroup({ strategy: "momentum:v1", foldId: "ALL_FOLDS", partition: "TRAIN",
      feature: "market.trend", bin: "TRENDING_UP", setupEvaluations: 15, distinctSetups: 1,
      trades: [trade("t1", 10)] }, 2);
    expect(baseline.closedTrades).toBe(2);
    expect(baseline.setupEvaluations).toBe(25);
    expect(baseline.netPnl).toBe(5);
    expect(baseline.expectancy).toBe(2.5);
    expect(baseline.concentration.fold.largestTradeShare).toBe(0.5);
    expect(slice.maxDrawdown).toBeNull();
    expect(slice.profitFactor).toBeNull();
    expect(slice.profitFactorReason).toBe("NO_GROSS_LOSSES");
    expect(effectVsComplement(slice, baseline)).toMatchObject({ expectancyDifference: 15,
      winRateDifference: 1, tradeActivityShare: 0.5, complementClosedTrades: 1 });
    const empty = summarizeClosedTradeGroup({ ...slice, trades: [] }, 0);
    expect(empty.sampleStatus).toBe("NO_ACTIVITY_FOR_FEATURE_ABLATION");
    expect(empty.profitFactor).toBe(0);
  });

  it("rejects a corrupted or mismatched capture before resume", () => {
    const core = { format: "9D-FROZEN-PARTITION-CAPTURE-1" as const, specHash: featureAblationSpecHash,
      baselineRunId: featureAblationSpec.sources.phase8Baseline.runId, foldId: "fold-01", partition: "TEST" as const,
      range: { from: start, to: later }, strategies: featureAblationSpec.strategies.map((strategy) =>
        ({ strategy, setups: [], trades: [], metrics: {} as FeatureAblationCapture["strategies"][number]["metrics"] })) };
    const capture = { ...core, contentHash: createHash("sha256").update(JSON.stringify(core)).digest("hex") };
    expect(validateCapture(capture, "fold-01", "TEST")).toBe(capture);
    expect(() => validateCapture({ ...capture, contentHash: "incorrect" }, "fold-01", "TEST")).toThrow(/Corrupt/);
    expect(() => validateCapture(capture, "fold-02", "TEST")).toThrow(/Incompatible/);
    expect(() => validateCapture({ ...capture, strategies: [...capture.strategies].reverse() }, "fold-01", "TEST")).toThrow(/Incompatible/);
  });

  it("records only execution-ID divergence and still rejects an outcome change", () => {
    const frozen = { metadata: { runId: "frozen" }, pnl: { netPnl: 10 } } as BacktestAnalyticsResult;
    const actual = { metadata: { runId: "replayed" }, pnl: { netPnl: 10 } };
    expect(compareFrozenAnalytics(actual as BacktestAnalyticsResult, frozen)).toEqual({
      frozenExecutionRunId: "frozen", observedExecutionRunId: "replayed"
    });
    expect(() => compareFrozenAnalytics({ ...actual, pnl: { netPnl: 11 } } as BacktestAnalyticsResult, frozen)).toThrow();
  });
});
