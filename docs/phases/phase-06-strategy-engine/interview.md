# Phase 06 Interview Notes - Strategy Engine

**Status:** COMPLETE

## The simple explanation

Phase 6 converts a scanner candidate into a structured trading setup.

A setup contains direction, conditions, entry trigger, stop, target, reward-risk, invalidation rules, reasons, and a deterministic identity. It is still analysis, not an order.

```text
Scanner candidate
    + bounded market context
    -> strategy registry
       -> breakout:v1
       -> breakdown:v1
       -> momentum:v1
       -> opening-momentum:v1
    -> NO_SETUP / SETUP_DETECTED / SETUP_INVALID / DATA_UNAVAILABLE
```

## Why deterministic strategies came before AI

The project needed a reproducible baseline. If the same market context can produce different opaque answers, debugging execution or backtesting becomes impossible.

The v1 strategies use explicit, versioned rules. Future intelligence can be measured against this baseline rather than replacing it silently.

## Problems and how they were handled

### One candidate may fit several strategies

The registry evaluates enabled strategies independently. One strategy's state or result does not suppress another unless a later decision layer explicitly chooses between them.

### Status and direction are different concepts

`SETUP_DETECTED` is a status. `BULLISH` is a direction. Using BUY/SELL as a status would confuse analytical evidence with an execution instruction.

### Historical context was bounded

Tick history uses a bounded per-instrument buffer. The candle aggregator builds 1-minute and 5-minute OHLC context without storing an unbounded live history.

### Candle gaps must not become zero-price candles

Aggregation preserves missing intervals as missing. A strategy that requires unavailable history receives `DATA_UNAVAILABLE`.

### A mathematically invalid setup should not disappear

If a stop is invalid or the reward-risk is below the configured minimum, the engine returns `SETUP_INVALID` with the reason. This is different from no setup existing.

### Duplicate setup persistence

A deterministic setup identity hashes strategy, version, instrument, direction, and minute bucket. Only meaningful detected setups are persisted, and repeated evaluation does not spam duplicates.

### Opening strategy needs session semantics

Opening momentum cannot evaluate before its opening range exists and should not run all day. Session and time-window guards are part of the strategy context.

## Architecture decisions

- A common strategy interface and registry.
- Versioned IDs such as `breakout:v1`.
- Shared market context and candle aggregation.
- Explicit statuses, conditions, reasons, and invalidation.
- Risk-per-unit is exposed, but position quantity stays in the risk layer.
- Only `SETUP_DETECTED` is persisted.
- Scheduler disabled by default and single-flight.

## Tradeoffs

- Deterministic rules are easier to reproduce and explain, but may be less adaptive.
- Bounded in-memory history avoids runaway memory, but does not replace canonical historical storage.
- A setup identity based on a minute bucket intentionally deduplicates repeated observations within that decision interval.

## How it was verified

Tests cover all four strategy families, candle aggregation, missing data, stale context, session windows, confirmation logic, invalid stops, reward-risk rejection, deterministic identity, persistence behavior, and no order/account mutation.

## A good 30-second interview answer

> "I built a deterministic, versioned strategy registry that evaluates scanner candidates through breakout, breakdown, momentum, and opening-momentum rules. Every evaluation returns explicit conditions, reasons, status, entry, stop, target, reward-risk, and invalidation. Missing history is represented as unavailable, invalid setups are distinct from no setup, and only detected setups are persisted with deterministic identities. The engine never sizes or places an order."

## A longer interview answer

> "I wanted a reproducible baseline before adding any ML or LLM layer. I separated scanner ranking from strategy evaluation and implemented four v1 strategies behind a common registry. Market context comes from bounded tick history and shared 1-minute/5-minute aggregation. Each strategy produces an explainable structured result rather than a boolean. Versioning and deterministic setup hashes make live and historical behavior comparable, while risk sizing and execution remain separate concerns."

## Follow-up questions to expect

### Why keep `SETUP_INVALID`?

It distinguishes "conditions looked promising but the proposed trade geometry was unsafe" from "nothing happened." That is valuable for diagnostics and later research.

### Why not let a strategy decide quantity?

Sizing depends on account capital, current exposure, daily risk, and portfolio constraints. Those belong to the risk and allocation layers, not market-pattern logic.

### How do you prevent future AI work from changing the baseline?

Strategy versions and parameters are frozen in research identities. A changed rule becomes a new version and a separate experiment.

## Honest limitations

These are v1 baseline strategies. Phase 6 proves deterministic behavior and integration, not historical profitability or robustness.

