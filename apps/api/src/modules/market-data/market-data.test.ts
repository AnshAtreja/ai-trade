import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { InstrumentRecord } from "../../db/domain";
import { DEMO_USER_EMAIL, MEMORY_DEMO_USER_ID } from "../../db/domain";
import { resetRepositoriesForTests } from "../../db/persistence";
import { createMemoryRepositories } from "../../db/repositories/memory-repositories";
import { parseInstrumentCsvRow } from "../broker/adapters/kite-broker-adapter";
import { kiteBrokerAdapter } from "../broker/adapters/kite-broker-adapter";
import { LIVE_TRADING_DISABLED_MESSAGE } from "../broker/adapters/live-trading-disabled";
import { KiteAccountError } from "../broker/account/errors";
import type { BrokerInstrument } from "../broker/types";
import { fromBrokerInstrument } from "./instrument-types";
import { createMarketInstrumentService } from "./instrument-service";
import { KiteInstrumentProvider } from "./kite-instrument-provider";
import { KiteMarketDataProvider } from "./kite-market-data-provider";
import { MockInstrumentProvider } from "./mock-instrument-provider";
import { MockMarketDataProvider } from "./mock-market-data-provider";
import { InstrumentSyncService } from "./sync-service";
import { isTradableNseEquity } from "./universe";
import type { InstrumentProvider } from "./instrument-types";
import type { MarketDataProvider } from "./quote-types";

function instrumentRecord(overrides: Partial<InstrumentRecord> & Pick<InstrumentRecord, "symbol" | "exchange">): InstrumentRecord {
  const now = new Date("2026-09-10T12:00:00.000Z");
  return {
    id: overrides.id ?? "inst_1",
    name: overrides.name ?? overrides.symbol,
    instrumentToken: overrides.instrumentToken ?? "1",
    exchangeToken: overrides.exchangeToken ?? null,
    segment: overrides.segment ?? overrides.exchange,
    instrumentType: overrides.instrumentType ?? "EQ",
    expiry: overrides.expiry ?? null,
    strike: overrides.strike ?? null,
    tickSize: overrides.tickSize ?? 0.05,
    lotSize: overrides.lotSize ?? 1,
    isActive: overrides.isActive ?? true,
    createdAt: now,
    updatedAt: now,
    ...overrides
  };
}

function service(quotes?: MarketDataProvider, instruments?: InstrumentProvider) {
  return createMarketInstrumentService({
    instrumentProvider: instruments ?? new MockInstrumentProvider(),
    quotes: quotes ?? new MockMarketDataProvider()
  });
}

describe("instrument normalization", () => {
  it("normalizes a valid Kite equity instrument", () => {
    const normalized = fromBrokerInstrument({
      symbol: "reliance",
      exchange: "nse",
      instrumentToken: "2885",
      exchangeToken: "738",
      name: "Reliance Industries Limited",
      segment: "NSE",
      instrumentType: "EQ",
      tickSize: 0.05,
      lotSize: 1
    });

    expect(normalized).toMatchObject({
      tradingSymbol: "RELIANCE",
      exchange: "NSE",
      instrumentToken: "2885",
      instrumentType: "EQ",
      expiry: null,
      strike: null
    });
  });

  it("parses a valid Kite CSV row and rejects malformed rows", () => {
    expect(parseInstrumentCsvRow("2885,738,RELIANCE,Reliance,0,,0,0.05,1,EQ,NSE,NSE")).toMatchObject({
      symbol: "RELIANCE",
      exchange: "NSE",
      instrumentToken: "2885"
    });
    expect(parseInstrumentCsvRow("not-enough-columns")).toBeNull();
    expect(parseInstrumentCsvRow(",,,missing-token")).toBeNull();
  });

  it("returns null when required fields are missing", () => {
    expect(
      fromBrokerInstrument({
        symbol: "",
        exchange: "NSE",
        instrumentToken: "1",
        name: "X",
        segment: "NSE",
        tickSize: 0.05,
        lotSize: 1
      } as BrokerInstrument)
    ).toBeNull();
  });

  it("parses expiry and positive strike, ignoring zero strike", () => {
    const option = fromBrokerInstrument({
      symbol: "RELIANCE25SEP2500CE",
      exchange: "NFO",
      instrumentToken: "9",
      name: "RELIANCE",
      segment: "NFO-OPT",
      instrumentType: "CE",
      expiry: "2026-09-24",
      strike: 2500,
      tickSize: 0.05,
      lotSize: 250
    });
    expect(option?.expiry?.toISOString()).toContain("2026-09-23");
    expect(option?.strike).toBe(2500);

    const future = fromBrokerInstrument({
      symbol: "NIFTY25SEPFUT",
      exchange: "NFO",
      instrumentToken: "8",
      name: "NIFTY",
      segment: "NFO-FUT",
      instrumentType: "FUT",
      expiry: "not-a-date",
      strike: 0,
      tickSize: 0.05,
      lotSize: 25
    });
    expect(future?.expiry).toBeNull();
    expect(future?.strike).toBeNull();
  });
});

describe("instrument sync", () => {
  beforeEach(() => {
    resetRepositoriesForTests(createMemoryRepositories());
  });

  afterEach(() => {
    resetRepositoriesForTests();
    vi.restoreAllMocks();
  });

  it("inserts new instruments and is idempotent on repeat", async () => {
    const market = service();
    const first = await market.syncInstruments();
    const second = await market.syncInstruments();
    const listed = await market.listInstruments();

    expect(first.status).toBe("COMPLETE");
    expect(first.inserted).toBeGreaterThan(0);
    expect(second.inserted).toBe(0);
    expect(second.updated).toBe(first.inserted + first.updated);
    expect(listed).toHaveLength(first.received);
    expect(new Set(listed.map((item) => `${item.exchange}:${item.instrumentToken}`)).size).toBe(listed.length);
  });

  it("updates existing instruments without duplicating", async () => {
    const market = service();
    await market.syncInstruments();
    const renamed: InstrumentProvider = {
      source: "MOCK",
      async getInstruments() {
        return {
          received: 1,
          failed: 0,
          instruments: [
            {
              tradingSymbol: "RELIANCE",
              exchange: "NSE",
              name: "Reliance Industries Ltd",
              instrumentToken: "2885",
              exchangeToken: "738",
              segment: "NSE",
              instrumentType: "EQ",
              expiry: null,
              strike: null,
              tickSize: 0.05,
              lotSize: 1,
              isActive: true
            }
          ]
        };
      }
    };

    const result = await createMarketInstrumentService({ instrumentProvider: renamed }).syncInstruments();
    const reliance = await createMarketInstrumentService().getByInstrumentToken("2885");

    expect(result.updated).toBe(1);
    expect(result.inserted).toBe(0);
    expect(reliance.name).toBe("Reliance Industries Ltd");
  });

  it("counts malformed rows as failed without aborting valid ones", async () => {
    const provider: InstrumentProvider = {
      source: "MOCK",
      async getInstruments() {
        return {
          received: 3,
          failed: 2,
          instruments: [
            {
              tradingSymbol: "INFY",
              exchange: "NSE",
              name: "Infosys",
              instrumentToken: "408065",
              exchangeToken: "1594",
              segment: "NSE",
              instrumentType: "EQ",
              expiry: null,
              strike: null,
              tickSize: 0.05,
              lotSize: 1,
              isActive: true
            }
          ]
        };
      }
    };

    const result = await new InstrumentSyncService(undefined, provider).sync();
    expect(result.status).toBe("COMPLETE");
    expect(result.received).toBe(3);
    expect(result.failed).toBe(2);
    expect(result.inserted).toBe(1);
  });

  it("does not treat a provider failure as an empty successful sync", async () => {
    const provider: InstrumentProvider = {
      source: "MOCK",
      async getInstruments() {
        throw new Error("upstream down");
      }
    };

    await expect(new InstrumentSyncService(undefined, provider).sync()).rejects.toMatchObject({
      code: "INSTRUMENT_SYNC_FAILED"
    });
  });

  it("never calls Kite from mock instrument sync", async () => {
    const fetchSpy = vi.spyOn(globalThis, "fetch");
    await service().syncInstruments();
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it("surfaces Kite authentication failure from the Kite instrument provider", async () => {
    const fetchInstrumentMaster = vi.fn();
    const provider = new KiteInstrumentProvider({
      isConfigured: () => true,
      isAuthenticated: () => false,
      fetchInstrumentMaster
    } as never);

    await expect(provider.getInstruments()).rejects.toMatchObject({ code: "KITE_NOT_AUTHENTICATED" });
    expect(fetchInstrumentMaster).not.toHaveBeenCalled();
  });
});

describe("equity universe and lookups", () => {
  beforeEach(() => {
    resetRepositoriesForTests(createMemoryRepositories());
  });

  afterEach(() => {
    resetRepositoriesForTests();
  });

  it("includes NSE cash equity and excludes derivatives, ETFs, and inactive names", async () => {
    const market = service();
    await market.syncInstruments();
    const equities = await market.getTradableEquities(["NSE"]);
    const symbols = equities.map((item) => item.tradingSymbol);

    expect(symbols).toEqual(expect.arrayContaining(["RELIANCE", "INFY", "TCS"]));
    expect(symbols).not.toContain("HDFCBANK");
    expect(symbols).not.toContain("NIFTYBEES");
    expect(symbols).not.toContain("RELIANCE25SEP2500CE");
    expect(symbols).not.toContain("NIFTY25SEPFUT");
    expect(symbols).not.toContain("USDINR");
    expect(symbols).not.toContain("CRUDEOIL");
    expect(symbols).not.toContain("OLDCO");
  });

  it("filters the repository query before applying the page limit", async () => {
    const market = service();
    await market.syncInstruments();

    const firstPage = await market.listTradableEquities({ exchange: "NSE", page: 1, pageSize: 2 });
    const searchResult = await market.listTradableEquities({ exchange: "NSE", search: "INFY", pageSize: 2 });

    expect(firstPage.equities).toHaveLength(2);
    expect(firstPage.equities.map((item) => item.tradingSymbol)).toEqual(["INFY", "RELIANCE"]);
    expect(firstPage.equities.every((item) => item.exchange === "NSE" && item.instrumentType === "EQ")).toBe(true);
    expect(searchResult.equities.map((item) => item.tradingSymbol)).toEqual(["INFY"]);
    expect(searchResult.hasNext).toBe(false);
  });

  it("resolves trading symbol, token, and exchange+symbol", async () => {
    const market = service();
    await market.syncInstruments();
    await expect(market.getByTradingSymbol("RELIANCE")).resolves.toMatchObject({ instrumentToken: "2885", exchange: "NSE" });
    await expect(market.getByInstrumentToken("2885")).resolves.toMatchObject({ tradingSymbol: "RELIANCE" });
    await expect(market.getByTradingSymbol("HDFCBANK", "BSE")).resolves.toMatchObject({ exchange: "BSE" });
  });

  it("excludes expired and non-EQ instruments from the NSE cash filter", () => {
    expect(
      isTradableNseEquity(
        instrumentRecord({
          symbol: "RELCE",
          exchange: "NSE",
          instrumentType: "CE",
          expiry: new Date("2026-09-24")
        })
      )
    ).toBe(false);
  });
});

describe("market data", () => {
  beforeEach(() => {
    resetRepositoriesForTests(createMemoryRepositories());
  });

  afterEach(() => {
    resetRepositoriesForTests();
    vi.restoreAllMocks();
  });

  it("normalizes mock LTP and quotes in batch", async () => {
    const market = service();
    await market.syncInstruments();
    const ltp = await market.getLtp({ tradingSymbols: ["RELIANCE", "INFY"] });
    const quotes = await market.getQuotes({ instrumentTokens: ["2885", "408065"] });

    expect(ltp.quotes).toHaveLength(2);
    expect(ltp.quotes[0]?.lastPrice).toBeGreaterThan(0);
    expect(quotes.quotes[0]).toMatchObject({
      tradingSymbol: "RELIANCE",
      instrumentToken: "2885"
    });
    expect(quotes.quotes[0]?.volume).toBeGreaterThan(0);
    expect(ltp.source).toBe("MOCK");
  });

  it("batches Kite LTP requests instead of calling once per instrument", async () => {
    const getLTP = vi.fn(async (symbols: string[]) =>
      Object.fromEntries(symbols.map((symbol) => [symbol, { symbol, lastPrice: 12.5, updatedAt: "2026-09-10T12:00:00.000Z" }]))
    );
    const provider = new KiteMarketDataProvider(
      {
        isConfigured: () => true,
        isAuthenticated: () => true,
        getLTP,
        getQuotes: vi.fn()
      },
      2
    );
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    await new InstrumentSyncService(() => repos, new MockInstrumentProvider()).sync();
    const reliance = await repos.instruments.findByInstrumentToken("2885");
    const infy = await repos.instruments.findByInstrumentToken("408065");
    const tcs = await repos.instruments.findByInstrumentToken("2953217");

    await provider.getLtp([reliance!, infy!, tcs!]);
    expect(getLTP).toHaveBeenCalledTimes(2);
    expect(getLTP.mock.calls[0]?.[0]).toHaveLength(2);
  });

  it("throws on malformed Kite LTP payloads", async () => {
    const provider = new KiteMarketDataProvider({
      isConfigured: () => true,
      isAuthenticated: () => true,
      getLTP: async () => ({ "NSE:RELIANCE": { symbol: "NSE:RELIANCE", lastPrice: Number.NaN, updatedAt: "x" } }),
      getQuotes: vi.fn()
    });

    await expect(
      provider.getLtp([instrumentRecord({ symbol: "RELIANCE", exchange: "NSE", instrumentToken: "2885" })])
    ).rejects.toMatchObject({ code: "KITE_MALFORMED_RESPONSE" });
  });

  it("throws when Kite is not authenticated", async () => {
    const provider = new KiteMarketDataProvider({
      isConfigured: () => true,
      isAuthenticated: () => false,
      getLTP: vi.fn(),
      getQuotes: vi.fn()
    });

    await expect(
      provider.getLtp([instrumentRecord({ symbol: "RELIANCE", exchange: "NSE" })])
    ).rejects.toMatchObject({ code: "KITE_NOT_AUTHENTICATED" });
  });

  it("throws on Kite rate limits instead of returning empty quotes", async () => {
    const provider = new KiteMarketDataProvider({
      isConfigured: () => true,
      isAuthenticated: () => true,
      getLTP: async () => {
        throw new KiteAccountError("KITE_RATE_LIMITED", "slow down");
      },
      getQuotes: vi.fn()
    });

    await expect(
      provider.getLtp([instrumentRecord({ symbol: "RELIANCE", exchange: "NSE" })])
    ).rejects.toMatchObject({ code: "KITE_RATE_LIMITED" });
  });

  it("throws MARKET_DATA_FETCH_FAILED when the adapter fails", async () => {
    const provider = new KiteMarketDataProvider({
      isConfigured: () => true,
      isAuthenticated: () => true,
      getQuotes: async () => {
        throw new Error("socket hang up");
      },
      getLTP: vi.fn()
    });

    await expect(
      provider.getQuotes([instrumentRecord({ symbol: "RELIANCE", exchange: "NSE" })])
    ).rejects.toMatchObject({ code: "MARKET_DATA_FETCH_FAILED" });
  });

  it("persists immutable market snapshots without mutating paper state", async () => {
    const repos = createMemoryRepositories();
    resetRepositoriesForTests(repos);
    const market = createMarketInstrumentService({
      repos: () => repos,
      instrumentProvider: new MockInstrumentProvider(),
      quotes: new MockMarketDataProvider()
    });
    await market.syncInstruments();
    const first = await market.getQuotes({ tradingSymbols: ["RELIANCE"] });
    const second = await market.getQuotes({ tradingSymbols: ["RELIANCE"] });
    const snapshots = await market.listSnapshots({ symbol: "RELIANCE" });

    expect(first.persisted).toBe(1);
    expect(second.persisted).toBe(1);
    expect(snapshots).toHaveLength(2);
    expect(snapshots[0]?.id).not.toBe(snapshots[1]?.id);
    expect(await repos.trades.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.orders.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.positions.listByUser(MEMORY_DEMO_USER_ID)).toHaveLength(0);
    expect(await repos.paperAccounts.findByUser(MEMORY_DEMO_USER_ID, "PAPER")).toBeNull();
    expect(await repos.users.findByEmail(DEMO_USER_EMAIL)).toBeTruthy();
  });

  it("does not call Kite order endpoints from market-data operations", async () => {
    const place = vi.spyOn(kiteBrokerAdapter, "placeOrder");
    const modify = vi.spyOn(kiteBrokerAdapter, "modifyOrder");
    const cancel = vi.spyOn(kiteBrokerAdapter, "cancelOrder");
    await service().syncInstruments();
    await service().getQuotes({ tradingSymbols: ["INFY"] });
    expect(place).not.toHaveBeenCalled();
    expect(modify).not.toHaveBeenCalled();
    expect(cancel).not.toHaveBeenCalled();
  });

  it("keeps live order methods disabled", async () => {
    await expect(kiteBrokerAdapter.placeOrder({} as never)).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(kiteBrokerAdapter.modifyOrder("1", {})).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
    await expect(kiteBrokerAdapter.cancelOrder("1")).rejects.toThrow(LIVE_TRADING_DISABLED_MESSAGE);
  });
});
