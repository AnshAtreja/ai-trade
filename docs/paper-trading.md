# Paper trading & realistic execution (Phase 7)

> Phase 7 uses **real market data** but **virtual money**. It does **not** place real orders.

```text
StrategySetup / manual signal
        ↓
   Risk Engine (existing)
        ↓
 ExecutionRequest
        ↓
 PaperExecutionProvider  ← Phase 7
        ↓
 Paper Orders → PaperFills → Positions → AccountState
```

Live Kite execution remains structurally unreachable (`KiteBrokerAdapter.placeOrder|modifyOrder|cancelOrder` always throw).

## PAPER vs KITE

| Domain | Contents |
| --- | --- |
| PAPER | PaperAccount, paper Orders/Fills/Trades/Positions, paper P&L |
| KITE | Read-only profile/margins/positions/holdings snapshots |

Never merge them. Paper fills never call the broker.

## Architecture

| Piece | Role |
| --- | --- |
| `ExecutionRequest` / `ExecutionResult` | Deterministic request/result |
| `PaperExecutionProvider` | Simulator (only provider in Phase 7) |
| `evaluateFill` | MARKET/LIMIT + liquidity + slippage |
| `evaluateLiveExit` | Stop/target/square-off with gap-through |
| `calculatePaperCharges` | Configurable turnover bps proxy |
| Legacy `PaperTradingService.createTrade` | Phase 1 immediate-fill path (compat) |

Future Phase 20 may add `KiteExecutionProvider`; it is **not** implemented here.

## Order state machine

```text
CREATED → SUBMITTED → OPEN / PARTIALLY_FILLED → FILLED
                 ↘ REJECTED | CANCELLED | EXPIRED
```

Persisted timestamps: `submittedAt`, `firstFillAt`, `filledAt`, `cancelledAt`, `rejectedAt`, `expiredAt`, `executableAt` (latency).

## Fill model

- **MARKET BUY** → ask (or LTP±fallback half-spread if configured)
- **MARKET SELL** → bid
- **LIMIT** fills only when the live quote crosses the limit
- Liquidity from `buyQuantity` / `sellQuantity` when present
- Policies: `FILL_AVAILABLE_LIQUIDITY` (default), `REJECT`, `KEEP_OPEN`, `PARTIAL_THEN_CANCEL`
- Fallback spread is **explicit** (`usedFallbackSpread` in provenance)

## Slippage / latency / liquidity

| Setting | Default | Notes |
| --- | --- | --- |
| `PAPER_SLIPPAGE_POLICY` | `BPS` | `NONE` \| `BPS` \| `TICKS` |
| `PAPER_SLIPPAGE_BPS` | `2` | Buy +bps / sell −bps |
| `PAPER_EXECUTION_LATENCY_MS` | `250` | Via `executableAt`, no event-loop sleep |
| `PAPER_LIQUIDITY_POLICY` | `FILL_AVAILABLE_LIQUIDITY` | |
| `PAPER_ORDER_TIMEOUT_MS` | `60000` | Expire unfilled working orders |

## Stop / target / gap / ambiguity

- Tick chronology preferred; exit at **observed** price when `PAPER_STOP_GAP_POLICY=FILL_AT_TRIGGER_PRICE` (default).
- Ambiguous high/low same-bar: `PAPER_AMBIGUOUS_EXIT_POLICY=CONSERVATIVE_STOP` (default) — never assume the profitable side.
- Exits create EXIT orders + fills (not silent closes).

## Mark-to-market

`PAPER_MARK_PRICE_POLICY`:

- `LTP` — last traded price
- `CONSERVATIVE_BID_ASK` (default) — long on bid, short on ask when available

## Charges

Simple configurable model (`PAPER_CHARGE_RATE_BPS`, `PAPER_MIN_CHARGE`):

```text
charges = max(minCharge, turnover * bps / 10000)
netPnl = grossPnl - charges
```

This is **not** a Zerodha contract note. Statutory rates change; verify before financial decisions.

## Stale data / disconnect

If market age > `PAPER_MAX_DATA_AGE_MS`:

- no new fills from that tick
- working orders wait
- stops are **not** invented for unobserved prices

## Square-off

`PAPER_SQUARE_OFF_TIME_IST` (default `15:15`) + `PAPER_BLOCK_ENTRIES_AFTER_SQUARE_OFF`.

Open positions receive `SQUARE_OFF` exit handling after that time (simulation policy — not exchange auto square-off).

## Idempotency & restart

- Unique `idempotencyKey` / `clientOrderId` / `fillKey`
- Reconcile on startup / interval: process working orders + monitor positions without duplicating fills
- `PAPER_AUTO_EXECUTION=false` by default — strategy setups are **not** auto-traded unless enabled or `force`

## APIs

| Method | Path |
| --- | --- |
| GET | `/api/paper-trading/orders` |
| GET | `/api/paper-trading/orders/:orderId` |
| GET | `/api/paper-trading/orders/:orderId/fills` |
| GET | `/api/paper-trading/execution/status` |
| POST | `/api/paper-trading/execution/reconcile` |
| POST | `/api/paper-trading/execution/start` \| `/stop` |
| POST | `/api/paper-trading/execution/from-setup` |

Plus existing account / trades / positions / ticks routes.

## Known limitations

- Kite quote packets expose aggregate buy/sell qty, not full depth bid/ask prices — optional fallback spread is used when bid/ask absent.
- Charge model is a simplified proxy.
- Latency is timestamp-based scheduling, not exchange matching-engine fidelity.
- Still a **simulation**: real fills can differ.

## Safety confirmation

- No path from Phase 7 to live Kite order APIs
- No AI / Kronos / RAG / LLM / MCP / backtesting added in this phase
