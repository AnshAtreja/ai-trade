# Phase 18 — Telegram / Control Plane

**Status:** `planned`

## Goal

Expose authenticated operational visibility and controls through Telegram after the decision engine and reasoning layers exist.

## In scope

- Notifications:
  - trade candidates
  - approved/rejected decisions
  - reasons
  - risk
  - portfolio
  - P&L
  - system health
  - kill switch
  - daily report
- Potential commands:
  - `/status`
  - `/positions`
  - `/risk`
  - `/candidates`
  - `/why`
  - `/pause`
  - `/resume`
  - `/kill`
- Authorization and audit design.

## Out of scope

- Unauthenticated controls.
- Direct order submission that bypasses decision/risk/order infrastructure.

## Depends on

Phases 16–17.

## Key modules / paths

- `apps/api/src/modules/control-plane/ (to create)`
- `apps/api/src/modules/notifications/ (to create)`

## Acceptance checks

- [ ] Every command is authorized.
- [ ] Kill/pause commands are auditable.
- [ ] Messages include enough context for operator decisions.

## Notes

Telegram is an interface, not a trading brain.
