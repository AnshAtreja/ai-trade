# Status bar & global modes

The top status strip appears on every page ([`app-shell.tsx`](../../apps/web/src/components/layout/app-shell.tsx)). It answers: *is Kite verified, is the market stream actually connected, and can anything place a real order?*

## Pills

### Kite connected / Kite login required

| State | Means | What you can do |
| --- | --- | --- |
| **Kite connected** | Kite session/token is verified (`GET /api/broker/kite/status`) | Refresh account, REST LTP, start the market stream |
| **Kite login required** | Not logged in, token missing, or verification failed | Use **Login with Kite** on the Broker tab; mock mode still has mock providers |

### Stream connected / REST only

| State | Means | What you can do |
| --- | --- | --- |
| **Stream connected** | The market stream reports `connected` | Scanner/strategies can use fresh ticks from the latest-state store |
| **REST only** | No active WebSocket | Quotes via REST only; stream health shows stopped/disconnected |

**How to change it**

1. Open **Market**
2. Click **Start** → `POST /api/market/stream/start`
3. Wait until stream **State** is `CONNECTED` (and pill flips to Stream connected)
4. **Stop** → `POST /api/market/stream/stop` → back to REST only

Starting the stream does **not** place orders. It only opens the market-data socket.

### Paper enabled

| State | Means |
| --- | --- |
| **Paper enabled** (always shown today) | Simulated capital/orders are the supported execution path |

There is **no** UI toggle to turn paper off. Disabling paper is not a product feature yet.

Paper ≠ live:

- Paper fills hit the paper ledger only.
- Kite `placeOrder` remains blocked in the adapter.

### Live orders locked / Live orders enabled

| State | Means | Expected |
| --- | --- | --- |
| **Live orders locked** | Broker adapter rejects live order APIs | **Normal** for Phases 1–19 |
| **Live orders enabled** | Would mean live placement is allowed | Should **not** appear until Phases 20–21 deliberately unlock it |

If you ever see **Live orders enabled**, treat it as a bug unless you are intentionally on a controlled-live build.

### Kill switch armed / Kill switch off

| State | Means today | Means later (Phase 20+) |
| --- | --- | --- |
| **Armed** | Dashboard flag on (default). Shown in Overview kill-switch card | Should block new live submissions when live exists |
| **Off** | Flag cleared via **Disarm Dashboard Switch** | Live path may proceed *if* adapter + risk also allow |

**Important:** Disarming the kill switch does **not** enable live Kite orders today. The adapter hard-block still wins. The pill is preparation for future live infrastructure.

Toggle location: **Overview → Kill Switch** card (Zustand store; not persisted to the API).

## Mode matrix (mental model)

```text
                    Paper path          Live Kite orders
                    ----------          ----------------
Paper enabled       YES (default)       N/A
Live orders locked  OK                  BLOCKED (current)
Kill switch armed   Paper still OK      Would block live (future)
Kill switch off     Paper still OK      Still blocked by adapter today
REST only           Scanner may be stale / thinner
Stream connected    Fresh ticks for scanner/strategies
```

## Related

- [Overview tab](./overview.md) — kill switch control
- [Market tab](./market.md) — Start/Stop stream
- [../architecture/safety.md](../architecture/safety.md)
