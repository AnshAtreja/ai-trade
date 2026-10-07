# Scanner tab

**Route:** `/scanner` · **Source:** [`scanner-page.tsx`](../../apps/web/src/pages/scanner-page.tsx)

Production scanner (Phase 5): ranked **candidates** from the universe + latest market state. These are **not** buy/sell orders.

## What this tab is for

- See scanner lifecycle / market session / scheduler state
- Force a diagnostic scan with **Run once**
- Inspect latest candidates (direction, score, LTP, stale flag, reasons)

## Controls

| Control | API | What happens |
| --- | --- | --- |
| **Run once** | `POST /api/scanner/run` with `{ force: true }` | Runs one scan immediately, even outside the normal trading session (diagnostic). Invalidates status + latest candidates queries. Shows a short result message (status + candidate count) |

No other buttons on this page. Tables are read-only.

## Status fields

| Field | Meaning |
| --- | --- |
| **Lifecycle** | Engine lifecycle string from the API |
| **Market session** | Session classification used by the scanner |
| **Scheduler** | `running` / `stopped` — background scheduler if enabled server-side |
| **Last run** | Previous run status and candidate count |

## Candidates table

| Column | Meaning |
| --- | --- |
| Symbol / Direction / Score | Ranked watchlist-style output |
| LTP | Last price used for scoring |
| Stale / fresh | Whether the underlying tick was considered stale |
| Reasons | Short factor explanations (first few shown) |

Empty table → connect/start market data, then **Run once** (or start the server-side scanner scheduler).

## Dev-only panel

In development, a **legacy mock signal pipeline** panel may appear (`/api/scanner/intraday/mock/signal-pipeline`). That is **not** the production scanner path.

## Relation to other tabs

```text
Market stream (live preferred)
        ↓
  Run once (Scanner)
        ↓
  candidates
        ↓
  Evaluate now (Strategies)
```

## Does not

- Place paper or live trades
- Open strategy setups (use Strategies)
- Guarantee profitable signals — scoring is analytical
