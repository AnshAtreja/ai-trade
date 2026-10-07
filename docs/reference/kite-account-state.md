# Kite read-only account state (Phase 2)

## Existing Kite architecture (reused)

TradePilot already had:

1. **Login** — `GET /api/broker/kite/login-url` → Zerodha Connect.
2. **Request-token exchange** — `POST /api/broker/kite/request-token` and OAuth callback. SHA-256 checksum of `api_key + request_token + api_secret`.
3. **Access-token storage** — encrypted file via `KiteTokenStore` (`.secure/kite-session.enc`). **Not Prisma.** `BrokerConnection.credentialRef` is only an opaque pointer.
4. **`KiteBrokerAdapter`** — profile, thin margins, instruments, LTP, quotes, historical candles, WebSocket ticks.
5. **Live guard** — `placeOrder` / `modifyOrder` / `cancelOrder` always throw `LIVE_TRADING_DISABLED_MESSAGE`.

Phase 2 **does not** add order-routing endpoints. It adds a read-only account layer on top of the existing adapter (`fetchReadOnly` → Kite GET only).

## LIVE vs execution

`TradingMode.LIVE` on snapshots means **real broker / real-money context**.

It does **not** mean live order execution is enabled. Execution remains impossible through `KiteBrokerAdapter`.

Snapshot `source`:

- `PAPER` — virtual TradePilot money
- `KITE` / `MOCK` — broker account observation

## Broker abstraction

```
BrokerAccountProvider
  getProfile / getFunds / getPositions / getOrders / getHoldings
```

Implementations:

- `KiteAccountProvider` — real Kite GETs (`/user/profile`, `/user/margins`, `/portfolio/positions`, `/orders`, `/portfolio/holdings`)
- `MockBrokerAccountProvider` — deterministic fixtures; used when `PERSISTENCE_MODE=mock`

Raw Kite payloads are mapped in `mappers.ts` and never leaked as API types.

## Domain distinctions

| Concept | Meaning |
| --- | --- |
| Paper account | Virtual capital from `PaperAccount` + paper trades/positions |
| Kite account | Read-only Zerodha funds/positions/orders/holdings |
| Paper position | Simulated TradePilot position |
| Kite position | Broker position (`book`: NET or DAY). `quantity` is net; `buyQuantity` / `sellQuantity` are separate |
| Paper order | Simulated fill |
| Kite order | Broker order. Status strings are preserved (`COMPLETE`, `OPEN`, `REJECTED`, …) |
| Trade | Internal TradePilot decision/lifecycle. A Kite order never becomes a Trade |

Holdings are CNC/delivery inventory. They are **not** included in paper exposure.

Instrument master, LTP, quotes, and `MarketSnapshot` rows are **market data** (Phase 3), not account state. See [`instrument-market-data.md`](./instrument-market-data.md).

## Refresh behavior

`POST /api/kite/account/refresh`:

1. Throttle (`KITE_ACCOUNT_REFRESH_MIN_INTERVAL_MS`, default 5000).
2. Verify authentication (except mock provider).
3. Fetch profile, funds, positions, orders, holdings independently.
4. If auth is missing/expired, fail the whole refresh (`KITE_NOT_AUTHENTICATED` / `KITE_AUTH_EXPIRED`).
5. If a non-auth section fails, persist `refreshStatus: "PARTIAL"` with `errors[]` and **null** for that section. Funds are never faked as zeros in `state.funds`.
6. If every section fails, throw `KITE_ACCOUNT_REFRESH_FAILED` and persist nothing.
7. Write an immutable `BrokerAccountSnapshot` (normalized JSON state, no tokens) plus a summary `AccountSnapshot` with `tradingMode=LIVE`.

`GET /api/kite/account` returns the **latest persisted** snapshot. It does not call Kite.

In mock mode, GET auto-refreshes from the mock provider if no snapshot exists.

There is no background polling.

## Funds field semantics (Kite)

Mapped from Kite `equity` / `commodity` margin segments:

- `available.cash` — cash component
- `available.collateral` — collateral
- `available.opening_balance` / `live_balance` / `adhoc_margin` / `intraday_payin`
- `utilised.debits` — used margin (debits)
- `utilised.exposure` — Kite exposure utilisation
- `net` — segment net

PnL on the account view:

- `pnl.realised` / `unrealised` — sum of **NET** position `realised` / `unrealised` from Kite
- `pnl.day` — sum of **DAY** book `pnl` when present, else NET `pnl`

## APIs

- `GET /api/kite/account`
- `POST /api/kite/account/refresh`
- `GET /api/kite/account/profile`
- `GET /api/kite/account/positions`
- `GET /api/kite/account/orders`
- `GET /api/kite/account/holdings`
- `GET /api/kite/account/snapshots`

Existing market-data/auth routes under `/api/broker/kite/*` remain.

Health (`GET /api/health`) now includes `kite.configured`, `kite.authenticated`, `kite.accountReadable`, and `liveTrading.enabled: false`. Authentication is not treated as live trading.

## Errors

| Code | When |
| --- | --- |
| `KITE_NOT_AUTHENTICATED` | No session / missing API key |
| `KITE_AUTH_EXPIRED` | TokenException / HTTP 403 |
| `KITE_RATE_LIMITED` | HTTP 429 or local refresh throttle |
| `KITE_MALFORMED_RESPONSE` | Non-JSON or missing required fields |
| `KITE_API_ERROR` | Other Kite failures |
| `KITE_ACCOUNT_REFRESH_FAILED` | Every section failed |
| `KITE_ACCOUNT_NOT_REFRESHED` | GET with no snapshot in database mode |

Messages are sanitized; tokens are never logged or returned.

## Security

Access tokens stay in `KiteTokenStore`. Snapshots store only normalized account fields. System logs use event names such as `KITE_ACCOUNT_REFRESH_STARTED` without secrets.

## Why live trading stays disabled

`BrokerAccountProvider` has no place/modify/cancel methods. Refresh uses GET paths only. `KiteBrokerAdapter` order methods still throw. No new env var enables execution.
