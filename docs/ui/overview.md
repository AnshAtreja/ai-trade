# Overview tab

**Route:** `/` · **Source:** [`overview-page.tsx`](../../apps/web/src/pages/overview-page.tsx)

Home dashboard: the operating flow, connection health, paper risk snapshot, current Phase 9 gate, and safety boundaries.

## What this tab is for

- See at a glance whether broker/stream/live gates look healthy
- Read today’s paper equity and risk remaining
- Arm/disarm the **dashboard** kill switch
- Follow the recommended Broker → Market → Paper → Research flow
- See why Phase 9 is still open

## Controls

| Control | What happens |
| --- | --- |
| **Metric cards** (Kite connection / Market stream / Paper equity / Live orders) | Display only — refreshed via React Query (Kite status, stream status, paper account) |
| **Today’s paper risk** stats | Display only — from `GET /api/paper-trading/account` |
| **Kill Switch → Arm / Disarm Dashboard Switch** | Toggles local Zustand `killSwitchArmed`. Updates the header pill. Does **not** call the API and does **not** unlock live orders |
| **Recommended flow** | Shows the next action for Kite, market data, paper trading, and research |
| **Current gate** | Explains that Phase 9 live closure is waiting on current-day NSE CAS/source and feed verification |
| **Safety boundary** | Confirms paper-only execution and observational intelligence |
| **Quick links** | Client-side navigation to other tabs |

## Kill switch behavior

| Action | Result now | Result later |
| --- | --- | --- |
| Leave **Armed** (default) | Pill shows armed; adapter still blocks live | Intended to refuse new live orders |
| Click **Disarm** | Pill shows off; **paper still works**; live still blocked by adapter | Would allow live only if Phase 20+ gates also pass |
| Click **Arm** again | Back to armed | Same |

## Empty / error states

- Paper metrics show **—** or a hint if account load fails → open Paper or wait for auto-init on first paper access
- Broker **NO** → go to Broker tab and log in

## Does not

- Start the market stream
- Run scanner/strategies
- Place paper or live orders
