# Phase 04 Interview Notes - Real-Time Market Pipeline

**Status:** COMPLETE

## The simple explanation

Phase 4 built the live market-data nervous system.

REST can answer, "what is the price now?" A scanner needs a continuously updated view without requesting every stock repeatedly. The WebSocket pipeline receives Kite packets, validates and normalizes them, keeps the latest state in memory, and notifies consumers.

```text
Kite WebSocket
    -> connection manager
    -> defensive binary parser
    -> normalized market tick
    -> latest-state store
    -> bounded event delivery
    -> scanner and strategy consumers
```

## Why this is more than opening a socket

A market stream must survive disconnects, malformed packets, out-of-order observations, changing subscriptions, and slow consumers. A naive event queue can grow without limit during a burst and eventually exhaust memory.

## Problems and how they were handled

### Connections fail

The connection manager tracks lifecycle state and reconnects with exponential backoff. Stream health is separate from broker-account health so the UI cannot infer that a verified profile means prices are streaming.

### Desired subscriptions drift from actual subscriptions

The service owns desired state. After connection or reconnect, it reconciles the desired instrument/mode set with the broker's current subscription state.

### Binary packets can be malformed

The parser checks packet lengths and boundaries before reading fields. Invalid packets are rejected rather than producing fabricated prices.

### Unknown tokens arrive

The stream uses an in-memory token-to-instrument index built from the Phase 3 master. Unknown tokens are logged and ignored; the hot path does not create instruments or query Prisma for every tick.

### Ticks can arrive late or repeat

`LatestMarketStateStore` applies timestamp ordering and deduplication. An older observation cannot overwrite a newer market state.

### Consumers can be slower than the feed

The event bus uses latest-value-wins behavior and isolates consumers. It does not promise to retain every tick for every subscriber. That is appropriate for current-state consumers and prevents an unbounded backlog.

### Persisting every tick would overload PostgreSQL

The authoritative current state remains in memory. Snapshot persistence is optional and cadence-controlled, with per-tick persistence disabled by default. Historical research later uses canonical candles rather than pretending these optional observations are a complete tape.

## Architecture decisions

- One shared WebSocket provider, not one socket per feature.
- An explicit connection manager instead of reconnect logic scattered through consumers.
- In-memory latest state for low-latency reads.
- Every-applied-tick hooks for consumers that need chronology; latest-value-wins events for consumers that only need current state.
- Separate stream health, broker authentication, and REST market-data health.
- LTP, QUOTE, and FULL subscription modes, with a conservative default.

## Tradeoffs

- Latest-value-wins protects memory but is not an audit-grade tick archive.
- In-memory state is fast but must be rebuilt after restart.
- Optional snapshots aid diagnostics but are not complete historical market data.
- Exponential backoff improves reliability but means recovery is not instantaneous after repeated failures.

## How it was verified

Tests cover packet parsing, malformed input, deduplication, timestamp ordering, stale detection, reconnect behavior, subscription reconciliation, event-bus isolation, and mock-stream behavior.

## A good 30-second interview answer

> "I built a resilient real-time market-data pipeline over Kite WebSocket. It has reconnect and subscription reconciliation, defensive binary parsing, an ordered in-memory latest-state store, stale detection, and a latest-value-wins event bus so slow consumers cannot create unbounded queues. Unknown tokens are ignored rather than invented, and tick persistence is optional because PostgreSQL is not used as the live tape."

## A longer interview answer

> "The hard part was not opening the socket; it was controlling failure and backpressure. I separated provider transport, connection lifecycle, subscription state, parsing, latest state, and event delivery. The state store rejects older or duplicate ticks, while the event bus isolates consumers and coalesces updates. This gives scanners fast current data without one REST request per stock and without retaining every tick indefinitely. The stream has its own health state and remains observation-only."

## Follow-up questions to expect

### Why not put every tick in Kafka or PostgreSQL?

The product did not yet need a full tick archive. The current requirement was safe low-latency state. Adding durable streaming infrastructure without a consumer would increase operational cost and complexity.

### Can latest-value-wins lose information?

Yes, by design. Consumers requiring every applied tick use the state-store hook. Consumers requiring only current state get bounded delivery.

### What happens after restart?

The stream reconnects, reconciles subscriptions, and repopulates current state from new ticks. Historical continuity comes from the dedicated Phase 8 candle subsystem.

## Honest limitations

This phase is not a full exchange tape, order-book engine, or historical store. It provides a reliable current market view for downstream logic.

