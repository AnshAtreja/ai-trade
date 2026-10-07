# UI operator guide

How the TradePilot console works **today**: what each tab is for, what every button does, and what the status pills mean.

> Keep these files truthful. When you add/change a button or pill, update the matching tab file here (see Cursor rule `ui-operator-guide`).

## Start Here

Use **Overview** as the control center. The normal operating order is:

```text
1. Broker & Account  -> verify the Kite read-only connection
2. Market            -> sync the NSE universe, then start the stream
3. Scanner/Strategies -> inspect candidates and deterministic setups
4. Paper Trading     -> observe virtual orders, fills, and risk
5. Backtesting       -> read developer research artifacts
6. Intelligence      -> observe Phase 9 context and its live gate
```

The sidebar groups destinations as **Operate**, **Research**, and **Later**. The Later group is roadmap-only and does not imply that those capabilities are available.

## What you can do right now

| Capability | Where | Notes |
| --- | --- | --- |
| Connect Zerodha Kite (login + tokens) | [Broker](./broker.md) | Read-only session; **no live orders** |
| Refresh real broker funds / positions / orders | [Broker](./broker.md) | Observation only |
| Sync NSE instrument master + view equity sample | [Market](./market.md) | Phase 3 |
| Start / stop WebSocket market stream | [Market](./market.md) | Phase 4 — this is what flips **REST only ↔ Stream connected** |
| Run production scanner once | [Scanner](./scanner.md) | Ranked candidates, not buy/sell orders |
| Evaluate strategies on candidates | [Strategies](./strategies.md) | Analytical setups only |
| View paper equity, risk, orders, trades | [Paper](./paper.md) | Virtual money; realistic fill sim (Phase 7) |
| Refresh paper account / reconcile paper fills | [Paper](./paper.md) | Never hits Kite `placeOrder` |
| Run historical research from CLI | [Backtesting](./backtesting.md) | Replay, paper execution, analytics, and frozen 8E–8F reports are developer workflows; no web controls |
| Observe market intelligence | [Intelligence](./intelligence.md) | 9A–9D context is visible; 9E live closure is still gated |
| Arm/disarm dashboard kill switch | [Overview](./overview.md) | UI flag only today — adapter still blocks live |

**Not available yet:** web backtesting controls, walk-forward validation UI, Phase 9E live closure, Kronos, setup-quality model, news/RAG, unified decisioning, LLM reasoning, Telegram alerts, shadow sessions, live order placement.

## Suggested flow (happy path)

```text
1. Overview     — follow the recommended flow and confirm Live orders locked
2. Broker       — Login with Kite → Refresh from Kite
3. Market       — Sync universe → Start stream → wait for Stream connected
4. Scanner      — Run once → inspect candidates
5. Strategies   — Evaluate now → inspect a setup
6. Paper        — Refresh / Reconcile → watch virtual orders and trades
7. Intelligence — observe context; do not treat it as an order decision
```

Mock mode (`PERSISTENCE_MODE=mock`) works without a real Kite login for many paths; database + Kite credentials give real account/market data.

## Status bar (every page)

Full legend: [status-bar.md](./status-bar.md).

| Pill | Meaning today |
| --- | --- |
| **Kite connected / login required** | Kite session verified by a read-only profile request / login needed |
| **Stream connected / REST only** | The in-process market WebSocket is connected / no active stream |
| **Paper enabled** | Always on for now — paper path is the execution mode |
| **Live orders locked / enabled** | Live broker orders. Should stay **locked** until Phases 20–21 |
| **Kill switch armed / off** | Dashboard intent flag (Zustand). Does **not** replace the adapter hard-block |

## Tabs

| Tab | Guide | Status |
| --- | --- | --- |
| Overview | [overview.md](./overview.md) | Live |
| Broker & Account | [broker.md](./broker.md) | Live |
| Market | [market.md](./market.md) | Live |
| Scanner | [scanner.md](./scanner.md) | Live |
| Strategies | [strategies.md](./strategies.md) | Live |
| Paper Trading | [paper.md](./paper.md) | Live |
| Backtesting | [backtesting.md](./backtesting.md) | Roadmap view; Phase 8 research is complete through 8F.4 via developer workflows |
| Intelligence | [intelligence.md](./intelligence.md) | Observational Phase 9 surface; live closure pending |
| Agent & Decisions | [agent.md](./agent.md) | Roadmap view, phases 13–17 |
| Alerts | [alerts.md](./alerts.md) | Roadmap view, phase 18 |
| Shadow & Live | [shadow-live.md](./shadow-live.md) | Roadmap view, phases 19–21 |

## Related docs

- Roadmap: [../ROADMAP.md](../ROADMAP.md)
- Safety: [../architecture/safety.md](../architecture/safety.md)
- Feature deep-dives: [../scanner.md](../scanner.md), [../strategies.md](../strategies.md), [../paper-trading.md](../paper-trading.md)
