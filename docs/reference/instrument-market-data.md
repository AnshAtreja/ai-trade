# Instrument master and REST market data (Phase 3)

Phase 3 adds a persistent instrument universe and REST LTP/quote primitives. It does **not** add a scanner, strategy engine, or live order routing.

```
Kite
 ├── Account State (Phase 2) — funds, positions, orders, holdings
 └── Instrument Master (Phase 3)
        ↓
     Market Data (REST LTP / quotes)
        ↓
     Immutable MarketSnapshot rows
        ↓
     Future scanner (later)

Phase 4 will insert the WebSocket tick pipeline between Kite and market-data consumers.
```

## Architecture

```
route (/api/market)
  → MarketInstrumentService
  → InstrumentSyncService / InstrumentUniverseService / MarketDataProvider
  → InstrumentRepository / MarketSnapshotRepository
  → Prisma or in-memory
```

Routes do not import Prisma. Market-data code does not write paper accounts, trades, orders, or positions.

Existing dashboard fixtures remain at `/api/market-data`. New domain APIs live at `/api/market`.

## Instrument identity

Kite `tradingSymbol` is **not** globally unique (the same symbol can exist on NSE and BSE).

Kite exposes two different numeric identifiers in the instrument master:

- `instrumentToken` (CSV column 1 / `instrument_token`) is the canonical Kite instrument identifier. Use this for historical candle requests, quote/WebSocket subscriptions, and TradePilot `Instrument.instrumentToken` references.
- `exchangeToken` (CSV column 2 / `exchange_token`) is the exchange/security identifier. It is metadata only and must not be substituted for `instrumentToken` in historical requests.

For example, the current NSE master identifies RELIANCE as `instrumentToken=738561` and `exchangeToken=2885`; HDFCBANK is `instrumentToken=341249` and `exchangeToken=1333`.

Stable identity:

1. `exchange + instrumentToken` (preferred)
2. `exchange + tradingSymbol` (Prisma unique `@@unique([exchange, symbol])`)

`upsertNormalized` updates an existing token match in place so repeated syncs do not duplicate rows. Instruments missing from a later dump are **not** deleted. Use `isActive` instead of destructive cleanup.

## Providers

```
InstrumentProvider
  ├── KiteInstrumentProvider  — adapter.fetchInstrumentMaster() (authenticated GET /instruments)
  └── MockInstrumentProvider  — deterministic fixtures

MarketDataProvider
  ├── KiteMarketDataProvider  — adapter.getLTP / getQuotes, batched (`KITE_QUOTE_BATCH_SIZE`, default 400)
  └── MockMarketDataProvider  — deterministic prices; never contacts Kite
```

`PERSISTENCE_MODE=mock` uses mock providers only. Database mode uses Kite providers and requires an authenticated Kite session.

There is no second Kite HTTP client. Live `placeOrder` / `modifyOrder` / `cancelOrder` remain disabled on `KiteBrokerAdapter`.

Normalized instruments and quotes are TradePilot domain objects, not raw Kite CSV/JSON.

## Sync

`POST /api/market/instruments/sync`

1. Fetch master from the instrument provider.
2. Drop malformed rows (`failed` count); do not abort the rest of the file.
3. Upsert valid rows.
4. Return `{ status, source, received, inserted, updated, deactivated, failed }`.

`status: COMPLETE` with `received: 0` means the provider returned an empty master. A thrown `INSTRUMENT_SYNC_FAILED` / `KITE_*` error means the fetch failed. Those are not the same.

## Equity universe

`InstrumentUniverseService.getTradableEquities()` (default NSE) keeps:

- `isActive`
- no expiry
- `instrumentType = EQ`
- cash segments `NSE` / `NSE-EQ` (and BSE equivalents when that exchange is requested)
- names/symbols that are not ETFs (`ETF`, `BEES`)

It excludes FUT/CE/PE, NFO/CDS/MCX, currencies, commodities, and inactive rows. Filtering lives here so a future scanner does not re-implement it.

Lookups use repository indexes (`instrumentToken`, `exchange+symbol`), not a full in-memory scan of Kite’s dump.

## Snapshots

`MarketSnapshot` is an **immutable observation**. Quote fetches persist a new row by default (`persist: false` to skip). LTP persists only when `persist: true`.

There is no high-frequency write loop in this phase.

Snapshots store normalized OHLC/volume fields. They must not store access tokens, API secrets, or raw Kite payloads.

## REST vs WebSocket

REST LTP/quote is enough for Phase 3 and for manual checks. Kite REST is rate-limited and unsuitable as a live tape.

Phase 4 will add:

```
Kite WebSocket → connection manager → dedupe → in-memory latest → persistence policy → consumers
```

Do not poll `/ltp` or `/quotes` in a tight loop.

## Errors

| Code | Meaning |
| --- | --- |
| `KITE_NOT_AUTHENTICATED` / `KITE_AUTH_EXPIRED` | Session missing or rejected |
| `KITE_API_ERROR` / `KITE_RATE_LIMITED` / `KITE_MALFORMED_RESPONSE` | Broker transport/payload |
| `INSTRUMENT_SYNC_FAILED` | Master fetch/upsert failed |
| `MARKET_DATA_FETCH_FAILED` | LTP/quote fetch failed |
| `INSTRUMENT_NOT_FOUND` | Symbol/token not in the synchronized master |
| `INVALID_MARKET_UNIVERSE` | Bad request (empty token/symbol list, empty exchange list) |

Empty arrays are not used as a stand-in for these failures.

## Manual verification

### Mock (never contacts Kite)

```bash
cd apps/api
PERSISTENCE_MODE=mock npm run dev
```

```text
GET  /api/market/instruments
GET  /api/market/universe/equities
GET  /api/market/instruments/RELIANCE
GET  /api/market/instruments/token/738561
POST /api/market/instruments/sync
POST /api/market/ltp     { "tradingSymbols": ["RELIANCE", "INFY"] }
POST /api/market/quotes  { "instrumentTokens": ["738561", "408065"] }
GET  /api/market/snapshots?symbol=RELIANCE
```

### Database

```bash
cd apps/api
npx prisma migrate deploy
PERSISTENCE_MODE=database npm run dev
```

Authenticate with the existing Kite flow, then repeat sync / symbol / token / universe / LTP / quotes / snapshots. Restart the API and confirm instruments and snapshots are still listed.

Do not place any live order. `placeOrder` / `modifyOrder` / `cancelOrder` must still throw.

Live ticks (Phase 4) are documented in [`market-stream.md`](./market-stream.md). REST LTP/quotes remain for fallback and debugging.
