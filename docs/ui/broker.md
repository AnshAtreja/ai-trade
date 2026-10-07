# Broker & Account tab

**Route:** `/broker` · **Source:** [`broker-page.tsx`](../../apps/web/src/pages/broker-page.tsx), [`kite-connection-panel.tsx`](../../apps/web/src/features/broker/kite-connection-panel.tsx)

Connect to Zerodha and observe **real** account state. This is **not** order placement.

## What this tab is for

- Log in to Kite / store tokens
- See profile, available cash, used margin
- Refresh and view positions + orders snapshots
- Spot-check a few LTPs (RELIANCE / TCS / INFY)

## Controls

| Control | API / effect | Notes |
| --- | --- | --- |
| **Login with Kite** | Opens `loginUrl` from status (or fallback `/api/broker/kite/login-url`) | Disabled when already connected |
| **Live Orders Locked** | None | Always disabled — reminder that live placement is off |
| **Request token → Store Access Token** | `POST /api/broker/kite/request-token` | Use if OAuth redirect did not finish |
| **Access token → Verify Token** | `POST /api/broker/kite/access-token` | Manual paste path |
| **Refresh from Kite** | `POST /api/kite/account/refresh` | Pulls profile/funds/positions/orders/holdings; persists snapshot |
| Profile / LTP tables | `GET` profile, margins, LTP | Display after connect |

## After a successful refresh

You should see:

- Source (`KITE` or `MOCK`), refresh status (`COMPLETE` / `PARTIAL`)
- Available cash, used margin, day P&L, position count
- Positions and orders tables from the **last snapshot** (GET does not re-hit Kite)

`PARTIAL` means some sections failed — check the error line; funds are never faked as zeros.

## Prerequisites

| Mode | Need |
| --- | --- |
| `PERSISTENCE_MODE=database` | Valid `KITE_API_KEY` / `SECRET`, successful login |
| `mock` | Mock provider supplies account data without real Zerodha |

## Does not

- Place, modify, or cancel broker orders
- Change paper capital
- Start the market WebSocket (use Market tab)
