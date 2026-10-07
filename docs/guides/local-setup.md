# Local setup

## Prerequisites

- Node.js 20+
- Docker Desktop (recommended) — Compose runs Postgres + API + Web
- Zerodha Kite API key/secret (optional for mock mode)

## Option A — Full stack with Docker (recommended)

From the repo root:

```bash
cp .env.example .env   # once
docker compose up --build
```

This starts:

| Service | URL |
| --- | --- |
| Web | http://localhost:5173 |
| API | http://localhost:4000 |
| Postgres | localhost:5432 |
| Health | http://localhost:4000/api/health |

The API container applies Prisma migrations on startup (`prisma migrate deploy`) and forces `PERSISTENCE_MODE=database` with `DATABASE_URL` pointing at the `postgres` service.

Stop with `Ctrl+C` or `docker compose down`.

## Option B — Local Node + Docker Postgres only

```bash
npm install
cp .env.example .env
# Ensure apps/api/.env exists (symlink to root .env) so Prisma CLI sees DATABASE_URL:
ln -sfn ../../.env apps/api/.env

docker compose up -d postgres
# In .env set PERSISTENCE_MODE=database for real DB (optional; mock works without Postgres)

npm run prisma:generate
npm run prisma:migrate
npm run dev
```

- Web: http://localhost:5173  
- API: http://localhost:4000  

## Persistence modes

| `PERSISTENCE_MODE` | Behavior |
| --- | --- |
| `mock` (default in `.env`) | In-memory repositories; fine for local `npm run dev` without DB |
| `database` | Prisma + Postgres (Compose API always uses this) |

## Env — one file only

| Path | Role |
| --- | --- |
| **`.env` (repo root)** | The only file you edit |
| `apps/api/.env` | Symlink to root (Prisma + API cwd). Recreate with `npm run env:link` |

Never keep a separate real file at `apps/api/.env` — that causes two configs to diverge.

### Do I need `KITE_API_KEY` / `KITE_API_SECRET` if I have Connect Kite?

**Yes.** The login button only obtains a daily **access token**. Zerodha still requires:

- **API key** — login URL + every request `Authorization: token api_key:access_token`
- **API secret** — request_token → access_token exchange, and encryption of `apps/api/.secure/kite-session.enc`

Without both in root `.env`, login/callback/historical downloads cannot work.

### Historical downloads via Kite

In root `.env`:

```bash
PERSISTENCE_MODE=database
HISTORICAL_PROVIDER=kite
```

Then Connect Kite in the UI (with Docker API sharing `.secure`), or re-login after any secret change.

If you see `Unsupported state or unable to authenticate data`, the session file was encrypted with a different secret — delete `apps/api/.secure/kite-session.enc` and Connect Kite again.

## Useful scripts

| Script | Purpose |
| --- | --- |
| `docker compose up --build` | Postgres + API + Web |
| `npm run env:link` | Link `apps/api/.env` → root `.env` |
| `npm run dev` | API + web on the host |
| `npm run prisma:generate` | Prisma client |
| `npm run prisma:migrate` | Migrations (needs `apps/api/.env` link) |
| `npm run backtest:replay --workspace api -- --token 738561 --from ... --to ... --interval 1m` | Phase 8B historical market replay CLI |

## Env highlights

See `.env.example`. Optional: `VITE_API_BASE_URL` (web build; Compose defaults to `http://localhost:4000`).

Next: [Kite Connect](./kite-connect.md).
