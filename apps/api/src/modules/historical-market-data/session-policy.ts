import type { TradingSession } from "./calendar";

export type ClosingAuctionEligibility = "ELIGIBLE" | "NOT_ELIGIBLE" | "UNKNOWN";

export interface InstrumentIdentity {
  instrumentToken: string;
  tradingSymbol: string;
  exchange: string;
  eligibility: ClosingAuctionEligibility;
  eligibilitySource: string;
}

export interface ClosingAuctionEligibilityProvider {
  readonly version: string;
  readonly source: string;
  isEligible(instrument: InstrumentIdentity, tradeDate: string): ClosingAuctionEligibility;
  getProvenance?(instrument: InstrumentIdentity, tradeDate: string): { source: string; sourceVersion: string } | null;
}

export interface CasEligibilityRecord {
  instrumentToken: string;
  policy: "CAS";
  status: Exclude<ClosingAuctionEligibility, "UNKNOWN">;
  validFrom: string;
  validTo?: string;
  source: string;
  sourceVersion: string;
}

/** Deterministic local CAS membership data. Intervals use [validFrom, validTo). */
export class EffectiveDatedCasEligibilityDataset implements ClosingAuctionEligibilityProvider {
  readonly source = "Local versioned CAS eligibility dataset";

  constructor(readonly version: string, private readonly records: CasEligibilityRecord[]) {
    validateEligibilityRecords(records);
  }

  isEligible(instrument: InstrumentIdentity, tradeDate: string): ClosingAuctionEligibility {
    const matches = this.records.filter((record) => record.instrumentToken === instrument.instrumentToken && record.validFrom <= tradeDate && (!record.validTo || tradeDate < record.validTo));
    return matches.length === 1 ? matches[0]!.status : "UNKNOWN";
  }

  getProvenance(instrument: InstrumentIdentity, tradeDate: string) {
    const record = this.records.find((item) => item.instrumentToken === instrument.instrumentToken && item.validFrom <= tradeDate && (!item.validTo || tradeDate < item.validTo));
    return record ? { source: record.source, sourceVersion: record.sourceVersion } : null;
  }
}

function validateEligibilityRecords(records: CasEligibilityRecord[]) {
  for (const record of records) {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(record.validFrom) || (record.validTo && !/^\d{4}-\d{2}-\d{2}$/.test(record.validTo))) throw new Error(`Invalid CAS eligibility interval for ${record.instrumentToken}`);
    if (record.validTo && record.validTo <= record.validFrom) throw new Error(`CAS eligibility validTo must be after validFrom for ${record.instrumentToken}`);
  }
  const ordered = [...records].sort((a, b) => a.instrumentToken.localeCompare(b.instrumentToken) || a.validFrom.localeCompare(b.validFrom));
  for (let i = 1; i < ordered.length; i += 1) {
    const previous = ordered[i - 1]!;
    const current = ordered[i]!;
    if (previous.instrumentToken === current.instrumentToken && (!previous.validTo || current.validFrom < previous.validTo)) throw new Error(`Overlapping CAS eligibility intervals for ${current.instrumentToken}`);
  }
}

export const historicalCasEligibilityDataset = new EffectiveDatedCasEligibilityDataset(
  "NSE_CAS_ELIGIBILITY_2026_V2",
  [
    ...[
      ["738561", "RELIANCE"], ["341249", "HDFCBANK"], ["1270529", "ICICIBANK"], ["779521", "SBIN"], ["1510401", "AXISBANK"], ["492033", "KOTAKBANK"], ["81153", "BAJFINANCE"],
      ["2953217", "TCS"], ["408065", "INFY"], ["1850625", "HCLTECH"], ["969473", "WIPRO"], ["2714625", "BHARTIARTL"], ["2815745", "MARUTI"], ["519937", "M&M"], ["897537", "TITAN"],
      ["356865", "HINDUNILVR"], ["424961", "ITC"], ["4598529", "NESTLEIND"], ["857857", "SUNPHARMA"], ["225537", "DRREDDY"], ["177665", "CIPLA"], ["40193", "APOLLOHOSP"], ["2939649", "LT"], ["895745", "TATASTEEL"], ["3001089", "JSWSTEEL"]
    ].map(([instrumentToken]) => ({
      instrumentToken,
      policy: "CAS" as const,
      status: "ELIGIBLE" as const,
      validFrom: "2026-08-03",
      validTo: "2026-09-19",
      source: "NSE Phase 1 CAS applicability rule plus dated NSE CAS archive and NSE F&O contract/security-list evidence; absence from a daily exhaustive derivatives contract/security list would be NOT_ELIGIBLE, but no selected instrument was absent during the supported interval.",
      sourceVersion: "NSE-CAS-PHASE1-2026-08-03-to-2026-09-18-V2"
    }))
  ]
);

export interface InstrumentTradingSession {
  continuousSession: TradingSession | null;
  closingAuctionSession: {
    applicable: boolean;
    openTimeIst: string | null;
    closeTimeIst: string | null;
    source: string;
  };
  eligibility: ClosingAuctionEligibility;
  eligibilitySource: string;
  policyVersion: string;
  eligibilityDatasetVersion: string;
  effectiveDate: string;
}

export interface InstrumentSessionPolicy {
  readonly version: string;
  readonly effectiveDate: string;
  getSession(instrument: InstrumentIdentity, tradeDate: string): InstrumentTradingSession;
}

export const CAS_EFFECTIVE_DATE = "2026-08-03";
export const SESSION_POLICY_VERSION = "NSE_CASH_INSTRUMENT_SESSION_2026_V1";
export const LEGACY_SESSION_POLICY_VERSION = "NSE_CASH_LEGACY_GLOBAL_SESSION_V1";

export const identityEligibilityProvider: ClosingAuctionEligibilityProvider = {
  version: "IDENTITY_ELIGIBILITY_V1",
  source: "Resolved instrument identity",
  isEligible(instrument) {
    return instrument.eligibility;
  }
};

export class NseCashInstrumentSessionPolicy implements InstrumentSessionPolicy {
  readonly version = SESSION_POLICY_VERSION;
  readonly effectiveDate = CAS_EFFECTIVE_DATE;

  constructor(private readonly eligibilityProvider: ClosingAuctionEligibilityProvider = identityEligibilityProvider) {}

  get eligibilityDatasetVersion() {
    return this.eligibilityProvider.version;
  }

  getSession(instrument: InstrumentIdentity, tradeDate: string): InstrumentTradingSession {
    const resolvedEligibility = this.eligibilityProvider.isEligible(instrument, tradeDate);
    const eligibility = tradeDate < this.effectiveDate ? "NOT_ELIGIBLE" : resolvedEligibility;
    const casApplies = tradeDate >= this.effectiveDate && resolvedEligibility === "ELIGIBLE";
    return {
      continuousSession: {
        openTimeIst: "09:15",
        closeTimeIst: casApplies ? "15:15" : "15:30"
      },
      closingAuctionSession: {
        applicable: casApplies,
        openTimeIst: casApplies ? "15:15" : null,
        closeTimeIst: casApplies ? "15:35" : null,
        source: casApplies ? "NSE Closing Auction Session (CAS)" : "No CAS session applied"
      },
      eligibility,
      eligibilitySource: tradeDate < this.effectiveDate ? "CAS policy not effective; normal session applies" : this.eligibilityProvider.getProvenance?.(instrument, tradeDate) ? `${this.eligibilityProvider.getProvenance(instrument, tradeDate)!.source} (${this.eligibilityProvider.getProvenance(instrument, tradeDate)!.sourceVersion})` : instrument.eligibilitySource,
      policyVersion: this.version,
      eligibilityDatasetVersion: this.eligibilityProvider.version,
      effectiveDate: this.effectiveDate
    };
  }
}

/** Compatibility policy for callers that have no instrument identity yet. */
export const legacyGlobalSessionPolicy: InstrumentSessionPolicy = {
  version: LEGACY_SESSION_POLICY_VERSION,
  effectiveDate: CAS_EFFECTIVE_DATE,
  getSession() {
    return {
      continuousSession: { openTimeIst: "09:15", closeTimeIst: "15:30" },
      closingAuctionSession: {
        applicable: false,
        openTimeIst: null,
        closeTimeIst: null,
        source: "Legacy global NSE cash session"
      },
      eligibility: "UNKNOWN",
      eligibilitySource: "No instrument identity supplied",
      policyVersion: LEGACY_SESSION_POLICY_VERSION,
      eligibilityDatasetVersion: "LEGACY_GLOBAL_SESSION_V1",
      effectiveDate: CAS_EFFECTIVE_DATE
    };
  }
};
