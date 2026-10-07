# Phase 02 Interview Notes - Real Kite Account State

**Status:** COMPLETE

## The simple explanation

Phase 2 let TradePilot observe the real Zerodha account without giving the application permission to trade.

The system can read profile, margins, positions, orders, trades, and holdings, normalize them into TradePilot's domain model, and store a timestamped snapshot.

The boundary is:

```text
Kite account
    -> authenticated read-only requests
    -> normalized broker account state
    -> immutable snapshot
    -> UI/API consumers

No broker order route
```

A snapshot marked `LIVE` means it describes a real-money broker account. It does not mean live execution is enabled.

## Why this phase mattered

Paper state and broker state answer different questions:

```text
Paper account = what TradePilot simulated
Kite account  = what Zerodha currently reports
```

Merging them would create dangerous ambiguity. A simulated position must never be mistaken for a broker position, and a Kite order must never silently become an internal paper trade.

## Architecture

```text
BrokerAccountProvider
    -> KiteAccountProvider
       -> existing KiteBrokerAdapter
       -> existing KiteTokenStore
    -> MockBrokerAccountProvider
```

The provider exposes account-reading operations only. Raw Kite payloads are mapped into stable application types before they reach routes or persistence.

## Problems and how they were handled

### Broker data is not one atomic object

Kite exposes profile, margins, positions, orders, and holdings through separate endpoints. One section can fail while the others succeed.

The refresh service fetches sections independently. A non-auth failure produces a `PARTIAL` snapshot with explicit errors and a null section. It does not replace missing funds with fake zeros.

If authentication is invalid, the entire refresh fails because all downstream reads are untrustworthy. If every non-auth section fails, nothing is persisted.

### Rate limits and accidental refresh storms

Repeated UI refreshes could make unnecessary broker calls. A local throttle enforces a minimum refresh interval and returns a clear rate-limit state.

### Secrets leaking into persistence or logs

Access tokens remain in the encrypted `KiteTokenStore`. Database snapshots contain normalized account information, never API secrets or raw credential payloads. Errors are sanitized before reaching clients.

### Misleading connection state

Configuration, stored authentication, verified connectivity, account readability, and market-data liveness are separate concepts. A valid profile request verifies the broker session; it does not imply that the WebSocket is streaming or that order execution is enabled.

### LIVE being mistaken for permission

The word `LIVE` appears only as account context. The provider has no order methods, and the shared adapter still throws for `placeOrder`, `modifyOrder`, and `cancelOrder`.

## Important decisions

- Reuse the existing adapter and token store instead of creating duplicate HTTP or credential handling.
- Normalize external payloads at the boundary so broker schema changes do not leak through the application.
- Persist immutable observations rather than mutating the paper ledger.
- Let GET return the latest persisted observation; only the refresh command contacts Kite.
- Preserve partial success instead of erasing useful sections.
- Keep holdings separate from positions and paper exposure.

## Tradeoffs

- On-demand refresh is predictable and rate-limit friendly, but the snapshot can become stale between refreshes.
- Partial snapshots require consumers to handle nullable sections, but that is safer than invented defaults.
- An encrypted local token store is appropriate for this deployment, but a distributed deployment would need managed secret storage.

## How it was verified

Tests cover normalized mapping, partial failures, authentication expiry, throttling, snapshot persistence, health reporting, and Prisma-backed behavior. Separate safety tests confirm that live order methods remain disabled.

## A good 30-second interview answer

> "I added a read-only broker account layer over Kite. It reuses one authenticated adapter and token store, fetches account sections independently, normalizes the external payloads, and persists immutable snapshots. Partial non-auth failures are represented explicitly instead of becoming zero balances. Most importantly, account visibility is separate from execution permission, so the provider cannot place or modify orders."

## A longer interview answer

> "The tricky part was that a broker account is not returned atomically. Margins, positions, orders, holdings, and profile are separate calls and can fail independently. I designed a provider abstraction with real and mock implementations, fetched each section independently, and stored either a complete or explicit partial snapshot. Authentication failures stop the whole refresh, while ordinary section failures preserve successful data. Credentials remain in the existing encrypted token store, raw payloads never become API contracts, and the read-only provider has no execution methods."

## Follow-up questions to expect

### Why store snapshots rather than always call Kite?

Snapshots provide a stable audit record, reduce broker calls, let the UI remain readable during a transient outage, and separate external observation from application reads.

### Why not merge Kite positions into the paper ledger?

They have different ownership and semantics. Broker positions are external facts; paper positions are simulated application state. Combining them would corrupt risk and P&L calculations.

### Does CONNECTED mean market data is live?

No. A successful read-only profile verification proves the session works. The market WebSocket has its own health state.

## Honest limitations

There is no background polling, cross-account reconciliation, or order routing in this phase. Account state is only as fresh as the latest explicit refresh.
