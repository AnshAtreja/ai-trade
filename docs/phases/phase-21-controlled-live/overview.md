# Phase 21 — Controlled Live Trading

**Status:** `planned`

## Goal

Enable real trading only under very tight, evidence-based constraints.

## In scope

- Small capital.
- Small risk.
- Limited symbols.
- Limited strategies.
- Limited daily trades.
- Hard kill switch.
- Live-vs-expected comparisons:
  - expected fill vs actual fill
  - expected slippage vs actual slippage
  - backtest distribution vs live distribution

## Out of scope

- Automatic scaling.
- Unbounded automation.
- Disabling hard safety limits.

## Depends on

Phase 20.

## Key modules / paths

- `apps/api/src/modules/live-execution/`
- `docs/operations/ (to create if needed)`

## Acceptance checks

- [ ] Live path remains kill-switchable.
- [ ] Limits are enforced server-side.
- [ ] Scaling decisions are based on evidence.

## Notes

Scaling is a decision, not a roadmap default.
