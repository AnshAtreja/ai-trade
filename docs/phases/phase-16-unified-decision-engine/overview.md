# Phase 16 — Unified Decision Engine

**Status:** `planned`

## Goal

Fuse all approved decision inputs into a deterministic gate that returns `APPROVE`, `REDUCE`, or `SKIP`.

## In scope

- Inputs:
  - strategy setup candidate
  - regime
  - relative strength
  - market/sector context
  - Kronos, if accepted by ablation
  - news/RAG event risk
  - meta-model probability
  - execution-cost model
  - portfolio allocator
  - adaptive risk
- Explainable decision trace.
- Deterministic approval/reduction/skip contract.

## Out of scope

- LLM override of decisions.
- Telegram delivery.
- Live broker submission.

## Depends on

Phases 9–15.

## Key modules / paths

- `apps/api/src/modules/decision-engine/ (to create)`

## Acceptance checks

- [ ] Every decision has a readable reason chain.
- [ ] Risk, allocation, and kill switches can hard-block.
- [ ] LLM output cannot bypass the deterministic gate.
- [ ] Identical inputs produce identical outputs.

## Notes

This is the trading brain. It approves, reduces, or skips; later systems may explain or deliver the result.
