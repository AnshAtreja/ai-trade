# Backtesting tab

**Route:** `/backtesting` · **Source:** [`backtesting-page.tsx`](../../apps/web/src/pages/backtesting-page.tsx)

## Status

**Roadmap view** — no runnable web controls. Phase 8A–8F.4 research is complete through API/developer CLI workflows. The final evidence gate retains four frozen v1 baselines, finds no validated successor, and makes no deployment claim. The web page reports status; it does not start research jobs.

## Planned purpose

The page shows the completed historical research pipeline. The underlying CLI artifacts include walk-forward evaluation, robustness, controlled optimization, and a final evidence synthesis. Phase 9 market-intelligence work is separate and pending.

## Controls today

| Control | Behavior |
| --- | --- |
| None | Page shows phase status and scope; no backtest is launched from the web app |

## Developer CLI today

```bash
npm run backtest:replay --workspace api -- \
  --token 738561 \
  --from 2026-09-15T03:45:00.000Z \
  --to 2026-09-15T10:00:00.000Z \
  --interval 1m
```

The replay CLI feeds stored candles through the scanner and strategy engine. `backtest:execute` simulates historical paper fills, and `backtest:analyze` measures completed execution results. These remain separate developer workflows; the web page does not run them.

The final evidence artifact is `apps/artifacts/phase8f/phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1.json`. To verify it without replay:

```bash
cd apps/api
node --import tsx src/modules/scanner/replay/final-evidence-gate-cli.ts verify
```

When web Backtesting controls ship, document each new button (Run backtest, Load report, …) in this file.
