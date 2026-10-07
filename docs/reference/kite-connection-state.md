# Kite connection state

The Kite status endpoint is authoritative: `GET /api/broker/kite/status` reports `CONNECTED` only after the API server successfully completes a read-only `GET /user/profile` using the current session. An encrypted session file by itself is never reported as connected.

The endpoint returns `NOT_CONFIGURED`, `DISCONNECTED`, `VERIFYING`, `CONNECTED`, `AUTH_REQUIRED`, or `ERROR`, plus `hasStoredSession`, `verified`, `lastVerifiedAt`, and a safe reason code. It never returns request tokens, access tokens, API secrets, or authorization headers. Successful verification is cached for 30 seconds; an authenticated Kite read that later fails updates the next status to `AUTH_REQUIRED`.

To reconnect, open **Broker & Account** in the web app, select **Login with Kite**, complete the Kite login, and let the callback return to TradePilot. The app stores the encrypted session and verifies it before displaying connected. If the redirect cannot finish, paste the short-lived Kite `request_token` into the same panel, or use **Verify Token** with an access token. A stale stored session can remain on disk; the next successful login replaces it.

Historical Kite reads call the same verification status before requesting candles. This remains read-only: no order placement, modification, or cancellation is reachable from this flow.
