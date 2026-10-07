# Market tab

**Route:** `/market` · **Source:** [`market-page.tsx`](../../apps/web/src/pages/market-page.tsx)

Instrument universe + real-time stream control. This tab is how you move between **REST only** and **Stream connected**.

## What this tab is for

- Sync the Kite instrument master into TradePilot
- Browse a sample of tradable NSE equities
- Start/stop the in-process WebSocket pipeline
- Diagnose stream health (reconnects, last message, errors)

## Controls

| Control | API | What happens |
| --- | --- | --- |
| **Start stream** | `POST /api/market/stream/start` | Starts the market stream service (connect + receive ticks when auth/subscriptions allow). Status fields refresh. Header flips to **Stream connected** only when `connected` |
| **Stop stream** | `POST /api/market/stream/stop` | Stops the stream. Header returns to **REST only** |
| **Sync universe** | `POST /api/market/instruments/sync` | Downloads/upserts instrument master; reloads the paginated NSE equity table |

Busy state disables buttons while a request is in flight. Status message under Stream health reports success/failure text.

## Stream health fields

| Field | Meaning |
| --- | --- |
| **State** | `STOPPED` / `CONNECTING` / `CONNECTED` / `RECONNECTING` / `DISCONNECTED` / `AUTH_FAILED` |
| **Source** | `KITE` or `MOCK` |
| **Subscriptions** | How many instrument tokens are subscribed |
| **Reconnects** | Backoff reconnect count |
| **Last message** | Last tick/message timestamp |
| **Last error** | Most recent stream error, if any |

## Expected workflow

```text
Broker connected (recommended for real Kite)
        ↓
Sync universe      → table fills with equities
        ↓
Start stream       → State → CONNECTED → status bar "Stream connected"
        ↓
Scanner / Strategies can use fresh latest-state ticks
        ↓
Stop stream        → REST only again
```

## REST only vs Stream connected

| | REST only | Stream connected |
| --- | --- | --- |
| How | Default / after Stop | After successful Start + connection |
| Data | On-demand LTP/quotes HTTP | Continuous ticks into memory store |
| Scanner | May run with thinner/stale data | Prefers fresh latest prices |
| Orders | Unaffected | Unaffected — stream never places orders |

## Does not

- Subscribe individual symbols from this UI yet (subscriptions are managed by the stream service / other callers)
- Place trades
- Change paper or live mode
