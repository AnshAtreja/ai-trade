# Strategies tab

**Route:** `/strategies` · **Source:** [`strategies-page.tsx`](../../apps/web/src/pages/strategies-page.tsx)

Deterministic strategy engine (Phase 6). Outputs are **setups** (analytical), not broker orders.

## What this tab is for

- See which strategies are registered and enabled
- Force an evaluation pass with **Evaluate now**
- Inspect latest `SETUP_DETECTED` rows (entry / stop / target / R:R)
- Open **Details** for conditions and reasons
- Browse persisted historical setups

## Controls

| Control | API | What happens |
| --- | --- | --- |
| **Evaluate now** | `POST /api/strategies/evaluate` with `{ force: true }` | Runs strategy evaluation against current scanner candidates (when available). Bypasses closed-session skips for diagnostics. Refreshes status, latest setups, and persisted list |
| **Details** (per setup row) | None (UI state) | Opens the detail panel for that setup’s reasons + pass/fail conditions |
| **Close** | None | Hides the detail panel |

## Status fields

| Field | Meaning |
| --- | --- |
| **Lifecycle** | Engine lifecycle |
| **Market session** | Session used for evaluation rules |
| **Scheduler** | Background strategy scheduler on/off |
| **Enabled** | Comma-separated enabled strategy IDs |

## Tables

1. **Registered strategies** — id, name, version, enabled, allowed sessions  
2. **Latest detected setups** — live evaluation output (`SETUP_DETECTED`)  
3. **Persisted strategy setups** — historical rows saved from detected setups  

Empty latest setups → run Scanner first, then **Evaluate now**.

## Relation to paper

Strategy setups can later feed **auto paper execution** when `PAPER_AUTO_EXECUTION` is enabled server-side. The Strategies tab itself never calls Kite order APIs.

## Does not

- Send live orders
- Create paper fills by itself (Paper / execution module does)
- Replace the scanner — it **consumes** scanner candidates
