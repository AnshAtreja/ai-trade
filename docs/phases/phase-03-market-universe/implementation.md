# Phase 03 Implementation — Market Universe & REST Market Data

**Status:** COMPLETE

## What was built

`InstrumentProvider` supports Kite and mock sources. `InstrumentSyncService` normalizes the Kite instrument master into persistent instrument rows. Identity prefers `exchange + instrumentToken`, with symbol uniqueness enforced for lookup. `InstrumentUniverseService` filters for cash-equity `EQ` instruments and excludes ETFs, derivatives, and unsuitable segments.

Market data uses batched LTP/quote requests through the existing broker adapter. Optional `MarketSnapshot` rows preserve immutable observations without forcing every consumer to query the broker directly.

## Important identity lesson

Kite exposes both `instrument_token` and `exchange_token`. Historical OHLCV requests require the instrument token. The repository and UI must label these fields explicitly so an exchange token is never accidentally used for historical data.

## Main code areas

- `apps/api/src/modules/market-data/`
- `apps/api/src/modules/broker/adapters/`
- `apps/api/src/db/repositories/`

## Known limitations

The universe reflects the current instrument master and therefore needs refresh and later survivorship-bias controls for historical research.
