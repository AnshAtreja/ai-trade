# Phase 19 — Full Shadow Trading

**Status:** `planned`

## Goal

Run the full TradePilot decision pipeline on live NSE data for an extended period while guaranteeing `Kite order = NEVER`.

## In scope

- Shadow session runner.
- Decision journal.
- Simulated execution.
- Comparisons:
  - backtest
  - walk-forward
  - paper
  - shadow
- Model drift and execution-assumption monitoring.

## Out of scope

- Live broker order placement.
- Relaxing kill-switch or authorization rules.

## Depends on

Phase 18.

## Key modules / paths

- `apps/api/src/modules/shadow-trading/ (to create)`
- `apps/web Shadow & Live page`

## Acceptance checks

- [ ] Zero live orders in shadow mode.
- [ ] Shadow reports are comparable to backtest/walk-forward/paper.
- [ ] Divergences are recorded and explainable.

## Notes

This is a major validation phase, not a checkbox.
