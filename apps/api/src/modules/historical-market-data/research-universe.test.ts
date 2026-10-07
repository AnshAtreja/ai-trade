import { describe, expect, it } from "vitest";
import { researchUniverseInstruments, researchUniverseManifest, researchUniverseManifestId, validateResearchUniverseManifest } from "./research-universe";

describe("frozen research universe", () => {
  it("contains 25 unique NSE EQ Kite identities", () => {
    expect(validateResearchUniverseManifest()).toBe(true);
    expect(researchUniverseInstruments).toHaveLength(25);
    expect(new Set(researchUniverseInstruments.map((instrument) => instrument.instrumentToken)).size).toBe(25);
    expect(researchUniverseInstruments.every((instrument) => instrument.exchange === "NSE" && instrument.instrumentType === "EQ")).toBe(true);
  });

  it("has a deterministic versioned identity without generated timestamps", () => {
    expect(researchUniverseManifest.version).toBe("NSE_EQ_RESEARCH_UNIVERSE_2026_V1");
    expect(researchUniverseManifestId).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(researchUniverseManifest)).not.toContain("generatedAt");
  });

  it("keeps CAS coverage explicit", () => {
    expect(researchUniverseManifest.casEligibilityCoveredTokens).toEqual(["341249", "408065", "738561"]);
    expect(researchUniverseManifest.casEligibilityRequiredTokens).toHaveLength(22);
    expect(researchUniverseManifest.excludedCandidates[0]?.tradingSymbol).toBe("TATAMOTORS");
  });

  it("uses the canonical RELIANCE instrument token and records the stale master conflict", () => {
    expect(researchUniverseInstruments.find((instrument) => instrument.tradingSymbol === "RELIANCE")?.instrumentToken).toBe("738561");
    expect(researchUniverseManifest.identityConflicts).toEqual([expect.objectContaining({
      tradingSymbol: "RELIANCE",
      canonicalInstrumentToken: "738561",
      currentMasterInstrumentToken: "2885",
      currentMasterExchangeToken: "738"
    })]);
  });
});
