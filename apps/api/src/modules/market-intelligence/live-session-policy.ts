import { createHash } from "node:crypto";
import { gunzipSync } from "node:zlib";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { env } from "../../config/env";
import { getTradingDate } from "../../common/utils/trading-date";
import { getRepositories } from "../../db/persistence";
import type { InstrumentRecord } from "../../db/domain";
import { nseCashCalendar } from "../historical-market-data/calendar";
import { CAS_EFFECTIVE_DATE, type ClosingAuctionEligibility } from "../historical-market-data/session-policy";
import type { FeatureSession } from "./feature-types";

export const LIVE_SESSION_POLICY_VERSION = "NSE_LIVE_CASH_SESSION_V1";
export const LIVE_CAS_SOURCE_VERSION = "NSE_CM_SECURITY_MII_V1";
export const LIVE_PRE_CAS_SESSION_VERSION = "NSE_LIVE_PRE_CAS_CONTINUOUS_V1";
const LIVE_CAS_TRANSITION_TIME_IST = "15:15";
const SNAPSHOT_DIR = path.resolve(process.cwd(), "../../apps/artifacts/phase9/live-cas");

export type LiveSessionState = "PRE_CAS_CONTINUOUS" | "CAS_TRANSITION_OR_SESSION" | "NON_CAS_CONTINUOUS" | "POST_CLOSE";

export interface LiveCasSnapshot {
  version: string;
  tradeDate: string;
  sourceDate: string;
  effectiveTradingDate: string;
  sourceUrl: string;
  fileName: string;
  sourceSha256: string;
  schemaVersion: string;
  parsedEqRows: number;
  eligibleCount: number;
  notEligibleCount: number;
  unknownCount: number;
  crossCheckVersion: string | null;
  crossCheckContentHash: string | null;
  contentHash: string;
  fetchedAt: string;
  status: "READY" | "RECONCILIATION_INCOMPLETE" | "SOURCE_DISAGREEMENT";
  statuses: Readonly<Record<string, ClosingAuctionEligibility>>;
  unreconciledSymbols: readonly string[];
  reconciliation: readonly { symbol: string; result: "MATCHED" | "NOT_FOUND" | "AMBIGUOUS" | "NON_EQ" | "STALE_IDENTITY" | "INVALID_SCHEMA"; instrumentToken: string | null }[];
  sourceDisagreement: readonly string[];
}

export interface DailyCasSource {
  readonly version: string;
  load(tradeDate: string): Promise<{ bytes: Buffer; sourceUrl: string; fileName?: string }>;
  eligibleSymbols(bytes: Buffer, tradeDate: string): Set<string>;
  parseEligibility?(bytes: Buffer, tradeDate: string): ParsedCasSecurityMaster;
}

export interface ParsedCasSecurity {
  symbol: string;
  series: string;
  isin: string | null;
  eligible: ClosingAuctionEligibility;
}

export interface ParsedCasSecurityMaster {
  schemaVersion: string;
  tradeDate: string;
  rows: readonly ParsedCasSecurity[];
}

export interface CasUnderlyingCrossCheck {
  readonly version: string;
  load(tradeDate: string): Promise<{ symbols: ReadonlySet<string>; sourceDate: string }>;
}

function validateSourceUrl(sourceUrl: string, tradeDate: string) {
  const ddmmyyyy = `${tradeDate.slice(8, 10)}${tradeDate.slice(5, 7)}${tradeDate.slice(0, 4)}`;
  const yyyymmdd = tradeDate.replace(/-/g, "");
  const url = new URL(sourceUrl);
  if (url.protocol !== "https:" || !["nseindia.com", "nsearchives.nseindia.com"].includes(url.hostname)) {
    throw new Error("Live CAS source must be an official NSE HTTPS host");
  }
  if (!url.pathname.includes(ddmmyyyy) && !url.pathname.includes(yyyymmdd)) throw new Error("Daily NSE source URL is not date-specific");
}

function snapshotContentHash(snapshot: Omit<LiveCasSnapshot, "contentHash" | "fetchedAt">) {
  return createHash("sha256").update(JSON.stringify(snapshot)).digest("hex");
}

function dateCode(tradeDate: string) {
  return `${tradeDate.slice(8, 10)}${tradeDate.slice(5, 7)}${tradeDate.slice(0, 4)}`;
}

function normalizeDate(value: string) {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) return trimmed;
  const match = /^(\d{2})[-/]?(\d{2})[-/]?(\d{4})$/.exec(trimmed);
  return match ? `${match[3]}-${match[2]}-${match[1]}` : trimmed;
}

function columnIndex(header: string[], names: string[]) {
  return names.map((name) => header.indexOf(name)).find((index) => index >= 0) ?? -1;
}

/** Replaceable daily NSE source. A later CM security-master CAS field can implement the same interface. */
export class NseDailyFoContractSource implements DailyCasSource {
  readonly version = LIVE_CAS_SOURCE_VERSION;
  constructor(private readonly urlTemplate = env.NSE_LIVE_CAS_FO_REPORT_URL_TEMPLATE) {}

  async load(tradeDate: string) {
    if (!this.urlTemplate) throw new Error("No verified official NSE daily F&O contract-master URL is configured");
    const ddmmyyyy = `${tradeDate.slice(8, 10)}${tradeDate.slice(5, 7)}${tradeDate.slice(0, 4)}`;
    const sourceUrl = this.urlTemplate.replace("{DDMMYYYY}", ddmmyyyy);
    validateSourceUrl(sourceUrl, tradeDate);
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(12_000), headers: { Accept: "text/csv,application/gzip,application/octet-stream" } });
    if (!response.ok) throw new Error(`NSE daily F&O contract request failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100) throw new Error("NSE daily F&O contract file is unexpectedly short");
    return { bytes, sourceUrl };
  }

  eligibleSymbols(bytes: Buffer, tradeDate: string) { return parseNseFoUnderlyings(bytes, tradeDate); }
}

export const LIVE_CM_SECURITY_SCHEMA_VERSION = "NSE_CM_SECURITY_MII_SCHEMA_V1";

/** Primary operational source: the daily NSE Capital Market MII security master. */
export class NseDailyCmSecuritySource implements DailyCasSource {
  readonly version = LIVE_CAS_SOURCE_VERSION;
  constructor(private readonly urlTemplate = env.NSE_LIVE_CAS_CM_SECURITY_URL_TEMPLATE) {}

  async load(tradeDate: string) {
    if (!this.urlTemplate) throw new Error("No verified official NSE daily CM MII security-master resource is configured");
    const sourceUrl = this.urlTemplate.replace("{DDMMYYYY}", dateCode(tradeDate)).replace("{YYYYMMDD}", tradeDate.replace(/-/g, ""));
    validateSourceUrl(sourceUrl, tradeDate);
    const response = await fetch(sourceUrl, { signal: AbortSignal.timeout(12_000), headers: { Accept: "text/csv,application/gzip,application/octet-stream" } });
    if (!response.ok) throw new Error(`NSE daily CM MII security-master request failed: HTTP ${response.status}`);
    const bytes = Buffer.from(await response.arrayBuffer());
    if (bytes.length < 100) throw new Error("NSE daily CM MII security-master file is unexpectedly short");
    return { bytes, sourceUrl, fileName: path.basename(new URL(sourceUrl).pathname) };
  }

  parseEligibility(bytes: Buffer, tradeDate: string) { return parseNseCmSecurityMaster(bytes, tradeDate); }

  eligibleSymbols(bytes: Buffer, tradeDate: string) {
    return new Set(parseNseCmSecurityMaster(bytes, tradeDate).rows.filter((row) => row.eligible === "ELIGIBLE").map((row) => row.symbol));
  }
}

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const c = text[i]!;
    if (c === '"') {
      if (quoted && text[i + 1] === '"') { field += '"'; i += 1; }
      else quoted = !quoted;
    } else if (c === "," && !quoted) { row.push(field); field = ""; }
    else if ((c === "\n" || c === "\r") && !quoted) {
      if (c === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field); if (row.some(Boolean)) rows.push(row);
      row = []; field = "";
    } else field += c;
  }
  if (quoted) throw new Error("Unclosed quote in NSE contract CSV");
  row.push(field); if (row.some(Boolean)) rows.push(row);
  return rows;
}

/** Active individual-stock futures or options establish current Phase-1 derivative availability. */
export function parseNseFoUnderlyings(bytes: Buffer, tradeDate: string): Set<string> {
  const content = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex((row) => row.includes("FinInstrmTp") && row.includes("TckrSymb"));
  if (headerIndex < 0) throw new Error("NSE F&O contract schema is unrecognized");
  const header = rows[headerIndex]!;
  const typeColumn = header.indexOf("FinInstrmTp");
  const symbolColumn = header.indexOf("TckrSymb");
  const expiryColumn = header.indexOf("XpryDt");
  const tradeDateColumn = header.indexOf("TradDt");
  if (expiryColumn < 0 || tradeDateColumn < 0) throw new Error("NSE F&O contract date or expiry column is missing");
  const symbols = new Set<string>();
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length !== header.length) throw new Error("Malformed NSE F&O contract row");
    if (row[tradeDateColumn]?.trim() !== tradeDate) throw new Error("NSE F&O contract trade date does not match requested date");
    if (!["STF", "STO", "FUTSTK", "OPTSTK"].includes(row[typeColumn]?.trim() ?? "")) continue;
    const symbol = row[symbolColumn]?.trim();
    if (!symbol || !/^[A-Z0-9&.-]+$/.test(symbol)) throw new Error("Invalid NSE F&O underlying symbol");
    const expiry = row[expiryColumn]?.trim();
    if (!expiry || !/^\d{4}-\d{2}-\d{2}$/.test(expiry)) throw new Error("NSE F&O contract expiry is invalid");
    if (expiry < tradeDate) continue;
    symbols.add(symbol);
  }
  if (symbols.size < 100) throw new Error("NSE F&O contract list is unexpectedly incomplete");
  return symbols;
}

/** Parses the dated CM MII schema without relying on positional fields. */
export function parseNseCmSecurityMaster(bytes: Buffer, tradeDate: string): ParsedCasSecurityMaster {
  const content = bytes[0] === 0x1f && bytes[1] === 0x8b ? gunzipSync(bytes).toString("utf8") : bytes.toString("utf8");
  const rows = parseCsv(content.replace(/^\uFEFF/, ""));
  const headerIndex = rows.findIndex((row) => row.includes("ElgbltyClsgAuctnSsn"));
  if (headerIndex < 0) throw new Error("NSE CM MII schema is missing ElgbltyClsgAuctnSsn");
  const header = rows[headerIndex]!;
  const symbolColumn = columnIndex(header, ["TckrSymb", "TradngSymbol", "TradingSymbol"]);
  const seriesColumn = columnIndex(header, ["SctySrs", "SctySrsCd", "Series"]);
  const isinColumn = columnIndex(header, ["ISIN", "ISINCode"]);
  const typeColumn = columnIndex(header, ["FinInstrmTp", "InstrmTp", "InstrumentType"]);
  const dateColumn = columnIndex(header, ["TradDt", "TradeDate", "BizDt"]);
  const eligibilityColumn = header.indexOf("ElgbltyClsgAuctnSsn");
  if (symbolColumn < 0 || seriesColumn < 0 || eligibilityColumn < 0) throw new Error("NSE CM MII schema is missing required security columns");
  const parsed: ParsedCasSecurity[] = [];
  for (const row of rows.slice(headerIndex + 1)) {
    if (row.length !== header.length) throw new Error("Malformed NSE CM MII security row");
    if (dateColumn >= 0 && normalizeDate(row[dateColumn] ?? "") !== tradeDate) throw new Error("NSE CM MII security file trade date does not match requested date");
    const series = row[seriesColumn]?.trim().toUpperCase() ?? "";
    if (series !== "EQ") continue;
    const type = typeColumn >= 0 ? row[typeColumn]?.trim().toUpperCase() ?? "" : "EQ";
    if (type && !["EQ", "STK", "EQUITY", "EQUITY SHARE"].includes(type)) continue;
    const symbol = row[symbolColumn]?.trim().toUpperCase() ?? "";
    if (!symbol || !/^[A-Z0-9&.-]+$/.test(symbol)) throw new Error("Invalid NSE CM MII security symbol");
    const flag = row[eligibilityColumn]?.trim();
    if (flag !== "0" && flag !== "1") throw new Error("NSE CM MII CAS eligibility value must be 0 or 1");
    parsed.push({ symbol, series, isin: isinColumn >= 0 ? row[isinColumn]?.trim() || null : null, eligible: flag === "1" ? "ELIGIBLE" : "NOT_ELIGIBLE" });
  }
  if (parsed.length === 0) throw new Error("NSE CM MII security file contains no EQ rows");
  const bySymbol = new Map<string, ParsedCasSecurity>();
  for (const row of parsed) {
    const previous = bySymbol.get(row.symbol);
    if (previous && previous.eligible !== row.eligible) bySymbol.set(row.symbol, { ...row, eligible: "UNKNOWN" });
    else if (!previous) bySymbol.set(row.symbol, row);
  }
  return { schemaVersion: LIVE_CM_SECURITY_SCHEMA_VERSION, tradeDate, rows: [...bySymbol.values()].sort((a, b) => a.symbol.localeCompare(b.symbol)) };
}

export class OperationalCasPolicy {
  private snapshot: LiveCasSnapshot | null = null;
  private lastError: string | null = null;
  private pending: Promise<void> | null = null;

  constructor(private readonly source: DailyCasSource = new NseDailyCmSecuritySource(), private readonly directory = SNAPSHOT_DIR,
    private readonly listInstruments: () => Promise<InstrumentRecord[]> = () => getRepositories().instruments.list({
      exchange: "NSE", segment: "NSE", instrumentType: "EQ", isActive: true, limit: 50_000
    }), private readonly crossCheck?: CasUnderlyingCrossCheck) {}

  async refresh(tradeDate: string): Promise<void> {
    if (this.snapshot?.effectiveTradingDate === tradeDate) return;
    if (this.pending) return this.pending;
    this.pending = this.refreshInner(tradeDate).finally(() => { this.pending = null; });
    return this.pending;
  }

  private async refreshInner(tradeDate: string) {
    try {
      if (!nseCashCalendar.getDay(tradeDate).session) throw new Error(`No authoritative cash session on ${tradeDate}`);
      const { bytes, sourceUrl, fileName } = await this.source.load(tradeDate);
      validateSourceUrl(sourceUrl, tradeDate);
      const parsed = this.source.parseEligibility?.(bytes, tradeDate);
      const directRows = parsed?.rows ?? [];
      const directSource = Boolean(parsed);
      const symbols = parsed ? new Set(directRows.filter((row) => row.eligible === "ELIGIBLE").map((row) => row.symbol)) : this.source.eligibleSymbols(bytes, tradeDate);
      const sourceRows = parsed ? new Map(directRows.map((row) => [row.symbol, row])) : null;
      let sourceDisagreement: string[] = [];
      let crossCheckContentHash: string | null = null;
      if (this.crossCheck) {
        const comparison = await this.crossCheck.load(tradeDate);
        if (comparison.sourceDate !== tradeDate) throw new Error("NSE underlying cross-check is stale");
        crossCheckContentHash = createHash("sha256").update([...comparison.symbols].sort().join("\n")).digest("hex");
        sourceDisagreement = [...new Set([...symbols, ...comparison.symbols].filter((symbol) => symbols.has(symbol) !== comparison.symbols.has(symbol)))].sort();
      }
      const rows = await this.listInstruments();
      const bySymbol = new Map<string, InstrumentRecord[]>();
      for (const row of rows) {
        if (row.exchange !== "NSE" || row.segment !== "NSE") continue;
        if (row.symbol) bySymbol.set(row.symbol, [...(bySymbol.get(row.symbol) ?? []), row]);
      }
      const statuses: Record<string, ClosingAuctionEligibility> = {};
      const unreconciledSymbols: string[] = [];
      const reconciliation: LiveCasSnapshot["reconciliation"][number][] = [];
      for (const [symbol, identities] of bySymbol) {
        const activeEq = identities.filter((row) => row.isActive && row.instrumentType === "EQ" && row.instrumentToken);
        const result = activeEq.length > 1 ? "AMBIGUOUS" : activeEq.length === 1 ? "MATCHED" :
          identities.some((row) => row.instrumentType === "EQ") ? "STALE_IDENTITY" : "NON_EQ";
        const sourceRow = sourceRows?.get(symbol);
        const sourcePresent = directSource ? Boolean(sourceRow) : symbols.has(symbol) || activeEq.length === 1;
        if (directSource && sourcePresent || !directSource && symbols.has(symbol)) reconciliation.push({ symbol, result, instrumentToken: activeEq.length === 1 ? activeEq[0]!.instrumentToken : null });
        if (directSource && (!sourcePresent || result !== "MATCHED" || sourceRow?.eligible === "UNKNOWN") || !directSource && symbols.has(symbol) && result !== "MATCHED") unreconciledSymbols.push(symbol);
        for (const row of activeEq) statuses[row.instrumentToken!] = result === "MATCHED" && !sourceDisagreement.includes(symbol) ?
          directSource ? (sourceRow?.eligible ?? "UNKNOWN") : symbols.has(symbol) ? "ELIGIBLE" : "NOT_ELIGIBLE" : "UNKNOWN";
      }
      for (const symbol of (directSource ? [...sourceRows!.keys()] : [...symbols])) if (!bySymbol.has(symbol)) {
        unreconciledSymbols.push(symbol);
        reconciliation.push({ symbol, result: "NOT_FOUND", instrumentToken: null });
      }
      if (Object.keys(statuses).length < 25) throw new Error("NSE EQ instrument reconciliation is incomplete");
      const sourceSha256 = createHash("sha256").update(bytes).digest("hex");
      const statusCounts = Object.values(statuses).reduce((counts, status) => { counts[status] += 1; return counts; }, { ELIGIBLE: 0, NOT_ELIGIBLE: 0, UNKNOWN: 0 });
      const identity = { version: this.source.version, tradeDate, sourceDate: tradeDate, effectiveTradingDate: tradeDate,
        sourceUrl, fileName: fileName ?? path.basename(new URL(sourceUrl).pathname), sourceSha256,
        schemaVersion: parsed?.schemaVersion ?? "LEGACY_ELIGIBLE_SYMBOLS_V1", parsedEqRows: parsed?.rows.length ?? 0,
        eligibleCount: statusCounts.ELIGIBLE, notEligibleCount: statusCounts.NOT_ELIGIBLE, unknownCount: statusCounts.UNKNOWN,
        crossCheckVersion: this.crossCheck?.version ?? null, crossCheckContentHash,
        status: sourceDisagreement.length ? "SOURCE_DISAGREEMENT" as const :
          unreconciledSymbols.length ? "RECONCILIATION_INCOMPLETE" as const : "READY" as const,
        statuses, unreconciledSymbols: unreconciledSymbols.sort(), reconciliation: reconciliation.sort((a, b) => a.symbol.localeCompare(b.symbol)), sourceDisagreement };
      const snapshot: LiveCasSnapshot = { ...identity, contentHash: snapshotContentHash(identity), fetchedAt: new Date().toISOString() };
      await mkdir(this.directory, { recursive: true });
      const destination = path.join(this.directory, `${tradeDate}.json`);
      const temporary = `${destination}.${process.pid}.tmp`;
      await writeFile(temporary, JSON.stringify(snapshot));
      await rename(temporary, destination);
      this.snapshot = snapshot;
      this.lastError = null;
    } catch (error) {
      this.snapshot = null;
      this.lastError = error instanceof Error ? error.message : String(error);
      throw error;
    }
  }

  async loadPersisted(tradeDate: string) {
    try {
      const candidate = JSON.parse(await readFile(path.join(this.directory, `${tradeDate}.json`), "utf8")) as LiveCasSnapshot;
      validateSourceUrl(candidate.sourceUrl, tradeDate);
      const { contentHash, fetchedAt, ...identity } = candidate;
      if (candidate.tradeDate !== tradeDate || candidate.sourceDate !== tradeDate || candidate.effectiveTradingDate !== tradeDate ||
        candidate.version !== this.source.version || candidate.crossCheckVersion !== (this.crossCheck?.version ?? null) ||
        !["READY", "RECONCILIATION_INCOMPLETE", "SOURCE_DISAGREEMENT"].includes(candidate.status) ||
        contentHash !== snapshotContentHash(identity)) throw new Error("Invalid CAS snapshot identity");
      this.snapshot = candidate;
      this.lastError = null;
    } catch (error) {
      this.snapshot = null;
      this.lastError = error instanceof Error ? error.message : String(error);
    }
  }

  eligibility(token: string, tradeDate: string): ClosingAuctionEligibility {
    if (tradeDate < CAS_EFFECTIVE_DATE) return "NOT_ELIGIBLE";
    return this.snapshot?.effectiveTradingDate === tradeDate ? this.snapshot.statuses[token] ?? "UNKNOWN" : "UNKNOWN";
  }

  get version() { return this.source.version; }

  diagnostics(tradeDate: string) {
    return { version: this.source.version, tradeDate, snapshotDate: this.snapshot?.tradeDate ?? null,
      sourceDate: this.snapshot?.sourceDate ?? null, effectiveTradingDate: this.snapshot?.effectiveTradingDate ?? null,
      sourceUrl: this.snapshot?.sourceUrl ?? null, sourceSha256: this.snapshot?.sourceSha256 ?? null,
      crossCheckVersion: this.snapshot?.crossCheckVersion ?? null, crossCheckContentHash: this.snapshot?.crossCheckContentHash ?? null,
      contentHash: this.snapshot?.contentHash ?? null, coveredTokens: this.snapshot?.tradeDate === tradeDate ? Object.keys(this.snapshot.statuses).length : 0,
      unresolved: this.snapshot?.unreconciledSymbols.length ?? 0, sourceDisagreement: this.snapshot?.sourceDisagreement ?? [],
      fileName: this.snapshot?.fileName ?? null, schemaVersion: this.snapshot?.schemaVersion ?? null,
      parsedEqRows: this.snapshot?.parsedEqRows ?? 0, eligibleCount: this.snapshot?.eligibleCount ?? 0,
      notEligibleCount: this.snapshot?.notEligibleCount ?? 0, unknownCount: this.snapshot?.unknownCount ?? 0,
      lastError: this.lastError, status: this.snapshot?.tradeDate === tradeDate ? this.snapshot.status : "SOURCE_UNAVAILABLE" };
  }
}

export function resolveLiveSessionState(options: { tradeDate: string; at: Date; closeTimeIst: string; specialSession: boolean; eligibility: ClosingAuctionEligibility; index: boolean }): LiveSessionState {
  if (options.index || options.specialSession) {
    return options.at.getTime() >= Date.parse(`${options.tradeDate}T${options.closeTimeIst}:00+05:30`) ? "POST_CLOSE" : "NON_CAS_CONTINUOUS";
  }
  const transitionMs = Date.parse(`${options.tradeDate}T${LIVE_CAS_TRANSITION_TIME_IST}:00+05:30`);
  if (options.at.getTime() < transitionMs) return "PRE_CAS_CONTINUOUS";
  if (options.eligibility === "UNKNOWN") return "CAS_TRANSITION_OR_SESSION";
  const closeTime = options.eligibility === "ELIGIBLE" ? LIVE_CAS_TRANSITION_TIME_IST : options.closeTimeIst;
  return options.at.getTime() >= Date.parse(`${options.tradeDate}T${closeTime}:00+05:30`) ? "POST_CLOSE" :
    options.eligibility === "ELIGIBLE" ? "CAS_TRANSITION_OR_SESSION" : "NON_CAS_CONTINUOUS";
}

export function resolveLiveFeatureSession(identity: { instrumentToken: string; exchange: string; tradingSymbol: string }, at: Date, policy: OperationalCasPolicy, index = false): FeatureSession | null {
  const tradeDate = getTradingDate(at, "Asia/Kolkata");
  const day = nseCashCalendar.getDay(tradeDate);
  if (!day.session || identity.exchange !== "NSE") return null;
  const eligibility = index || day.type === "SPECIAL_SESSION" ? "NOT_ELIGIBLE" : policy.eligibility(identity.instrumentToken, tradeDate);
  const state = resolveLiveSessionState({ tradeDate, at, closeTimeIst: day.session.closeTimeIst,
    specialSession: day.type === "SPECIAL_SESSION", eligibility, index });
  if (state === "POST_CLOSE" || (state === "CAS_TRANSITION_OR_SESSION" && eligibility === "UNKNOWN")) return null;
  const close = state === "CAS_TRANSITION_OR_SESSION" && eligibility === "ELIGIBLE" ? LIVE_CAS_TRANSITION_TIME_IST : day.session.closeTimeIst;
  return {
    tradeDate, openTime: `${tradeDate}T${day.session.openTimeIst}:00+05:30`, closeTime: `${tradeDate}T${close}:00+05:30`,
    calendarVersion: nseCashCalendar.version, sessionPolicyVersion: LIVE_SESSION_POLICY_VERSION,
    casEligibilityVersion: index ? "INDEX_NORMAL_SESSION_V1" : day.type === "SPECIAL_SESSION" ? "SPECIAL_SESSION_OVERRIDE_V1" :
      state === "PRE_CAS_CONTINUOUS" ? LIVE_PRE_CAS_SESSION_VERSION : policy.version
  };
}
