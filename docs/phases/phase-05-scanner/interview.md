# Phase 05 Interview Notes - Production Scanner

**Status:** COMPLETE

## The simple explanation

The scanner answers one question:

> Which instruments deserve closer attention right now?

It does not answer whether TradePilot should buy or sell.

```text
NSE equity universe
    + latest market state
    -> features
    -> hard filters
    -> explainable score
    -> ranked candidates
    -> persisted ScannerSignal observations
```

This reduced a large tradable universe into a small, explainable candidate set for the strategy engine.

## Why the scanner is separate from strategy logic

A scanner is broad and cheap: it reduces the search space. A strategy is narrow and specific: it decides whether a setup exists.

Keeping them separate means:

```text
Scanner: "RELIANCE looks interesting."
Strategy: "Breakout v1 conditions are satisfied."
Risk: "The account can afford this trade."
Execution: "This order filled under these assumptions."
```

No layer silently takes over another layer's responsibility.

## Problems and how they were handled

### A per-stock REST loop would be slow and rate-limit heavy

The scanner reads from Phase 4's in-memory latest-state store and the Phase 3 universe. It does not request a fresh quote for each stock during every run.

### Missing data can create fake confidence

Some features, such as relative volume or multi-day volatility, were not available yet. The scanner represents them as `UNKNOWN` or `UNAVAILABLE`; it does not invent an average volume, ATR, RSI, or score contribution.

This is an important design principle:

> Missing evidence is not negative evidence, and it is not permission to fabricate a value.

### Stale prices can look valid

A stale tick may still contain a plausible number. The scanner checks age explicitly and excludes stale observations rather than treating them as zero or current.

### Scores can become unexplainable

The score is broken into named components such as activity, momentum, range expansion, day-extremum proximity, and price movement. Candidates include reasons that correspond to actual feature states.

### Scheduled scans can overlap

If one full-universe scan takes longer than the interval, a second run could compete for state and persistence. The scheduler is single-flight and skips overlapping runs.

### Persisting candidates can overwrite history

Signals use run-scoped dedupe identity. A new scan creates a new observation instead of rewriting the previous run's candidate.

## Architecture decisions

- Read one shared live state rather than polling REST.
- Apply hard data-quality and universe filters before scoring.
- Keep feature calculation, filtering, scoring, ranking, and persistence separate.
- Persist only meaningful candidates, not every rejected instrument.
- Keep manual run and disabled-by-default scheduling.
- Preserve the legacy mock pipeline for compatibility while production endpoints and UI use the new service.

## Tradeoffs

- The scanner is only as useful as the fields present in LTP/QUOTE ticks.
- Explicit unknowns reduce apparent feature richness, but improve honesty.
- Top-N ranking is operationally useful, but it is not evidence that rank 1 is profitable.
- Run metadata remains in memory, while candidate records are persisted.

## How it was verified

Tests cover feature calculation, bullish/bearish/neutral direction, filters, stale and missing data, ranking, closed-session behavior, single-flight scheduling, persistence identity, and absence of order or paper-account mutation.

## A good 30-second interview answer

> "I built a production scanner that combines a synchronized NSE equity universe with the in-memory WebSocket state. It calculates only supported features, explicitly marks unavailable data, applies hard liquidity, price, volatility, and freshness filters, then emits a ranked candidate list with score components and reasons. It is single-flight and persists run-scoped observations, but it never makes a trade decision."

## A longer interview answer

> "The key design choice was separating broad candidate generation from strategy decisions. The scanner reads the shared latest-state store, so it avoids a rate-limited REST loop. Data quality is enforced before scoring: stale or missing prices are excluded, and unavailable historical features remain unknown rather than being approximated. The score is decomposed into explainable components, and each persisted signal belongs to a scan run. This made the pipeline efficient, reproducible, and auditable without pretending a high scanner score is a buy signal."

## Follow-up questions to expect

### Why score at all if strategy rules make the decision?

The score prioritizes scarce downstream attention. It is a ranking mechanism, not a probability of profit.

### Why not persist every evaluated instrument?

Most rows would be low-value rejected observations. Run statistics capture filter counts, while persistence focuses on candidates that passed the gate.

### What happens outside market hours?

The scheduler does not run ordinary scans outside valid sessions. A manual forced run is available for controlled diagnostics.

## Honest limitations

Phase 5 does not include multi-day historical features, market-regime intelligence, news, or profitability validation.

