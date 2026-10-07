# Phase 01 — Foundation & persistence

**Status:** `done`

## Goal

Persist paper capital, risk config, trades/positions, and immutable AccountSnapshots. Derive current AccountState on read.

## Implemented

- Prisma schema + memory/Prisma repositories (`PERSISTENCE_MODE=mock|database`)
- PaperAccount as authoritative starting capital after init
- AccountState formulas (equity, exposure, day PnL, daily-loss block)
- Risk validation hooked into paper `createTrade`
- Initial `ScannerSignal` model (candidate persistence primitive)
- Live `placeOrder` / `modifyOrder` / `cancelOrder` disabled on Kite adapter

## Out of scope (deferred)

- Real Kite funds (Phase 2)
- WebSocket tape (Phase 4)
- Production scanner ranking (Phase 5)

## Key modules

- `apps/api/src/modules/account-state/`
- `apps/api/src/modules/paper-trading/`
- `apps/api/src/modules/risk/`
- `apps/api/prisma/`

## Reference

- [paper-account-state.md](../reference/paper-account-state.md)
