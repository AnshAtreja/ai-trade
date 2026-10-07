# Phase 17 — LLM + MCP Reasoning

**Status:** `planned`

## Goal

Use an LLM and tool surface for explanation, research, summaries, diagnostics, and operator interaction after deterministic decision contracts exist.

## In scope

- Structured fact inputs:
  - strategy
  - regime
  - Kronos
  - meta probability
  - news
  - portfolio
  - risk
  - execution cost
- Explanation of approval/reduction/skip decisions.
- Research and diagnostic summaries.
- MCP/tool surface for read-only or proposal-only workflows.

## Out of scope

- Direct order placement.
- Bypassing the unified decision engine.
- Inventing facts not present in the decision trace.

## Depends on

Phase 16.

## Key modules / paths

- `apps/api/src/modules/agent/ (to create)`
- `MCP server TBD`

## Acceptance checks

- [ ] Agent output is explanation/proposal only.
- [ ] No broker `placeOrder` tool is exposed.
- [ ] Responses cite structured inputs or retrieved facts.

## Notes

The LLM is useful for reasoning and operator clarity, not direct trading authority.
