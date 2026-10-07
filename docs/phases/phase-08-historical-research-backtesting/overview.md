# Phase 08 — Backtesting + walk-forward evaluation

**Status:** `complete` (8A through 8F.4 complete; Phase 9 pending)

Phase 8 is split after implementation inspection:

| Sub-phase | Scope | Status |
| --- | --- | --- |
| **8A** | Historical market-data foundation | **done** |
| **8B** | Historical market replay through scanner + deterministic strategy engine | **done** |
| **8C** | Historical paper execution, isolated portfolio, orders/fills/trades | **done** |
| **8D** | Read-only analytics and performance measurement | **done** |
| **8E** | Deterministic walk-forward baseline infrastructure and frozen run | **complete** |
| **8F.1** | Frozen baseline validation gate | **complete** |
| **8F.2** | Local parameter / execution-cost robustness | **complete** |
| **8F.3** | Controlled TRAIN optimization and VALIDATION selection | **complete** |
| **8F.4** | Final baseline strategy evidence gate | **complete** |

## Phase 8A — Historical data foundation (done)

### Goal

Fetch, persist, validate, and serve historical NSE OHLCV (primarily 1m; 5m derived) behind a provider abstraction — without implementing the backtester.

### Implemented

- `HistoricalCandle` Prisma model + migration `20260915160000_phase_8a_historical_candles`
- Repository (memory + Prisma): insert-only idempotent persist, `[from, to)` range queries, coverage
- `HistoricalMarketDataProvider` + Kite/Mock providers (reuse `KiteBrokerAdapter`)
- Chunked/throttled/retry downloader
- Validation (OHLC, gaps, session awareness) — no fabricated fills
- Deterministic 1m → 5m aggregation (shared bucket helpers with Phase 6)
- API: `/api/backtest/historical/*`
- CLI: `historical:coverage` / `download` / `validate`
- Docs: [docs/historical-market-data.md](../historical-market-data.md)

### Out of scope (8A)

- Backtest engine / walk-forward / optimization
- Kronos / LLM / RAG / news / Telegram
- Live trading / Kite order placement
- Frontend dashboard
- Future calendar years and exchange notices beyond the versioned `NSE_CASH_2025_2026_V2` calendar require explicit reconciliation before research use.

### Acceptance (8A)

- [x] Historical candles persist idempotently
- [x] Provider abstraction exists; backtests will not need direct Kite
- [x] 5m derivable from 1m
- [x] Validation without fabricating data
- [x] Half-open `[from, to)` temporal semantics
- [x] No path to live order placement
- [x] Tests + docs

## Phase 8B — Historical market replay (done)

### Goal

Replay stored historical candles through the existing market-state/scanner/strategy architecture without look-ahead, without live orders, and without profitability claims.

### Implemented

- `HistoricalReplayClock` advances chronological candle/data-gap/duplicate events with deterministic token tie-breakers.
- `HistoricalMarketStateAdapter` feeds candle-derived ticks into `LatestMarketStateStore` one candle at a time.
- Production `ProductionScannerService` is reused with replay market state and persistence disabled.
- Existing `StrategyEngineService`, strategy registry, contexts, identities, invalidation, and candle aggregation are reused.
- Structured in-memory replay result captures candle events, scanner output, strategy output/statuses, data gaps, duplicate candles, and deterministic run id.
- Developer CLI:

```bash
npm run backtest:replay --workspace api -- \
  --token 738561 \
  --from 2026-09-15T03:45:00.000Z \
  --to 2026-09-15T10:00:00.000Z \
  --interval 1m
```

### 8B acceptance

- [x] Historical candles replay chronologically.
- [x] `[from, to)` semantics preserved.
- [x] Scanner/strategy-visible state advances one candle at a time.
- [x] Tests prove future candle changes do not alter outputs before that candle.
- [x] Repeated identical replay returns identical event sequence and deterministic run id.
- [x] Production scanner integration without duplicated scanner logic.
- [x] Deterministic strategy engine integration without duplicated strategy versions.
- [x] 1m to 5m candle aggregation is available during replay without future candles.
- [x] Missing historical candles are explicit `DATA_GAP` events; no forward-fill.
- [x] Multi-instrument replay ordering is timestamp then instrument token.
- [x] Empty/insufficient ranges are handled without fabricated data.
- [x] Duplicate historical candle timestamps are reported and skipped.
- [x] Existing timezone/session utilities are used.

### Out of scope (8B)

- Permanent backtest trade/order/portfolio persistence.
- P&L, win rate, Sharpe/Sortino, drawdown, profitability metrics, or strategy rejection.
- Walk-forward/train-validation-test.
- Web Backtesting UI controls.
- Kronos, ML, LLM, RAG, news, Telegram, live trading, or optimization.

## Phase 8C — Historical paper execution (done)

Phase 8C layers an isolated, deterministic historical-paper runtime over the Phase 8B event stream. It reuses Phase 7's pure fill, slippage, charge, and conservative exit primitives while keeping all backtest account state in memory.

- Setup orders are created after candle T and first become eligible at T+1.
- Market and limit entries, deterministic partial fills, adverse slippage, stop/target exits, gap-through fills, charges, and conservative intrabar stop-first resolution are supported.
- Gaps are not filled or forward-filled. Unresolved open positions are explicitly marked `INCOMPLETE_DATA` when the dataset does not prove normal session square-off.
- The runtime has no repository, operational paper-account, broker, Kite market, or Kite order dependency.

Developer CLI:

```bash
npm run backtest:execute --workspace api -- \
  --token 738561 \
  --from 2026-09-15T03:45:00.000Z \
  --to 2026-09-15T10:00:00.000Z \
  --interval 1m \
  --starting-capital 100000
```

## Phase 8D — Backtest analytics (done)

### Goal

Measure completed historical execution results without changing replay, strategy, risk, orders, fills, or portfolio state.

### In scope

- Read-only trade/P&L/outcome metrics, equity curve, drawdown, daily returns, holding times, R multiples, factual breakdowns, and diagnostics.
- Sharpe/Sortino are daily-return based and return `null` with an explicit reason when observations are insufficient.
- Incomplete trades are excluded from outcome metrics. Profit factor is `null` when gross profit exists without gross loss, avoiding JSON infinity.
- Trading-day grouping uses Asia/Kolkata market dates.

### Depends on

Phases 6–7 + **8A–8C**

### Acceptance checks (8D)

- [x] Pure deterministic analytics over completed execution results
- [x] Equity/drawdown/daily-return series without future data
- [x] Data-quality and insufficient-sample diagnostics
- [x] No live/paper operational dependency

## Phase 8D.5 — CAS-aware historical session semantics (implemented)

- [x] Separate exchange calendar availability from instrument session policy
- [x] Model CAS eligibility as `ELIGIBLE`, `NOT_ELIGIBLE`, or `UNKNOWN`
- [x] Validate continuous-session coverage without treating the CAS window as a missing candle gap
- [x] Apply the same policy to historical replay gap events
- [x] Record policy version, CAS effective date, and eligibility provenance in dataset manifests
- [x] Preserve explicit uncertainty where current instrument-master data cannot establish eligibility
- [x] Freeze the research dataset contract and consumer completeness eligibility
- [x] Preserve raw observations while excluding holiday rows from policy-valid views
- [x] Document the Phase 8E handoff contract without starting Phase 8E

**Phase 8D.5 status:** `COMPLETE` — research dataset readiness is validated with explicit interval-aware `COMPLETE`, `INCOMPLETE`, `MISSING`, and `UNKNOWN_POLICY` classifications. The canonical dataset remains gap-aware rather than gap-free.

## Phase 8F.2 — Baseline robustness and sensitivity research (complete)

The research-only command is `npm run backtest:robustness --workspace api`. It creates the immutable specification at `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.spec.json`. The design contains 24 eligible numeric parameters and 120 grid entries including the baseline reference; the 96 non-baseline variants run only on TRAIN/VALIDATION. The six predefined cost scenarios run only on TEST with frozen strategy parameters.

The cost model is the existing simple turnover-basis charge model (`3 bps`, `minCharge=5`) and the historical baseline's explicit `NONE` slippage policy. Slippage stress uses the existing BPS primitive at 3 bps and 4 bps. No favorable scenarios, parameter/cost combinations, synthetic candles, live paths, or new strategy versions are allowed.

Parameter results are descriptive only and remain separate from execution-cost results. No parameter winner, strategy ranking, or Phase 8F.3 decision may be inferred from this phase.

### 8F.2 execution readiness

The naive variant path repeats strict research-view loading, replay-clock advancement, market-state updates, and scanner work for every variant. The research-only shared fan-out primitive groups variants by base strategy and fold/partition: canonical candles, replay frames, market state, and scanner output are shared; strategy instances, parameter configurations, execution accounts, orders, fills, positions, analytics, and compact diagnostics remain isolated.

The shared path uses bounded current-frame fan-out rather than a materialized feature matrix. Parameter-dependent strategy contexts remain inside each variant engine. Batch size is operational only and cannot alter experiment identity or result semantics. Checkpoints remain variant-specific and include the robustness variant identity; incompatible earlier smoke checkpoints are not reused.

Stage classification is:

| Stage | Classification |
| --- | --- |
| Canonical research view, calendar/CAS eligibility, candle ordering | invariant across variants |
| Replay clock, market-state updates, scanner universe/features/candidates | invariant across variants of one base strategy group |
| Strategy context and rule evaluation | parameter-dependent |
| Orders, fills, positions, execution account, analytics, diagnostics | mutable per variant |

The research-only coordinator/worker path emits structured telemetry for long-running
batches. Heartbeats cover request validation, research-view assembly, variant
initialization, replay progress, analytics finalization, atomic result writing, result
verification, and completion. Replay progress is emitted on bounded candle milestones
so CPU-bound work remains observable even when timer callbacks cannot run.

Worker result files use bounded deterministic batch keys rather than unbounded variant
lists in filenames. Results are written through a temporary file and atomic rename,
then read back and identity-checked before the coordinator writes its checkpoint.
Resume detection is identity-bound to the frozen spec and recognizes a completed
variant set even when a later invocation uses a different batch size. An interrupted
worker must leave neither a final result nor a temporary result artifact.

The readiness verification batch is intentionally representative only: one frozen
momentum TRAIN batch containing eight non-baseline variants over all 25 instruments.
It does not constitute the full 8F.2 experiment, and no parameter selection or ranking
is performed from its metrics.

On a bounded real-data fixture (720 candles, two frozen instruments, two breakout variants), two legacy passes took 356 ms; one shared batch took 221 ms with identical execution summaries and DATA_GAP counts. This was an infrastructure benchmark. The complete 8F.2 experiment produced 768/768 TRAIN/VALIDATION parameter results and 96/96 TEST cost results, with zero perturbed TEST executions and zero parameter-by-cost combinations. A later audit found that the legacy parameter worker schema omitted durable closed-trade expectancy fields. The separate repaired artifact recovered 576 active rows while retaining 192 zero-trade breakdown rows; 18 groups are locally sensitive and six breakdown groups have insufficient activity. The original raw result is preserved. Phase 8F.3 then completed 800 TRAIN and 60 VALIDATION candidate-fold evaluations. Five candidates per active strategy were shortlisted; none passed the frozen validation gates. All eight breakdown activity candidates failed to reach the pre-registered viable-activity threshold. Optimized TEST executions were zero and no successor strategy was created. The result content hash is `1af9eeb9148603581258f09114329050ef0a065308bed7b2efd4031285636a58`. Phase 8F.4 validated all source identities and closed the research evidence gate without another replay. All four v1 strategies remain frozen research baselines; none has standalone deployment evidence or a validated successor. Its final content hash is `6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41`. See [runtime recovery](runtime-recovery.md) and the [Phase 8 interview notes](interview.md). Phase 8 is complete; Phase 9 is pending.

## Phase 8E — Deterministic walk-forward infrastructure (implemented)

The research-only command is `npm run backtest:walk-forward --workspace api`. It accepts `--strategies`, `--tokens`, `--interval`, `--from`, `--to`, `--train-sessions`, `--validation-sessions`, `--test-sessions`, `--step-sessions`, `--starting-capital`, and `--output`. The default contract is the frozen 25-instrument universe, the frozen research range, 1m candles, all four baseline strategies (`breakout:v1`, `breakdown:v1`, `momentum:v1`, `opening-momentum:v1`), `requireCompleteSession=true`, and `FROZEN_PARAMETERS`.

The initial fold policy is 126 / 21 / 21 valid trading sessions for train / validation / test, stepping 21 sessions. The default range generates four deterministic folds:

| Fold | Train | Validation | Test |
| --- | --- | --- | --- |
| fold-01 | 2025-09-18 → 2026-03-25 | 2026-03-25 → 2026-04-30 | 2026-04-30 → 2026-06-02 |
| fold-02 | 2025-10-20 → 2026-04-30 | 2026-04-30 → 2026-06-02 | 2026-06-02 → 2026-07-02 |
| fold-03 | 2025-11-20 → 2026-06-02 | 2026-06-02 → 2026-07-02 | 2026-07-02 → 2026-07-31 |
| fold-04 | 2025-12-19 → 2026-07-02 | 2026-07-02 → 2026-07-31 | 2026-07-31 → 2026-09-01 |

Boundaries are half-open at session open and are generated from the authoritative calendar, not wall-clock month lengths. Each partition is executed in an isolated replay/paper-execution account, so positions cannot cross partition boundaries. No purge or embargo is applied: the baseline starts each partition with fresh strategy state and scores only candles in that partition. This is conservative and means no prior-partition lookback warmup is silently scored as current-partition data; a future methodology may add explicit warmup context.

Every partition loads candles through `getResearchCandles(..., requireCompleteSession: true)`. Incomplete, missing, and unknown-policy instrument-sessions are excluded and recorded with their reason. Existing Phase 8C paper execution and Phase 8D analytics supply fills, charges, P&L, R metrics, drawdown, holding time, daily risk metrics, and diagnostics. The walk-forward identity includes the frozen universe, both canonical dataset IDs, calendar/CAS versions, strategy versions, fold configuration, execution-assumption version, analytics version, interval, and completeness requirement.

The bounded smoke verification used one frozen strategy and two frozen instruments and produced deterministic run ID `c0d6d8d7221ee079` on repeated identical runs. The research runner now has an optimized mode (the default) that loads each instrument/partition once, shares one immutable replay across the four strategies, maintains historical aggregation incrementally, and avoids repeated weighted-average scans. The legacy path remains available with `--legacy` for equivalence checks. Research checkpoints are written atomically with the full run identity and can be resumed only when that identity matches.

On the four-strategy/two-instrument bounded fixture, the optimized path reduced database loads from 24 to 6 and replay runs from 12 to 3, while preserving byte-identical logical output (excluding runtime performance/output-path metadata), including execution and analytics results. Scanner profiling now records replay, state-update, scanner, strategy, context, feature, filter, scoring, ranking, and operation-count metrics in the research result. The optimized replay uses the same production scanner feature/filter/score functions with a replay-only dirty-instrument mode: a new candle recomputes that instrument's scanner state, while prior-minute candidates expire under the unchanged 30-second stale-data rule. Candidate ordering remains the production score/symbol ordering; no timestamp batching is used because replay events intentionally remain one-candle-at-a-time.

The CLI emits non-identity-bearing JSON progress every 5,000 candles, including fold, partition, replay timestamp, scanner/strategy counts, and elapsed time. Atomic checkpoints remain partition-level because a partially replayed partition cannot safely resume without persisting the isolated scanner, strategy, and execution states. A bounded 25-instrument, three-session run processed 28,125 candles and 1,462,500 strategy evaluations; scanner replay time was 3.35 seconds, while strategy evaluation and context construction remained the dominant costs. The full frozen baseline remains an explicit operator run and is not started automatically. No strategy, fold, execution, eligibility, universe, or candle semantics were changed.
