# Intelligence tab

**Route:** `/intelligence` · **Source:** [`intelligence-page.tsx`](../../apps/web/src/pages/intelligence-page.tsx)

## Status

**Phase 9 observational surface** — 9A, 9B, 9C, and 9D are complete. Phase 9E remains open because the live current-day NSE CM/MII CAS source and real active-session feed still need verification. Phase 10 has not started.

## What this tab shows

- Market regime, sector context, relative strength, and intraday features
- Market, sector, relative, and instrument context from the current intelligence APIs
- Feature/regime freshness, stream health, subscription coverage, and CAS source status
- Explicit unavailable/unknown states when live inputs are not verified

## Controls today

| Control | Behavior |
| --- | --- |
| **Instrument selector** | Changes the observed research-sample instrument |
| **Refresh intelligence** | Refetches health, market, sector, and selected-instrument context |

This page is read-only. It does not filter strategies, submit paper orders, or place live orders.

No model inference or news search is wired in the UI yet.
