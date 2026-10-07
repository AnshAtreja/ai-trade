# Phase 04 — Real-time market pipeline

**Status:** `done`

## Goal

In-process Kite WebSocket pipeline: connect, subscribe, normalize ticks, latest-state store, event bus.

## Implemented

- `MarketStreamProvider` (Kite + Mock) reusing `KiteBrokerAdapter.openMarketWebSocket`
- Connection manager with exponential backoff; subscription desired/actual reconcile
- Modes `LTP` / `QUOTE` / `FULL` (default LTP)
- Binary parser with bounds checks; unknown tokens logged, not invented
- `LatestMarketStateStore`, ordering/dedup, stale detection
- `MarketTickEventBus` latest-value-wins; consumer isolation
- Optional snapshot cadence (default off); no per-tick Postgres writes
- APIs under `/api/market/stream/*`; health `marketStream` block

## Out of scope

- Persisting every tick
- Scanner candidate generation (Phase 5)

## Reference

- [market-stream.md](../reference/market-stream.md)
