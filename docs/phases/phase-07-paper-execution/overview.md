# Phase 07 — Realistic paper execution

**Status:** `done`

## Goal

Upgrade paper trading into a live-market paper execution simulator: real Kite market data, virtual money, realistic fills/stops/P&L — without live broker orders.

## In scope

- ExecutionProvider abstraction + PaperExecutionProvider
- Spread / slippage / latency / partial fills / liquidity policies
- PaperFill persistence + order lifecycle timestamps
- Stop/target with gap-through + ambiguous exit policy
- Charges proxy, MTM, square-off, stale-data handling
- Idempotency + restart reconciliation
- Strategy-setup bridge gated by `PAPER_AUTO_EXECUTION=false`

## Out of scope

- Live Kite place/modify/cancel
- Backtesting (Phase 8)
- AI / Kronos / LLM

## Depends on

Phases 1–6

## Key modules / paths

- `apps/api/src/modules/paper-trading/execution/`
- `docs/paper-trading.md`
- Migration `20260915120000_phase_7_realistic_paper_execution`

## Acceptance checks

- [x] Uses Phase 4 latest market state with freshness checks
- [x] Partial fills + liquidity policies
- [x] Gap-through stop + ambiguous policy
- [x] No Kite order methods invoked
- [x] Matching Paper Trading page shows execution status + orders (PhaseSkeleton removed)
- [x] Tests + `tsc --noEmit` green

## Notes

Reference: [docs/paper-trading.md](../paper-trading.md)
