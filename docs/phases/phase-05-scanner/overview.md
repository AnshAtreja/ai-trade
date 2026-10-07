# Phase 05 — Production market scanner

**Status:** `done`

## Goal

Reduce the tradable equity universe into a ranked set of **candidate** instruments for later strategy evaluation. Not a trading decision system.

## Implemented

- `ProductionScannerService` over `InstrumentUniverseService` + `LatestMarketStateStore`
- NSE session helper (`market-session.ts`)
- Feature calculator with explicit `UNAVAILABLE` / `UNKNOWN` (no fake RVOL)
- Filters: price, liquidity, stale, volatility
- Explainable score components + direction + reasons
- Top-N + min-score ranking; run-scoped `ScannerSignal` persistence (no history overwrite)
- Single-flight scheduler (`POST /start`/`stop`); manual `POST /run`
- Legacy mock intraday engine/pipeline kept for compatibility
- Docs: [scanner.md](../scanner.md)

## Out of scope

- Strategy decisions (Phase 6)
- Kronos / LLM / RAG / news
- Live or paper order placement from scanner
- Multi-day historical factors (Phase 8)

## Acceptance

- [x] Consumes universe + in-memory market state (no per-stock REST scan loop)
- [x] Candidates include score, components, reasons
- [x] Stale/missing data excluded with stats
- [x] No overlapping full scans
- [x] No Kite order methods invoked
- [x] Matching Scanner page uses production `/api/scanner/*` (status, latest, run) — not only the mock pipeline

## Depends on

Phases 3–4
