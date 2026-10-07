# Phase 03 Interview Notes - Market Universe & REST Market Data

**Status:** COMPLETE

## The simple explanation

Phase 3 taught TradePilot what instruments exist and how to request current prices for them.

Kite's instrument master is a large broker dataset containing equities, derivatives, currencies, commodities, bonds, ETFs, expired contracts, and multiple identifiers. The phase imports that data, normalizes it, persists it, and builds a narrower NSE cash-equity universe for later scanning.

```text
Kite instrument master
    -> provider
    -> normalization
    -> repository upsert
    -> universe filters
    -> NSE cash equities
    -> batched LTP/quote reads
```

## The most important identity lesson

Kite exposes two numeric tokens:

```text
instrumentToken = Kite's canonical instrument identifier
exchangeToken   = exchange/security metadata
```

Historical candles, quotes, and WebSocket subscriptions use `instrumentToken`.

For example:

```text
RELIANCE
instrumentToken = 738561
exchangeToken   = 2885
```

Confusing the two can produce failed or incorrect historical-data requests. The repository and UI therefore label both explicitly.

## Problems and how they were handled

### Symbols are not globally unique

The same trading symbol can exist on more than one exchange. Stable identity prefers `exchange + instrumentToken`, with `exchange + symbol` as a repository uniqueness and lookup constraint.

### The broker master is not a ready-made universe

The source contains FUT, CE, PE, currencies, commodities, ETFs, debt-like symbols, inactive instruments, and rows with expiry dates. The universe service applies explicit filters for active, non-expiring cash-segment `EQ` instruments and excludes ETF-like names.

### Refresh must be idempotent

Repeated syncs upsert normalized records rather than inserting duplicates. Existing records are updated when the authoritative master changes.

Rows absent from a later dump are not destructively deleted. Their lifecycle is represented through active metadata because a temporary source issue should not erase historical identity.

### A UI sample accidentally looked like the universe

An early query applied a row limit before the NSE-equity filter, so the UI displayed an arbitrary first page dominated by bond-like symbols. The correct design filters in the repository query first, then paginates or searches the filtered result.

That is a useful general lesson:

> Filtering after pagination changes the meaning of the page.

### Avoiding one request per instrument

LTP and quote requests are batched through the existing adapter. REST is suitable for manual reads and diagnostics, but not for constructing a live high-frequency tape.

### Mock mode must remain truly offline

The mock provider uses deterministic fixtures and does not contact Kite. This keeps local tests repeatable and prevents accidental credential use.

## Architecture decisions

- Separate provider, normalization, persistence, universe selection, and price retrieval.
- Reuse the shared Kite adapter; do not create another credentials or session stack.
- Put universe rules in one service so scanner code does not duplicate them.
- Persist optional immutable market snapshots rather than overwriting one current row.
- Keep REST market data as a Phase 3 primitive and defer WebSocket streaming to Phase 4.
- Return explicit errors instead of using an empty array for authentication or provider failures.

## Tradeoffs

- Current-master selection introduces survivorship bias for historical research; Phase 8 freezes and documents a research universe rather than pretending it is point-in-time membership.
- Keeping stale rows preserves identity and history, but requires active-state filtering.
- REST batching reduces calls, but it is still not a replacement for streaming data.

## How it was verified

Tests cover parsing, malformed-row handling, idempotent sync, symbol/token lookup, universe filters, quote batching, mock isolation, and Prisma persistence. Manual verification includes syncing the master and resolving major NSE symbols.

## A good 30-second interview answer

> "I built the instrument-master and REST market-data layer. Kite's master contains many asset classes and two easily confused token types, so I normalized it behind a provider, persisted it with idempotent upserts, and centralized the NSE cash-equity filters in a universe service. Quote requests are batched, mock mode is deterministic, and the canonical instrument token is kept distinct from the exchange token."

## A longer interview answer

> "The main challenge was that the broker instrument file is reference data, not a clean trading universe. Symbols are not globally unique, rows cover many exchanges and instrument types, and Kite exposes both instrument and exchange tokens. I separated fetch, normalization, repository upsert, universe filtering, and market-data reads. Identity is exchange plus instrument token, repeated syncs update rather than duplicate rows, and missing rows are not blindly deleted. I also fixed a pagination bug where limiting before filtering made the UI sample look like the whole NSE equity universe."

## Follow-up questions to expect

### Why not hardcode the tokens for the stocks you care about?

Tokens are broker-owned reference data and can change or be corrected. Hardcoding bypasses the authoritative sync path and does not scale to a real universe.

### Why are stale instruments not deleted?

Deletion can destroy historical references and can turn a transient incomplete master into permanent data loss. Active metadata is safer.

### Why not use REST polling for the scanner?

Rate limits and latency make it inefficient. Phase 4 maintains an in-memory latest state from WebSocket data.

## Honest limitations

The universe reflects the current master, not historical index membership. That limitation is explicitly carried into the research phase instead of being hidden.
