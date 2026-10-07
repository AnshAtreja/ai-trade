# Phase 01 Implementation — Foundation & Persistence

**Status:** COMPLETE

## What was built

The API gained Prisma-backed and in-memory repository implementations selected by `PERSISTENCE_MODE`. `PaperAccount` became the authoritative source for initialized starting capital, while `AccountState` is derived on read from account, orders, positions, and trades. This prevents the common error of assuming capital is always `100000` after startup.

Risk validation is connected to paper-trade creation. The initial `ScannerSignal` model provides a durable candidate record without turning a scanner signal into an order.

## Important boundaries

- PostgreSQL is the durable store when database persistence is enabled.
- In-memory repositories support local development and isolated tests.
- Account snapshots are immutable observations; current state is calculated from domain records.
- Kite `placeOrder`, `modifyOrder`, and `cancelOrder` remain disabled.

## Main code areas

- `apps/api/src/modules/account-state/`
- `apps/api/src/modules/paper-trading/`
- `apps/api/src/modules/risk/`
- `apps/api/prisma/`

## Verification

Repository, account-state, risk, and persistence tests are part of the API suite. Database-backed behavior is verified separately when PostgreSQL is available.

## Known limitations

This phase does not observe a real broker account and does not stream market data. Those concerns are deliberately introduced later.
