# Production market scanner (Phase 5)

Scanner signals are **candidate-generation observations**. They are not trade recommendations or order instructions.

```text
InstrumentUniverseService (NSE EQ)
        ↓
LatestMarketStateStore (Phase 4)
        ↓
Feature calculation
        ↓
Filters (price / liquidity / stale / volatility)
        ↓
Score + direction + reasons
        ↓
Top-N candidates → ScannerSignal rows
        ↓
Future Strategy Engine (Phase 6) — **done**; see [strategies.md](./strategies.md)
```

## Purpose

Answer: *which instruments currently look interesting for deeper analysis?*

Do **not** answer buy/sell. Phase 6 strategies decide setups; Phase 7+ may paper-trade; live orders stay disabled.

## Architecture

| Piece | Role |
| --- | --- |
| `ProductionScannerService` | Single-flight scan runs + scheduler |
| `InstrumentUniverseService` | Tradable NSE cash equities |
| `LatestMarketStateStore` | Primary market input (no per-stock REST) |
| `feature-calculator` | Deterministic features; `UNAVAILABLE` / `UNKNOWN` when history missing |
| `filters` | Hard excludes |
| `scoring` | Explainable weighted score 0–100 |
| Legacy `engine` / `pipeline` | Phase 1 mock/intraday helpers kept for compat |

Scanner does **not** open a second Kite WebSocket or place orders.

## Market session

Centralized in `apps/api/src/common/utils/market-session.ts` (Asia/Kolkata):

`PRE_MARKET` → `OPENING` → `REGULAR` → `CLOSING` → `POST_MARKET` → `CLOSED`

Continuous scheduler runs only in `OPENING` / `REGULAR` / `CLOSING`. Manual `POST /run` skips closed sessions unless `{ "force": true }`.

## Features

From latest quote/LTP state:

| Feature | Notes |
| --- | --- |
| `changeFromOpenPercent` | null if open missing |
| `changeFromPreviousClosePercent` | uses quote `close` when present |
| `intradayRangePercent` | (high−low)/open |
| `nearDayHigh` / `nearDayLow` | configurable band |
| `breakingDayHigh` / `breakingDayLow` | tighter tolerance |
| `volumeActivity` | AVAILABLE only if volume present |
| `volumeSpike` | always `UNKNOWN` until multi-day history (Phase 8) |
| `momentumBias` | UP / DOWN / FLAT / UNKNOWN |

No invented average volume, ATR, RSI, or multi-day momentum.

## Filters

Exclude when:

- inactive instrument
- missing / non-positive price (`NO_MARKET_DATA` / `MISSING_PRICE`)
- stale (`dataAgeMs > SCANNER_MAX_DATA_AGE_MS`)
- outside `SCANNER_MIN_PRICE` / `SCANNER_MAX_PRICE`
- volume present but `< SCANNER_MIN_VOLUME`
- volatility outside min/max when range is known

Stale prices are never treated as zero.

## Scoring (max 100)

Configurable weights (defaults):

| Component | Max |
| --- | --- |
| volumeActivity | 25 |
| momentum | 25 |
| rangeExpansion | 20 |
| dayExtremumProximity | 20 |
| priceMovement | 10 |

Direction: bullish evidence (up momentum, near/breaking day high) vs bearish (down, near/breaking day low). Conflict → `NEUTRAL`.

Reasons are emitted only when the matching feature is true (e.g. never claim “volume spike” while `volumeSpike=UNKNOWN`).

## Ranking & persistence

1. Filter → score
2. Keep score ≥ `SCANNER_MIN_SCORE` with ≥1 reason
3. Sort by score, take `SCANNER_MAX_CANDIDATES`
4. Persist each candidate as a `ScannerSignal` with **run-scoped** `dedupeKey` so history is not overwritten

Non-candidates are not written. Run metadata stays in-memory (`GET /api/scanner/runs`).

`marketRegime` is `UNKNOWN` in Phase 5.

## Scheduler

- Default **disabled** (`SCANNER_ENABLED=false`; API does not auto-start on boot)
- `POST /start` / `POST /stop`
- Interval `SCANNER_INTERVAL_MS` (default 60s)
- Single-flight: overlapping ticks are skipped (`scanner_busy`)
- Timers `unref()` so they don’t keep Node alive after shutdown

## APIs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/scanner/status` | lifecycle, session, last run |
| POST | `/api/scanner/start` | start scheduler |
| POST | `/api/scanner/stop` | stop scheduler |
| POST | `/api/scanner/run` | one shot; `{ "force": true }` optional |
| GET | `/api/scanner/runs` | recent in-memory runs |
| GET | `/api/scanner/signals` | persisted signals (Phase 1+) |
| GET | `/api/scanner/signals/latest` | last run candidates |

Legacy routes (`/scans`, `/intraday`, mock pipeline) remain.

## Configuration

See `.env.example`: `SCANNER_*` knobs validated in `apps/api/src/config/env.ts`.

## Mock / test behavior

Deterministic via seeded instruments + `LatestMarketStateStore` ticks. No Kite network. Tests cover features, filters, bullish/bearish/neutral, ranking, stale exclusion, closed session, single-flight, and no order/paper mutation.

## Limitations

- Needs stream (or test store) populated with QUOTE/LTP fields for useful OHLC features
- No historical RVOL / ATR / RSI until Phase 8 datasets
- Does not auto-subscribe the full NSE universe (use Phase 4 subscription manager for a controlled set)
- Does not call LLM / Kronos / strategy engine

## Manual verification

```bash
cd apps/api
PERSISTENCE_MODE=mock npm run dev
```

1. `POST /api/market/instruments/sync`
2. Start stream + subscribe a few tokens (`2885`, `408065`, …)
3. `POST /api/scanner/run` with `{ "force": true }` if outside market hours
4. Inspect candidates / reasons / `GET /api/scanner/signals`
5. `POST /api/scanner/start` then confirm no overlapping runs; `POST /stop`

Real Kite: authenticate, small subscription set only, confirm candidates and that `placeOrder` still throws.
