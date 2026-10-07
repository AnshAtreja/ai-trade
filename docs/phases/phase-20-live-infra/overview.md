# Phase 20 — Live Kite Execution Infrastructure

**Status:** `planned`

## Goal

Introduce actual broker-write infrastructure only after shadow validation and a fresh regulatory/broker requirement review.

## In scope

- Order Manager.
- Kite order adapter.
- Order reconciliation.
- Idempotency.
- Broker state recovery.
- Execution monitoring.
- Compliance and broker requirement checklist.

## Out of scope

- Broad live trading.
- Unbounded automation.
- LLM direct order authority.

## Depends on

Phase 19 proven.

## Key modules / paths

- `apps/api/src/modules/orders/`
- `apps/api/src/modules/live-execution/ (to create)`

## Acceptance checks

- [ ] Idempotent submit.
- [ ] Disconnect recovery tested.
- [ ] Compliance checklist documented.
- [ ] Kill switch gates live placement.

## Notes

Current Indian regulatory and broker requirements should be checked at this phase, not frozen too early.
