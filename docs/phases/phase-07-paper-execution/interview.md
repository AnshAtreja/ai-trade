# Phase 07 Interview Notes - Realistic Paper Execution

**Status:** COMPLETE

## The simple explanation

Phase 7 built a small paper broker.

Before this phase, it would have been tempting to treat a strategy setup as an instant trade at the visible price. Real execution is messier: orders wait, limits may not fill, liquidity can be partial, prices slip, stops can gap, and fees reduce P&L.

```text
Strategy setup or manual request
    -> risk checks
    -> paper order
    -> CREATED / SUBMITTED / OPEN / PARTIALLY_FILLED / FILLED
    -> position
    -> stop / target / square-off
    -> exit fill
    -> charges and net P&L
```

All money and orders remain virtual.

## Why a signal is not a fill

A strategy saying "buy" does not prove that the market would fill the desired quantity at the candle close. Phase 7 makes execution assumptions explicit and testable rather than burying them in a P&L formula.

## Problems and how they were handled

### Bid/ask data can be incomplete

Market orders use observed bid/ask when available. When Kite data lacks suitable prices, an explicitly configured fallback spread is used and recorded in fill provenance.

### Orders can be only partly filled

Available buy/sell quantity informs the liquidity model. Policies can fill available liquidity, reject, keep the remainder open, or partially fill then cancel.

### Latency should not block the event loop

The engine calculates `executableAt`. It does not sleep. Later market updates decide whether the order is eligible.

### Stops can be jumped

If price gaps through a stop, the engine applies the configured gap policy instead of pretending the stop filled at an impossible better price.

### Stop and target can both appear inside one OHLC bar

A candle does not reveal intrabar order. The default ambiguity policy chooses the conservative stop outcome rather than assuming the profitable sequence.

### Working state must survive restart

Lifecycle rows, fills, idempotency keys, and reconciliation let the engine recover working orders and positions without duplicating fills.

### Disconnected or stale data must not invent execution

Stale ticks cannot trigger new fills. Stops are not manufactured for prices the system did not observe.

### Gross profit can disappear after costs

Charges and adverse slippage are part of execution results. Net P&L is not simply exit minus entry.

## Architecture decisions

- Put execution behind an `ExecutionProvider` boundary.
- Implement only `PaperExecutionProvider` in this phase.
- Keep pure fill, charge, and exit functions reusable by Phase 8 historical execution.
- Persist order lifecycle and fills, not just final trades.
- Isolate paper account state from read-only Kite account state.
- Disable automatic strategy-to-paper execution by default.
- Keep broker order methods structurally unreachable.

## Tradeoffs

- The charge model is a configurable proxy, not a broker contract-note calculator.
- Aggregate quantities are less precise than full depth.
- Timestamp-based latency is realistic enough for deterministic research but not an exchange matching-engine simulation.
- Conservative ambiguity avoids optimistic bias, but may understate favorable outcomes.

## How it was verified

Tests cover market and limit orders, latency, slippage, fallback spread, partial fills, timeout/expiry, idempotency, stale data, stop/target exits, gap-through stops, ambiguous bars, charges, reconciliation, and the live-order safety boundary.

## A good 30-second interview answer

> "I built a deterministic paper-execution provider that models the complete order lifecycle rather than assuming perfect fills. It supports market and limit orders, timestamp-based latency, adverse slippage, liquidity-driven partial fills, stop and target exits, gap handling, conservative same-bar ambiguity, charges, idempotency, and restart reconciliation. It uses real market observations with virtual money and has no path to Kite order APIs."

## A longer interview answer

> "The main goal was to separate strategy quality from unrealistic execution assumptions. A setup becomes a paper order, then fills only when eligible market data supports it. The engine records lifecycle timestamps and individual fills, marks positions conservatively, and creates explicit exit orders for stops, targets, or square-off. Pure execution primitives were deliberately separated so historical backtesting could reuse exactly the same fill semantics later. Automatic execution is disabled by default and paper state never merges with broker state."

## Follow-up questions to expect

### Why choose the stop in an ambiguous candle?

OHLC data cannot tell whether high or low came first. Choosing the target would introduce optimistic bias. The policy is explicit and configurable, but the default is conservative.

### How do you avoid duplicate fills after restart?

Stable idempotency, client-order, and fill keys are checked during reconciliation. Lifecycle state is persisted before later processing.

### Is this the same as real execution?

No. It is a controlled approximation. Real queue position, depth changes, outages, and broker behavior can differ. That limitation is carried into research conclusions.

## Honest limitations

This phase validates paper execution mechanics, not strategy profitability. Historical evaluation, walk-forward testing, and robustness belong to Phase 8.

