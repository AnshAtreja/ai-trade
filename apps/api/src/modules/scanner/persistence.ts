/**
 * Scanner signal persistence helpers.
 * persistent: writes ScannerSignal (+ Instrument) through repositories
 * mock: uses in-memory repositories when PERSISTENCE_MODE=mock
 * broker integration: none
 * paper trading: signals are candidates only; they do not open paper trades here
 * live trading disabled: no broker orders are created from persisted signals
 */
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import { buildScannerDedupeKey, utcSessionDate } from "../../db/mappers";
import { getPersistenceMode, getRepositories } from "../../db/persistence";
import type { ScannerSignalRecord } from "../../db/domain";
import type { ScannerSignalCardData } from "./pipeline";

export async function persistScannerSignalCards(signalCards: ScannerSignalCardData[]) {
  const repos = getRepositories();
  const user = await repos.users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  const sessionDate = utcSessionDate();
  const persisted: ScannerSignalRecord[] = [];

  for (const card of signalCards) {
    const instrument = await repos.instruments.upsertByExchangeSymbol({
      symbol: card.symbol,
      exchange: "MOCK",
      name: card.symbol,
      instrumentToken: null,
      segment: "EQ",
      tickSize: 0.05,
      lotSize: 1,
      isActive: true
    });

    const record = await repos.scannerSignals.upsertByDedupeKey({
      userId: user.id,
      instrumentId: instrument.id,
      symbol: card.symbol,
      direction: card.direction,
      score: card.score,
      matchedSignals: card.matchedSignals,
      explanation: card.aiExplanation,
      entryTrigger: card.entryTrigger,
      stopLoss: card.stopLoss,
      target: card.target,
      riskAmount: card.riskAmount,
      riskApproved: card.riskApproved,
      suggestedAction: card.suggestedAction,
      confidenceLabel: card.confidenceLabel,
      tradingMode: "PAPER",
      sessionDate,
      dedupeKey: buildScannerDedupeKey({
        userId: user.id,
        tradingMode: "PAPER",
        sessionDate,
        symbol: card.symbol,
        direction: card.direction
      })
    });

    persisted.push(record);
  }

  await repos.systemLogs.create({
    userId: user.id,
    level: "INFO",
    source: "scanner",
    message: `Persisted ${persisted.length} scanner signals.`,
    metadata: { mode: getPersistenceMode(), sessionDate }
  });

  return {
    mode: getPersistenceMode(),
    userId: user.id,
    sessionDate,
    count: persisted.length,
    signals: persisted
  };
}

export async function listPersistedScannerSignals(params?: { symbol?: string; sessionDate?: string }) {
  const repos = getRepositories();
  const user = await repos.users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });

  return repos.scannerSignals.listByUser(user.id, {
    symbol: params?.symbol,
    tradingMode: "PAPER",
    sessionDate: params?.sessionDate
  });
}
