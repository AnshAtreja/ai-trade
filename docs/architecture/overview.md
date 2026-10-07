# Architecture overview

TradePilot is a workspace monorepo:

```text
apps/
  api/   Express + Prisma trading engine
  web/   React dashboard (phase-aware product shell)
docs/    Roadmap, phases, reference
```

## Core loop (target)

```text
Market (REST + WebSocket)
        ↓
     Scanner
        ↓
 ┌──────┼──────┐
 ↓      ↓      ↓
Strategy Intelligence News/RAG
 └──────┼──────┘
        ↓
 Unified Decision Engine
        ↓
   Risk Engine ← Account State (paper and/or Kite)
        ↓
  Order Manager
        ↓
 Paper | Shadow | Live (gated)
```

Today: Phases **1–8D** are implemented in the API through realistic live-market paper execution plus developer CLI historical replay, execution, and analytics. Market intelligence, Kronos, RAG, Telegram, the unified decision engine, and live execution are not built. Paper uses real market data with virtual money only.

## Trading modes

| Mode | Meaning |
| --- | --- |
| **Paper** | Virtual capital; simulated fills. Source of truth is paper ledger + risk config. |
| **LIVE observation** | Real Kite account/market context (`tradingMode=LIVE` on broker snapshots). **Does not** mean live order placement. |
| **Shadow** | Full decision path; broker order placement never runs (Phase 19). |
| **Live execution** | Real orders via Order Manager (Phases 20–21 only, hard-gated). |

## Module map (`apps/api/src/modules`)

| Module | Role |
| --- | --- |
| `auth` | App auth stubs |
| `broker` | Kite Connect login, adapter, read-only account |
| `account-state` | Derived paper AccountState |
| `market-data` | Instruments, universe, REST LTP/quotes, WebSocket stream |
| `scanner` | Intraday scan + signal pipeline |
| `strategies` | Deterministic strategy registry + setups (Phase 6) |
| `risk` | Risk configuration + validation |
| `paper-trading` | Paper lifecycle + Phase 7 realistic execution simulator |
| `orders` | Order domain stubs |
| `ai-analysis` | Placeholder analysis |
| `journal` | Journal stubs |

## Data boundaries

- Tokens stay in encrypted Kite session store — never in Prisma account snapshots.
- Market ticks are not written one-row-per-tick to Postgres.
- Paper positions and Kite positions are separate concepts; do not merge them.
- LLM (future) proposes decisions; it must not call broker `placeOrder`.

See [safety.md](./safety.md) for execution locks.
