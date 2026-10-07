# Phase 08 Interview Notes - Historical Research & Backtesting

**Status:** COMPLETE

Phase 8A through 8F.4 are complete. The 8F.2 parameter-classification recovery finished on September 28, 2026; 8F.3 finished its controlled search, and 8F.4 closed the read-only evidence gate. Phase 9 remains pending. Completion does not assert strategy profitability or live readiness.

## The one-line explanation

> Phase 8 turned the trading engine into a reproducible research platform: canonical historical data, leakage-safe replay, realistic execution, streaming analytics, chronological walk-forward evaluation, and robustness testing with resumable large-scale workers.

## The simple explanation

At the start, the request sounded like this:

> "Can we backtest the strategies?"

A toy answer would have been:

```text
read candles
    -> run an if statement
    -> assume entry at close
    -> add profits
```

That would produce a number, but not a number we could trust.

Phase 8 instead asks:

```text
Was the source data complete and correctly understood?
Did the strategy see only information available at that moment?
Would the order actually have been eligible to fill?
Were slippage, liquidity, gaps, and charges included?
Was performance measured consistently?
Was the final period truly unseen?
Does the result survive small parameter and cost changes?
Can the large run finish and resume without corrupting evidence?
```

That is why Phase 8 became a research program rather than one backtest script.

## Before and after

Before Phase 8:

```text
Live market
    -> latest market state
    -> scanner
    -> strategy
    -> paper execution
```

After the implemented Phase 8 work:

```text
Historical database
    -> policy-aware research view
    -> historical replay clock
    -> historical market-state adapter
    -> same scanner
    -> same deterministic strategies
    -> historical paper execution
    -> analytics
    -> TRAIN / VALIDATION / TEST folds
    -> frozen baseline artifact
    -> validation and robustness research
```

The key architectural choice was to reuse production scanner, strategy, and execution rules. The historical path substitutes the market-data source and clock; it does not create separate "backtest strategies."

# Phase 8A - Building trustworthy historical data

## What we built

Kite historical candles are downloaded through a provider abstraction, stored in PostgreSQL as canonical 1-minute observations, validated, and aggregated deterministically into 5-minute candles.

```text
Kite historical API
    -> chunking, throttling, retry
    -> normalized 1m candles
    -> insert-only persistence
    -> policy-aware validation
    -> deterministic 5m aggregation
```

## Why historical data was not simple

A naive model would assume:

```text
Monday to Friday
09:15 to 15:30 IST
375 one-minute candles every day
```

The real research period contained:

- ordinary exchange holidays;
- ordinary weekends;
- Muhurat trading with special boundaries;
- a Sunday Union Budget trading session on February 1, 2026;
- the 2026 Closing Auction Session transition;
- instrument-specific CAS eligibility;
- provider observations on dates the authoritative calendar still classifies as holidays;
- genuine missing expected candles;
- duplicate and incomplete download concerns.

The validator therefore needed to understand what was expected before it could call anything missing.

## The calendar defect story

The first calendar version did not model the February 1, 2026 Union Budget cash-market session. Kite had returned candles for that Sunday, but raw provider data alone was not treated as proof of an exchange session.

The session was added only after reconciling the authoritative NSE Capital Market circular. Because calendar meaning changed, the calendar became:

```text
NSE_CASH_2025_2026_V2
```

The old identifier was not silently reused.

This is a strong interview lesson:

> Reference data is part of research logic. Changing a calendar can change expected coverage and therefore must be versioned like code.

## CAS-aware session semantics

From the CAS transition, not every selected security had the same expected continuous-session behavior by assumption. The system combines:

```text
calendar version
+ trade date
+ instrument identity
+ CAS eligibility version
    -> authoritative expected session boundaries
```

This prevented the validator from reporting structurally nonexistent closing-window candles as download failures.

## Raw observation is not the same as research-valid data

Some raw Kite rows exist on dates classified as holidays. Those rows remain stored for auditability, but they do not enter the canonical research view.

```text
raw persisted provider observation
    !=
policy-valid research candle
```

Deleting the rows would destroy evidence. Accepting them blindly would let provider behavior override exchange policy. The research-view layer resolves that distinction.

## Missing-candle policy

The final frozen dataset intentionally retains small provider gaps. No candle was forward-filled, interpolated, copied from a neighbor, or manufactured.

The contract classifies every instrument/date/interval session as:

```text
COMPLETE
INCOMPLETE
MISSING
UNKNOWN_POLICY
```

A consumer must explicitly request whether complete sessions are required.

For the continuous-intraday baseline:

```text
requireCompleteSession = true
```

An incomplete session is rejected with a reason such as `DATA_GAP`; the actual observations remain preserved.

## Frozen research data

```text
Universe:
NSE_EQ_RESEARCH_UNIVERSE_2026_V1

Universe manifest:
feaabc0198432edc

Calendar:
NSE_CASH_2025_2026_V2

CAS eligibility:
NSE_CAS_ELIGIBILITY_2026_V2

Range:
[2025-09-18T03:45:00.000Z,
 2026-09-18T03:45:00.000Z)
```

Canonical identities and coverage:

```text
1m dataset:
505dca3f27301e72
expected 2,258,250
actual   2,258,180
missing  70

5m dataset:
535e2347e56143d9
expected 451,650
actual   451,646
missing  4
```

The important claim is not "perfect data." It is:

> Known gaps are explicit, deterministic, and excluded when a consumer requires continuous sessions.

## Interview answer for 8A

> "I built a PostgreSQL-backed historical market-data pipeline with deterministic aggregation and policy-aware validation. The difficult part was defining what should exist: exchange holidays, special sessions, the Budget Sunday session, Muhurat trading, and instrument-specific closing-auction rules changed expected boundaries. I versioned the calendar and CAS policy, preserved raw observations, and added an explicit completeness contract so incomplete sessions are rejected instead of filled with synthetic candles."

# Phase 8B - Building a time machine without future leakage

## What replay means

Historical data exists as a complete file, but a strategy at 10:30 must not know the 10:31 candle.

The replay clock advances chronologically:

```text
09:15 -> state contains data through 09:15
09:16 -> state contains data through 09:16
09:17 -> state contains data through 09:17
```

At replay time T, scanner, candle aggregation, rolling calculations, opening ranges, prior highs/lows, and strategy context can access only data at or before T.

## Architecture

```text
Historical candles
    -> HistoricalReplayClock
    -> HistoricalMarketStateAdapter
    -> market-state interface
    -> ProductionScannerService
    -> StrategyEngineService and registry
    -> replay events
```

The live path remains:

```text
Kite WebSocket
    -> LatestMarketStateStore
    -> scanner
    -> strategy engine
```

Only the source/state adapter changes.

## How no-lookahead was tested

One especially important regression test runs replay through timestamp T, records all outputs, changes a candle strictly after T, and runs again. Outputs through T must remain identical.

Additional tests cover chronological ordering, `[from, to)` range semantics, one-candle advancement, duplicate handling, gaps, multi-instrument tie-breaking, aggregation, boundaries, and repeated-run determinism.

## Gap behavior

Replay does not invent a candle when an expected timestamp is absent. It emits an explicit `DATA_GAP` event. Duplicate historical candles are reported and skipped deterministically.

## Interview answer for 8B

> "I built an event-driven historical replay engine that advances one candle at a time through the same market-state interface used by production. At timestamp T, no component can access a later candle. I proved that by mutating future data and checking that all earlier scanner and strategy outputs remained identical."

# Phase 8C - Turning setups into realistic historical trades

## Why a setup is not a trade

Suppose a strategy produces:

```text
BUY RELIANCE
entry 100
stop 98
target 104
```

A simplistic backtest might fill at 100 immediately. Realistically:

- the decision was created after a candle completed;
- the order is not eligible until the next candle;
- the limit may never trade;
- available volume may fill only part of the order;
- price may slip;
- a gap may cross the stop;
- stop and target may both occur inside one OHLC candle;
- charges reduce net P&L.

## Execution semantics

Orders created from candle T are first eligible at T+1. Historical execution uses isolated in-memory accounts and reuses Phase 7's pure fill, slippage, charges, partial-fill, stop/target, gap, and ambiguity rules.

```text
SETUP_DETECTED
    -> historical order
    -> T+1 eligibility
    -> fill / partial fill / no fill
    -> position
    -> stop / target / square-off
    -> exit fill
    -> gross P&L - charges = net P&L
```

If one candle contains both stop and target, the conservative ambiguity policy avoids assuming the profitable sequence.

## Isolation

Historical execution cannot reach:

- the operational paper account;
- live market state;
- Kite order placement, modification, or cancellation;
- current account state.

This prevents a research command from mutating the product's operational ledger.

## Interview answer for 8C

> "I reused the production paper-execution primitives inside an isolated historical account. Orders generated on candle T are eligible only from T+1, and the simulation includes limit eligibility, partial fills, slippage, gap-through stops, conservative same-bar ambiguity, and charges. That avoids the common backtesting mistake of assuming every signal fills perfectly at the observed close."

# Phase 8D - Measuring outcomes without changing them

## The boundary

```text
8C decides what happened.
8D measures what happened.
```

Analytics cannot create, cancel, or alter an order.

## Metrics

The analytics layer calculates:

- gross and net P&L;
- charges;
- win rate;
- profit factor;
- expectancy;
- R multiples;
- average and median R;
- equity and drawdown;
- daily returns;
- Sharpe and Sortino when statistically valid;
- average holding time;
- long/short and exit-reason breakdowns;
- strategy and instrument contributions;
- incomplete-trade and data-quality diagnostics.

A profitable aggregate can still be weak evidence if it came from one trade, one fold, one instrument, or one sector. The analytics layer therefore keeps sample-size and concentration context.

## Interview answer for 8D

> "I kept analytics downstream from execution so metric changes cannot change fills. The layer calculates P&L, transaction costs, expectancy, R-based statistics, drawdown, holding time, and factual breakdowns, while emitting insufficient-sample diagnostics instead of presenting unstable Sharpe or win-rate numbers as meaningful."

# Phase 8D.5 - Freezing a research-grade dataset contract

## Why this intermediate phase existed

Before walk-forward evaluation, the system needed one exact answer to:

> Which candles, instruments, sessions, calendar rules, and gap policies define this experiment?

The phase froze:

- the 25-instrument universe;
- canonical instrument tokens;
- research dates;
- calendar version;
- CAS eligibility version;
- canonical 1m and 5m dataset identities;
- complete-session eligibility behavior;
- no-synthetic-data policy.

It also documented survivorship bias: the universe was selected from current authoritative instruments, not reconstructed point-in-time index membership.

## Interval-aware completeness

A session can legitimately be:

```text
1m INCOMPLETE
5m COMPLETE
```

Completeness is evaluated separately by interval. Consumer filtering does not mutate the canonical dataset identity.

## Interview answer for 8D.5

> "Before evaluating strategies, I froze a versioned research-data contract. It includes universe, date range, calendar, CAS policy, dataset hashes, interval, and complete-session requirements. Eligibility is metadata rather than destructive filtering, so raw observations remain available while strict consumers reject incomplete sessions."

# Phase 8E - Walk-forward evaluation on unseen periods

## The overfitting problem

Repeatedly testing and adjusting a strategy on the same history eventually teaches the rules that history.

The phase separates:

```text
TRAIN      = historical development/warmup evidence
VALIDATION = controlled comparison evidence
TEST       = untouched out-of-sample evidence
```

A simple analogy:

```text
TRAIN      = textbook exercises
VALIDATION = mock exam
TEST       = final exam
```

## Walk-forward folds

Instead of relying on one lucky split, four chronological folds move through time:

```text
Fold 1: TRAIN -------- VALIDATION -- TEST
Fold 2:    TRAIN -------- VALIDATION -- TEST
Fold 3:       TRAIN -------- VALIDATION -- TEST
Fold 4:          TRAIN -------- VALIDATION -- TEST
```

The frozen configuration is:

```text
TRAIN      126 trading sessions
VALIDATION  21 trading sessions
TEST        21 trading sessions
step        21 trading sessions
```

Trading dates come from the authoritative calendar, not shuffled samples or fixed wall-clock day counts.

## Partition isolation

TRAIN, VALIDATION, and TEST each receive fresh:

- strategy state;
- execution account;
- orders;
- positions;
- P&L;
- analytics.

Positions do not cross partition boundaries. Historical warmup context may initialize indicators, but signals or P&L outside the scored partition are not attributed inside it.

## Frozen baseline

Exactly these strategies were evaluated without tuning:

```text
breakout:v1
breakdown:v1
momentum:v1
opening-momentum:v1
```

The completed baseline produced:

```text
4 strategies
x 4 folds
x 3 partitions
= 48 strategy-partition results

7,417,125 candles processed
approximately 170 million strategy evaluations
```

Frozen run identity:

```text
1fd46d5ef1f0e98f
```

The run identity includes universe, dataset IDs, calendar, CAS policy, strategies, parameter mode, fold configuration, execution assumptions, analytics version, interval, and completeness requirement.

# The Phase 8 engineering problems

The research semantics worked before the full workload could finish reliably. Most of the later engineering effort was controlling repeated work, memory, and durable progress without changing results.

## Problem 1 - Repeated historical loading and scanner work

Overlapping folds and multiple strategies were repeatedly loading identical immutable candles and rebuilding the same scanner context.

The optimized path reuses safe immutable work:

```text
canonical candles
    -> one replay frame
    -> one scanner evaluation
    -> shared immutable market context
       -> isolated strategy A
       -> isolated strategy B
       -> isolated strategy C
       -> isolated strategy D
```

What is shared:

- immutable canonical candles;
- replay timestamps;
- session metadata;
- market-state progression;
- scanner features and candidates;
- safe historical preprocessing.

What remains isolated:

- strategy state;
- execution accounts;
- orders and fills;
- positions;
- P&L;
- analytics;
- partition state.

Reusing source data is not the same as reusing trading outcomes.

## Problem 2 - Too many candle and event copies

The first large path retained or rebuilt multiple representations:

```text
canonical candle
    -> copied replay candle
    -> event wrapper
    -> grouped arrays
    -> sorted arrays
    -> strategy context copies
```

At more than a million candles, object overhead matters as much as raw price data.

The fix was to share immutable candle references, process replay incrementally, avoid unnecessary sorting and slicing, and construct an event only when it is being handled.

A measured assembly improvement reduced heap from roughly:

```text
1.33 GB -> 459 MB
```

without changing logical output.

## Problem 3 - Snapshot retention

Historical execution originally retained rich portfolio snapshots for every candle.

```text
1,000,000+ candles
x multiple strategies
x account snapshot object
= millions of retained objects
```

For research runs, most of that detail was not needed after aggregate metrics were updated. Snapshot and equity-curve collection became configurable and disabled in bounded streaming paths.

## Problem 4 - The replay finished, then analytics crashed

This was the most revealing failure.

A large partition processed all 1,165,875 candles successfully, then Node ran out of memory during analytics finalization.

The problem was not the replay. Each completed strategy retained more than a million equity points, and final analytics copied, sorted, and transformed those arrays into drawdown and return structures.

The checkpoint reached approximately:

```text
871,417,114 bytes
about 831 MB
```

## The streaming analytics fix

Metrics such as maximum drawdown can be updated online:

```text
peak = max(previous peak, current equity)
drawdown = peak - current equity
max drawdown = max(previous max drawdown, drawdown)
```

Daily-return metrics need daily closing equity, not every intraday equity observation.

The analytics path was changed from:

```text
retain every point
    -> copy arrays
    -> sort arrays
    -> calculate at the end
```

to:

```text
observe current point
    -> update compact accumulators
    -> retain only required daily/summary state
```

The compact checkpoint became approximately:

```text
77,654 bytes
about 76 KB
```

That is the same research meaning with a checkpoint reduction from about 831 MB to 76 KB.

A strong interview sentence is:

> "The replay had completed, but post-processing still exhausted V8 because analytics retained and copied millions of equity points. I replaced that with exact streaming accumulators, reducing the checkpoint from roughly 831 MB to 76 KB without changing the calculated metrics."

## Problem 5 - Long runs need reliable resume

A full partition can run for tens of minutes or longer. Losing all completed work after an interruption was unacceptable.

The checkpoint model records completed independent units. On restart:

```text
load checkpoint
    -> validate full research identity
    -> reject incompatible checkpoint
    -> skip completed work
    -> run missing units
    -> write final artifact atomically
```

Atomic writing uses:

```text
write temporary file
    -> finish and verify
    -> rename to final path
```

An interrupted temporary file is never accepted as a completed result.

Resume equivalence was tested by comparing an uninterrupted bounded run with an interrupted-and-resumed run. Run identities and logical results matched.

## Problem 6 - Relative artifact paths changed under npm workspaces

Workspace commands executed under `apps/api`, so relative artifact paths could resolve somewhere different from an ordinary root command. Some parent directories also did not exist before an atomic write.

The fix standardized path resolution from the repository root, created required directories, and added pre-flight tests for write, read, rename, and identity round-trip.

This is a useful operational lesson:

> A correct algorithm can still fail because process working-directory assumptions are part of the runtime contract.

## Problem 7 - Memory telemetry itself needed safe semantics

Heap, RSS, progress, and checkpoint status were added so long workers could be distinguished from hung workers. Telemetry had to remain observational: it could report or stop on configured safety thresholds, but it could not silently change strategies, folds, or execution results.

## Problem 8 - Results must be deterministic after optimization

Every performance optimization was checked against a bounded legacy path. Equivalence comparisons included scanner candidates, strategy setups, orders, fills, trades, charges, P&L, analytics, exclusions, and run identity.

A speed improvement was accepted only when logical results remained equal.

# Phase 8F.1 - Reading the baseline without changing it

Phase 8F.1 is a read-only validation gate over the frozen Phase 8E artifact.

It asks:

- How many TEST trades exist?
- Are results consistent across folds?
- Is P&L concentrated in one instrument or sector?
- Does gross edge survive charges?
- Are sample sizes large enough to support a conclusion?
- Does TRAIN behavior differ sharply from TEST behavior?

It does not rewrite strategies after seeing TEST.

## Examples of factual findings

Momentum had positive aggregate TEST P&L, but only a small number of TEST trades and meaningful concentration in one fold and IT/HCLTECH contribution. The correct conclusion was not "momentum works"; it was "the result is interesting but the evidence is small and concentrated."

Breakout had slightly positive gross trading P&L but charges exceeded the gross edge, making net P&L negative. That demonstrates why a price-only backtest can make a non-viable implementation look attractive.

These are diagnostics, not strategy rankings or deployment recommendations.

# Phase 8F.2 - Robustness and sensitivity infrastructure

## The question

A strategy can look good only at one exact parameter value:

```text
18 -> poor
19 -> poor
20 -> excellent
21 -> poor
22 -> poor
```

That may indicate overfitting.

A more stable neighborhood looks like:

```text
18 -> reasonable
19 -> reasonable
20 -> good
21 -> reasonable
22 -> reasonable
```

Phase 8F.2 measures local sensitivity. It does not choose a winner.

## Frozen experiment

There are 24 numeric parameters. Each is changed one at a time around baseline:

```text
-20%
-10%
 baseline
+10%
+20%
```

That creates 96 non-baseline variants.

Perturbed parameter variants use TRAIN and VALIDATION only:

```text
96 variants
x 4 folds
x 2 partitions
= 768 logical parameter results
```

TEST is reserved for frozen-parameter cost scenarios:

```text
4 strategies
x 4 TEST folds
x 6 cost scenarios
= 96 scenario-partition results
```

Parameter changes and cost changes are never combined in this phase.

## Why shared replay was necessary

The first approach replayed the same history independently for every variant:

```text
variant 1 -> load, scan, replay
variant 2 -> load, scan, replay again
variant 3 -> load, scan, replay again
```

Only the parameter differed.

The shared runner now does:

```text
one immutable candle stream
    -> one market-state progression
    -> one scanner result
    -> variant fan-out
       -> isolated strategy state
       -> isolated execution account
       -> isolated analytics
```

Bounded equivalence showed that shared and legacy paths produced the same setups, fills, incomplete positions, and data-gap counts while reducing repeated work.

## Why coordinator and workers were added

A single process running every batch for hours makes memory reclamation and failure recovery harder.

```text
Coordinator
    -> worker: strategy/fold/partition + 8 variants
    -> atomic result
    -> checkpoint
    -> worker exits
    -> next worker
```

Benefits:

- the operating system reclaims process memory;
- failures are isolated to one batch;
- completed batches remain complete;
- resume is identity-safe;
- heartbeats expose actual progress;
- output names are bounded and deterministic.

## Issues found during full-experiment preparation

- A long worker originally emitted no progress, so healthy computation looked frozen. Structured heartbeats were added.
- Very long variant IDs produced a filename that exceeded filesystem limits. Output names now use deterministic short hashes.
- Loading all 25 research views concurrently exhausted Prisma's connection pool. Worker loading now uses bounded concurrency.
- The initial complete coordinator was serial and would require an impractically long wall-clock run. Bounded worker concurrency was added while preserving result ordering and isolated state.
- Interrupted workers must leave no accepted final result or checkpoint.
- Perturbed TEST execution is rejected in code, not merely avoided by convention.

## The September 22 stalled-progress incident

This incident exposed three different problems that initially looked like one slow batch. The user's terminal kept printing 608 completed results and RUNNING, even after the research processes had disappeared. That display was wrong: it checked for a final artifact but never checked whether the coordinator or workers existed. In plain language, it treated "not finished" as "still working."

The replacement monitor checks the OS process table, worker identity, saved heartbeat time and actual candle counters. A vanished worker is STOPPED. A process that still exists but has stopped reporting is shown as stale. A worker can also remain alive while its candle count does not move, so that condition is reported separately. Progress reports must distinguish durable work from current activity.

Next, the filename count itself missed an older valid checkpoint, so the accepted result count was really 616. Two other workers had completely written their result files, but the coordinator had not recorded their checkpoints. Those results were recovered only after checking the frozen experiment, exact variants, fold, partition and result completeness. That advanced the total to 632 without replaying those two expensive batches. Recovery must handle the small gap between "worker wrote output" and "coordinator acknowledged output."

There was also a concrete algorithmic slowdown. Opening-momentum generated around 74,000-94,000 order records per variant. Most were rejected or already finished, yet the engine scanned the full list on every new candle. Imagine checking every receipt you have ever received whenever you want to know which deliveries are still pending. We kept the full receipt history for auditing and added a separate, ordered index containing only pending deliveries. In execution terms, the index contains pending orders for the current instrument and drops filled orders. It changes lookup work without changing trading decisions.

A 74,000-order stress fixture previously scanned 370 million rows over 5,000 further candles. The index made that zero because all those orders were already terminal. The loop fell from roughly 1.6 seconds to 12 milliseconds, with exactly identical execution and analytics hashes. A separate real-data test covering 25 instruments, 27,000 candles and eight variants also matched exactly; its smaller order history produced a more modest runtime improvement, 34.6 to 30.7 seconds. We should not claim the isolated scan speedup as the speedup of the whole research run.

Finally, the resumed coordinator ran under a local OS supervisor with persistent logs and exit records. It closes database connections when workers finish and resumes validated batch results. The old run did not preserve enough evidence to establish its precise termination cause. The experiment subsequently finished; supervision and performance work were engineering prerequisites, not research conclusions. See [runtime recovery](runtime-recovery.md) for commands and test evidence.

An interview explanation could be: "I debugged a batch that looked stuck and found both an observability bug and an algorithmic bottleneck. The monitor confused unfinished work with a live process, and execution repeatedly scanned tens of thousands of completed orders. I added PID-aware monitoring, recovery of complete worker outputs, and a pending-order index, then proved execution and analytics stayed exactly equivalent before resuming."

## What the full run actually finished

The final status command reported `COMPLETE`, 96/96 parameter batches, 80/80 new cost batches plus 16 frozen Phase 8E baseline cost rows, and zero active workers. The 96 parameter batches contain eight variants each, which gives 768 TRAIN/VALIDATION results. The 96 cost rows cover four strategies, four TEST folds and six frozen scenarios each. The final JSON and Markdown artifacts exist and the JSON records zero perturbed TEST executions and zero parameter-by-cost combinations.

The result is bound to baseline run `1fd46d5ef1f0e98f`, robustness specification `PHASE_8F2_ROBUSTNESS_V1`, and specification hash `2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445`. The full machine-readable evidence is in `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.json`; the companion `.md` is a brief index, not the complete data table.

One subtle point matters when explaining the result: the JSON `runtime.totalRuntimeMs` is sub-second because the final invocation only assembled already completed checkpoints. It launched zero workers. It does not measure the entire multi-day experiment. Worker result files include individual elapsed times, but the final summary does not aggregate them into one reliable wall-clock figure.

## What the results say, in plain language

The original artifact displayed every parameter-neighborhood classification as `INSUFFICIENT_ACTIVITY`. A post-run audit found that this was not a valid evidence statement: the legacy worker persisted execution summaries but omitted the durable trade-count, monetary-expectancy, expectancy-R, and drawdown inputs required by the classifier. The raw per-variant TRAIN and VALIDATION results remain preserved. A versioned recovery schema proved the missing classification values on a real active batch by matching every original fill and P&L value exactly, then completed all 72 recovery batches. The repaired artifact classifies 18 active parameter groups as `LOCALLY_SENSITIVE`; the six breakdown groups remain `INSUFFICIENT_ACTIVITY` because all 192 rows had zero closed trades. The original result was not rewritten.

The cost stress test is more concrete, but still descriptive. The table below sums the four TEST folds for each strategy and scenario; values are rupees of modeled net P&L from the existing historical execution layer. `C0` is the frozen Phase 8E baseline reused in this result. The other scenarios apply the preregistered cost or slippage stresses with frozen strategy parameters.

| Strategy | TEST trades in C0 | C0 net | C1 net | C2 net | S1 net | S2 net | CS1 net |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| `breakout:v1` | 22 | -7,737.22 | -26,882.41 | -29,546.17 | -29,546.25 | -31,322.10 | -32,210.01 |
| `breakdown:v1` | 0 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 | 0.00 |
| `momentum:v1` | 16 | +99,863.43 | +94,062.74 | +88,262.00 | +88,262.38 | +84,394.86 | +82,461.68 |
| `opening-momentum:v1` | 18 | -34,907.02 | -37,652.49 | -40,398.03 | -40,339.83 | -42,150.68 | -43,085.31 |

Do not read the cost columns as a simple fee subtraction from fixed trades in every case. For breakout, C0 contains 22 closed trades while each stressed scenario contains 10. The historical execution model can change which orders fill when slippage or costs change. This is why cost stress is run through the same execution engine instead of adjusting an aggregate P&L number afterward. Breakdown's zero is zero observed TEST trades, not proof of safety or stability. Momentum's positive totals still rest on 16 baseline TEST trades and the concentration concerns found in 8F.1. Phase 8F.2 made no strategy or parameter selection.

## How to tell the engineering story in an interview

Start with the research question: "Do small changes to our frozen strategy settings or execution costs change the historical evidence?" Then explain why the first implementation could not be run cheaply: 96 parameter variants repeated the same candle loading, market-state updates and scanner work. We let variants share one immutable replay and scanner stream, while each retained its own strategy rules, orders, account and analytics. That preserved independent outcomes and reduced repeated computation.

Next describe the operational failure. Progress stayed at 608 and said RUNNING even when no workers existed. We checked the OS process table, found 616 accepted results and two complete unacknowledged worker outputs, validated their identities and recovered them to 632. We fixed the monitor to distinguish a live worker, a stale heartbeat, stopped work and durable checkpoint progress. The old run's exact termination cause could not be reconstructed, which is an honest limit of the evidence.

Then describe the real hot path. Opening-momentum accumulated tens of thousands of rejected or finished orders, and execution scanned the entire historical order list for each candle. We kept the full audit list and indexed only pending orders by instrument. A synthetic high-order fixture reduced 370 million irrelevant visits to zero and its loop from about 1.6 seconds to 12 milliseconds. On 27,000 real candles across 25 instruments and eight variants, runtime moved from 34.6 to 30.7 seconds with equal execution and analytics hashes. State clearly that the synthetic timing is a microbenchmark, while the real-data improvement was about 11.3% on that bounded fixture.

Finally state the outcome precisely: the complete workload produced 768 parameter and 96 cost results, all tied to a frozen spec and baseline. TEST was never used for perturbed parameter trials. Classification recovery subsequently repaired the missing inputs without changing original execution results. None of this justified a parameter change or strategy deployment.

A 60-second version is:

> "For Phase 8F.2 I ran a frozen sensitivity experiment around our four baseline strategies. It evaluated 96 one-at-a-time parameter variants across TRAIN and VALIDATION, plus six execution-cost scenarios on TEST with the original parameters. Variants shared one immutable historical replay and scanner pass while keeping separate strategies and simulated accounts. During the long run I fixed a misleading monitor, recovered validated worker outputs after a coordinator interruption, and removed an expensive scan of completed orders. Equivalence tests showed the optimized execution made the same decisions. The workload produced 768 parameter results and 96 cost results with no perturbed TEST executions. A post-run audit caught a missing-metrics schema defect; I repaired the classification inputs separately and verified every preserved execution value, finding 18 locally sensitive groups and six zero-trade breakdown groups."

# The research principles behind the phase

## No future leakage

At time T, no future price, volume, candle, daily close, setup outcome, or later partition can influence the decision.

## TEST remains untouched

Once TEST has been observed, using it to tune parameters makes it training data. Parameter sensitivity therefore stays in TRAIN and VALIDATION.

## No synthetic repair

Missing candles remain missing. Complete-session consumers exclude affected sessions.

## No silent mutation of baselines

Changing data, calendar, universe, fold configuration, parameters, or execution assumptions creates a different deterministic identity.

## No live side effects

Historical replay and research execution cannot reach operational paper state or Kite order APIs.

# Architecture decisions worth discussing

- Reuse production scanner and strategy implementations.
- Substitute only the clock and market-data adapter.
- Reuse Phase 7 execution primitives.
- Separate replay, execution, and analytics.
- Make data completeness an explicit consumer contract.
- Version calendars, CAS policy, universe, datasets, strategies, and run assumptions.
- Keep partition execution isolated.
- Use streaming analytics rather than retaining full histories.
- Checkpoint only safe independent units.
- Use process workers for memory reclamation and fault isolation.
- Prove optimized/legacy equivalence before accepting performance work.
- Treat diagnostics as evidence, not strategy recommendations.

# Honest limitations and tradeoffs

- The frozen universe uses current authoritative instruments, so survivorship bias remains.
- Historical prices are not yet a complete point-in-time corporate-action-adjusted research database.
- The dataset contains known provider gaps, although strict consumers exclude incomplete sessions.
- One-minute OHLC bars cannot reveal exact intrabar order.
- Charges and slippage are deterministic models, not exchange matching-engine truth.
- The research period is about one year, which limits regime coverage.
- Several strategy TEST samples are small.
- Robustness infrastructure is expensive because isolated execution semantics are preserved.
- Phase 8 does not prove future profitability.

# A good 30-second interview answer

> "Phase 8 turned my live trading architecture into a deterministic historical research platform. I built versioned historical data and session policies, replayed candles one event at a time through the production scanner and strategies without lookahead, reused realistic paper-execution rules, added streaming analytics, and evaluated frozen strategies with chronological walk-forward TRAIN, VALIDATION, and TEST folds. The system is gap-aware, checkpointed, resumable, and isolated from live trading."

# How to explain Phase 8 in 60-90 seconds

> "I built the research and backtesting layer for TradePilot. I first created a PostgreSQL-backed historical-data pipeline with strict NSE calendar and session handling, including holidays, special sessions, the Budget Sunday session, and closing-auction eligibility. Incomplete sessions are excluded explicitly rather than repaired with synthetic candles.
>
> I then built a deterministic replay clock that feeds one candle at a time through the same scanner and versioned strategies used by the live system, which prevents future-data leakage. Historical paper execution reuses the production fill, slippage, partial-fill, stop, gap, and charge logic, with orders becoming eligible only from the next candle.
>
> On top of that I added streaming analytics and four-fold chronological walk-forward evaluation with isolated TRAIN, VALIDATION, and TEST accounts. The largest engineering challenge was memory: replay and analytics originally retained millions of objects. By sharing immutable candle state and calculating analytics online, I reduced a research checkpoint from about 831 MB to 76 KB without changing metrics. Long runs are now identity-checked, atomic, checkpointed, resumable, and executed in isolated workers. The result is a reproducible research platform, not just a P&L script."

# The strongest technical-problem answer

> "One full replay processed 1,165,875 candles successfully and then crashed during analytics. Profiling showed that every strategy retained more than a million equity points and finalization copied and sorted them. I replaced those arrays with exact online accumulators for peak equity, drawdown, daily closes, and summary statistics. The checkpoint fell from approximately 831 MB to 76 KB, and equivalence tests confirmed the metrics were unchanged."

# The strongest data-quality answer

> "The difficult part was not downloading candles; it was defining which candles should exist. NSE holidays, Muhurat trading, a Sunday Budget session, and instrument-specific closing-auction rules all changed expected coverage. I versioned the exchange calendar and session policy, preserved raw provider observations, and made completeness an explicit interval-aware eligibility contract."

# The strongest research-integrity answer

> "I froze the strategies and research identity before reading TEST results. Parameter sensitivity runs only on TRAIN and VALIDATION, while TEST is used with frozen parameters for factual out-of-sample and cost-stress evidence. That prevents TEST from quietly becoming training data."

# Follow-up questions to expect

## Why reuse production logic instead of a vectorized backtester?

Reusing production scanner, strategy, and execution rules reduces semantic drift. A faster research adapter is acceptable only when equivalence tests prove it makes identical decisions.

## Why not fill 70 missing candles?

A synthetic value can change indicators, entries, stops, and P&L while pretending to be market evidence. Excluding an incomplete session is more honest for continuous intraday strategies.

## Why deterministic IDs?

They make evidence traceable. If calendar, data, universe, strategy, fold, or execution assumptions change, the run should no longer look identical.

## Why use worker processes?

Workers bound failure scope, let the operating system reclaim memory, make checkpoint units explicit, and allow long experiments to resume without keeping one giant process alive.

## Why did Phase 8F.2 avoid parameter optimization?

8F.2 measured local sensitivity around frozen v1 settings. Phase 8F.3 is a separately frozen experiment with TRAIN search, an immutable shortlist, one VALIDATION pass, and no optimized TEST execution. This preserves the meaning of the earlier robustness evidence.

## Did Phase 8 prove the strategies are profitable?

No. It produced controlled historical evidence with known assumptions and limitations. Future performance can differ, and small or concentrated samples remain weak evidence.

# A concise interview closing

> "The most important outcome of Phase 8 was not a profitable number. It was a system that makes it difficult to cheat accidentally: data policies are versioned, future data is unavailable, fills are explicit, costs are included, TEST is protected, results are deterministic, and long research runs can resume safely."

# Phase 8F.3 — Controlled optimization (complete)

Phase 8F.2 asked whether the existing settings were sensitive to small one-at-a-time changes. Eighteen active parameter groups were locally sensitive, while breakdown generated no closed trades across 192 perturbed rows. Phase 8F.3 asked whether a small, preregistered multivariate search on TRAIN could produce candidates that passed frozen gates on unseen VALIDATION. The completed experiment found no acceptable candidate, which is a valid research outcome.

The experiment's source is the recovered 8F.2 artifact, SHA-256 `6b505345eec692f1d8b04eb5873cf8220b6ec49c0fc5974dccb38113962999e9`. Its frozen specification is `PHASE_8F3_CONTROLLED_OPTIMIZATION_V1`, hash `89d84e2f98d8daeb5eddcb5c1c9d5e5f6e940cc5c25df64a08847baadf6daa20`. This identity binds the original dataset, calendar, CAS policy, universe and execution assumptions through the Phase 8E baseline, plus the new search design and selection rules.

The active search evaluated 64 deterministic multivariate candidates for each of breakout, momentum and opening-momentum. It used a six-dimensional Halton design within preregistered operational bounds, rather than enumerating every combination of five values across six parameters. Breakdown had eight separate activity-recovery candidates. It was evaluated for actual trading activity first; profit was not the objective of that diagnostic search. The v1 settings remained a reference and are not presented as an optimized result.

The enforced order evaluated candidates on four TRAIN folds; activity, fold coverage, drawdown, execution-validity and metric gates determined eligibility; a Pareto shortlist of five candidates per active strategy was frozen; then those candidate IDs ran once on four VALIDATION folds. The worker and coordinator reject any optimized candidate request for TEST. Candidate strategy and execution accounts stayed isolated even though candles, scanner output and replay frames were shared inside a batch.

Before launch, a real-data proof processed 720 candles from two instruments. Two candidate configurations produced exactly the same result when evaluated together through shared replay as when evaluated separately. The baseline path emitted canonical classification metrics. The API suite passed 258 tests across 33 files, including PostgreSQL-backed tests; TypeScript and build passed. This proof established orchestration correctness on a bounded sample, not candidate quality.

The breakdown diagnostic used one fold-01 TRAIN session and all 25 frozen instruments. It saw 121,875 scanner candidates, with 120,941 `NO_SETUP`, 127 `SETUP_DETECTED`, 762 `SETUP_INVALID`, and 45 `DATA_UNAVAILABLE` evaluations. The most frequent failed condition was `breakdown_level`. The separate eight-candidate TRAIN activity search found no viable activity candidate, so breakdown did not proceed to VALIDATION.

One launch defect was caught before a research batch produced output: the worker included the persisted `specHash` field when rehashing the spec's contents, so it rejected the valid frozen file. The content hash must cover the spec payload, excluding its own hash field. A focused serialized-spec test now covers that path. No candidate result was accepted from the failed workers; the supervisor resumed from zero durable batches.

The completed run produced 800 TRAIN candidate-fold evaluations, then froze a 15-candidate shortlist and ran it once across four VALIDATION folds for 60 evaluations. No optimized candidate ran on TEST. None passed the preregistered VALIDATION gates: breakout, momentum and opening-momentum ended `NO_ACCEPTABLE_CANDIDATE`; breakdown ended `BREAKDOWN_NO_VIABLE_ACTIVITY`. No successor strategy was created. The result content hash is `1af9eeb9148603581258f09114329050ef0a065308bed7b2efd4031285636a58`.

For an interview, explain it this way: "I ran a preregistered, bounded parameter search using TRAIN data only, then froze a shortlist before one VALIDATION pass. Some candidates passed the TRAIN gates, but none passed the frozen validation criteria. Breakdown also failed to produce enough activity. We recorded no successor strategy rather than relaxing thresholds after seeing results, and optimized candidates never touched TEST."

# Phase 8F.4 — Closing the research evidence gate

## Why this phase existed

At the end of 8F.3, we had a large collection of evidence, but it lived in separate places. The frozen walk-forward run told us what happened in four chronological TEST folds. The 8F.1 report described sample size and concentration. The repaired 8F.2 artifact described parameter sensitivity and six cost scenarios. The 8F.3 result said that no optimized candidate survived its single VALIDATION pass. The remaining task was to say exactly what those results support, while keeping the meaning of each earlier experiment intact.

The short answer is: **Phase 8 completed the research infrastructure and recorded the current strategies' evidence. It did not discover a validated production strategy.** All four v1 strategies remain useful as immutable comparisons for later research. No v2 strategy was created.

## What the gate actually did

The gate first froze a versioned rule spec, `PHASE_8F4_FINAL_EVIDENCE_GATE_V1`, with hash `c2e99bf80d39a29784b67253cf3293f3fc091c37974371c30152c4c7c6276865`. It then read seven existing artifacts: the 8E baseline, 8F.1 analysis, repaired 8F.2 result, 8F.3 final result, and the 8F.3 TRAIN, shortlist, and VALIDATION support files. Each file had to match a frozen SHA-256. Embedded research-content hashes and cross-artifact links had to match too. The gate checked the 48 original walk-forward partitions, 16 TEST table rows, 768 parameter rows, 96 cost rows, 800 TRAIN candidate evaluations, 60 VALIDATION evaluations, and zero optimized TEST evaluations.

Only after these checks did it construct an evidence matrix. That order matters: a polished conclusion built from the wrong calendar, a partial file, or a different run would be worse than no conclusion. The result is deterministic because it contains research facts and rules, with no wall-clock runtime field in its content hash. Running verification again checks that the JSON and Markdown still match the same inputs. The final content hash is `6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41`.

The code has no call to historical download, replay, strategy evaluation, paper execution, PostgreSQL, or Kite. This phase performed **zero new historical replay, parameter search, or optimized TEST executions**. It synthesized recorded evidence.

## Why there is more than one label per strategy

A single winner/loser label would mix up different questions. The gate stores five separate facts: whether a frozen baseline is retained; whether a validated successor exists; what the standalone evidence says; whether deployment evidence is sufficient; and where later research should go. All four baselines are retained and all four lack a validated successor. That does not mean all four have the same evidence or need the same next step.

The deployment rule is deliberately conservative: it asks for at least 30 TEST trades, no more than one negative-expectancy TEST fold, and no locally sensitive parameter groups. These are **TradePilot's frozen Phase 8 gate criteria**, not a universal statistical law. Every current strategy fails at least one. The rule was frozen before the final gate was applied; we did not loosen it to rescue a strategy after seeing the final labels.

| Frozen baseline | TEST trades | TEST net P&L | Negative TEST folds | Parameter evidence | 8F.3 outcome | Final research route |
| --- | ---: | ---: | ---: | --- | --- | --- |
| `breakout:v1` | 22 | -7,737.22 | 3/4 | 6/6 locally sensitive | No acceptable candidate | Preserve as comparator |
| `breakdown:v1` | 0 | 0.00 | 0/4, no trades | 6/6 insufficient activity | No viable activity candidate | Redesign before more optimization |
| `momentum:v1` | 16 | +99,863.43 | 3/4 | 6/6 locally sensitive | No acceptable candidate | Research context features |
| `opening-momentum:v1` | 18 | -34,907.02 | 3/4 | 6/6 locally sensitive | No acceptable candidate | Preserve as comparator |

For breakout, the result is negative after modeled costs. Only one TEST fold has positive expectancy. All six parameter groups changed behavior under local perturbations. The TRAIN search had 46 eligible candidates and a five-candidate shortlist, but none passed the frozen VALIDATION criteria. Its current role is a comparison baseline, not a parameter retuning target.

For opening-momentum, the aggregate TEST result is also negative and three folds have negative expectancy. It had 41 TRAIN candidates pass the first gates, but its five shortlisted configurations failed activity, fold-consistency, or baseline comparison checks on VALIDATION. This demonstrates why TRAIN improvement alone cannot justify a new version.

Momentum is the subtle case. Its TEST aggregate is positive, and all six predefined cost scenarios remain positive in aggregate. But that aggregate comes from only 16 TEST trades; three of four TEST folds have negative expectancy. Information Technology contributed about 96,087.55 of modeled net P&L from two trades, which illustrates concentration. Its six parameters were locally sensitive, and all five shortlisted candidates failed the frozen VALIDATION rules. The conclusion is **interesting research evidence that warrants context-feature experiments**, with insufficient evidence for standalone deployment. We did not call it the best strategy or promote its parameters.

Breakdown illustrates a different failure mode. The 8F.2 parameter study had 192 zero-trade rows. The 8F.3 TRAIN-only funnel observed some setups, but no activity-recovery configuration met the pre-registered viable-trading threshold. It sent no candidate to VALIDATION. Further parameter optimization would be hard to interpret until the strategy's signal-to-execution path is redesigned and versioned. The v1 version stays frozen as a comparator.

## Architectural decisions and tradeoffs

The main decision was to keep the final gate **read-only**. Earlier phases already did the expensive work; rerunning TEST or searching again here would quietly change the research question. The gate validates file bytes, embedded content hashes, strategy/fold matrices, and identity links. That gives a reproducible chain from the final disposition back to the candles, calendar, folds, and execution assumptions recorded by 8E.

The 8F.2 result contains both parameter tests and cost tests, but they answer different questions. Parameter perturbations used TRAIN/VALIDATION. The frozen baseline cost scenarios used TEST. The gate summarizes them separately and checks that no perturbed parameters entered TEST. Likewise, 8F.3's TRAIN search and one-time VALIDATION shortlist are not retroactively treated as an out-of-sample TEST result.

The first attempt to invoke the new CLI through `npm run` failed before executing the gate because this environment denied the `tsx` IPC pipe. The equivalent `node --import tsx` invocation successfully froze the spec and generated the report. The focused tests and full TypeScript build passed. This is a launcher/environment issue, not a research-data mismatch. The full API suite reported 34 files and 263 passing tests; Prisma tests reported PostgreSQL unreachable and skipped internally. This gate has no PostgreSQL dependency.

## Phase 9 handoff and remaining limits

Phase 9 may build market regime and context features on top of the validated research infrastructure. It must keep each v1 strategy unchanged. A regime filter, VWAP context, relative-strength filter, Kronos signal, meta-label, or news feature that changes a decision needs a new research version and independent evaluation. An ablation compares the same frozen baseline with and without that feature under the same data and execution contract. AI or extra features are not assumed to help.

The open limitations are material: approximately one year of history, a current-universe selection with survivorship bias, four walk-forward folds, small TEST trade samples, local parameter sensitivity, concentration in some results, inactive breakdown execution, and simulated rather than observed live fills. There is no validated successor and no future shadow/live evidence yet. Closing Phase 8 means the evidence process and artifacts are complete; it is not an authorization to trade any strategy live.

## Interview answers

**30 seconds:** "I closed the backtesting project with a read-only evidence gate over the frozen walk-forward, validation, robustness, and optimization artifacts. It verified file hashes, experiment identities, fold counts, and no-TEST leakage before recording separate conclusions for each v1 strategy. We retained all four as research baselines, found no validated successor, and made no deployment claim."

**60–90 seconds:** "After building historical data, replay, realistic paper execution, analytics, and walk-forward evaluation, I ran local parameter and cost sensitivity tests and a bounded TRAIN-only optimization. The final phase had to reconcile those experiments without rerunning them. I froze a rule specification and verified the source artifacts by SHA-256, content hashes, and cross-artifact counts. The result distinguishes baseline retention, successor validation, evidence quality, and the next research route. Momentum had positive aggregate TEST P&L but only 16 trades, three negative folds, parameter sensitivity, and concentration; it stays a context-research baseline, not a live candidate. Breakout and opening-momentum had negative or inconsistent evidence, while breakdown had no viable trading activity and needs redesign. No optimized candidate touched TEST, no v2 was created, and Phase 9 starts with a clear ablation and versioning contract."

**Likely follow-up: Why retain a negative baseline?** Because a frozen comparator lets later work measure incremental value honestly. Removing it after seeing bad results would hide the starting point.

**Likely follow-up: Why did momentum not pass?** Its positive total was based on 16 trades and one positive-expectancy fold; concentration and sensitivity weakened the evidence. The frozen gate asks more than aggregate P&L.

**Likely follow-up: Why zero new TEST runs?** TEST had already been observed in 8E and the predefined 8F.2 cost scenarios. Running more optimized candidates on TEST would turn the holdout into a search surface.

**Likely follow-up: What would a Phase 9 improvement look like?** A separately versioned candidate with a defined context feature, compared against the unchanged v1 baseline using the same data and execution assumptions, followed by fresh independent evidence.
