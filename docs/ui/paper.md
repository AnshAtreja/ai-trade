# Paper Trading tab

**Route:** `/paper` · **Source:** [`paper-page.tsx`](../../apps/web/src/pages/paper-page.tsx)

Virtual capital and Phase 7 realistic fill simulation. **Never** places live Kite orders.

## What this tab is for

- Inspect derived paper AccountState (equity, day P&L, risk remaining)
- See execution-provider status (slippage/latency path)
- Manually refresh account snapshot / reconcile open paper orders
- Browse paper orders and trades

## Controls

| Control | API | What happens |
| --- | --- | --- |
| **Refresh** | `POST /api/paper-trading/account/refresh` | Recomputes/persists paper account observation from ledger; reloads metrics |
| **Reconcile** | `POST /api/paper-trading/execution/reconcile` | Runs paper execution reconciliation (fills/stops against latest market state as implemented); refreshes execution status, orders, trades, account |

## Panels

### Paper AccountState

Equity, available/used capital, day P&L, risk remaining, open positions, trades today, status (`ACTIVE` / `TRADING_BLOCKED_DAILY_LOSS`), starting capital.

### Execution provider (Phase 7)

| Field | Meaning |
| --- | --- |
| **Provider** | Which paper execution provider is active |
| **Live Kite orders** | Should read **disabled** |
| **Auto paper exec** | Whether strategy setups may auto-route into paper (`PAPER_AUTO_EXECUTION`) |
| **Reconciler** | Background reconciler running or stopped |
| **Market session** | Session context for execution rules |
| **Busy** | Reconcile/execution loop busy flag |

### Paper orders / Paper trades

Read-only tables of simulated orders (status, purpose, fill qty, avg fill) and trade PnL.

## Paper enabled vs live

| Mode | This tab |
| --- | --- |
| Paper enabled | All actions here are valid |
| Live orders locked | Expected — paper still works |
| Kill switch armed/off | Does not block paper refresh/reconcile today |
| REST only | Reconcile may have weaker price updates |
| Stream connected | Better tick context for realistic fills |

## Does not

- Call Zerodha `placeOrder`
- Toggle paper on/off in the UI
- Run scanner or strategies (use those tabs)
