import { describe, expect, it } from "vitest";
import { CAS_EFFECTIVE_DATE, EffectiveDatedCasEligibilityDataset, historicalCasEligibilityDataset, NseCashInstrumentSessionPolicy, type InstrumentIdentity } from "./session-policy";
import { researchUniverseInstruments } from "./research-universe";

const instrument: InstrumentIdentity = { instrumentToken: "738561", tradingSymbol: "RELIANCE", exchange: "NSE", eligibility: "UNKNOWN", eligibilitySource: "fixture" };

describe("effective-dated CAS eligibility", () => {
  it("covers every frozen research identity with canonical instrument tokens", () => {
    expect(historicalCasEligibilityDataset.version).toBe("NSE_CAS_ELIGIBILITY_2026_V2");
    expect(researchUniverseInstruments).toHaveLength(25);
    for (const frozen of researchUniverseInstruments) {
      const result = historicalCasEligibilityDataset.isEligible({ ...instrument, instrumentToken: frozen.instrumentToken, tradingSymbol: frozen.tradingSymbol }, "2026-08-03");
      expect(result, frozen.tradingSymbol).toBe("ELIGIBLE");
      expect(historicalCasEligibilityDataset.isEligible({ ...instrument, instrumentToken: frozen.instrumentToken, tradingSymbol: frozen.tradingSymbol }, "2026-09-18"), frozen.tradingSymbol).toBe("ELIGIBLE");
      expect(historicalCasEligibilityDataset.isEligible({ ...instrument, instrumentToken: frozen.instrumentToken, tradingSymbol: frozen.tradingSymbol }, "2026-09-19"), frozen.tradingSymbol).toBe("UNKNOWN");
    }
  });

  it("resolves eligible and not eligible intervals with half-open boundaries", () => {
    const dataset = new EffectiveDatedCasEligibilityDataset("TEST_CAS_V1", [
      { instrumentToken: "738561", policy: "CAS", status: "ELIGIBLE", validFrom: "2026-08-03", validTo: "2026-09-01", source: "exchange fixture", sourceVersion: "S1" },
      { instrumentToken: "738561", policy: "CAS", status: "NOT_ELIGIBLE", validFrom: "2026-09-01", source: "exchange fixture", sourceVersion: "S1" }
    ]);
    expect(dataset.isEligible(instrument, "2026-08-02")).toBe("UNKNOWN");
    expect(dataset.isEligible(instrument, "2026-08-03")).toBe("ELIGIBLE");
    expect(dataset.isEligible(instrument, "2026-08-31")).toBe("ELIGIBLE");
    expect(dataset.isEligible(instrument, "2026-09-01")).toBe("NOT_ELIGIBLE");
  });

  it("keeps missing historical records unknown and does not use current state", () => {
    const dataset = new EffectiveDatedCasEligibilityDataset("EMPTY_V1", []);
    expect(dataset.isEligible({ ...instrument, eligibility: "ELIGIBLE" }, "2026-09-07")).toBe("UNKNOWN");
  });

  it("applies normal session semantics before the CAS effective date", () => {
    const policy = new NseCashInstrumentSessionPolicy(new EffectiveDatedCasEligibilityDataset("TEST_V1", [
      { instrumentToken: "738561", policy: "CAS", status: "ELIGIBLE", validFrom: "2026-01-01", source: "fixture", sourceVersion: "S1" }
    ]));
    expect(policy.getSession(instrument, "2026-07-31")).toMatchObject({ eligibility: "NOT_ELIGIBLE", continuousSession: { closeTimeIst: "15:30" }, effectiveDate: CAS_EFFECTIVE_DATE });
    expect(policy.getSession(instrument, "2026-08-03")).toMatchObject({ eligibility: "ELIGIBLE", continuousSession: { closeTimeIst: "15:15" }, closingAuctionSession: { applicable: true } });
  });

  it("rejects overlapping intervals deterministically", () => {
    expect(() => new EffectiveDatedCasEligibilityDataset("BAD_V1", [
      { instrumentToken: "738561", policy: "CAS", status: "ELIGIBLE", validFrom: "2026-08-03", validTo: "2026-09-01", source: "fixture", sourceVersion: "S1" },
      { instrumentToken: "738561", policy: "CAS", status: "NOT_ELIGIBLE", validFrom: "2026-08-15", source: "fixture", sourceVersion: "S1" }
    ])).toThrow(/Overlapping/);
  });
});
