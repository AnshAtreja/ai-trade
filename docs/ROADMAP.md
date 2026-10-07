# TradePilot AI roadmap

TradePilot AI is an NSE/Zerodha-oriented trading assistant: observe real account and market state, scan and evaluate strategies, paper-trade realistically, replay and measure history, then only later consider controlled live execution.

Later phases may split further once we inspect implementation. Build **one phase at a time**.

Detailed phase records live in the canonical folders under `docs/phases/phase-XX/`: `roadmap.md`, `implementation.md`, and `interview.md`. The legacy single-file phase documents remain as compatibility references.

## Status summary

| Phase | Name | Status |
| --- | --- | --- |
| 1 | Foundation & persistence | done |
| 2 | Real Kite account state | done |
| 3 | Real market universe + REST market data | done |
| 4 | Real-time market pipeline | done |
| 5 | Production-grade scanner | done (API + web) |
| 6 | Strategy engine | done (API + web) |
| 7 | Realistic paper execution | done (API + web; basic paper also remains) |
| 8 | Backtesting + walk-forward | complete (8A–8F.4; four research baselines retained, no validated successor) |
| 9 | Market intelligence & feature layer | in progress (9A/9B/9C/9D complete; 9E integration implemented, live provider gate pending) |
| 10 | Kronos / financial time-series intelligence | planned |
| 11 | Meta-labeling / setup quality model | planned |
| 12 | Event intelligence: news + RAG | planned |
| 13 | Portfolio & capital allocation engine | planned |
| 14 | Adaptive risk engine | planned |
| 15 | Execution intelligence | planned |
| 16 | Unified decision engine | planned |
| 17 | LLM + MCP reasoning | planned |
| 18 | Telegram / control plane | planned |
| 19 | Full shadow trading | planned |
| 20 | Live Kite execution infrastructure | planned |
| 21 | Controlled live trading | planned |

## Dependency graph

```text
1 Foundation
 └─► 2 Kite account state
      └─► 3 Universe + REST data
           └─► 4 Real-time stream
                └─► 5 Scanner
                     └─► 6 Strategy engine
                          ├─► 7 Realistic paper
                          │    └─► 8 Backtesting / walk-forward
                          │         └─► 9 Market intelligence + features
                          │              └─► 10 Kronos research
                          │                   └─► 11 Meta-labeling
                          │                        └─► 12 News + RAG
                          │                             └─► 13 Portfolio allocation
                          │                                  └─► 14 Adaptive risk
                          │                                       └─► 15 Execution intelligence
                          │                                            └─► 16 Unified decision engine
                          │                                                 └─► 17 LLM/MCP reasoning
                          │                                                      └─► 18 Telegram / control plane
                          │                                                           └─► 19 Shadow trading
                          │                                                                └─► 20 Live infra
                          │                                                                     └─► 21 Controlled live
```

## Phase narratives

### PHASE 1 — Foundation & persistence

Paper capital, Prisma persistence, risk configuration, immutable account snapshots. Risk uses derived paper state, not a hardcoded assumption that capital is always 100,000 after init.

### PHASE 2 — Real Kite account state

Periodically retrieve profile, margins, cash, used margin, positions, holdings, orders, trades. Maintain `AccountState` from the broker. Risk asks what Zerodha says is available **now**. Read-only; no order routing.

### PHASE 3 — Real market universe

Replace mock instrument lists with a universe manager: Kite instruments -> NSE equity -> tradability -> liquidity -> price -> volatility -> intraday universe. Dynamic discovery of what to scan.

### PHASE 4 — Real-time market data

Kite WebSocket -> MarketDataService -> event stream -> scanner consumers. Handle reconnects, stale/missing ticks, market open/close, subscriptions, timestamp validation.

### PHASE 5 — Scanner

Candidate generation from live latest-state + NSE equity universe: filters, explainable score, top-N `ScannerSignal` rows. Not buy/sell. No LLM/Kronos.

### PHASE 6 — Strategy engine

Scanner candidates -> registry of deterministic strategies (breakout, breakdown, momentum, opening momentum) -> versioned setups with conditions, entry/stop/target, RR. Not orders. No LLM/Kronos.

### PHASE 7 — Serious paper trading

Live-market paper simulator: spread/slippage/latency/partials, stop gap-through, charges proxy, square-off, restart-safe reconciliation. Virtual money only, never places Kite orders.

### PHASE 8 — Backtesting

**8A (done):** Historical candle fetch/persist/validate + provider abstraction + 1m->5m derivation. See [historical-market-data.md](./historical-market-data.md).

**8B (done):** Deterministic historical market replay over stored candles through the existing market-state adapter, production scanner, and deterministic strategy engine. CLI only; no trade simulation, P&L, or UI controls.

**8C (done):** Isolated deterministic historical-paper execution consumes Phase 8B setups after their source candle closes. It supports next-candle eligibility, market/limit fills, liquidity-driven partial fills, adverse slippage, charges, stop/target and gap exits, conservative intrabar ambiguity, and explicit incomplete-data outcomes. It has no live broker, Kite, or operational paper-account path.

**8D (done):** Pure, deterministic analytics consumes the completed 8C result: P&L/outcome statistics, R multiples, equity/drawdown curves, IST daily returns, factual strategy/instrument/direction/exit breakdowns, and data-quality diagnostics. Sharpe/Sortino use daily returns only when at least two observations exist; otherwise they are explicitly unavailable. No validation or ranking is performed.

**8E (complete):** Deterministic four-fold walk-forward evaluation of the frozen four-strategy baseline. The frozen artifact is `1fd46d5ef1f0e98f`.

**8F.1 (complete):** Frozen baseline validation and factual research-readiness checks.

**8F.2 (complete):** Pre-registered one-at-a-time local parameter sensitivity on TRAIN/VALIDATION and adverse execution-cost sensitivity on TEST. The frozen experiment completed 768/768 parameter results and 96/96 cost results, with zero perturbed TEST executions. A post-run schema audit prompted a separate deterministic classification recovery: all 576 active rows were repaired without changing the original execution metrics; 192 zero-trade breakdown rows were retained. The final classifications are 18 locally sensitive groups and six insufficient-activity breakdown groups. Shared replay, isolated variant accounts, atomic checkpoints and supervised workers made the long run resumable; pending-order indexing removed repeated scans of completed orders. See [runtime recovery and monitoring](phases/phase-08-historical-research-backtesting/runtime-recovery.md) and [Phase 8 interview notes](phases/phase-08-historical-research-backtesting/interview.md). This phase did not select parameters.

**8F.3 (complete):** The frozen search completed 800 TRAIN and 60 VALIDATION candidate-fold evaluations with zero optimized TEST executions. No candidate passed the pre-registered validation gates; breakdown produced no viable activity candidate. No successor strategy was created.

**8F.4 (complete):** The final evidence gate validated the frozen 8E, 8F.1, recovered 8F.2, and 8F.3 artifacts without new replay. It retained all four v1 strategies as research baselines, recorded no validated successor, and found insufficient standalone deployment evidence for each. Breakdown requires strategy redesign before further optimization; momentum has an interesting but small and inconsistent research signal. Artifact: `apps/artifacts/phase8f/phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1.json`, content hash `6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41`. Phase 8 is complete. Phase 8 research infrastructure is CLI-only by design. The Backtesting page reports phase status but does not operate research runs.

### PHASE 9 — Market intelligence & feature layer

**9A complete:** Versioned `MARKET_FEATURES_V1`/`MARKET_FEATURE_DEFINITIONS_V1` backend foundation with finalized-candle historical/live-style adapters, incremental session VWAP, high/low, 14-bar ATR, gap and time features, explicit per-field quality and no-future tests. This is not wired to live strategy decisions or a product screen.

**9B complete:** A separate NSE `INDICES` benchmark registry (verified against the local Phase 3 master), a stable-as-of sector taxonomy for the frozen 25-stock research universe, coverage-gated market/sector sample breadth, and 5m/15m/30m/60m point-in-time relative returns. At the 9B handoff, the Kite session was expired and no index candles were stored; the engine reported unavailable context instead of inventing prices. **9C complete:** After reauthentication, the existing provider supplied one year of eight index histories. The versioned `NSE_INDEX_CONTEXT_2025_2026_V1` research view (`0671adf35f4fae2f1d4ec05a`) records 726,478/726,480 expected policy-valid minutes, two explicit provider gaps, and separate index closing semantics. The frozen `MARKET_REGIME_V1` was exercised on real 9A/9B context with point-in-time tests, descriptive distributions and transition statistics. **9D complete:** The frozen `PHASE_9D_FEATURE_ABLATION_V1` retrospective study joined all 31,944 requested setup-time context points, reproduced 9C market-stream distributions and emitted deterministic fold-aware quality, ablation and redundancy artifacts. No conditioned group met its pre-registered activity gate, so no feature filter was validated. **9E in progress:** The observational live 9A/9B/9C path, context subscriptions, fail-closed operational CAS provider and read-only API/UI passed synthetic tests, but Kite authentication and NSE daily source access blocked a real feed smoke. Phase 9 remains open; see [Phase 9 live integration](phases/phase-09-market-intelligence/live-integration.md).

Features are **not** automatically trading rules. They become structured context for later models, filters, allocation, and decisioning.

### PHASE 10 — Kronos / financial time-series intelligence

Treat Kronos as a separate experimental research phase. Integrate NSE OHLCV into Kronos inputs, run zero-shot benchmarks against simple baselines, evaluate direction/return/volatility/horizon/confidence behavior across stocks, regimes, periods, and market conditions, and only consider adaptation/fine-tuning if justified. Keep Kronos only if ablation proves useful out-of-sample information.

### PHASE 11 — Meta-labeling / setup quality model

Deterministic strategies keep finding setups. ML answers a narrower question: should this setup be taken? Inputs may include strategy features, regime, VWAP, volume, relative strength, sector, market breadth, Kronos, and time-of-day. Outputs must be calibrated probabilities or skip/take recommendations learned from validation, not arbitrary thresholds.

### PHASE 12 — Event intelligence: news + RAG

Ingest company news, market news, macro news, NSE/BSE announcements, results, board meetings, corporate actions, and regulatory filings. Classify event risk through retrieval and LLM-assisted labeling, then expose event-risk filters such as `POSITIVE_CATALYST`, `NEGATIVE_CATALYST`, `RESULTS`, `MANAGEMENT`, `REGULATORY`, `CORPORATE_ACTION`, `MACRO`, and `UNKNOWN`.

### PHASE 13 — Portfolio & capital allocation engine

Stop treating individual trades as independent. Build deterministic allocation across available equity, capital, daily risk remaining, open risk, maximum exposure, sector exposure, correlation risk, and direction/market exposure. Candidate competition should produce `APPROVE`, `REDUCE`, or `SKIP` with quantity proposals.

### PHASE 14 — Adaptive risk engine

Separate adaptive risk from allocation. Research dynamic risk scaling for volatility, drawdown, daily limits, calibrated confidence, fractional Kelly caps, and kill-switch conditions. Hard deterministic ceilings remain authoritative; no unconstrained model may decide risk.

### PHASE 15 — Execution intelligence

Evaluate whether a valid signal is worth trading after spread, slippage, charges, partial fills, liquidity, market impact, and entry timing. A setup with positive gross edge can still be skipped when expected execution cost consumes the edge.

### PHASE 16 — Unified decision engine

Fuse strategy candidates, regime, relative strength, Kronos, news/RAG, meta-model probability, execution cost, portfolio allocation, and adaptive risk into a deterministic gate that returns `APPROVE`, `REDUCE`, or `SKIP`. The LLM does not bypass this engine.

### PHASE 17 — LLM + MCP reasoning

Give the LLM structured facts and tools for explanation, research, summaries, diagnostics, and operator interaction. It may explain why a candidate was approved, reduced, or skipped. It must not have direct order authority.

### PHASE 18 — Telegram / control plane

Telegram becomes an authenticated control and visibility plane for candidates, approved/rejected trades, reasons, risk, portfolio, P&L, system health, kill switch, and daily reports. Commands such as `/status`, `/positions`, `/risk`, `/candidates`, `/why`, `/pause`, `/resume`, and `/kill` require explicit authorization design.

### PHASE 19 — Full shadow trading

Run the full TradePilot pipeline on live NSE data for an extended period with broker order placement disabled. Compare backtest, walk-forward, paper, and shadow behavior. Monitor model drift and execution assumptions.

### PHASE 20 — Live Kite execution infrastructure

Introduce actual broker writes only here: order manager, Kite order adapter, order reconciliation, idempotency, broker state recovery, and execution monitoring. Recheck current Indian regulatory and broker requirements at this phase rather than encoding today's rules too early.

### PHASE 21 — Controlled live trading

Start extremely constrained: small capital, small risk, limited symbols, limited strategies, limited daily trades, and hard kill switch. Compare expected vs actual fills, expected vs actual slippage, and backtest distributions vs live distributions before scaling.

## UI mapping

| Product area | Primary phases |
| --- | --- |
| Overview | 1+ |
| Broker & Account | 2 |
| Market | 3–4 |
| Scanner | 5 |
| Strategies | 6 |
| Paper Trading | 1, 7 |
| Backtesting | 8 |
| Intelligence | 9 (current; live gate pending) |
| Agent & Decisions | 13–17 |
| Alerts | 18 |
| Shadow & Live | 19–21 |
