# Phase 13 — Portfolio & Capital Allocation Engine

**Status:** `planned`

## Goal

Evaluate candidate trades at the portfolio level instead of treating each setup as an independent bet.

## In scope

- Risk budgeting:
  - equity
  - available capital
  - daily risk remaining
  - open risk
  - maximum exposure
- Candidate competition across multiple setups.
- Sector exposure controls.
- Correlation risk using rolling historical correlation or exposure awareness.
- Direction and market exposure controls.
- Capital allocation output:
  - `APPROVE`
  - `REDUCE`
  - `SKIP`
- Deterministic quantity proposals.

## Out of scope

- Adaptive confidence sizing, except as a future input.
- Live broker order submission.
- LLM override of allocation.

## Depends on

Phases 8–12.

## Key modules / paths

- `apps/api/src/modules/portfolio-allocation/ (to create)`
- `apps/api/src/modules/risk/`

## Acceptance checks

- [ ] Multiple candidates compete against shared capital/risk budgets.
- [ ] Sector concentration is detected.
- [ ] Same-direction crowding is detected.
- [ ] Output is deterministic for identical inputs.

## Notes

This phase prevents correlated trades from masquerading as independent opportunities.
