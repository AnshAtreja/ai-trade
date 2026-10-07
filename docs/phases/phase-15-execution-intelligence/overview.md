# Phase 15 — Execution Intelligence

**Status:** `planned`

## Goal

Estimate whether a valid signal is still worth trading after realistic execution costs and liquidity constraints.

## In scope

- Expected edge vs:
  - spread
  - slippage
  - charges
  - market impact
  - liquidity
  - partial fills
  - entry timing
- Market vs limit research.
- Execution-cost model inputs for the unified decision engine.

## Out of scope

- Live Kite order placement.
- Portfolio allocation.
- LLM decision authority.

## Depends on

Phases 8C, 8D, 13, and 14.

## Key modules / paths

- `apps/api/src/modules/execution-intelligence/ (to create)`
- `apps/api/src/modules/scanner/replay/historical-paper-execution.ts`

## Acceptance checks

- [ ] Execution-cost estimates are deterministic.
- [ ] Costs can reduce or skip a candidate.
- [ ] Historical evaluation uses only information available at the simulated time.
- [ ] The model distinguishes gross edge from net expected edge.

## Notes

A correct setup can still be a bad trade if execution cost consumes the edge.
