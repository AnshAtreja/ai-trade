# Phase 01 Interview Notes - Foundation & Persistence

**Status:** COMPLETE

## The simple explanation

Phase 1 gave TradePilot a reliable memory and a safe paper-trading foundation.

Before this phase, it would have been easy to hold values such as capital, positions, or P&L only in process memory. That looks fine until the API restarts, two requests arrive together, or a cached account number disagrees with the underlying trades.

The phase established this rule:

```text
Persist facts
    +
derive current state from those facts
    =
restart-safe account state
```

The persisted facts are the paper account's starting capital, risk configuration, trades, orders, positions, and immutable snapshots. Current equity, exposure, day P&L, available capital, and risk remaining are calculated from those records.

## What existed after the phase

```text
API request
    -> service
    -> repository interface
       -> in-memory repository for tests/local work
       -> Prisma/PostgreSQL repository for durable state
```

The rest of the application does not need to know which repository implementation is active. `PERSISTENCE_MODE` selects the implementation.

## The main problem we were solving

A mutable "current account" row is convenient, but it can drift from the real ledger. For example, a trade may be persisted while an account total update fails. After that, two database rows tell different stories.

We instead made domain records authoritative and treated snapshots as historical observations:

```text
PaperAccount.startingCapital
Trades
Positions
RiskConfiguration
        -> derive AccountState on read
```

If a snapshot ever disagrees with a newly derived value, the derived value wins.

## Problems and risks handled

### Restart safety

An environment variable is used only when a paper account is first initialized. Once `PaperAccount.startingCapital` exists, changing the environment does not silently reset the account after restart.

### Double-counting P&L

Equity is:

```text
starting capital + realised P&L + unrealised P&L
```

`totalPnl` is informational. It is not added to equity again.

### Trading-day semantics

Day P&L is based on the `Asia/Kolkata` trading date, not a rolling 24-hour window or the server's local timezone. Centralizing that rule avoids different modules disagreeing about which day a trade belongs to.

### Concurrent trade creation

Two simultaneous requests could both read the same available capital and both approve themselves. The implementation uses a per-user process lock and, in database mode, a `PaperAccount` row lock inside a transaction before risk validation and creation.

### Risk limits supplied by clients

Risk configuration is loaded from the trusted repository. A request body cannot raise its own limits. Checks include available capital, exposure, open-position count, and daily-loss blocking.

## Important architectural decisions

### Repository interfaces

The same services work with memory or PostgreSQL. This made isolated tests fast without creating a separate business-logic implementation.

### Immutable snapshots

Snapshots are audit records written at meaningful events. They are not rewritten continuously and are not the live ledger.

### Derived state

Account totals are formulas over authoritative records. This reduces stale-cache bugs and makes the numbers explainable.

### Candidate persistence without execution

The initial `ScannerSignal` model stores an observation that something looked interesting. It does not turn a scanner candidate into an order.

### Live trading disabled from day one

The Kite adapter's `placeOrder`, `modifyOrder`, and `cancelOrder` methods remain blocked. Building persistence did not accidentally create an execution path.

## Tradeoffs

- Deriving state costs more reads and calculation than reading one mutable total, but gives better consistency and auditability.
- In-memory mode is convenient and deterministic, but intentionally does not survive restart.
- A process lock alone is not distributed coordination; PostgreSQL row locking is the durable concurrency protection in database mode.
- Snapshots are useful for history, but writing them on every tick would create unnecessary storage pressure, so they are event-driven.

## How it was verified

Tests cover repository behavior, account formulas, risk checks, lifecycle updates, persistence behavior, and database-backed paths when PostgreSQL is available. The safety tests also confirm live Kite order methods remain disabled.

## A good 30-second interview answer

> "I built the persistence and account-state foundation for a paper-trading system. I used repository interfaces with both in-memory and Prisma implementations, persisted ledger facts, and derived current equity, exposure, P&L, and risk on read. I also protected trade creation with per-user and database row locks, so concurrent requests cannot spend the same capital. Snapshots are immutable audit observations, while live broker order methods remain disabled."

## A longer interview answer

> "The main design question was whether to persist one mutable account total or derive state from the ledger. I chose to persist the paper account, trades, positions, orders, and risk configuration, then calculate current state from those facts. This avoids a partial update leaving account totals inconsistent with trades. Starting capital becomes authoritative after initialization, day calculations use the market timezone, and risk checks run inside the protected create-trade flow. In-memory repositories support deterministic tests, while Prisma provides restart safety. Immutable snapshots preserve history but are not treated as the ledger."

## Follow-up questions to expect

### Why not use event sourcing?

The design borrows the useful idea of deriving state from durable facts without introducing a full event-sourcing platform. The current scale does not justify event versioning, projections, replay infrastructure, and operational complexity for every domain change.

### Why keep snapshots if state is derived?

Snapshots provide an audit trail of what the application observed at meaningful moments. They speed historical inspection, but they are deliberately not authoritative.

### What would change for multiple API instances?

Database transactions and row locks remain essential. Any behavior relying only on an in-process lock would need distributed coordination or a database-enforced invariant.

## Honest limitations

This phase created a trustworthy paper-state foundation. It did not read a real broker account, stream prices, rank instruments, or execute realistic fills. Those were intentionally separated into later phases.
