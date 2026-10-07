# Agent & Decisions tab

**Route:** `/agent` · **Source:** [`agent-page.tsx`](../../apps/web/src/pages/agent-page.tsx)

## Status

**Roadmap view (Phases 13–17)** — portfolio allocation, adaptive risk, execution intelligence, unified decisions, and LLM/MCP reasoning are planned.

## Planned purpose

- Portfolio allocation, adaptive risk, and execution-cost context feed a unified decision engine
- Unified decision engine fuses strategy, features, Kronos, news, allocation, risk, and execution cost
- Tool-using agent explains decisions and proposes research/diagnostics, never places orders

## Controls today

| Control | Behavior |
| --- | --- |
| None | Phase summaries only; no allocation or decision is run |

Hard rule for later: any “Approve” control must route through Decision + Risk, not straight to Kite.
