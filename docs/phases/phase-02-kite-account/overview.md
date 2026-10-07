# Phase 02 — Real Kite account state

**Status:** `done`

## Goal

Observe the real Zerodha account (profile, margins, positions, orders, holdings). Read-only; no order routing.

## Implemented

- `BrokerAccountProvider` (`KiteAccountProvider` + `MockBrokerAccountProvider`)
- `POST /api/kite/account/refresh`, `GET /api/kite/account*`
- Immutable `BrokerAccountSnapshot` + summary `AccountSnapshot` (`tradingMode=LIVE` = context only)
- Throttled refresh, partial section errors, sanitized messages
- Health: `kite.configured` / `authenticated` / `accountReadable`
- Reuses `KiteBrokerAdapter` + `KiteTokenStore` (no second HTTP client)

## Out of scope

- Live order placement
- Background polling
- Merging Kite positions into paper ledger

## Reference

- [kite-account-state.md](../reference/kite-account-state.md)
