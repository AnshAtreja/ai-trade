# Phase 11 — Meta-Labeling / Setup Quality Model

**Status:** `planned`

## Goal

Keep deterministic strategies responsible for finding setups, then use a calibrated setup-quality model to estimate whether a setup should be taken.

## In scope

- Feature vector construction from:
  - strategy setup features
  - regime
  - VWAP context
  - volume
  - relative strength
  - sector context
  - market breadth
  - Kronos outputs, if accepted
  - time-of-day
- Calibrated probability output such as `P(success)`.
- No-trade model for avoiding otherwise valid setups during:
  - bad regime
  - abnormal volatility
  - poor liquidity
  - excessive spread
  - event risk
  - weak breadth
  - conflicting market context
- Ablation:
  - strategy
  - strategy + regime
  - strategy + context
  - strategy + Kronos
  - strategy + meta-label
  - strategy + everything

## Out of scope

- Replacing deterministic strategy detection.
- Arbitrary hand-picked thresholds without validation.
- Live order placement.
- LLM decision authority.

## Depends on

Phases 8–10.

## Key modules / paths

- `apps/api/src/modules/setup-quality/ (to create)`
- `apps/api/src/modules/scanner/replay/` for historical labels and evaluations

## Acceptance checks

- [ ] The model receives only information available at setup time.
- [ ] Confidence is calibrated.
- [ ] No-trade outputs are explainable and measurable.
- [ ] Ablation shows what each component contributes.

## Notes

The model asks "should we actually take this setup?" It does not discover setups from scratch.
