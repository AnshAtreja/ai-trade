import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { performance } from "node:perf_hooks";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { InstrumentRecord } from "../../db/domain";
import { isTradableNseEquity } from "../market-data/universe";
import { LatestMarketStateStore } from "../market-data/stream/latest-state-store";
import { MarketTickEventBus } from "../market-data/stream/event-bus";
import type { MarketStreamService } from "../market-data/stream/service";
import type { MarketTick } from "../market-data/stream/types";
import type { NormalizedHistoricalCandle } from "../historical-market-data/types";
import { fromHistoricalBenchmarkCandle, MarketContextEngine } from "./context-engine";
import { benchmarkRegistry, sectorMemberships } from "./context-universe";
import { fromHistoricalCandle, MarketFeatureEngine } from "./feature-engine";
import { LiveMarketIntelligenceService } from "./live-intelligence-service";
import { LiveMinuteCandleAssembler } from "./live-minute-candles";
import { liveMarketIntelligenceRouter } from "./live-router";
import { NseDailyCmSecuritySource, NseDailyFoContractSource, OperationalCasPolicy, parseNseCmSecurityMaster, parseNseFoUnderlyings, resolveLiveFeatureSession, resolveLiveSessionState, type DailyCasSource } from "./live-session-policy";
import { MarketRegimeEngine } from "./regime-engine";

const tradeDate = "2026-09-30";
const startMs = Date.parse(`${tradeDate}T09:15:00+05:30`);
const allSymbols = sectorMemberships.map((item) => item.tradingSymbol);
const sourceSymbols = [...allSymbols, ...Array.from({ length: 100 }, (_, index) => `TEST${index}`)];
const tempDirs: string[] = [];
afterEach(async () => { await Promise.all(tempDirs.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

function fakeRecord(item: typeof sectorMemberships[number]): InstrumentRecord {
  return { id: item.instrumentToken, symbol: item.tradingSymbol, exchange: "NSE", name: item.tradingSymbol,
    instrumentToken: item.instrumentToken, exchangeToken: null, segment: "NSE", instrumentType: "EQ", expiry: null,
    strike: null, tickSize: 0.05, lotSize: 1, isActive: true, createdAt: new Date(0), updatedAt: new Date(0) };
}

async function policy(symbols = allSymbols) {
  const csv = `TradDt,FinInstrmTp,TckrSymb,XpryDt\n${[...symbols, ...sourceSymbols.slice(25)].map((symbol) => `${tradeDate},STF,${symbol},2026-10-27`).join("\n")}\n`;
  const source: DailyCasSource = { version: "NSE_DAILY_FO_CONTRACT_V1", async load(date) {
    expect(date).toBe(tradeDate);
    return { bytes: Buffer.from(csv), sourceUrl: `https://nsearchives.nseindia.com/content/fo/NSE_FO_contract_30092026.csv.gz` };
  }, eligibleSymbols: parseNseFoUnderlyings };
  const dir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cas-"));
  tempDirs.push(dir);
  const result = new OperationalCasPolicy(source, dir, async () => sectorMemberships.map(fakeRecord));
  await result.refresh(tradeDate);
  return result;
}

function tick(token: string, symbol: string, atMs: number, volume: number | null, price = 100): MarketTick {
  const timestamp = new Date(atMs).toISOString();
  return { instrumentToken: token, exchange: "NSE", tradingSymbol: symbol, instrumentId: null, timestamp,
    receivedAt: timestamp, exchangeTimestamp: timestamp, lastPrice: price, volume, lastTradedQuantity: null,
    open: null, high: null, low: null, close: 99, averagePrice: null, buyQuantity: null, sellQuantity: null,
    mode: "QUOTE", source: "MOCK", orderKey: `${token}|${timestamp}|${price}|${volume}` };
}

function fakeStream() {
  const store = new LatestMarketStateStore();
  const bus = new MarketTickEventBus();
  const subscriptions = [...benchmarkRegistry, ...sectorMemberships].map((item) => ({ instrumentToken: item.instrumentToken, mode: "QUOTE" as const }));
  return { store, bus, subscriptions: { getActual: () => subscriptions }, listSubscriptions: () => subscriptions,
    getStatus: () => ({ state: "CONNECTED", running: false, source: "MOCK" }),
    subscribe: async () => subscriptions, logger: { info: () => undefined, error: () => undefined } } as unknown as MarketStreamService;
}

describe("Phase 9E live market intelligence", () => {
  it("parses only individual-stock derivatives and rejects unrecognized NSE schemas", () => {
    const rows = `${sourceSymbols.map((symbol) => `${tradeDate},STF,${symbol},2026-10-27`).join("\n")}\n${tradeDate},FUTIDX,NIFTY,2026-10-27\n`;
    expect(parseNseFoUnderlyings(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${rows}`), tradeDate).size).toBe(125);
    expect(() => parseNseFoUnderlyings(Buffer.from("symbol,expiry\nRELIANCE,2026-10-27"), tradeDate)).toThrow(/schema/);
    expect(() => parseNseFoUnderlyings(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${rows.replace(new RegExp(tradeDate, "g"), "2026-09-29")}`), tradeDate)).toThrow(/trade date/);
    expect(() => parseNseFoUnderlyings(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${sourceSymbols.slice(0, 25).map((symbol) => `${tradeDate},STF,${symbol},2026-10-27`).join("\n")}`), tradeDate)).toThrow(/incomplete/);
    expect(() => parseNseFoUnderlyings(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${sourceSymbols.map((symbol) => `${tradeDate},STF,${symbol},2026-09-29`).join("\n")}`), tradeDate)).toThrow(/incomplete/);
  });

  it("deduplicates stock future/option contracts and excludes both index types", () => {
    const rows = sourceSymbols.map((symbol) => `${tradeDate},FUTSTK,${symbol},2026-10-27`).join("\n");
    const extra = `${tradeDate},OPTSTK,NEWSTK,2026-10-27\n${tradeDate},STO,RELIANCE,2026-10-27\n` +
      `${tradeDate},FUTIDX,NIFTY,2026-10-27\n${tradeDate},OPTIDX,BANKNIFTY,2026-10-27`;
    const symbols = parseNseFoUnderlyings(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${rows}\n${extra}\n`), tradeDate);
    expect(symbols.size).toBe(126);
    expect(symbols.has("NEWSTK")).toBe(true);
    expect(symbols.has("NIFTY")).toBe(false);
    expect(symbols.has("BANKNIFTY")).toBe(false);
    expect(() => parseNseFoUnderlyings(Buffer.from(`FinInstrmTp,TckrSymb,XpryDt\nSTF,RELIANCE,2026-10-27`), tradeDate)).toThrow(/date/);
  });

  it("refuses an unverified report URL instead of retrying the old guessed endpoint", async () => {
    await expect(new NseDailyFoContractSource("").load(tradeDate)).rejects.toThrow(/No verified official NSE/);
    await expect(new NseDailyCmSecuritySource("").load(tradeDate)).rejects.toThrow(/No verified official NSE daily CM MII/);
  });

  it("parses the CM MII CAS flag by header, excludes non-EQ rows, and collapses duplicate rows", () => {
    const csv = [
      "TradDt,FinInstrmTp,TckrSymb,SctySrs,ISIN,ElgbltyClsgAuctnSsn",
      `${tradeDate},STK,RELIANCE,EQ,INE002A01018,1`,
      `${tradeDate},STK,HDFCBANK,EQ,INE040A01034,0`,
      `${tradeDate},STK,HDFCBANK,EQ,INE040A01034,0`,
      `${tradeDate},STK,NIFTY,XX,,1`
    ].join("\n");
    const parsed = parseNseCmSecurityMaster(Buffer.from(csv), tradeDate);
    expect(parsed.schemaVersion).toBe("NSE_CM_SECURITY_MII_SCHEMA_V1");
    expect(parsed.rows).toEqual([
      { symbol: "HDFCBANK", series: "EQ", isin: "INE040A01034", eligible: "NOT_ELIGIBLE" },
      { symbol: "RELIANCE", series: "EQ", isin: "INE002A01018", eligible: "ELIGIBLE" }
    ]);
  });

  it("marks conflicting CM MII duplicate flags UNKNOWN and rejects missing or malformed schemas", () => {
    const conflict = `TradDt,FinInstrmTp,TckrSymb,SctySrs,ElgbltyClsgAuctnSsn\n${tradeDate},STK,RELIANCE,EQ,1\n${tradeDate},STK,RELIANCE,EQ,0`;
    expect(parseNseCmSecurityMaster(Buffer.from(conflict), tradeDate).rows[0]?.eligible).toBe("UNKNOWN");
    expect(() => parseNseCmSecurityMaster(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,SctySrs\n${tradeDate},STK,RELIANCE,EQ`), tradeDate)).toThrow(/missing Elgblty/);
    expect(() => parseNseCmSecurityMaster(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,SctySrs,ElgbltyClsgAuctnSsn\n${tradeDate},STK,RELIANCE,EQ,2`), tradeDate)).toThrow(/must be 0 or 1/);
    expect(() => parseNseCmSecurityMaster(Buffer.from(`TradDt,FinInstrmTp,TckrSymb,SctySrs,ElgbltyClsgAuctnSsn\n2026-09-29,STK,RELIANCE,EQ,1`), tradeDate)).toThrow(/trade date/);
  });

  it("creates a dated CM MII operational snapshot with direct eligibility counts", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cm-cas-"));
    tempDirs.push(dir);
    const csv = `TradDt,FinInstrmTp,TckrSymb,SctySrs,ISIN,ElgbltyClsgAuctnSsn\n${allSymbols.map((symbol, index) => `${tradeDate},STK,${symbol},EQ,ISIN${index},${index % 2}`).join("\n")}`;
    const source: DailyCasSource = {
      version: "NSE_CM_SECURITY_MII_V1",
      async load() { return { bytes: Buffer.from(csv), sourceUrl: `https://nsearchives.nseindia.com/content/cm/NSE_CM_security_30092026.csv.gz`, fileName: "NSE_CM_security_30092026.csv.gz" }; },
      eligibleSymbols: (bytes, date) => new Set(parseNseCmSecurityMaster(bytes, date).rows.filter((row) => row.eligible === "ELIGIBLE").map((row) => row.symbol)),
      parseEligibility: parseNseCmSecurityMaster
    };
    const cas = new OperationalCasPolicy(source, dir, async () => sectorMemberships.map(fakeRecord));
    await cas.refresh(tradeDate);
    expect(cas.diagnostics(tradeDate)).toMatchObject({ status: "READY", fileName: "NSE_CM_security_30092026.csv.gz", parsedEqRows: 25, eligibleCount: 12, notEligibleCount: 13, unknownCount: 0 });
    expect(cas.eligibility(sectorMemberships[0]!.instrumentToken, tradeDate)).toBe("NOT_ELIGIBLE");
    expect(cas.eligibility(sectorMemberships[1]!.instrumentToken, tradeDate)).toBe("ELIGIBLE");
  });

  it("marks conflicting NSE underlying membership UNKNOWN and records disagreement", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cas-conflict-"));
    tempDirs.push(dir);
    const csv = `TradDt,FinInstrmTp,TckrSymb,XpryDt\n${sourceSymbols.map((symbol) => `${tradeDate},STF,${symbol},2026-10-27`).join("\n")}`;
    const source: DailyCasSource = { version: "NSE_DAILY_FO_CONTRACT_V1", async load() { return { bytes: Buffer.from(csv),
      sourceUrl: "https://nsearchives.nseindia.com/content/fo/NSE_FO_contract_30092026.csv.gz" }; },
      eligibleSymbols: parseNseFoUnderlyings };
    const cas = new OperationalCasPolicy(source, dir, async () => sectorMemberships.map(fakeRecord), {
      version: "NSE_UNDERLYINGS_V1", async load() { return { sourceDate: tradeDate,
        symbols: new Set(sourceSymbols.filter((symbol) => symbol !== allSymbols[0])) }; }
    });
    await cas.refresh(tradeDate);
    expect(cas.diagnostics(tradeDate).status).toBe("SOURCE_DISAGREEMENT");
    expect(cas.diagnostics(tradeDate).sourceDisagreement).toEqual([allSymbols[0]]);
    expect(cas.eligibility(sectorMemberships[0]!.instrumentToken, tradeDate)).toBe("UNKNOWN");
    expect(cas.eligibility(sectorMemberships[1]!.instrumentToken, tradeDate)).toBe("ELIGIBLE");
    await cas.loadPersisted(tradeDate);
    expect(cas.eligibility(sectorMemberships[0]!.instrumentToken, tradeDate)).toBe("UNKNOWN");
  });

  it("effective-dates and hashes official-source CAS policy; missing or stale dates fail closed", async () => {
    const cas = await policy();
    const first = cas.diagnostics(tradeDate);
    expect(first.status).toBe("RECONCILIATION_INCOMPLETE");
    expect(first.coveredTokens).toBe(25);
    expect(cas.eligibility(sectorMemberships[0]!.instrumentToken, tradeDate)).toBe("ELIGIBLE");
    expect(cas.eligibility(sectorMemberships[0]!.instrumentToken, "2026-10-01")).toBe("UNKNOWN");
    expect(cas.eligibility("999999", tradeDate)).toBe("UNKNOWN");
    await cas.refresh(tradeDate);
    expect(cas.diagnostics(tradeDate).contentHash).toBe(first.contentHash);
  });

  it("keeps non-derivative equities non-CAS and loses availability after a failed refresh", async () => {
    const cas = await policy(allSymbols.slice(1));
    expect(cas.eligibility(sectorMemberships[0]!.instrumentToken, tradeDate)).toBe("NOT_ELIGIBLE");
    expect(cas.eligibility(sectorMemberships[1]!.instrumentToken, tradeDate)).toBe("ELIGIBLE");
    const failedDir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cas-failed-"));
    tempDirs.push(failedDir);
    const failed = new OperationalCasPolicy({ version: "NSE_DAILY_FO_CONTRACT_V1", async load() { throw new Error("NSE unavailable"); },
      eligibleSymbols: parseNseFoUnderlyings },
      failedDir, async () => sectorMemberships.map(fakeRecord));
    expect(failed.eligibility(sectorMemberships[0]!.instrumentToken, tradeDate)).toBe("UNKNOWN");
    await expect(failed.refresh(tradeDate)).rejects.toThrow(/NSE unavailable/);
    expect(failed.diagnostics(tradeDate).status).toBe("SOURCE_UNAVAILABLE");
  });

  it("keeps index, pre-CAS equity, CAS transition, and special-session boundaries distinct", async () => {
    const cas = await policy();
    const equity = sectorMemberships[0]!;
    const session = resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date(startMs), cas)!;
    expect(session.closeTime).toBe(`${tradeDate}T15:30:00+05:30`);
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date(`${tradeDate}T15:14:00+05:30`), cas)?.closeTime)
      .toBe(`${tradeDate}T15:30:00+05:30`);
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date(`${tradeDate}T15:15:00+05:30`), cas)).toBeNull();
    const index = benchmarkRegistry[0]!;
    expect(resolveLiveFeatureSession({ ...index, tradingSymbol: index.symbol }, new Date(startMs), cas, true)?.closeTime).toBe(`${tradeDate}T15:30:00+05:30`);
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-02-01T09:15:00+05:30"), cas)?.closeTime)
      .toBe("2026-02-01T15:30:00+05:30");
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-10-01T09:15:00+05:30"), cas)?.closeTime)
      .toBe("2026-10-01T15:30:00+05:30");
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-09-27T09:15:00+05:30"), cas)).toBeNull();
  });

  it("requires CAS only from the 15:15 transition boundary", async () => {
    const unknownDir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cas-unknown-boundary-"));
    tempDirs.push(unknownDir);
    const unknown = new OperationalCasPolicy({ version: "NSE_DAILY_FO_CONTRACT_V1", async load() { throw new Error("NSE unavailable"); },
      eligibleSymbols: parseNseFoUnderlyings }, unknownDir, async () => sectorMemberships.map(fakeRecord));
    const equity = sectorMemberships[0]!;
    const preCas = resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-10-01T15:14:00+05:30"), unknown);
    expect(preCas?.closeTime).toBe("2026-10-01T15:30:00+05:30");
    expect(preCas?.casEligibilityVersion).toBe("NSE_LIVE_PRE_CAS_CONTINUOUS_V1");
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-10-01T15:15:00+05:30"), unknown)).toBeNull();

    const eligible = await policy();
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-09-30T15:14:00+05:30"), eligible)?.closeTime)
      .toBe("2026-09-30T15:30:00+05:30");
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-09-30T15:15:00+05:30"), eligible)).toBeNull();

    const nonCas = await policy(allSymbols.slice(1));
    expect(resolveLiveFeatureSession({ ...equity, exchange: "NSE" }, new Date("2026-09-30T15:15:00+05:30"), nonCas)?.closeTime)
      .toBe("2026-09-30T15:30:00+05:30");
    expect(resolveLiveSessionState({ tradeDate: "2026-09-30", at: new Date("2026-09-30T15:15:00+05:30"), closeTimeIst: "15:30",
      specialSession: false, eligibility: "UNKNOWN", index: false })).toBe("CAS_TRANSITION_OR_SESSION");
    expect(resolveLiveSessionState({ tradeDate: "2026-09-30", at: new Date("2026-09-30T15:15:00+05:30"), closeTimeIst: "15:30",
      specialSession: false, eligibility: "NOT_ELIGIBLE", index: false })).toBe("NON_CAS_CONTINUOUS");
    expect(resolveLiveFeatureSession({ ...benchmarkRegistry[0]!, tradingSymbol: benchmarkRegistry[0]!.symbol, exchange: "NSE" },
      new Date("2026-10-01T15:16:00+05:30"), unknown, true)?.closeTime).toBe("2026-10-01T15:30:00+05:30");
  });

  it("never promotes context indices into the tradable NSE EQ universe", () => {
    for (const benchmark of benchmarkRegistry) expect(isTradableNseEquity({ ...fakeRecord(sectorMemberships[0]!),
      symbol: benchmark.symbol, instrumentToken: benchmark.instrumentToken, segment: "INDICES", instrumentType: "EQ" })).toBe(false);
  });

  it("resets session-local feature values on the next trading date", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cas-sessions-"));
    tempDirs.push(dir);
    const source: DailyCasSource = { version: "NSE_DAILY_FO_CONTRACT_V1", async load(date) {
      const dateCode = `${date.slice(8, 10)}${date.slice(5, 7)}${date.slice(0, 4)}`;
      const rows = sourceSymbols.map((symbol) => `${date},STF,${symbol},2026-10-27`).join("\n");
      return { bytes: Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${rows}\n`),
        sourceUrl: `https://nsearchives.nseindia.com/content/fo/NSE_FO_contract_${dateCode}.csv.gz` };
    }, eligibleSymbols: parseNseFoUnderlyings };
    const cas = new OperationalCasPolicy(source, dir, async () => sectorMemberships.map(fakeRecord));
    const stream = fakeStream();
    const live = new LiveMarketIntelligenceService(stream, cas);
    live.start();
    const item = sectorMemberships[0]!;
    await cas.refresh(tradeDate);
    stream.store.set(tick(item.instrumentToken, item.tradingSymbol, startMs, 10, 100));
    live.flush(new Date(startMs + 61_000));
    expect(live.getLatestInstrumentFeatures(item.instrumentToken, new Date(startMs + 61_000))?.feature?.values.sessionHigh).toBe(100);
    const nextDate = "2026-10-01";
    const nextStart = Date.parse(`${nextDate}T09:15:00+05:30`);
    await cas.refresh(nextDate);
    stream.store.set(tick(item.instrumentToken, item.tradingSymbol, nextStart, 5, 80));
    live.flush(new Date(nextStart + 61_000));
    const feature = live.getLatestInstrumentFeatures(item.instrumentToken, new Date(nextStart + 61_000))?.feature;
    expect(feature?.sessionDate).toBe(nextDate);
    expect(feature?.values.sessionHigh).toBe(80);
    expect(feature?.values.minutesSinceMarketOpen).toBe(1);
    live.stop();
  });

  it("prepares a dated CAS snapshot before the stream starts and skips weekends", async () => {
    const dir = await mkdtemp(path.join(os.tmpdir(), "tradepilot-live-cas-preflight-"));
    tempDirs.push(dir);
    const load = vi.fn(async (date: string) => ({
      bytes: Buffer.from(`TradDt,FinInstrmTp,TckrSymb,XpryDt\n${sourceSymbols.map((symbol) => `${date},STF,${symbol},2026-10-27`).join("\n")}\n`),
      sourceUrl: `https://nsearchives.nseindia.com/content/fo/NSE_FO_contract_${date.slice(8, 10)}${date.slice(5, 7)}${date.slice(0, 4)}.csv.gz`
    }));
    const cas = new OperationalCasPolicy({ version: "NSE_DAILY_FO_CONTRACT_V1", load, eligibleSymbols: parseNseFoUnderlyings },
      dir, async () => sectorMemberships.map(fakeRecord));
    const stream = fakeStream();
    const live = new LiveMarketIntelligenceService(stream, cas, () => new Date(startMs - 10 * 60_000));
    expect(stream.getStatus().running).toBe(false);
    live.start();
    await vi.waitFor(() => expect(cas.diagnostics(tradeDate).status).toBe("RECONCILIATION_INCOMPLETE"));
    expect(load).toHaveBeenCalledTimes(1);
    live.stop();

    const weekendCas = new OperationalCasPolicy({ version: "NSE_DAILY_FO_CONTRACT_V1", load, eligibleSymbols: parseNseFoUnderlyings },
      dir, async () => sectorMemberships.map(fakeRecord));
    const weekend = new LiveMarketIntelligenceService(stream, weekendCas, () => new Date("2026-09-27T09:00:00+05:30"));
    weekend.start();
    expect(load).toHaveBeenCalledTimes(1);
    weekend.stop();
  });

  it("exposes only read-only intelligence API routes", () => {
    const router = liveMarketIntelligenceRouter as unknown as { stack: Array<{ route?: { methods: Record<string, boolean> } }> };
    const methods = router.stack.flatMap((layer) => Object.keys(layer.route?.methods ?? {}));
    expect(methods).toHaveLength(4);
    expect(methods).toEqual(["get", "get", "get", "get"]);
  });

  it("emits only settled completed minutes, preserves gaps, and rejects late revisions", async () => {
    const cas = await policy();
    const item = sectorMemberships[0]!;
    const session = resolveLiveFeatureSession({ ...item, exchange: "NSE" }, new Date(startMs), cas)!;
    const assembler = new LiveMinuteCandleAssembler();
    assembler.ingest(tick(item.instrumentToken, item.tradingSymbol, startMs, 10), session, false);
    expect(assembler.drain(new Date(startMs + 60_000))).toHaveLength(0);
    expect(assembler.drain(new Date(startMs + 61_000))).toMatchObject([{ candle: { volume: 10, startTime: new Date(startMs).toISOString() } }]);
    assembler.ingest(tick(item.instrumentToken, item.tradingSymbol, startMs + 120_000, 30), session, false);
    expect(assembler.drain(new Date(startMs + 181_000))).toMatchObject([{ candle: { volume: 20, startTime: new Date(startMs + 120_000).toISOString() } }]);
    assembler.ingest(tick(item.instrumentToken, item.tradingSymbol, startMs, 11), session, false);
    expect(assembler.drain(new Date(startMs + 181_000))).toHaveLength(0);
    expect(assembler.size().droppedLate).toBe(1);
  });

  it("does not infer a full warm-up from a mid-session start", async () => {
    const cas = await policy();
    const item = sectorMemberships[0]!;
    const session = resolveLiveFeatureSession({ ...item, exchange: "NSE" }, new Date(startMs + 5 * 60_000), cas)!;
    const assembler = new LiveMinuteCandleAssembler();
    assembler.ingest(tick(item.instrumentToken, item.tradingSymbol, startMs + 5 * 60_000, 100), session, false);
    const completed = assembler.drain(new Date(startMs + 6 * 60_000 + 1_000))[0]!;
    expect(completed.candle.volume).toBeNull();
    const feature = new MarketFeatureEngine().ingest(fromHistoricalCandle({ instrumentId: null, instrumentToken: item.instrumentToken,
      exchange: "NSE", tradingSymbol: item.tradingSymbol, interval: "1m", timestamp: new Date(startMs + 5 * 60_000),
      open: 100, high: 100, low: 100, close: 100, volume: 0, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: new Date(startMs) }, session, "fixture", 99));
    expect(feature.quality.sessionHigh).toBe("DATA_GAP");
  });

  it("resubscribes on reconnect without duplicate applied feature updates", async () => {
    const cas = await policy();
    const stream = fakeStream();
    const subscribe = vi.spyOn(stream, "subscribe");
    const live = new LiveMarketIntelligenceService(stream, cas, () => new Date(startMs + 10_000));
    live.start();
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(2));
    stream.bus.emitConnectionState("RECONNECTING");
    stream.bus.emitConnectionState("CONNECTED");
    await vi.waitFor(() => expect(subscribe).toHaveBeenCalledTimes(4));
    const item = sectorMemberships[0]!;
    const observation = tick(item.instrumentToken, item.tradingSymbol, startMs + 60_000, 20);
    expect(stream.store.set(observation)).toBe("applied");
    expect(stream.store.set(observation)).toBe("duplicate");
    live.flush(new Date(startMs + 121_000));
    expect(live.getHealth(new Date(startMs + 121_000)).counters.featureEvaluations).toBe(1);
    live.stop();
  });

  it("records feature failures without preventing market-state updates", async () => {
    const cas = await policy();
    const stream = fakeStream();
    const live = new LiveMarketIntelligenceService(stream, cas);
    live.start();
    const item = sectorMemberships[0]!;
    stream.store.set(tick(item.instrumentToken, item.tradingSymbol, startMs, 10));
    live.flush(new Date(startMs + 61_000));
    vi.spyOn(live.featureEngine, "ingest").mockImplementationOnce(() => { throw new Error("fixture feature failure"); });
    const invalid = tick(item.instrumentToken, item.tradingSymbol, startMs + 60_000, 20);
    expect(stream.store.set(invalid)).toBe("applied");
    live.flush(new Date(startMs + 121_000));
    expect(stream.store.getLatest(item.instrumentToken)?.lastPrice).toBe(100);
    expect(live.getHealth(new Date(startMs + 121_000)).errors.count).toBeGreaterThan(0);
    live.stop();
  });

  it("matches finalized historical adapters through 9A, 9B, and 9C without strategy state", async () => {
    const cas = await policy();
    const stream = fakeStream();
    const live = new LiveMarketIntelligenceService(stream, cas);
    live.start();
    const historicalFeatures = new MarketFeatureEngine();
    const historicalContext = new MarketContextEngine();
    const historicalRegime = new MarketRegimeEngine();
    let expectedFeatureId = "";
    let expectedMarketId = "";
    let expectedRegimeId = "";
    for (let minute = 0; minute < 32; minute += 1) {
      const atMs = startMs + minute * 60_000;
      const candles: NormalizedHistoricalCandle[] = [];
      for (const benchmark of benchmarkRegistry) {
        stream.store.set(tick(benchmark.instrumentToken, benchmark.symbol, atMs, null, 100 + minute));
        candles.push({ instrumentId: null, instrumentToken: benchmark.instrumentToken, exchange: "NSE", tradingSymbol: benchmark.symbol,
          interval: "1m", timestamp: new Date(atMs), open: 100 + minute, high: 100 + minute, low: 100 + minute,
          close: 100 + minute, volume: 0, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: new Date(atMs) });
      }
      for (const item of sectorMemberships) {
        stream.store.set(tick(item.instrumentToken, item.tradingSymbol, atMs, (minute + 1) * 10, 100 + minute));
        candles.push({ instrumentId: null, instrumentToken: item.instrumentToken, exchange: "NSE", tradingSymbol: item.tradingSymbol,
          interval: "1m", timestamp: new Date(atMs), open: 100 + minute, high: 100 + minute, low: 100 + minute,
          close: 100 + minute, volume: 10, openInterest: null, source: "MOCK", adjustment: "UNKNOWN", fetchedAt: new Date(atMs) });
      }
      live.flush(new Date(atMs + 61_000));
      for (const candle of candles.slice(0, 8)) historicalContext.ingestBenchmark(fromHistoricalBenchmarkCandle(candle,
        benchmarkRegistry.find((item) => item.instrumentToken === candle.instrumentToken)!.id, "LIVE_MOCK_9E_V1", 99));
      for (const candle of candles.slice(8)) {
        const session = resolveLiveFeatureSession(candle, candle.timestamp, cas)!;
        const feature = historicalFeatures.ingest(fromHistoricalCandle(candle, session, "LIVE_MOCK_9E_V1", 99));
        historicalContext.ingestEquity({ feature, previousSessionClose: 99 });
      }
      const first = sectorMemberships[0]!;
      const asOf = new Date(atMs + 60_000);
      const context = historicalContext.getContext(first.instrumentToken, asOf);
      const regime = historicalRegime.observe(context);
      expectedFeatureId = historicalFeatures.readAt(first.instrumentToken, "1m", asOf, 0)!.id;
      expectedMarketId = context.market.id;
      expectedRegimeId = regime.market.id;
    }
    const readAt = new Date(startMs + 32 * 60_000 + 30_000);
    expect(live.getLatestInstrumentFeatures(sectorMemberships[0]!.instrumentToken, readAt)?.feature?.id).toBe(expectedFeatureId);
    expect(live.getLatestMarketContext(readAt).market?.id).toBe(expectedMarketId);
    expect(live.getLatestMarketContext(readAt).regime?.id).toBe(expectedRegimeId);
    expect(live.getLatestSectorContext(sectorMemberships[0]!.sectorId, readAt).context?.id)
      .toBe(historicalContext.getContext(sectorMemberships[0]!.instrumentToken, new Date(startMs + 32 * 60_000)).sector?.id);
    expect(live.getHealth(readAt).counters).toMatchObject({ processedCandles: 32 * 33, featureEvaluations: 32 * 25 });
    expect(live.getHealth(new Date(readAt.getTime() + 120_000)).marketFreshness.reason).toBe("STALE_OBSERVATION");
    expect(live.getLatestSectorContext(sectorMemberships[0]!.sectorId, new Date(readAt.getTime() + 120_000)).regime).toBeNull();
    expect(live.getIntelligenceSnapshot(sectorMemberships[0]!.instrumentToken, new Date(readAt.getTime() + 120_000))?.context).toBeNull();
    live.stop();
  });

  it("keeps 25-equity/8-benchmark full-session state bounded under live-style load", async () => {
    const cas = await policy();
    const stream = fakeStream();
    const live = new LiveMarketIntelligenceService(stream, cas);
    live.start();
    const before = process.memoryUsage().rss;
    const started = performance.now();
    for (let minute = 0; minute < 360; minute += 1) {
      const atMs = startMs + minute * 60_000;
      for (const item of benchmarkRegistry) stream.store.set(tick(item.instrumentToken, item.symbol, atMs, null, 100 + minute * 0.01));
      for (const item of sectorMemberships) stream.store.set(tick(item.instrumentToken, item.tradingSymbol, atMs, (minute + 1) * 10, 100 + minute * 0.01));
      live.flush(new Date(atMs + 61_000));
    }
    const elapsedMs = performance.now() - started;
    const after = process.memoryUsage().rss;
    const health = live.getHealth(new Date(startMs + 360 * 60_000));
    expect(health.counters.processedCandles).toBe(360 * 33);
    expect(health.stateSize.latestFeatures).toBe(25);
    expect(health.stateSize.latestSectors).toBeLessThanOrEqual(10);
    expect(health.stateSize.openBuckets).toBe(0);
    expect(health.stateSize.pending).toBe(0);
    console.info(JSON.stringify({ benchmark: "PHASE_9E_LIVE_STYLE_V1", candles: health.counters.processedCandles,
      featureEvaluations: health.counters.featureEvaluations, marketContextUpdates: health.counters.marketContextUpdates,
      sectorContextUpdates: health.counters.sectorContextUpdates, regimeUpdates: health.counters.regimeUpdates,
      elapsedMs: Math.round(elapsedMs), updatesPerSecond: Math.round(health.counters.processedCandles / (elapsedMs / 1000)),
      rssBeforeMb: Math.round(before / 1048576), rssAfterMb: Math.round(after / 1048576), stateSize: health.stateSize }));
    live.stop();
  }, 60_000);
});
