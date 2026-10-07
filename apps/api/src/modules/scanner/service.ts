import type { ModuleSummary } from "../../common/utils/create-module-summary";
import { getPersistenceMode } from "../../db/persistence";
import { intradayScannerEngine } from "./engine";
import { mockIntradayInstruments, mockScans } from "./mock-data";
import { listPersistedScannerSignals, persistScannerSignalCards } from "./persistence";
import { runMockScannerSignalPipeline } from "./pipeline";
import { getProductionScannerService } from "./production-service";
import type { IntradayInstrumentInput, IntradayScannerOptions, IntradayWatchlistCandidate } from "./types";

export interface ScannerService {
  listScans: () => Promise<typeof mockScans>;
  runScan: (universe: string, timeframe: string) => Promise<typeof mockScans>;
  runIntradayScan: (
    instruments: IntradayInstrumentInput[],
    options?: IntradayScannerOptions
  ) => Promise<IntradayWatchlistCandidate[]>;
  listMockIntradayCandidates: () => Promise<IntradayWatchlistCandidate[]>;
  runMockSignalPipeline: () => ReturnType<typeof runMockScannerSignalPipelineWithPersistence>;
  listPersistedSignals: typeof listPersistedScannerSignals;
  getSummary: () => ModuleSummary;
}

async function runMockScannerSignalPipelineWithPersistence() {
  const result = await runMockScannerSignalPipeline();
  const persistence = await persistScannerSignalCards(result.signalCards);

  return {
    ...result,
    persistence: {
      mode: persistence.mode,
      userId: persistence.userId,
      sessionDate: persistence.sessionDate,
      count: persistence.count
    }
  };
}

/**
 * Scanner application service.
 * persistent: mock pipeline results are upserted as ScannerSignal rows (memory or Postgres)
 * mock: listScans / runScan still return fixtures
 * broker integration: none in this module
 * paper trading: signal cards remain candidates until a later paper-trade slice
 * live trading disabled: this service never places broker orders
 */
export class MockScannerService implements ScannerService {
  async listScans() {
    return mockScans;
  }

  async runScan(universe: string, timeframe: string) {
    return mockScans.map((scan) => ({
      ...scan,
      setup: `${scan.setup} • ${universe}`,
      timeframe
    }));
  }

  async runIntradayScan(instruments: IntradayInstrumentInput[], options?: IntradayScannerOptions) {
    return intradayScannerEngine.scan(instruments, options);
  }

  async listMockIntradayCandidates() {
    return intradayScannerEngine.scan(mockIntradayInstruments);
  }

  runMockSignalPipeline() {
    return runMockScannerSignalPipelineWithPersistence();
  }

  listPersistedSignals(params?: { symbol?: string; sessionDate?: string }) {
    return listPersistedScannerSignals(params);
  }

  getSummary(): ModuleSummary {
    const production = getProductionScannerService().getStatus();
    const persistenceMode = getPersistenceMode();

    return {
      key: "scanner",
      title: "Scanner",
      description:
        "Phase 5 candidate-generation scanner ranks NSE equities from live market state. Signals are observations, not trade instructions.",
      status: production.schedulerRunning ? "Running" : persistenceMode === "database" ? "Persistent" : "Mocked",
      metrics: [
        { label: "Lifecycle", value: production.lifecycle },
        { label: "Last candidates", value: String(production.lastRun?.stats.candidateCount ?? 0) },
        { label: "Session", value: production.marketSession },
        { label: "Persistence", value: persistenceMode }
      ]
    };
  }
}

export const scannerService = new MockScannerService();
