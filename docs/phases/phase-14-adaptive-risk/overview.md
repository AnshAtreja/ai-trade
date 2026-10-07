# Phase 14 — Adaptive Risk Engine

**Status:** `planned`

## Goal

Adapt risk according to market and portfolio stress while keeping deterministic hard limits authoritative.

## In scope

- Dynamic risk scaling research:
  - normal volatility
  - elevated volatility
  - moderate drawdown
  - severe drawdown
  - daily stop
- Confidence-aware sizing after probability calibration.
- Fractional Kelly research with hard caps.
- Drawdown protection.
- Kill-switch conditions:
  - daily loss exceeded
  - abnormal data
  - broker state inconsistent
  - market data stale
  - extreme volatility
  - execution divergence

## Out of scope

- Unconstrained model-selected risk.
- Live order placement.
- Replacing existing hard risk limits.

## Depends on

Phases 11 and 13.

## Key modules / paths

- `apps/api/src/modules/adaptive-risk/ (to create)`
- `apps/api/src/modules/risk/`

## Acceptance checks

- [ ] Hard risk ceilings always win.
- [ ] Risk scaling is deterministic and explainable.
- [ ] Kill-switch conditions block new trades.
- [ ] Confidence-aware sizing is used only after calibration exists.

## Notes

This phase changes risk sizing, not candidate discovery.
