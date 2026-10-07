import { describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import type { NormalizedHistoricalCandle } from "../../historical-market-data/types";
import { deterministicReplayId, HistoricalReplayRunner } from "./historical-replay-runner";
import type { HistoricalReplayRequest, ReplayEvent } from "./types";

const BASE_FETCHED_AT = new Date("2026-09-15T10:00:00.000Z");

type TestCandleInput = Omit<Partial<NormalizedHistoricalCandle>, "timestamp"> & {
  instrumentToken?: string;
  timestamp: string;
  open?: number;
  high?: number;
  low?: number;
  close?: number;
  volume?: number;
};

function candle(partial: TestCandleInput): NormalizedHistoricalCandle {
  const token = partial.instrumentToken ?? "738561";
  return {
    ...partial,
    instrumentId: `inst-${token}`,
    instrumentToken: token,
    exchange: "NSE",
    tradingSymbol: token === "738561" ? "RELIANCE" : `SYM${token}`,
    interval: "1m",
    timestamp: new Date(partial.timestamp),
    open: partial.open ?? 100,
    high: partial.high ?? 101,
    low: partial.low ?? 99,
    close: partial.close ?? 100.8,
    volume: partial.volume ?? 5000,
    openInterest: null,
    source: "MOCK",
    adjustment: "UNADJUSTED",
    fetchedAt: BASE_FETCHED_AT
  };
}

function risingSeries(token = "738561", start = "2026-09-15T03:45:00.000Z", count = 6) {
  const startMs = Date.parse(start);
  return Array.from({ length: count }, (_, index) => {
    const open = 100 + index * 0.4;
    const close = open + 0.8;
    return candle({
      instrumentToken: token,
      timestamp: new Date(startMs + index * 60_000).toISOString(),
      open,
      high: close + 0.2,
      low: open - 0.4,
      close,
      volume: 5000 + index * 1000
    });
  });
}

function runnerFor(candles: NormalizedHistoricalCandle[], incrementalScanner = false, optimizedContext = false) {
  return new HistoricalReplayRunner({
    loadCandles: async (_request: HistoricalReplayRequest) => candles,
    incrementalScanner,
    optimizedContext
  });
}

function candleEvents(events: ReplayEvent[]) {
  return events.filter((event) => event.type === "CANDLE");
}

function normalizeThrough(events: ReplayEvent[], timestamp: string) {
  return events
    .filter((event) => event.replayTimestamp <= timestamp)
    .map((event) => {
      if (event.type !== "CANDLE") {
        return event;
      }
      return {
        type: event.type,
        replayTimestamp: event.replayTimestamp,
        instrumentToken: event.instrumentToken,
        candle: event.candle,
        tick: {
          lastPrice: event.tick.lastPrice,
          high: event.tick.high,
          low: event.tick.low,
          volume: event.tick.volume
        },
        scannerCandidates: event.scanner.candidates.map((candidate) => ({
          token: candidate.instrumentToken,
          score: candidate.score,
          direction: candidate.direction,
          lastPrice: candidate.lastPrice,
          dataTimestamp: candidate.dataTimestamp,
          reasons: candidate.reasons
        })),
        strategy: event.strategy.evaluations.map((evaluation) => ({
          strategyId: evaluation.strategyId,
          status: evaluation.status,
          setupIdentity: evaluation.setupIdentity,
          marketDataTimestamp: evaluation.marketDataTimestamp,
          timestamp: evaluation.timestamp,
          entry: evaluation.entry,
          stopLoss: evaluation.stopLoss,
          target: evaluation.target
        }))
      };
    });
}

describe("HistoricalReplayRunner", () => {
  it("replays candles chronologically with half-open [from, to) boundaries", async () => {
    const candles = [
      ...risingSeries("738561", "2026-09-15T03:45:00.000Z", 3).reverse(),
      candle({ timestamp: "2026-09-15T03:48:00.000Z", close: 999, high: 999 })
    ];
    const result = await runnerFor(candles).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:48:00.000Z",
      interval: "1m"
    });

    expect(candleEvents(result.events).map((event) => event.replayTimestamp)).toEqual([
      "2026-09-15T03:45:00.000Z",
      "2026-09-15T03:46:00.000Z",
      "2026-09-15T03:47:00.000Z"
    ]);
    expect(result.summary.candleCountProcessed).toBe(3);
  });

  it("advances market state one candle at a time without exposing future highs", async () => {
    const candles = risingSeries("738561", "2026-09-15T03:45:00.000Z", 3);
    candles[2] = candle({
      timestamp: "2026-09-15T03:47:00.000Z",
      open: 100,
      high: 999,
      low: 99,
      close: 998,
      volume: 5000
    });

    const result = await runnerFor(candles).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:48:00.000Z",
      interval: "1m"
    });
    const [first, second, third] = candleEvents(result.events);

    expect(first?.tick.high).toBeLessThan(999);
    expect(second?.tick.high).toBeLessThan(999);
    expect(third?.tick.high).toBe(999);
    expect(second?.marketState.latestAvailableTimestamp).toBe("2026-09-15T03:46:00.000Z");
  });

  it("keeps scanner and strategy outputs through T unchanged when only a future candle changes", async () => {
    const base = risingSeries("738561", "2026-09-15T03:45:00.000Z", 4);
    const changedFuture = [...base];
    changedFuture[3] = candle({
      timestamp: "2026-09-15T03:48:00.000Z",
      open: 500,
      high: 700,
      low: 400,
      close: 650,
      volume: 999999
    });

    const request = {
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:49:00.000Z",
      interval: "1m" as const
    };
    const first = await runnerFor(base).run(request);
    const second = await runnerFor(changedFuture).run(request);

    expect(normalizeThrough(first.events, "2026-09-15T03:47:00.000Z")).toEqual(
      normalizeThrough(second.events, "2026-09-15T03:47:00.000Z")
    );
  });

  it("is deterministic for repeated runs over identical historical data", async () => {
    const candles = risingSeries("738561", "2026-09-15T03:45:00.000Z", 5);
    const request = {
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:50:00.000Z",
      interval: "1m" as const
    };

    const first = await runnerFor(candles).run(request);
    const second = await runnerFor(candles).run(request);

    expect(first.summary.deterministicRunId).toBe(second.summary.deterministicRunId);
    expect(first.events).toEqual(second.events);
  });

  it("streams the exact legacy replay identity material without a monolithic allocation", async () => {
    const result = await runnerFor(risingSeries("738561", "2026-09-15T03:45:00.000Z", 3)).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:48:00.000Z",
      interval: "1m"
    });
    const legacy = createHash("sha256").update(JSON.stringify({ request: result.request, events: result.events })).digest("hex").slice(0, 16);
    expect(deterministicReplayId(result.request, result.events)).toBe(legacy);
  });

  it("matches the full production scan with the incremental scanner across simultaneous instruments", async () => {
    const candles = [
      ...risingSeries("738561", "2026-09-15T03:45:00.000Z", 6),
      ...risingSeries("408065", "2026-09-15T03:45:00.000Z", 6)
    ];
    const request = {
      tokens: ["738561", "408065"],
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:51:00.000Z",
      interval: "1m" as const
    };
    const reference = await runnerFor(candles).run(request);
    const incremental = await runnerFor(candles, true).run(request);

    expect(incremental.events).toEqual(reference.events);
    expect(incremental.summary).toEqual(reference.summary);
    expect(incremental.performance?.scanner.featureCalculations).toBe(12);
    expect(reference.performance?.scanner.featureCalculations).toBeGreaterThan(12);
  });

  it("preserves contexts and strategy results with immutable replay hints", async () => {
    const candles = [
      ...risingSeries("738561", "2026-09-15T03:45:00.000Z", 80),
      ...risingSeries("408065", "2026-09-15T03:45:00.000Z", 80)
    ];
    const request = { tokens: ["738561", "408065"], from: "2026-09-15T03:45:00.000Z", to: "2026-09-15T05:05:00.000Z", interval: "1m" as const };
    const reference = await runnerFor(candles, true).run(request);
    const optimized = await runnerFor(candles, true, true).run(request);

    expect(optimized.events).toEqual(reference.events);
    expect(optimized.summary).toEqual(reference.summary);
  });

  it("feeds the production scanner and deterministic strategy engine", async () => {
    const result = await runnerFor(risingSeries("738561", "2026-09-15T03:45:00.000Z", 4)).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:49:00.000Z",
      interval: "1m"
    });

    expect(result.summary.scannerEvaluations).toBe(4);
    expect(result.summary.strategyEvaluations).toBeGreaterThan(0);
    expect(candleEvents(result.events).some((event) => event.scanner.candidates.length > 0)).toBe(true);
    expect(candleEvents(result.events).some((event) => event.strategy.evaluations.length > 0)).toBe(true);
    expect(result.summary.setupsDetected + result.summary.invalidSetups + result.summary.unavailableEvents).toBeGreaterThan(0);
  });

  it("derives 5m candles during replay only after enough 1m history exists", async () => {
    const result = await runnerFor(risingSeries("738561", "2026-09-15T03:45:00.000Z", 6)).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:51:00.000Z",
      interval: "1m"
    });
    const events = candleEvents(result.events);

    expect(events[3]?.marketState.candles5mCount).toBe(0);
    expect(events[4]?.marketState.candles5mCount).toBe(1);
    expect(events[5]?.marketState.candles1mCount).toBe(6);
  });

  it("represents missing data explicitly and does not forward-fill candles", async () => {
    const candles = [
      candle({ timestamp: "2026-09-15T03:45:00.000Z" }),
      candle({ timestamp: "2026-09-15T03:47:00.000Z", close: 102, high: 103 })
    ];

    const result = await runnerFor(candles).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:48:00.000Z",
      interval: "1m"
    });

    expect(result.events.map((event) => `${event.type}:${event.replayTimestamp}`)).toEqual([
      "CANDLE:2026-09-15T03:45:00.000Z",
      "DATA_GAP:2026-09-15T03:46:00.000Z",
      "CANDLE:2026-09-15T03:47:00.000Z"
    ]);
    expect(result.summary.dataGapEvents).toBe(1);
    expect(result.summary.candleCountProcessed).toBe(2);
  });

  it("does not emit a CAS-window gap after the CAS effective date", async () => {
    const start = Date.parse("2026-09-07T03:45:00.000Z");
    const candles = Array.from({ length: 360 }, (_, index) => candle({
      timestamp: new Date(start + index * 60_000).toISOString()
    }));
    const result = await runnerFor(candles).run({
      instruments: [{ instrumentToken: "738561", tradingSymbol: "RELIANCE", exchange: "NSE", casEligibility: "ELIGIBLE", eligibilitySource: "test fixture" }],
      from: "2026-09-07T03:45:00.000Z",
      to: "2026-09-07T10:00:00.000Z",
      interval: "1m"
    });

    expect(result.summary.candleCountProcessed).toBe(360);
    expect(result.summary.dataGapEvents).toBe(0);
    expect(result.validationIssues.filter((issue) => issue.kind === "MISSING_CANDLE")).toHaveLength(0);
  });

  it("does not infer session gaps when CAS eligibility is unknown", async () => {
    const start = Date.parse("2026-09-07T03:45:00.000Z");
    const candles = Array.from({ length: 360 }, (_, index) => candle({
      timestamp: new Date(start + index * 60_000).toISOString()
    }));
    const result = await runnerFor(candles).run({
      instruments: [{ instrumentToken: "738561", tradingSymbol: "RELIANCE", exchange: "NSE", casEligibility: "UNKNOWN", eligibilitySource: "unresolved" }],
      from: "2026-09-07T03:45:00.000Z",
      to: "2026-09-07T10:00:00.000Z",
      interval: "1m"
    });

    expect(result.summary.dataGapEvents).toBe(0);
  });

  it("still emits a real gap inside a CAS continuous session", async () => {
    const start = Date.parse("2026-09-07T03:45:00.000Z");
    const candles = Array.from({ length: 360 }, (_, index) => candle({ timestamp: new Date(start + index * 60_000).toISOString() })).filter((_, index) => index !== 120);
    const result = await runnerFor(candles).run({
      instruments: [{ instrumentToken: "738561", tradingSymbol: "RELIANCE", exchange: "NSE", casEligibility: "ELIGIBLE", eligibilitySource: "test fixture" }],
      from: "2026-09-07T03:45:00.000Z",
      to: "2026-09-07T10:00:00.000Z",
      interval: "1m"
    });

    expect(result.summary.dataGapEvents).toBe(1);
    expect(result.events.some((event) => event.type === "DATA_GAP" && event.expectedTimestamp === "2026-09-07T05:45:00.000Z")).toBe(true);
    expect(result.validationIssues.some((issue) => issue.kind === "MISSING_CANDLE" && issue.timestamp === "2026-09-07T05:45:00.000Z")).toBe(true);
  });

  it("keeps a non-CAS closing gap as a real diagnostic", async () => {
    const start = Date.parse("2026-09-07T03:45:00.000Z");
    const candles = Array.from({ length: 360 }, (_, index) => candle({ timestamp: new Date(start + index * 60_000).toISOString() }));
    const result = await runnerFor(candles).run({
      instruments: [{ instrumentToken: "738561", tradingSymbol: "RELIANCE", exchange: "NSE", casEligibility: "NOT_ELIGIBLE", eligibilitySource: "test fixture" }],
      from: "2026-09-07T03:45:00.000Z",
      to: "2026-09-07T10:00:00.000Z",
      interval: "1m"
    });

    expect(result.summary.dataGapEvents).toBe(15);
    expect(result.validationIssues.filter((issue) => issue.kind === "MISSING_CANDLE")).toHaveLength(15);
  });

  it("orders multiple instruments by timestamp and deterministic token tie-breaker", async () => {
    const candles = [
      candle({ instrumentToken: "2", timestamp: "2026-09-15T03:45:00.000Z" }),
      candle({ instrumentToken: "1", timestamp: "2026-09-15T03:45:00.000Z" }),
      candle({ instrumentToken: "1", timestamp: "2026-09-15T03:46:00.000Z" })
    ];

    const result = await runnerFor(candles).run({
      tokens: ["2", "1"],
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:47:00.000Z",
      interval: "1m"
    });

    expect(candleEvents(result.events).map((event) => `${event.replayTimestamp}:${event.instrumentToken}`)).toEqual([
      "2026-09-15T03:45:00.000Z:1",
      "2026-09-15T03:45:00.000Z:2",
      "2026-09-15T03:46:00.000Z:1"
    ]);
  });

  it("uses existing timezone/session utilities for replayed strategy contexts", async () => {
    const result = await runnerFor(risingSeries("738561", "2026-09-15T03:45:00.000Z", 2)).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:47:00.000Z",
      interval: "1m"
    });
    const sessions = candleEvents(result.events).flatMap((event) =>
      event.strategy.evaluations.map((evaluation) => evaluation.marketSession)
    );

    expect(sessions).toContain("REGULAR");
  });

  it("handles empty non-session historical ranges without inventing candles", async () => {
    const result = await runnerFor([]).run({
      token: "738561",
      from: "2026-09-12T03:45:00.000Z",
      to: "2026-09-12T03:47:00.000Z",
      interval: "1m"
    });

    expect(result.summary.candleCountProcessed).toBe(0);
    expect(result.summary.dataGapEvents).toBe(0);
    expect(result.events).toEqual([]);
  });

  it("surfaces insufficient historical data through strategy DATA_UNAVAILABLE statuses", async () => {
    const result = await runnerFor([candle({ timestamp: "2026-09-15T03:45:00.000Z" })]).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:46:00.000Z",
      interval: "1m"
    });

    expect(result.summary.unavailableEvents).toBeGreaterThan(0);
  });

  it("reports duplicate historical candles without replaying the duplicate", async () => {
    const duplicate = candle({ timestamp: "2026-09-15T03:45:00.000Z", close: 101 });
    const result = await runnerFor([
      candle({ timestamp: "2026-09-15T03:45:00.000Z", close: 100.8 }),
      duplicate
    ]).run({
      token: "738561",
      from: "2026-09-15T03:45:00.000Z",
      to: "2026-09-15T03:46:00.000Z",
      interval: "1m"
    });

    expect(result.summary.candleCountProcessed).toBe(1);
    expect(result.summary.duplicateCandleEvents).toBe(1);
    expect(result.validationIssues.some((issue) => issue.kind === "DUPLICATE_TIMESTAMP")).toBe(true);
  });
});
