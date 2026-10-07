# TradePilot AI

NSE/Zerodha-oriented trading assistant: real account observation, market data, scanning, and paper trading first — live execution only after later gated phases.

## Stack

| Layer | Tech |
| --- | --- |
| Web | React, Vite, TypeScript, Tailwind, React Query, Zustand, React Router |
| API | Node.js, Express, TypeScript, Prisma, PostgreSQL, Zod |
| Broker | Zerodha Kite Connect (read-only account + market data; live orders disabled) |

## Monorepo

```text
apps/
  api/     Trading engine & domain modules
  web/     Phase-aware product dashboard
docs/      Roadmap, architecture, phase handoffs, reference
```

## Implementation status

| Phases | Status |
| --- | --- |
| 1–4 Foundation, Kite account, universe/REST, WebSocket stream | Done (API + web) |
| 5 Production scanner | Done (API + web) |
| 6 Strategy engine | Done (API + web) |
| 7 Realistic paper execution | Done (API + web; basic paper remains) |
| 8A Historical market-data foundation | Done (API/CLI) |
| 8B Historical market replay | Done (developer CLI; no P&L/backtest trades/UI yet) |
| 8C Historical paper execution | Done (developer CLI; isolated in-memory orders/fills/portfolio) |
| 8D Backtest analytics | Done (developer CLI; read-only metrics and diagnostics) |
| Historical dataset readiness | Done (calendar-aware validation and resumable bulk CLI) |
| 8E Walk-forward baseline | Done (checkpointed research artifact) |
| 8F.1 Baseline validation | Done (read-only analysis) |
| 8F.2 Robustness and sensitivity | Complete (768 parameter results, 96 cost results; research artifact) |
| 8F.3 Controlled optimization | Complete (800 TRAIN, 60 VALIDATION, zero optimized TEST; no accepted successor) |
| 8F.4 Final baseline evidence gate | Complete (four frozen baselines retained; no deployment claim) |
| 9A Market feature foundation | Complete (backend library; no live/UI integration by design) |
| 9B Market/sector/relative context | Complete (backend engine and verified benchmark registry) |
| 9C regime engine | Complete (real index-context dataset, point-in-time validation and descriptive distributions; backend-only) |
| 9D historical feature validation | Complete; no feature filter passed the sample gate |
| 9E live feature integration | In progress; deterministic API/UI path implemented, real Kite/NSE-source gate pending |
| 10–21 Kronos research → controlled live | Planned |

Full roadmap: [docs/ROADMAP.md](docs/ROADMAP.md).

## Local setup

```bash
npm install
cp .env.example .env
ln -sfn ../../.env apps/api/.env   # so Prisma CLI sees DATABASE_URL
npm run prisma:generate
npm run dev
```

### Full stack via Docker

```bash
docker compose up --build
```

Starts **Postgres + API + Web**. Migrations run inside the API container on boot.

- Web: http://localhost:5173  
- API: http://localhost:4000  
- Health: http://localhost:4000/api/health  

Details: [docs/guides/local-setup.md](docs/guides/local-setup.md) · Kite: [docs/guides/kite-connect.md](docs/guides/kite-connect.md).

`PERSISTENCE_MODE=mock` (default in `.env`) uses in-memory stores for host `npm run dev`. Compose API forces `database` mode against the Compose Postgres service.

**Env rule:** edit only the **root** `.env`. Run `npm run env:link` so `apps/api/.env` stays a symlink (Prisma needs it there). Do not maintain two separate env files.

## What can I do in the UI?

Operator guide (every tab, every button, status pills): **[docs/ui/README.md](docs/ui/README.md)**.

Short version: connect Kite → sync instruments → **Start** market stream → **Run once** scanner → **Evaluate now** strategies → inspect paper account. Live orders stay locked.

## Safety

Live order placement is disabled in the broker adapter. Observation of real Kite funds/positions is not live trading. See [docs/architecture/safety.md](docs/architecture/safety.md).

## Docs for agents

1. [docs/ui/README.md](docs/ui/README.md) — keep in sync when UI controls change  
2. [docs/ROADMAP.md](docs/ROADMAP.md)  
3. Matching [docs/phases/](docs/phases/) phase folder (`roadmap.md`, `implementation.md`, `interview.md`)  
4. Linked [docs/reference/](docs/reference/) / feature docs when present  
5. Matching page under `apps/web/src/pages/` when UI is in scope; backend-only research phases do not require a new screen
