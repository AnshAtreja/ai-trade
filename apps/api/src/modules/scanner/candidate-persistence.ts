import { createId } from "../../db/mappers";
import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import { getPersistenceMode, getRepositories } from "../../db/persistence";
import { getTradingDate } from "../../common/utils/trading-date";
import type { ScannerCandidate } from "./production-types";

/**
 * Persist Phase 5 candidates as historical ScannerSignal rows.
 * Each run uses a unique dedupeKey so rescans do not overwrite prior evidence.
 */
export async function persistScannerCandidates(runId: string, candidates: ScannerCandidate[]) {
  const repos = getRepositories();
  const user = await repos.users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  const sessionDate = getTradingDate();
  const persisted = [];

  for (const candidate of candidates) {
    const record = await repos.scannerSignals.upsertByDedupeKey({
      userId: user.id,
      instrumentId: candidate.instrumentId,
      symbol: candidate.tradingSymbol,
      direction: candidate.direction,
      score: candidate.score,
      matchedSignals: [
        ...candidate.reasons,
        ...Object.entries(candidate.scoreComponents).map(([key, value]) => `score:${key}=${value}`)
      ],
      explanation: [
        `Phase 5 scanner candidate (${candidate.direction}).`,
        `Score ${candidate.score}/100.`,
        candidate.reasons.length > 0 ? `Reasons: ${candidate.reasons.join("; ")}.` : "No strong feature reasons.",
        `Data age ${candidate.dataAgeMs}ms; stale=${candidate.stale}.`,
        `Run ${runId}.`
      ].join(" "),
      entryTrigger: null,
      stopLoss: null,
      target: null,
      riskAmount: null,
      riskApproved: false,
      suggestedAction: "WATCH_FOR_SETUP",
      confidenceLabel: candidate.score >= 70 ? "HIGH" : candidate.score >= 50 ? "MEDIUM" : "LOW",
      tradingMode: "PAPER",
      sessionDate,
      dedupeKey: `scanner|${runId}|${candidate.exchange}|${candidate.tradingSymbol}|${candidate.direction}`
    });
    persisted.push(record);
  }

  await repos.systemLogs.create({
    userId: user.id,
    level: "INFO",
    source: "scanner",
    message: `Persisted ${persisted.length} Phase 5 scanner candidates.`,
    metadata: {
      event: "scanner_completed",
      runId,
      count: persisted.length,
      mode: getPersistenceMode()
    }
  });

  return {
    mode: getPersistenceMode(),
    userId: user.id,
    sessionDate,
    count: persisted.length,
    signals: persisted
  };
}

export function newScannerRunId() {
  return createId("scanrun");
}
