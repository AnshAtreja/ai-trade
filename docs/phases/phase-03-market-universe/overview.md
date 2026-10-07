# Phase 03 — Real market universe + REST market data

**Status:** `done`

## Goal

Sync Kite instruments, filter an NSE/BSE cash-equity universe, and serve REST LTP/quotes with optional immutable `MarketSnapshot` rows.

## Implemented

- `InstrumentProvider` (Kite + Mock) + `InstrumentSyncService`
- Identity: `exchange + instrumentToken` preferred; unique `[exchange, symbol]`
- `InstrumentUniverseService.getTradableEquities()` (EQ, cash segment, no ETF/derivatives)
- `MarketDataProvider` batch LTP/quotes via existing adapter
- APIs under `/api/market` (sync, instruments, universe, ltp, quotes, snapshots)
- Mock mode never contacts Kite

## Out of scope

- WebSocket pipeline (Phase 4)
- Scanner ranking (Phase 5)

## Reference

- [instrument-market-data.md](../reference/instrument-market-data.md)
