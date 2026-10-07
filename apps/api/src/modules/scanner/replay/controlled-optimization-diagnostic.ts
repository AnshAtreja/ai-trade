import { getHistoricalMarketDataService } from "../../historical-market-data/service";
import { researchUniverseInstruments } from "../../historical-market-data/research-universe";
import { NseCashInstrumentSessionPolicy } from "../../historical-market-data/session-policy";
import { HistoricalReplayRunner } from "./historical-replay-runner";

/** TRAIN-only baseline funnel; this uses production scanner and strategy evaluation. */
export async function diagnoseBreakdownTrain(from: string, to: string) {
  if (Date.parse(from) >= Date.parse(to) || Date.parse(to) > Date.parse("2026-03-25T03:45:00.000Z")) throw new Error("Breakdown diagnostic range must stay inside fold-01 TRAIN.");
  const service = getHistoricalMarketDataService();
  const tokens = researchUniverseInstruments.map((instrument) => instrument.instrumentToken);
  const views = await Promise.all(tokens.map((instrumentToken) => service.getResearchCandles({ instrumentToken, interval: "1m", from, to, requireCompleteSession: true })));
  const candles = views.flatMap((view) => view.candles);
  const statuses: Record<string, number> = { NO_SETUP: 0, SETUP_DETECTED: 0, SETUP_INVALID: 0, DATA_UNAVAILABLE: 0 };
  const failedConditions = new Map<string, number>();
  let scannerCandidates = 0;
  const runner = new HistoricalReplayRunner({
    loadCandles: async () => candles,
    sessionPolicy: new NseCashInstrumentSessionPolicy(),
    incrementalScanner: true,
    optimizedContext: true,
    collectEvents: false,
    onEvent: (event) => {
      if (event.type !== "CANDLE") return;
      scannerCandidates += event.scanner.candidates.length;
      for (const evaluation of event.strategy.evaluations) {
        statuses[evaluation.status] = (statuses[evaluation.status] ?? 0) + 1;
        for (const condition of evaluation.conditions.filter((condition) => !condition.passed)) failedConditions.set(condition.name, (failedConditions.get(condition.name) ?? 0) + 1);
      }
    }
  });
  const replay = await runner.run({ tokens, from, to, interval: "1m", strategyIds: ["breakdown"] });
  return { from, to, instrumentCount: tokens.length, candlesProcessed: replay.summary.candleCountProcessed, scannerCandidates, statuses, failedConditions: [...failedConditions.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([condition, count]) => ({ condition, count })), dataGapEvents: replay.summary.dataGapEvents };
}
