# TradePilot API

Express + Prisma trading engine for TradePilot AI.

## Run

From repo root:

```bash
npm run dev:api
```

Default port: `4000`. Health: `GET /api/health`.

## Modules

See [docs/architecture/overview.md](../../docs/architecture/overview.md). Phase handoffs: [docs/phases/](../../docs/phases/).

Deep notes for completed work:

- [Paper account](../../docs/reference/paper-account-state.md)
- [Kite account](../../docs/reference/kite-account-state.md)
- [Instruments / REST](../../docs/reference/instrument-market-data.md)
- [Market stream](../../docs/reference/market-stream.md)

## Persistence

- `PERSISTENCE_MODE=mock` — in-memory
- `PERSISTENCE_MODE=database` — Prisma + Postgres (`npm run prisma:migrate` from root)
