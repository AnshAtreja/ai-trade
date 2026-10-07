# Phase 08 Implementation — What Exists

**Status:** PARTIALLY COMPLETE BY DESIGN

## 8A — Historical data foundation

Kite historical data is fetched through a provider abstraction, persisted as canonical 1-minute candles in PostgreSQL, validated for coverage, and deterministically aggregated to 5-minute candles. The system models NSE holidays, special sessions, Muhurat trading, the February 2026 Budget session, and CAS-aware session boundaries through versioned calendar/session policies.

The final research dataset intentionally retains a small number of provider gaps. The validator classifies sessions rather than hiding gaps, and the strict research view excludes incomplete sessions without deleting raw observations.

## 8B — Historical replay

`HistoricalReplayClock` and `HistoricalMarketStateAdapter` feed one candle at a time into the existing production scanner and strategy engine. Replay uses the same conceptual market-state interface as live operation, while substituting only the data source. Missing candles become explicit data-gap events. Duplicate candles are reported and skipped deterministically.

## 8C — Historical paper execution

Historical execution consumes replay events in isolated in-memory accounts. Orders created from candle T become eligible from T+1. Existing Phase 7 fill, slippage, charge, partial-fill, stop/target, gap, and conservative intrabar primitives are reused. Operational paper repositories, live market state, and Kite order APIs are unreachable from this path.

## 8D — Analytics

Analytics consumes completed historical execution results without changing execution. It calculates P&L, charges, R multiples, equity and drawdown, holding time, daily-return Sharpe/Sortino when statistically valid, and factual strategy/instrument/direction/exit breakdowns.

## 8D.5 — Research-data contract

Completeness is interval-aware and classified as `COMPLETE`, `INCOMPLETE`, `MISSING`, or `UNKNOWN_POLICY`. Consumers explicitly request `requireCompleteSession`. A strict consumer receives `DATA_GAP`, `MISSING_SESSION`, or `UNKNOWN_SESSION_POLICY` rather than silently treating partial data as ordinary data. Raw holiday observations remain stored but are excluded from policy-valid research views.

## 8E — Walk-forward baseline

The deterministic fold generator uses 126 TRAIN sessions, 21 VALIDATION sessions, 21 TEST sessions, stepping 21 sessions, across four chronological folds. The baseline evaluates exactly `breakout:v1`, `breakdown:v1`, `momentum:v1`, and `opening-momentum:v1` with frozen parameters. TRAIN, VALIDATION, and TEST execution state remains isolated; TEST metrics are aggregated separately.

The completed run produced 48 strategy-partition results over 7,417,125 candles, with strict research eligibility and 22 unique incomplete instrument-sessions excluded as `DATA_GAP`.

## 8F.1 — Baseline validation

This is a read-only analysis of the frozen Phase 8E artifact. It reports fold-level evidence, sample-size warnings, concentration, and unresolved limitations without changing strategies, parameters, folds, candles, or universe membership.

## 8F.2 — Completed robustness experiment

The frozen robustness specification contains 96 non-baseline parameter variants for TRAIN/VALIDATION and six execution-cost scenarios for TEST. Shared replay/fan-out reuses canonical candles, replay frames, market state, and scanner output while isolating strategy state, execution accounts, orders, fills, positions, analytics, and diagnostics.

The coordinator/worker path has structured heartbeats, deterministic artifact names, atomic result writes, spec-hash validation and batch-boundary checkpoints. On September 22, the process was confirmed stopped with 616 validated parameter results; two complete orphan worker results were identity-checked and recovered, bringing durable progress to 632/768. The remaining work resumed under a local macOS supervisor. The final result completed on September 23: 96/96 parameter batches yielded 768/768 TRAIN/VALIDATION results, and 80 new cost workers plus 16 frozen Phase 8E baseline rows yielded 96/96 TEST cost results. No perturbed TEST or parameter-by-cost execution occurred.

Historical execution now indexes pending orders by instrument while retaining the complete ordered audit history. Legacy/indexed execution and analytics produced exactly equal hashes on a rejection-heavy fixture and 27,000 real candles across 25 instruments and eight variants. This is a lookup optimization, not a change to fills, risk rules, strategy parameters, or fees.

The progress monitor verifies actual processes, heartbeat age, matching checkpoints and final artifact completeness. Logs and PID status survive the tool session. Worker completion closes Prisma connections, and atomic worker results can be recovered if the coordinator was lost before writing its checkpoint. Cost workers select one TEST fold from the full frozen fold schedule, rather than trying to construct six-month folds inside a one-month range. Empty cost outputs are rejected. Detailed evidence and commands are in [runtime-recovery.md](runtime-recovery.md).

The authoritative raw result is `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.json` (human-readable companion `.md`), bound to spec hash `2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445` and baseline run `1fd46d5ef1f0e98f`. It preserves all 768 parameter rows and all six frozen cost scenarios per strategy/fold. A post-run audit found that legacy parameter workers omitted durable closed-trade expectancy inputs. The separate recovered artifact now contains exact-match classification metrics for all 576 active rows and retains 192 zero-trade breakdown rows. It reports 18 locally sensitive and six insufficient-activity groups. Its SHA-256 is `6b505345eec692f1d8b04eb5873cf8220b6ec49c0fc5974dccb38113962999e9`. The original artifact remains unchanged. The original artifact's sub-second `runtime` fields describe only its final assembly pass, not the multi-day computation.

## 8F.3 — Controlled optimization (complete)

The frozen `PHASE_8F3_CONTROLLED_OPTIMIZATION_V1` spec has hash `89d84e2f98d8daeb5eddcb5c1c9d5e5f6e940cc5c25df64a08847baadf6daa20`. It registers 64 deterministic Halton-designed multivariate candidates for each of breakout, momentum, and opening-momentum, plus eight activity-recovery candidates for breakdown. Bounds are 70%-130% of frozen v1 settings, with integer/lookback values rounded into valid operational ranges. Frozen v1 is a reference, not a search candidate.

The coordinator runs four TRAIN folds with strict complete-session reads, shared scanner/replay frames, isolated candidate execution accounts, compact analytics, two worker processes, heartbeats, and atomic batch checkpoints. TRAIN activity, fold coverage, drawdown, execution-validity and finite-metric gates are frozen in the spec. A Pareto shortlist of at most five active candidates per strategy is persisted before one VALIDATION pass. Hard stage assertions reject any optimized candidate on TEST. No successor strategy is created during search.

A bounded proof used 720 persisted candles from two frozen instruments and two breakout candidates. Shared and isolated candidate outputs matched exactly; the TEST assertion rejected execution. PostgreSQL-backed tests, TypeScript and the API build passed before launch. A separate fold-01 TRAIN diagnostic inspected one session of all 25 instruments: 121,875 scanner candidates, 120,941 `NO_SETUP`, 127 `SETUP_DETECTED`, 762 `SETUP_INVALID`, and 45 `DATA_UNAVAILABLE`. The most frequent failed condition was `breakdown_level`.

The first supervised worker launch failed before loading data because the worker hashed the persisted spec including its own `specHash` field. The worker now hashes only the spec payload, and a serialized-spec regression test covers this case. No failed worker output was accepted; the corrected run resumed with zero accepted batches.

The full result completed with 800/800 TRAIN candidate-fold executions: 64 candidates each for breakout, momentum and opening-momentum, plus eight breakdown activity candidates, across four TRAIN folds. TRAIN gates admitted 46 breakout, 40 momentum and 41 opening-momentum candidates; Pareto selection froze five candidates per active strategy. The single VALIDATION pass completed 60/60 candidate-fold executions (15 candidates across four folds). No candidate passed the frozen VALIDATION gates: breakout candidates failed baseline-comparison or fold-consistency checks; momentum candidates failed fold-consistency or baseline comparison; opening-momentum candidates failed activity-collapse, fold-consistency or baseline-comparison checks. Breakdown had zero viable activity candidates, so none entered VALIDATION. Final status: `NO_ACCEPTABLE_CANDIDATE` for breakout, momentum and opening-momentum, and `BREAKDOWN_NO_VIABLE_ACTIVITY` for breakdown.

The final report records 800 TRAIN executions, 60 VALIDATION executions and zero optimized TEST executions. The frozen spec hash is `89d84e2f98d8daeb5eddcb5c1c9d5e5f6e940cc5c25df64a08847baadf6daa20`; result content hash is `1af9eeb9148603581258f09114329050ef0a065308bed7b2efd4031285636a58`. The run used two workers and 112 durable batch checkpoints. These findings do not approve a successor strategy or establish profitability.

## 8F.4 — Final baseline strategy evidence gate (complete)

`final-evidence-gate.ts` defines a frozen, deterministic policy. `final-evidence-gate-cli.ts` has separate `spec`, `run`, and `verify` commands. The spec was persisted before the gate ran. The CLI reads seven existing artifacts: the 8E baseline, 8F.1 validation, recovered 8F.2 robustness, 8F.3 final result, and its TRAIN/shortlist/VALIDATION support artifacts. It checks file SHA-256, embedded content hashes, baseline run and dataset identity, partition matrices, scenario counts, and the no-TEST audit. A mismatch stops synthesis. There is no PostgreSQL call or historical replay in this path.

The final report has separate dimensions for baseline retention, validated successor, standalone evidence, deployment evidence, and next research action. All four v1 strategies remain frozen research baselines; validated successors: zero; standalone deployment evidence: insufficient for all four. Breakout and opening-momentum have negative or inconsistent baseline evidence and remain comparators. Momentum has a positive aggregate TEST result and stays a context-feature research subject, but its 16 trades, three negative folds, six locally sensitive parameters, and concentration prevent a deployment claim. Breakdown had no TEST trades and no viable activity-recovery candidate, so strategy redesign is required before further optimization. There is no strategy ranking or forced winner.

Artifacts: `apps/artifacts/phase8f/phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1.{spec.json,spec.md,json,md}`. Frozen spec hash: `c2e99bf80d39a29784b67253cf3293f3fc091c37974371c30152c4c7c6276865`; final research-content hash: `6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41`. Commands: `npm run backtest:final-evidence-gate --workspace api -- spec`, then `run`, then `verify` (on this host, `node --import tsx` can invoke the same CLI when the npm tsx launcher cannot create its sandbox IPC pipe). The final audit records zero historical replay, zero parameter search, and zero optimized TEST executions during 8F.4. The Backtesting web page is a status roadmap; Phase 8 research execution and artifacts are developer CLI only by design, with no research UI in scope.

Focused 8F.4 tests: 4 passed. Full API suite: 34 files, 263 tests passed; its Prisma cases reported PostgreSQL unreachable and skipped internally. TypeScript lint and build passed. Phase 8F.4 has no database dependency. Phase 8 is complete; Phase 9 remains pending. The evidence does not establish a profitable or live-ready strategy.

## Main code areas

- `apps/api/src/modules/historical-market-data/`
- `apps/api/src/modules/scanner/replay/`
- `apps/api/src/modules/scanner/`
- `apps/api/src/modules/strategies/`
- `apps/api/src/modules/paper-trading/execution/`
- `apps/artifacts/phase8e/`
- `apps/artifacts/phase8f/`

## Safety boundary

No Phase 8 module calls Kite order methods. No phase changes live strategy behavior, operational paper state, or canonical historical candles.
