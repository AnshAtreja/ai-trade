# Historical market data + replay (Phase 8A/8B/8C)

Reusable historical OHLCV foundation and deterministic replay path. **No backtest trade simulation, no P&L metrics, no live orders.**

## Architecture

```text
KiteBrokerAdapter.getHistoricalCandlesByToken
        │
        ▼
HistoricalMarketDataProvider  (Kite | Mock)
        │
        ▼
HistoricalCandleDownloader (chunk + throttle + retry)
        │
        ▼
HistoricalCandleRepository (memory | Prisma)
        │
        ▼
PostgreSQL HistoricalCandle / in-memory Map
```

Future backtests must depend on `HistoricalMarketDataProvider` / `HistoricalMarketDataService`, not on Kite HTTP.

## Historical replay (Phase 8B)

```text
Historical DB candles
        │
        ▼
HistoricalReplayClock
        │
        ▼
HistoricalMarketStateAdapter → LatestMarketStateStore interface
        │
        ▼
ProductionScannerService
        │
        ▼
StrategyEngineService + existing strategy registry
        │
        ▼
Structured HistoricalReplayResult
```

Replay advances one historical candle at a time in chronological order. For multi-instrument runs, events are ordered by timestamp and then instrument token. At replay timestamp `T`, scanner and strategy contexts only contain candles/ticks already applied by the replay clock.

Missing candles are emitted as `DATA_GAP` events. Duplicate historical timestamps are emitted as `DUPLICATE_CANDLE` events and skipped. The replay engine does not forward-fill, interpolate, or invent candles.

Phase 8C adds an isolated in-memory historical-paper executor. It creates orders from detected setups after candle T and makes them eligible from T+1, reusing Phase 7 deterministic fill, slippage, charge, and conservative exit primitives. It does not write operational paper-account records, call Kite order APIs, or calculate evaluative portfolio metrics.

```bash
npm run backtest:execute --workspace api -- \
  --token 738561 \
  --from 2026-09-15T03:45:00.000Z \
  --to 2026-09-15T10:00:00.000Z \
  --interval 1m \
  --starting-capital 100000
```

OHLC ambiguity is resolved conservatively: when stop and target are both touched inside one bar, the adverse stop result is selected. Gaps never receive fabricated prices; open positions are marked `INCOMPLETE_DATA` when the dataset does not establish a true session square-off.

Phase 8D adds a pure analytics pass over that execution output:

```bash
npm run backtest:analyze --workspace api -- \
  --token 738561 \
  --from 2026-09-15T03:45:00.000Z \
  --to 2026-09-15T10:00:00.000Z \
  --interval 1m \
  --starting-capital 100000
```

Outcome metrics use closed trades only; `grossLoss` and the largest losing trade retain negative signs. Daily returns use Asia/Kolkata dates. A partial session/data gap is retained as a diagnostic, and Sharpe/Sortino are unavailable rather than annualized from an inadequate sample.

## Dataset readiness

The Phase 8A subsystem now has a versioned local NSE cash-equity calendar (`NSE_CASH_2025_2026_V2`) reconciled against NSE's official Capital Market / Equities holiday publications. It is explicitly scoped to `NSE`, `CASH_EQUITY`, and `Asia/Kolkata`; ordinary weekends remain `WEEKEND`, weekday closures remain `HOLIDAY`, and dates outside the supported range are `UNKNOWN`. The V2 calendar adds the authoritative Sunday, 2026-02-01 Union Budget live session from `09:15` to `15:30` IST under `NSE/CMTR/72349`, Circular Ref. 11/2026 dated 2026-01-16. Its 09:00–09:08 pre-open is metadata only. The current implementation derives normal-session candle counts from 09:15–15:30 IST; this is not a valid universal assumption after the introduction of CAS for eligible instruments.

**Research-readiness limitation (2026-09-18):** the [Phase 8D.5 closing-window investigation](investigations/phase-8d5-closing-window.md) traced RELIANCE through raw HTTP, normalization, and storage: all contain 360 continuous-session minute candles ending at 15:14 IST. Narrow closing-window reads return no candles. NSE/Kite's documented Closing Auction Session explains the cutoff for eligible equities from 2026-08-03. The calendar now consumes the versioned instrument session policy for dataset validation and replay gap generation. The policy uses explicit `ELIGIBLE`, `NOT_ELIGIBLE`, and `UNKNOWN` states. Current/live diagnostics may use the synchronized instrument master, but historical validation and replay use the deterministic effective-dated eligibility dataset and never fall back to current NFO membership. Preserve the stored rows and do not globally reduce all sessions to 360 candles.

### Instrument session policy

`NseCashInstrumentSessionPolicy` is separate from `ExchangeTradingCalendar`. The calendar determines whether an exchange date is available; the session policy determines the instrument's continuous session for that date. `NSE_CASH_2025_2026_V2` covers 2025 and 2026 using NSE Capital Market holiday sources plus the February 1, 2026 special-session circular. After `2026-08-03`, an eligible CAS instrument has continuous candles from `09:15` to `15:15` IST and a separate auction-session descriptor from `15:15` to `15:35`. Non-CAS instruments retain `09:15` to `15:30`. Auction periods are metadata only; no auction candles are synthesized.

Dataset manifests include `sessionPolicyVersion`, `eligibilityDatasetVersion`, `casEffectiveDate`, and per-instrument eligibility metadata. Research session classification is interval-aware: `COMPLETE`, `INCOMPLETE`, `MISSING`, or `UNKNOWN_POLICY`. The classification is derived from canonical candles, calendar V2, the session-policy version, and the CAS eligibility dataset. It is not a destructive filter and does not change canonical dataset IDs. Historical CAS V2 is populated for the frozen 25-instrument research universe over its supported interval; future universes still require their own dated eligibility evidence.

`HistoricalMarketDataService.getCandles()` is deliberately a raw persisted-observation accessor. Research consumers must use `getResearchCandles({ ..., requireCompleteSession })` and make the completeness choice explicit. With `requireCompleteSession: true`, incomplete sessions return no research candles and an explicit `DATA_GAP` rejection; missing sessions return `MISSING_SESSION`; unknown boundaries return `UNKNOWN_SESSION_POLICY`. With `false`, incomplete sessions may be consumed with their `INCOMPLETE` metadata. Missing and unknown-policy sessions remain ineligible in either mode. Holiday rows returned by the provider are raw observations, not policy-valid research candles, and are excluded from this research view without deletion.

Phase 8B replay remains compatible because it continues to consume stored candles and the same historical session policy; Phase 8E should request `requireCompleteSession: true` for continuous intraday strategy evaluation. Replay itself is not run or changed by the research eligibility contract.

2025-10-21 is represented as an authoritative `SPECIAL_SESSION` from `13:45` to `14:45` IST under NSE/CMTR/70319; validators use that 60-minute normal-market window rather than ordinary session hours. 2026-11-08 remains `SPECIAL_SESSION_TIMES_UNKNOWN` until NSE publishes its timing circular. Calendar metadata is local and versioned, so replay and validation do not depend on a live NSE request.

2026-02-01 is represented as an authoritative `SPECIAL_SESSION` from `09:15` to `15:30` IST under NSE/CMTR/72349, Circular Ref. 11/2026. The pre-open and other ancillary sessions are not OHLCV continuous-session candles. Raw observations on other dates excluded by the calendar remain diagnostics until separately supported by authoritative Capital Market evidence.

### Phase 8D.5 research dataset handoff (complete)

Frozen canonical dataset: `NSE_EQ_RESEARCH_UNIVERSE_2026_V1`, manifest `feaabc0198432edc`, range `[2025-09-18T03:45:00.000Z, 2026-09-18T03:45:00.000Z)`, calendar `NSE_CASH_2025_2026_V2`, CAS dataset `NSE_CAS_ELIGIBILITY_2026_V2`.

- 1m: `505dca3f27301e72`, 2,258,180 / 2,258,250, 99.996900%, 6,053 complete and 22 incomplete sessions.
- 5m: `535e2347e56143d9`, 451,646 / 451,650, 99.999114%, 6,074 complete and 1 incomplete session.
- No expected session is completely missing.
- Known provider gaps remain visible: HINDUNILVR on 2025-12-05; the cross-instrument 2025-12-15 cluster; and KOTAKBANK/APOLLOHOSP on 2026-04-22.
- No candles are synthesized, interpolated, forward-filled, or adjusted by this contract.
- Raw provider observations on 2026-02-19, 2026-03-19, 2026-04-01, and 2026-08-26 remain stored diagnostics and are excluded from policy-valid research views because those dates are calendar holidays.
- The universe is current-universe selected and carries survivorship bias; corporate-action adjustment remains `UNKNOWN` and requires review before any stronger inference.

### Phase 8E input contract (handoff only)

Phase 8E receives the canonical dataset IDs above, frozen universe `NSE_EQ_RESEARCH_UNIVERSE_2026_V1` / manifest `feaabc0198432edc`, the exact research period, calendar/session/CAS versions, the requested interval, and an explicit `requireCompleteSession` value. The baseline for continuous intraday strategy evaluation is `true`. No synthetic candles are permitted. Transaction-cost assumptions are supplied by the execution layer. Phase 8E must not alter this contract after inspecting strategy results.

```bash
npm run historical:dataset-validate --workspace api -- --tokens 738561,12345 --from 2026-01-01T03:45:00.000Z --to 2026-02-01T10:00:00.000Z
npm run historical:bulk-download --workspace api -- --tokens 738561,12345 --from 2026-01-01T03:45:00.000Z --to 2026-02-01T10:00:00.000Z
```

Bulk downloads run sequentially, preserve existing throttling/retries, isolate instrument failures, and skip ranges whose sessions are already complete. The manifest dataset ID excludes generation time; `generatedAt` is informational only. The calendar must be reviewed and versioned again before a dataset crosses into another calendar year.

## Database model

`HistoricalCandle`:

- Unique key: `(instrumentToken, interval, timestamp)`
- Indexes: instrument+interval+timestamp, timestamp+interval, exchange+symbol+interval+timestamp
- Prices/volume: `Decimal` columns (same conventions as other market tables)
- Optional FK `instrumentId` → `Instrument`
- `source`: `KITE` | `MOCK` | `DERIVED_5M`
- `adjustment`: `UNADJUSTED` | `ADJUSTED` | `UNKNOWN` (Phase 8A default for Kite: `UNKNOWN`)

### Idempotency

Default write path is **insert-only** (`createMany` + `skipDuplicates` / memory skip).

Re-fetching the same candle does **not** silently overwrite OHLC.

Optional `reconcile=true` on download updates existing rows deliberately.

## Provider abstraction

`HistoricalMarketDataProvider`:

- `fetchCandles` / `fetchRange` — remote/source fetch for `[from, to)`
- `getStoredCandles` — repository only (local replay)
- `validateRange` — integrity report, no fabrication

Implementations:

- `KiteHistoricalMarketDataProvider` — uses existing `KiteBrokerAdapter` (no second Kite client)
- `MockHistoricalMarketDataProvider` — deterministic fixtures

## Download flow

1. Resolve instrument metadata from instrument master when available.
2. Split `[from, to)` into configurable chunks (`HISTORICAL_CHUNK_DAYS_1M`, overlap minutes).
3. Throttle between requests (`HISTORICAL_THROTTLE_MS`, default 400ms — conservative vs documented ~3 req/s).
4. Retry transient/`429` with backoff; fail fast on auth/malformed.
5. Persist idempotently.
6. Optionally derive+persist 5m from 1m (`HISTORICAL_PERSIST_DERIVED_5M`).

## Timestamp semantics

- Stored `timestamp` = candle **open/start** as UTC `DateTime`.
- Exchange session interpretation uses `Asia/Kolkata` helpers (`market-session`, `trading-date`).
- Kite request params are formatted as Kolkata wall-clock strings.

### Range convention (critical for no look-ahead)

All stored queries use **half-open** ranges:

**`[from, to)` — `to` is exclusive.**

A caller asking for candles “available up to T” must pass `to = T` and will never receive `timestamp >= T`.

## Missing-data semantics

Validation distinguishes:

| Kind | Meaning |
| --- | --- |
| `EXPECTED_SESSION_GAP` | Weekend / non-trading session minute |
| `MISSING_CANDLE` | Expected trading-session minute absent |
| `INVALID_*` | Bad OHLC/volume/alignment/duplicates |

**No forward-fill, interpolation, or fabricated candles.**

### Calendar limitation

The lower-level legacy candle validator still uses market-session state and is not the authoritative calendar-aware dataset completeness report. Use `historical:dataset-validate` for holiday-aware session coverage and explicit unknown/special-session diagnostics.

## 1m → 5m aggregation

`aggregateOneMinuteToFiveMinute`:

- first open, max high, min low, last close, summed volume
- OI = last non-null in bucket
- bucket alignment shares `common/utils/candle-buckets` with Phase 6 live aggregator
- incomplete trailing buckets omitted by default (`includeIncomplete=false`)

Do **not** download 5m from Kite for Phase 8A; derive from stored 1m.

## Adjustment semantics

Phase 8A stores the **source representation** as returned. Kite-sourced rows are tagged `adjustment=UNKNOWN` because corporate-action handling is not locally asserted. No local CA adjustment is applied. Survivorship bias is out of scope.

## API

Mounted at `/api/backtest/historical`:

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/coverage` | Coverage summary (+ optional missing ranges when from/to provided) |
| GET | `/candles` | Stored (or derived 5m) candles for `[from, to)` |
| POST | `/download` | Chunked download + persist (1m only) |
| POST | `/validate` | Validation report |

Not a generic unauthenticated Kite proxy.

## CLI

```bash
npm run historical:coverage --workspace api
npm run historical:download --workspace api -- --token 738561 --from 2026-09-10T03:45:00.000Z --to 2026-09-10T10:00:00.000Z
npm run historical:validate --workspace api -- --token 738561 --from ... --to ...
npm run backtest:replay --workspace api -- --token 738561 --from 2026-09-15T03:45:00.000Z --to 2026-09-15T10:00:00.000Z --interval 1m
```

## Configuration

See `.env.example` (`HISTORICAL_*`). Defaults are safe for mock mode.

Set `HISTORICAL_PROVIDER=kite` only when authenticated Kite session exists.

## Safety

This module never calls `placeOrder` / `modifyOrder` / `cancelOrder`. Live order methods remain disabled on `KiteBrokerAdapter`.

## Out of scope (later phases)

Trade simulation, walk-forward, portfolio sim, P&L/profitability analytics, Kronos/LLM/RAG/news/Telegram, live trading, strategy changes.
