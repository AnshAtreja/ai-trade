# Real-time Kite WebSocket market pipeline (Phase 4)

Phase 4 adds an in-process live tape. It does **not** place orders, run a scanner, or persist every tick.

```
Zerodha Kite
      │
      ├── REST (Phase 3 LTP/quotes, instruments)
      └── WebSocket
            ↓
      Connection manager (single socket, backoff reconnect)
            ↓
      Binary parse → normalize → instrument index
            ↓
      Dedup / order check
            ↓
      LatestMarketStateStore (memory)
            ↓
      MarketTickEventBus (latest-value-wins flush)
            ↓
      Future scanner / paper / strategy consumers

PostgreSQL: instruments + optional snapshot cadence
            (never one row per WebSocket tick)
```

## Reuse

The pipeline uses `KiteBrokerAdapter.openMarketWebSocket` — the same API key, `KiteTokenStore`, and `ws` client as before. There is no second Kite HTTP/WebSocket stack.

Legacy `POST /api/broker/kite/subscribe-ticks` still opens that **same** socket. Prefer `/api/market/stream/*`. Tick handlers no longer write paper trades.

## Providers

```
MarketStreamProvider
  ├── KiteMarketStreamProvider   PERSISTENCE_MODE=database
  └── MockMarketStreamProvider   PERSISTENCE_MODE=mock (no network)
```

Domain modes: `LTP` (default), `QUOTE`, `FULL` → Kite `ltp` / `quote` / `full`. Do not subscribe FULL unless a consumer asks.

## Connection lifecycle

States: `STOPPED` | `CONNECTING` | `CONNECTED` | `RECONNECTING` | `DISCONNECTED` | `AUTH_FAILED`.

- Duplicate `start()` is a no-op while running.
- Unexpected close → exponential backoff `MARKET_WS_RECONNECT_BASE_MS` … `MARKET_WS_RECONNECT_MAX_MS` (1s → 30s).
- `stop()` bumps a generation counter so in-flight reconnects are dropped.
- Auth failures (`token` / 401 / 403) → `AUTH_FAILED`, no reconnect loop.

`connected` and `receiving` are different: connected with `lastMessageAt` older than `MARKET_TICK_STALE_MS` is not receiving.

## Subscriptions

`SubscriptionManager` keeps **desired** vs **actual** maps. Reconcile diffs subscribe / unsubscribe / `setMode`. Desired set survives reconnect; actual is cleared on disconnect and rebuilt.

Operations are idempotent. Unsubscribe removes latest-state rows for those tokens.

## Ticks

Parser (`stream/kite-binary-parser.ts`) validates frame bounds. One bad packet is logged (`market_stream_parse_error`, throttled) and skipped; the socket stays up.

Missing optional fields are `null`, never invented `0`.

Unknown tokens (`UNKNOWN_INSTRUMENT_TOKEN`) are not auto-created. The token → instrument map is an in-memory index refreshed from the Phase 3 master at stream start (no Prisma per tick).

## Latest state, order, dedup, stale

- Store: `instrumentToken → MarketTick` (O(1)).
- Order: prefer exchange timestamp (FULL); otherwise `receivedAt`. Older ticks do not overwrite.
- Dedup: identical `orderKey` (`token|exchangeTs|lastPrice|volume|mode`). Same last price with a newer event is **not** dropped.
- Stale: `now - receivedAt > MARKET_TICK_STALE_MS`. API returns `stale: true` with the last real price — never `lastPrice: 0`.

## Event dispatch / backpressure

- Socket thread: parse → index lookup → store.update → `bus.emitTick` (no `await` consumers).
- Bus: latest-value-wins **per token** until the next `setImmediate` flush.
- Latest store sees every **applied** tick.
- Consumers see coalesced ticks. A consumer that needs every print needs a future dedicated queue.
- Handler throws are isolated (`market_stream_consumer_error`).

## Persistence

`MARKET_SNAPSHOT_INTERVAL_MS=0` (default) disables the timer. `POST /api/market/stream/snapshots` writes **current** latest rows only. Persistence errors are logged and do not stop the stream.

## APIs

| Method | Path |
| --- | --- |
| GET | `/api/market/stream/status` |
| POST | `/api/market/stream/start` |
| POST | `/api/market/stream/stop` |
| GET/POST/DELETE | `/api/market/stream/subscriptions` |
| GET | `/api/market/stream/latest` |
| GET | `/api/market/stream/latest/:instrumentToken` |
| POST | `/api/market/stream/snapshots` |

Bodies: Zod. Not a raw Kite WS proxy.

Phase 3 REST `/api/market/ltp` and `/quotes` remain.

## Health

`GET /api/health` adds `marketStream` (`state`, `connected`, `receiving`, `running`). `ok` still follows **database** availability only. A stopped stream does not make the API unhealthy.

## Manual checks

Mock:

```bash
cd apps/api
PERSISTENCE_MODE=mock npm run dev
```

1. Sync instruments (`POST /api/market/instruments/sync`).
2. `POST /api/market/stream/start`
3. `POST /api/market/stream/subscriptions` `{ "instrumentTokens": ["2885","408065"], "mode": "LTP" }`
4. `GET /api/market/stream/status` → `CONNECTED` / `receiving`
5. `GET /api/market/stream/latest/2885`
6. Unsubscribe one token; confirm it leaves latest.
7. `POST /stop` then `start`; subscriptions restore from desired set.

Real Kite: authenticate, start, subscribe **two** NSE tokens only, confirm ticks, confirm `placeOrder` still throws. Do not subscribe the whole universe.

## Why ticks are not all persisted

The live tape is high frequency. PostgreSQL is for controlled observations (Phase 3 quotes, optional cadence). Phase 4 keeps current prices in memory for future scanners.
