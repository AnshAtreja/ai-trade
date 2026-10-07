# Phase 06 Implementation — Strategy Engine

**Status:** COMPLETE

## What was built

The strategy registry evaluates the same candidate independently through four deterministic v1 strategies. Each setup has a version, conditions, reasons, entry trigger, stop, target, reward-risk, and deterministic identity. Invalid setups are represented explicitly when stop or reward-risk rules fail; `NO_SETUP` is not spam-persisted.

Bounded tick history and shared candle aggregation provide the required context while session and stale-data guards protect live evaluation. `SETUP_DETECTED` records are persisted as strategy setups, not orders.

## Architecture decisions

- Keep strategy rules behind a common interface and registry.
- Version every strategy identity.
- Separate scanner candidate generation from strategy setup generation.
- Keep risk sizing and execution out of the strategy engine.

## Main code areas

- `apps/api/src/modules/strategies/`
- `apps/api/src/modules/scanner/`
- `apps/web/src/`
- `docs/strategies.md`

## Known limitations

The v1 strategies are deterministic baselines. They are not optimized or validated by this phase.
