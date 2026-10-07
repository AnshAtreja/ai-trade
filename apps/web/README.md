# TradePilot Web

React dashboard for TradePilot AI. Product areas map to roadmap phases; unfinished areas (8+) render as skeletons. Phases 5–7 pages are wired to production APIs.

## Run

From repo root:

```bash
npm run dev:web
```

Default: http://localhost:5173 (proxies API via Vite config when configured).

## Structure

```text
src/
  pages/           Route pages (Overview, Broker, Market, …)
  components/      Shell, UI primitives, PhaseSkeleton
  features/        Domain widgets (broker connect, scanner cards, …)
  api/             Client + React Query hooks
```

## Docs

- **Operator guide (buttons / modes):** [docs/ui/README.md](../../docs/ui/README.md)
- Product roadmap: [docs/ROADMAP.md](../../docs/ROADMAP.md)
- Local setup: [docs/guides/local-setup.md](../../docs/guides/local-setup.md)
- Safety: [docs/architecture/safety.md](../../docs/architecture/safety.md)
