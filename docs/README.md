# TradePilot AI documentation

Index for product docs, roadmap, architecture, and phase handoffs.

## Start here

| Doc | Purpose |
| --- | --- |
| [ui/README.md](./ui/README.md) | **Operator guide** — what each tab/button does, what works today |
| [ROADMAP.md](./ROADMAP.md) | 21-phase build plan and dependency order |
| [architecture/overview.md](./architecture/overview.md) | System shape and trading modes |
| [architecture/safety.md](./architecture/safety.md) | Kill switch, live-execution locks, LLM boundaries |
| [guides/local-setup.md](./guides/local-setup.md) | Run the monorepo locally |
| [guides/kite-connect.md](./guides/kite-connect.md) | Zerodha Kite login and tokens |

## UI (per tab)

One file per console tab under [`ui/`](./ui/) — controls, APIs, and mode semantics (Market REST/live, paper, live, kill switch). Index: [ui/README.md](./ui/README.md).

## Phases

Agent-ready stubs live in [`phases/`](./phases/). Open the matching phase file before implementing work.

## Reference

Deep technical notes for completed foundation work:

- [Paper account state](./reference/paper-account-state.md) (Phase 1)
- [Kite account state](./reference/kite-account-state.md) (Phase 2)
- [Instrument + REST market data](./reference/instrument-market-data.md) (Phase 3)
- [Market stream](./reference/market-stream.md) (Phase 4)
- [Scanner](./scanner.md) (Phase 5)
- [Strategies](./strategies.md) (Phase 6)
- [Paper trading](./paper-trading.md) (Phase 7)
- [Historical market data](./historical-market-data.md) (Phase 8A)

## Handoff convention

1. Read `ROADMAP.md` for context.
2. Open `phases/phase-XX-*.md`.
3. Follow any linked `reference/` / feature doc.
4. Ship **API + matching `apps/web` page** together — do not mark a phase `done` with only backends and a `PhaseSkeleton`.
5. Keep root `README.md` implementation status aligned with `ROADMAP.md`.
