# Phase 05 Implementation — Production Scanner

**Status:** COMPLETE

## What was built

`ProductionScannerService` consumes `InstrumentUniverseService` and `LatestMarketStateStore`. It calculates only features supported by available data and represents missing or stale values as `UNAVAILABLE` or `UNKNOWN`; it does not manufacture relative volume or volatility.

The scanner applies explicit price, liquidity, stale, and volatility filters, then emits explainable score components, direction, and reasons. Results are ranked to Top-N and minimum-score constraints and persisted as run-scoped `ScannerSignal` records instead of overwriting history. The scheduler is single-flight so overlapping full scans cannot run together.

## Architecture decisions

- Scan in-memory latest state rather than making one REST request per stock.
- Keep candidates separate from strategy setups.
- Preserve the legacy mock pipeline for compatibility while the production page uses `/api/scanner/*`.

## Main code areas

- `apps/api/src/modules/scanner/`
- `apps/web/src/pages/`
- `docs/scanner.md`

## Known limitations

Historical multi-day factors are outside this phase and arrive through Phase 8’s research path.
