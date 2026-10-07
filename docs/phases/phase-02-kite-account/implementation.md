# Phase 02 Implementation — Real Kite Account State

**Status:** COMPLETE

## What was built

`BrokerAccountProvider` separates account observation from transport. `KiteAccountProvider` uses the existing `KiteBrokerAdapter` and `KiteTokenStore`; `MockBrokerAccountProvider` keeps tests and local development deterministic. The API exposes refresh and account-read endpoints under `/api/kite/account`.

Account observations are stored as immutable `BrokerAccountSnapshot` records, with a summary `AccountSnapshot` for application consumers. A `LIVE` trading mode in this context describes the broker account being observed; it does not authorize writes.

## Reliability decisions

- Refreshes are throttled to avoid repeated broker calls.
- One failed account section does not erase successful sections.
- Error messages are sanitized before returning to clients.
- Health separates configuration, authentication, and account readability.

## Main code areas

- `apps/api/src/modules/broker/account/`
- `apps/api/src/modules/broker/adapters/`
- `apps/api/src/db/broker-credentials/`

## Known limitations

Account state is refreshed on demand. Background polling and paper-ledger reconciliation are later concerns.
