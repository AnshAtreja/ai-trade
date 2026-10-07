# Phase 06 — Strategy engine

**Status:** `done`

## Goal

Convert scanner candidates + market context into structured, versioned, explainable **strategy setups**. Analytical only — no orders, no risk sizing, no AI.

## In scope

- Strategy interface + registry (enable/disable, versions)
- Breakout / Breakdown / Momentum / Opening Momentum v1
- Bounded tick history + 1m/5m candle aggregator
- Entry / stop / target / reward-risk with invalidation
- Explicit conditions + reasons + deterministic setup identity
- Persist `SETUP_DETECTED` to `StrategySetup`
- APIs: list, status, evaluate, start/stop scheduler, signals
- Session + stale-data guards

## Out of scope

- Kronos / LLM / RAG / news
- Live or automatic paper execution
- Position sizing / daily loss / capital checks (Risk Engine)
- Unified Decision Engine (Phase 16)

## Depends on

Phases 1–5

## Key modules / paths

- `apps/api/src/modules/strategies/`
- `docs/strategies.md`
- Prisma `StrategySetup`

## Acceptance checks

- [x] Multiple strategies evaluate the same candidate independently
- [x] Versioned strategies (`*:v1`)
- [x] Conditions + reasons explainable and deterministic
- [x] Entry/stop/target/RR when setup detected; invalid when stop/RR fail
- [x] Stale / missing data / session restrictions enforced
- [x] Meaningful setups persisted; NO_SETUP not spam-persisted
- [x] No order/account mutation; no AI
- [x] Tests + `tsc --noEmit` green
- [x] Matching Strategies page in `apps/web` wired to list/status/evaluate/signals (not a PhaseSkeleton)

## Notes

Reference: [docs/strategies.md](../strategies.md)

Earlier API-only “done” left the Strategies dashboard on `PhaseSkeleton` — that handoff gap is closed; phase completion now requires the web page.
