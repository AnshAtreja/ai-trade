# Deterministic intraday strategy engine (Phase 6)

Strategy setups are **deterministic analytical outputs**, not orders or guarantees of profitability.

```text
ScannerSignal / candidate
        ↓
  Strategy Engine (registry)
        ↓
 Breakout | Breakdown | Momentum | Opening Momentum
        ↓
  StrategyEvaluation / StrategySetup
        ↓
  Future Unified Decision Engine (Phase 16)
```

## Boundaries

| Layer | Says |
| --- | --- |
| Scanner | “RELIANCE looks interesting.” |
| Strategy | “RELIANCE satisfies Breakout v1 conditions.” |
| Decision (later) | “Given evidence, choose whether to trade.” |
| Risk (later) | “Given account constraints, is the trade permitted?” |
| Execution (later) | “Paper execute the approved trade.” |

Phase 6 does **not**:

- call `placeOrder` / `modifyOrder` / `cancelOrder`
- mutate PaperAccount, Orders, Trades, or Positions
- size quantity from capital / daily loss limits
- invoke LLM, Kronos, RAG, or news
- invent ATR / RSI / RVOL when unavailable (`DATA_UNAVAILABLE` instead)

## Architecture

| Piece | Role |
| --- | --- |
| `Strategy` interface | `id`, `name`, `version`, `evaluate(context)` |
| `StrategyRegistry` | enable/disable, version listing, multi-eval |
| `StrategyEngineService` | candidate → contexts → evaluations; optional scheduler |
| `TickHistoryBuffer` | bounded per-token tick ring (`STRATEGY_TICK_HISTORY_SIZE`) |
| `CandleAggregator` | in-memory 1m / 5m OHLC (gaps ≠ zero candles) |
| `StrategySetup` | persisted `SETUP_DETECTED` rows only |

Tick history is fed from **every applied tick** on `LatestMarketStateStore.onAppliedTick` (not the latest-wins event bus).

## Status vs direction

**Status:** `NO_SETUP` | `SETUP_DETECTED` | `SETUP_INVALID` | `DATA_UNAVAILABLE`  
**Direction:** `BULLISH` | `BEARISH` | `NEUTRAL` (separate from status)

Do not use BUY/SELL as strategy status.

## Versions (v1)

| Id | Name | Sessions |
| --- | --- | --- |
| `breakout` | Intraday Breakout | REGULAR, CLOSING |
| `breakdown` | Intraday Breakdown | REGULAR, CLOSING |
| `momentum` | Momentum Continuation | REGULAR, CLOSING |
| `opening-momentum` | Opening Momentum | OPENING + early REGULAR (until ~09:45 IST) |

### Breakout v1

Prior session high from tick history (latest Kite `high` already includes last price) → distinguish `NEAR_HIGH` / `BREAKING_HIGH` / `CONFIRMED_BREAKOUT` → require confirmation ticks above reference high + positive short-term momentum + activity → entry / stop below structure / RR target.

### Breakdown v1

Mirror of breakout around prior session low.

### Momentum v1

Sustained 1m close direction, minimum move, not excessively extended from open, activity → structure stop → RR target. Missing candles → `DATA_UNAVAILABLE`.

### Opening Momentum v1

Needs ≥ N 1m candles for opening range. Break of OR + confirming momentum. Before OR established → `DATA_UNAVAILABLE`. Outside window/session → `NO_SETUP`.

## Entry / stop / target / RR

- Entry types: `MARKET`, `BREAKOUT_PRICE`, `BREAKDOWN_PRICE`, …
- Stop required for `SETUP_DETECTED`; otherwise `SETUP_INVALID`
- Target from configured reward/risk multiple
- `rewardRisk < STRATEGY_MIN_REWARD_RISK` → `SETUP_INVALID`
- `riskPerUnit` exposed; **quantity is not** (Risk Engine later)

## Explainability

Every evaluation includes:

- `conditions[]` with `passed` / optional `detail`
- `reasons[]` derived from passed conditions (no generic “strong stock”)
- optional deterministic `confidence` + `confidenceComponents`
- structured `invalidation` (stop + rules)

## Identity & persistence

`setupIdentity` = hash of `strategyId|version|instrumentToken|direction|minuteBucket`.

Only `SETUP_DETECTED` rows are written to `StrategySetup` (immutable by identity). `NO_SETUP` does not create rows.

## API

| Method | Path | Purpose |
| --- | --- | --- |
| GET | `/api/strategies` | Registry + legacy mock list |
| GET | `/api/strategies/status` | Scheduler / last evaluations |
| POST | `/api/strategies/evaluate` | Manual eval (`instrumentTokens`, `strategyIds`, `force`) |
| POST | `/api/strategies/start` | Start single-flight scheduler (off by default) |
| POST | `/api/strategies/stop` | Stop scheduler |
| GET | `/api/strategies/signals` | Persisted setups |
| GET | `/api/strategies/signals/latest` | In-memory detected setups from last run |

Scheduler: single-flight, session-aware, **not** auto-started on boot. Evaluates scanner candidates only (not full universe per tick).

## Config (centralized)

See `getStrategyConfig()` / env:

- `STRATEGY_ENABLED` (scheduler default off)
- `STRATEGY_INTERVAL_MS`
- `STRATEGY_TICK_HISTORY_SIZE`
- `STRATEGY_MAX_DATA_AGE_MS`
- `STRATEGY_MIN_REWARD_RISK`
- `STRATEGY_ENABLED_IDS` (comma list)

Per-strategy thresholds live in application config objects (not dozens of env vars).

## Mock scenarios

Under `PERSISTENCE_MODE=mock`, feed deterministic ticks into the stream store / context:

1. Breakout: approach high → cross → confirm
2. Breakdown: approach low → cross → confirm
3. Momentum: sustained 1m closes
4. Invalid: stale, missing history, poor RR

## Manual check

```bash
cd apps/api
PERSISTENCE_MODE=mock npm run dev
```

Sync instruments → start mock stream → run scanner → `POST /api/strategies/evaluate` → inspect conditions, entry/stop/target, RR → confirm no paper/live orders.
