# Paper account state (Phase 1C)

## Decision: snapshot vs current state

`AccountSnapshot` is an **immutable historical observation**. It is written on meaningful events (initialization, paper trade/position open or close, explicit refresh). It is **not** the live ledger and is **not** written on every market tick.

**Current account state is always derived** from:

1. `PaperAccount.startingCapital` (persisted once at initialization)
2. Paper `Trade` and `Position` rows
3. `RiskConfiguration`

A dedicated mutable “current account” table was not added. Restart safety comes from replaying those persisted rows, not from caching derived numbers.

If a snapshot field disagrees with a derived value, **the derived value is authoritative**.

## Paper capital

`PAPER_STARTING_CAPITAL` (default `100000`) is used **only** when a user has no `PaperAccount` row.

After initialization, `PaperAccount.startingCapital` is authoritative. Changing the environment variable does not reset an existing account.

Mock mode (`PERSISTENCE_MODE=mock`) uses the same service against in-memory repositories. It does not survive process restart. Database mode does.

## Formulas

Money values are rounded to two decimal places (`money()`). Prisma stores them as `Decimal(18, 2)`.

| Concept | Definition |
| --- | --- |
| **Current equity** | `startingCapital + realisedPnl + unrealisedPnl` |
| **Realised PnL** | Sum of `Trade.pnl` for PAPER trades with status `CLOSED` or `CANCELLED` |
| **Unrealised PnL** | Sum of `Position.unrealizedPnl` for OPEN PAPER positions |
| **Total PnL** | `realisedPnl + unrealisedPnl` (do not add this to equity twice) |
| **Open exposure / used capital** | Sum over OPEN positions of `quantity × (currentPrice ?? averagePrice)` (side-independent notional). This is **not** Kite margin. |
| **Available capital** | `currentEquity − usedCapital` |
| **Day PnL** | Realised PnL of trades **closed** on the Asia/Kolkata calendar date, **plus current unrealised PnL**. Not a rolling 24-hour window. |
| **Risk used today** | Realised **losses** on trades closed today **plus** committed stop-loss risk of OPEN positions (`\|entry − stop\| × quantity`). Distinct from PnL and from notional exposure. |
| **Risk remaining today** | `max(0, dailyLossLimit − riskUsedToday)` where `dailyLossLimit = RiskConfiguration.capital × maxDailyLossPercent / 100` |
| **Trades today** | Count of PAPER trades with `createdAt` on the trading date and status other than `REJECTED`. Scanner signals, cancelled scanner candidates, and risk **rejections** are not trades. |

Timezone for account/risk session dates is `MARKET_TIMEZONE` (default `Asia/Kolkata`), via `apps/api/src/common/utils/trading-date.ts` only. Scanner `sessionDate` remains UTC-based.

## What is persisted vs derived

**Persisted (source of truth):**

- `PaperAccount.startingCapital`
- `RiskConfiguration` limits
- `Trade` / `Order` / `Position` lifecycle rows
- `AccountSnapshot` audit copies of derived state at event time

**Derived on read:** equity, available/used capital, exposure, PnL totals, day PnL, risk used/remaining, trades today, open position count, account status.

## Risk checks connected to account state

Paper `createTrade` flow:

```
Trade request
  → initialize paper account if needed
  → process-local lock (per user)
  → database transaction + PaperAccount row lock (database mode)
  → derive AccountState
  → load RiskConfiguration (request body cannot override limits)
  → RiskValidator (existing rules + account context)
  → create trade / entry order / position
  → snapshot
```

Additional rejection codes:

- `MAX_OPEN_POSITIONS_REACHED`
- `MAX_CAPITAL_EXPOSURE_EXCEEDED`
- `INSUFFICIENT_AVAILABLE_CAPITAL`
- `TRADING_BLOCKED_DAILY_LOSS` when `dayPnl <= -dailyLossLimit`

Existing validator rules are unchanged and still apply.

## Concurrency

Mock and single-process API: `withUserLock` serializes paper trade creation per user.

Database mode also `SELECT … FOR UPDATE` on `PaperAccount` inside the create-trade transaction.

This is **not** distributed locking across multiple API processes. Two API instances can still race unless they share one database lock (they do if both use the same Postgres and take the row lock). Two processes without entering the transaction lock path at the same time are protected by the row lock. Mock mode has no cross-process persistence.

## APIs

- `GET /api/paper-trading/account` — derived current state
- `GET /api/paper-trading/account/snapshots` — historical snapshots
- `POST /api/paper-trading/account/refresh` — derive + persist a `PAPER_ACCOUNT_REFRESHED` snapshot

Live Kite `placeOrder` / `modifyOrder` / `cancelOrder` remain disabled. Paper trading does not call them.

## Historical replay

`HistoricalReplayRunner` still uses in-memory `PaperTradingEngine` and is not wired to this account layer.
