import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { getPersistenceMode, resetRepositoriesForTests } from "../../db/persistence";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { listPersistedScannerSignals, persistScannerSignalCards } from "./persistence";
import type { ScannerSignalCardData } from "./pipeline";

const nvdaCard: ScannerSignalCardData = {
  symbol: "NVDA",
  direction: "BULLISH",
  score: 86,
  matchedSignals: ["GAP_UP", "VOLUME_SPIKE"],
  entryTrigger: 1048.12,
  stopLoss: 1037.45,
  target: 1069.46,
  riskAmount: 250,
  aiExplanation: "Watch for a long setup.",
  riskApproved: true,
  suggestedAction: "WATCH_FOR_LONG_SETUP",
  confidenceLabel: "HIGH"
};

describe("scanner signal persistence", () => {
  beforeEach(() => {
    resetRepositoriesForTests(createMemoryRepositories());
  });

  afterEach(() => {
    resetRepositoriesForTests();
  });

  it("persists scanner cards and reads them back", async () => {
    const result = await persistScannerSignalCards([nvdaCard]);
    const listed = await listPersistedScannerSignals({ symbol: "NVDA" });

    expect(result.count).toBe(1);
    expect(result.mode).toBe(getPersistenceMode());
    expect(listed).toHaveLength(1);
    expect(listed[0]).toMatchObject({
      symbol: "NVDA",
      direction: "BULLISH",
      score: 86,
      tradingMode: "PAPER"
    });
  });

  it("upserts duplicates for the same user/symbol/direction/session", async () => {
    await persistScannerSignalCards([nvdaCard]);
    await persistScannerSignalCards([{ ...nvdaCard, score: 92, aiExplanation: "Updated conviction." }]);

    const listed = await listPersistedScannerSignals({ symbol: "NVDA" });

    expect(listed).toHaveLength(1);
    expect(listed[0]?.score).toBe(92);
    expect(listed[0]?.explanation).toBe("Updated conviction.");
  });
});
