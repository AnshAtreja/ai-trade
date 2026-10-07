# Phase 04 Implementation — Real-Time Market Pipeline

**Status:** COMPLETE

## What was built

`MarketStreamProvider` reuses `KiteBrokerAdapter.openMarketWebSocket` for Kite and has a mock implementation for tests. A connection manager reconnects with exponential backoff and reconciles desired subscriptions with the broker’s actual state. The stream supports LTP, QUOTE, and FULL modes, defaulting to LTP.

Binary packets are parsed with bounds checks. Unknown tokens are logged and ignored rather than invented. `LatestMarketStateStore` enforces timestamp ordering, deduplication, and stale detection. `MarketTickEventBus` uses latest-value-wins semantics so slow consumers do not create unbounded queues.

## Architecture decisions

- Keep live market state in memory for fast scanner reads.
- Make persistence of snapshots optional and disabled by default.
- Keep the stream independent from scanner and strategy decisions.
- Expose stream health separately from broker account health.

## Main code areas

- `apps/api/src/modules/market-data/stream/`
- `apps/api/src/modules/market-data/`

## Known limitations

The system intentionally does not retain every tick as a historical tape. Historical research uses the dedicated candle subsystem in Phase 8.
