# Phase 10 — Kronos / Financial Time-Series Intelligence

**Status:** `planned`

## Goal

Evaluate Kronos as a separate experimental forecasting layer for NSE OHLCV data. Keep it only if it contributes useful out-of-sample information beyond simple baselines.

## In scope

- Kronos integration:
  - NSE OHLCV -> Kronos input -> forecast
- NSE zero-shot benchmark.
- Baseline comparisons against simple forecasting methods.
- Forecast evaluation:
  - direction
  - return distribution
  - volatility
  - forecast horizon
  - confidence
- Evaluation across:
  - stocks
  - regimes
  - time periods
  - market conditions
- Probability calibration research.
- Ablation gate:
  - baseline strategy
  - baseline + Kronos

## Out of scope

- Direct order placement from model output.
- Replacing the scanner or deterministic strategies.
- Fine-tuning unless zero-shot and baseline results justify it.
- LLM/RAG/news integration.

## Depends on

Phases 8–9.

## Key modules / paths

- `services/kronos/ (to create, if needed)`
- `apps/api/src/modules/kronos/ (to create, if needed)`

## Acceptance checks

- [ ] Forecast outputs are reproducible for fixed inputs.
- [ ] Simple baselines are measured alongside Kronos.
- [ ] Forecast confidence is evaluated and calibration is documented.
- [ ] Kronos is removed or kept based on ablation evidence.

## Notes

Kronos is not assumed valuable. It earns a place only if measured results support it.
