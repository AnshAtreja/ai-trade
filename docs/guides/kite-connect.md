# Kite Connect

TradePilot uses Zerodha Kite for **login, account observation, instruments, quotes, and WebSocket ticks**. Live order placement remains disabled.

## Flow

1. `GET /api/broker/kite/login-url` → open Zerodha Connect.
2. User logs in; Kite redirects with `request_token`.
3. Callback or `POST /api/broker/kite/request-token` exchanges the token (SHA-256 checksum of `api_key + request_token + api_secret`).
4. Access token stored encrypted (`.secure/kite-session.enc`), not in Prisma.
5. Adapter can fetch profile, margins, instruments, LTP/quotes, historical candles, and open the market WebSocket.

## Env

```bash
KITE_API_KEY=
KITE_API_SECRET=
KITE_REDIRECT_URL=http://127.0.0.1:4000/api/broker/kite/callback
WEB_APP_URL=http://127.0.0.1:5173
```

Register the redirect URL in the Kite developer console.

## Read-only account APIs

| Method | Path | Notes |
| --- | --- | --- |
| GET | `/api/kite/account` | Latest persisted broker account snapshot |
| POST | `/api/kite/account/refresh` | Fetch from Kite and persist |
| GET | `/api/kite/account/profile` | Profile section |
| GET | `/api/kite/account/positions` | Positions |
| GET | `/api/kite/account/orders` | Orders |
| GET | `/api/kite/account/holdings` | Holdings |

Deep detail: [../reference/kite-account-state.md](../reference/kite-account-state.md).

## UI

Use **Broker & Account** in the web app to log in, paste tokens if redirect fails, and refresh account state.
