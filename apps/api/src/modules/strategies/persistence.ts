import { DEMO_USER_EMAIL, DEMO_USER_NAME } from "../../db/domain";
import { getPersistenceMode, getRepositories } from "../../db/persistence";
import type { StrategyEvaluation } from "./engine-types";

/**
 * Persist SETUP_DETECTED evaluations only.
 * NO_SETUP / SETUP_INVALID / DATA_UNAVAILABLE are not written.
 * Rows are immutable by setupIdentity.
 */
export async function persistStrategySetups(evaluations: StrategyEvaluation[]) {
  const setups = evaluations.filter(
    (item) =>
      item.status === "SETUP_DETECTED" &&
      item.entry != null &&
      item.stopLoss != null &&
      item.target != null &&
      item.rewardRisk != null
  );

  const repos = getRepositories();
  const user = await repos.users.upsertByEmail({ email: DEMO_USER_EMAIL, name: DEMO_USER_NAME });
  const persisted = [];

  for (const setup of setups) {
    const record = await repos.strategySetups.upsertByIdentity({
      userId: user.id,
      setupIdentity: setup.setupIdentity,
      strategyId: setup.strategyId,
      strategyVersion: setup.strategyVersion,
      instrumentId: setup.instrumentId,
      instrumentToken: setup.instrumentToken,
      symbol: setup.tradingSymbol.toUpperCase(),
      exchange: setup.exchange,
      direction: setup.direction,
      status: setup.status,
      confidence: setup.confidence,
      confidenceComponents: setup.confidenceComponents,
      entryType: setup.entry?.type ?? null,
      entryPrice: setup.entry?.price ?? null,
      stopLoss: setup.stopLoss!,
      target: setup.target!,
      rewardRisk: setup.rewardRisk!,
      riskPerUnit: setup.riskPerUnit,
      conditions: setup.conditions,
      reasons: setup.reasons,
      invalidation: setup.invalidation,
      scannerSignalId: setup.scannerSignalId,
      marketDataTimestamp: setup.marketDataTimestamp ? new Date(setup.marketDataTimestamp) : null,
      marketSession: setup.marketSession,
      capturedAt: new Date(setup.timestamp)
    });
    persisted.push(record);
  }

  if (persisted.length > 0) {
    await repos.systemLogs.create({
      userId: user.id,
      level: "INFO",
      source: "strategies",
      message: `Persisted ${persisted.length} strategy setups.`,
      metadata: {
        event: "strategy_setups_persisted",
        count: persisted.length,
        mode: getPersistenceMode()
      }
    });
  }

  return {
    mode: getPersistenceMode(),
    userId: user.id,
    count: persisted.length,
    setups: persisted
  };
}

export async function listPersistedStrategySetups(params?: {
  strategyId?: string;
  symbol?: string;
  limit?: number;
}) {
  const repos = getRepositories();
  return {
    mode: getPersistenceMode(),
    setups: await repos.strategySetups.list(params)
  };
}
