# Phase 8F.2 Runtime Recovery - September 22, 2026

Status: workload recovery completed; the full experiment finished on September 23, 2026. Spec `PHASE_8F2_ROBUSTNESS_V1`, hash `2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445`, baseline `1fd46d5ef1f0e98f` remain frozen. A later classification-schema audit found that parameter worker outputs omitted durable expectancy inputs; raw work is preserved while deterministic classification recovery remains pending.

## Why the old display stayed at 608

The shell loop counted filenames and printed RUNNING whenever the final artifact was incomplete. It never inspected a process. It also missed the older, valid `momentum-fold-01-TRAIN-batch.json` checkpoint. There were 616 valid parameter rows, not just the 608 inferred from filenames.

Read-only process inspection confirmed no coordinator or research workers remained. Two additional full worker result files existed without matching coordinator checkpoints:

- opening-momentum / fold-01 / TRAIN / stopBufferPercent and targetRewardRisk variants
- opening-momentum / fold-02 / TRAIN / breakBufferPercent and minMomentumPercent variants

Their frozen spec, baseline, strategy, fold, partition, exact variant set, result-row uniqueness, candle counts and full instrument counts were verified before adopting them. Neither source result was rewritten. Their new checkpoints contain SHA-256 content hashes. Recovery brought progress to 632/768, with 79/96 parameter batches durable.

The old run did not preserve exit diagnostics, so its precise termination cause is unknown. A missing tool-session ID alone is not proof that a process died; the OS process table must also be checked. A complete worker file proves the worker finished writing results even if its parent failed to record a checkpoint.

## Why opening-momentum was slower

Existing completed TRAIN artifacts show roughly 74,000-94,000 orders per opening-momentum variant, versus about 2,000 for breakout. Historical execution called `orders.filter(...)` on every candle, traversing rejected and filled orders indefinitely. Near the end of a long partition it visited tens of thousands of irrelevant records per variant per candle. The display's zero order/setup values were unpopulated telemetry placeholders and have been removed.

The execution engine now keeps an insertion-ordered pending-order index by instrument. Rejected orders never enter it; filled orders leave it. Full audit arrays and their object identities are preserved. Partial fills, T+1 eligibility, limits, duplicate setup identities, stops, targets, charges, risk checks and account isolation remain unchanged. A legacy scan option exists only for equivalence verification.

This fixes a measured source of wasted work. It does not establish how much of the old multi-hour wall time also involved sleep, host memory pressure or other system activity. No unmeasured end-to-end speedup is claimed.

## Measured verification

- An isolated execution fixture with 74,000 rejected orders followed by 5,000 candles made 370 million order visits in legacy mode and zero in indexed mode. The first measurement reduced the candle loop from 1,606 ms to 12 ms; execution and analytics hashes matched exactly. This fixture is not canonical historical data.
- A database-backed comparison used all 25 instruments, eight opening-momentum variants, and three complete sessions from September 7 through September 9, 2026: 27,000 candles. Legacy took 34.577 seconds, indexed took 30.667 seconds (about 11.3% less time). Orders per variant ranged from 2,158 to 3,380, with 25 fills each.
- Real-data logical digest in both modes: `ec584a99769f12f2bd0613df63eaf4228d24ff7adbb16a7d801601676570fd7c`.
- Real benchmark process peak RSS reached about 395 MiB; the second measurement includes the same process's earlier high-water mark and is not a separate per-mode peak-memory comparison.
- Full API suite: 31 files, 247 tests passed, including PostgreSQL-backed tests. Monitor tests: 2 passed. API TypeScript: passed.
- Frozen baseline artifact SHA-256 still matches `8070a2f7e6e1c23aafc9cf801d385b2aa064cd004cdfb298e9214594de23c852`.

Report: `apps/artifacts/phase8f/execution-index-equivalence-2026-09-22.json`.

## Durable execution and monitoring

The macOS launcher submits a one-shot launchd job named `com.tradepilot.robustness8f2`. It does not automatically retry failures. The supervisor starts the coordinator with its explicit project directory and Node executable. The coordinator starts two direct Node workers. Logs, exit codes/signals, worker PIDs and heartbeat snapshots are written to research artifacts. This survives loss of the tool session; it cannot make computation continue while the laptop is asleep or powered off.

From the repository root:

```bash
node scripts/robustness-process.mjs status
node scripts/robustness-process.mjs --watch 120
```

The watch prints immediately, then every two minutes. It shows validated results, active worker PIDs, current fold, candle progress, heartbeat age and heap usage. It exits on verified completion or STOPPED. Failed process inspection is UNKNOWN; an alive worker with old telemetry is reported as stale rather than assumed healthy.

The cost display is `0/80 new + 16 frozen baseline`: the six-scenario total of 96 includes 16 C0 rows reused from Phase 8E. There are only 80 new cost-worker checkpoints.

Resume when stopped:

```bash
node scripts/robustness-process.mjs start
```

The launcher refuses duplicate or unverifiable launches. Already accepted checkpoints are skipped. Fully written orphan outputs are validated before recovery; incomplete batches restart from their beginning. With two active workers, up to two unfinished batches can require repetition. There is no mid-candle checkpointing.

Log: `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.log`.
Runtime: `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.runtime.json`.
Supervisor exit record: same prefix with `.supervisor.json`.

## Cost-stage correctness gate

The previous cost worker passed a 21-session TEST range to a fold generator needing 126+21+21 sessions. That yields no folds. It now selects the requested TEST fold from the existing full frozen schedule, requests only that partition's research data, and requires exactly one nonempty partition result. Tests verify the range and reject empty cost output. No historical cost results were accepted during this fix.

The final artifact is marked complete only when all 768 parameter rows, 96 cost rows and zero perturbed TEST executions are present. On September 23, `node scripts/robustness-process.mjs status` reported `COMPLETE`, 96/96 parameter batches, 80/80 new cost batches plus 16 frozen baseline rows, and zero workers. The final JSON and Markdown artifacts are under `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.*`. The final invocation assembled already completed checkpoints; its sub-second runtime is not the total worker compute time. This operational completion does not validate the legacy parameter classifications: recovery now requires a schema-versioned sidecar with closed-trade count, monetary expectancy, valid-R count, expectancy R, and drawdown, while preserving every original execution metric exactly. Strategy rules, parameters, universe, fold boundaries, canonical candles and execution assumptions were not changed. PostgreSQL was already healthy and was not restarted; no API/web containers were required. No live order operations or research parameter selection were performed.

## Classification-metrics recovery

The original 8F.2 raw workload remains authoritative, but its parameter worker schema did not persist the closed-trade expectancy fields needed by the frozen classifier. The recovery path reruns only the 576 active TRAIN/VALIDATION parameter rows in 72 batches of eight variants. The 192 zero-trade breakdown rows are retained without replay because their zero activity is already sufficient and must not be fabricated into activity.

Recovery batches vary widely:

- VALIDATION batches are shorter because they cover 21 sessions.
- TRAIN batches are much heavier because they cover 126 sessions and can replay about 1.16 million candles for eight variants.
- Opening-momentum batches are often slowest because they generate far more candidate orders than breakout or momentum.

A long TRAIN recovery batch taking one to three hours can be normal on the local laptop. Progress must therefore be judged from worker heartbeats and process state, not from accepted batch count alone. The accepted batch count changes only after a whole batch finishes and writes its atomic result. During a long batch, the correct signal is a live worker process with increasing `candlesProcessed`, recent `lastHeartbeatAt`, and bounded heap usage.

The recovery output is intentionally separate from the original artifact:

```text
apps/artifacts/phase8f/classification-metrics-recovery-1fd46d5ef1f0e98f-v1/
apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1-classification-recovered.json
```

The repaired artifact must reference the original artifact and hash, preserve every original execution metric exactly, add only the durable classification metrics, and recompute a stable research hash that excludes transient telemetry. It must not run perturbed TEST parameters, combine parameter and cost scenarios, change strategies, change folds, change candles, or start Phase 8F.3.

## Classification recovery completed — September 28

The recovery completed all 72/72 batches and 576/576 active rows. It retained the 192 zero-trade breakdown rows without replay. The authoritative repaired JSON is `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1-classification-recovered.json` (SHA-256 `6b505345eec692f1d8b04eb5873cf8220b6ec49c0fc5974dccb38113962999e9`); the companion Markdown SHA-256 is `7d6a4f7cc985bf3bd054d5c65a8ef3fa6f8c3f491e3c491e625df87383765045`. It contains 768 parameter rows, 96 cost rows, 24 parameter classifications, zero perturbed TEST executions, and zero parameter-by-cost combinations. Eighteen active groups are locally sensitive; six breakdown groups have insufficient activity. The original raw result was left intact. The earlier text in this document records the conditions under which recovery was designed and started; this section records its verified outcome.
