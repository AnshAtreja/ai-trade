# TradePilot Research Universe 2026 V1

Manifest version: `NSE_EQ_RESEARCH_UNIVERSE_2026_V1`  
Deterministic manifest ID: `feaabc0198432edc`  
Selection date: `2026-09-18`  
Research period: `[2025-09-18T03:45:00.000Z, 2026-09-18T03:45:00.000Z)`  
Timezone: `Asia/Kolkata`

The manifest is defined in `apps/api/src/modules/historical-market-data/research-universe.ts`. The period is exactly one year, ends at the next session open rather than in a partial current trading day, and includes the 2026-08-03 CAS transition.

## Methodology

Candidates were read from the synchronized Phase 3 Kite instrument master with `exchange=NSE`, `instrumentType=EQ`, `isActive=true`, and no expiry. Selection used established market prominence, broad trading activity, and sector diversification, cross-checked against the official Nifty 50 sector/constituent material. No scanner, strategy, historical replay, execution, P&L, or setup count was used.

The Nifty 50 reference is a factual market-prominence and sector-diversity screen, not a claim that this manifest is a historical Nifty constituent snapshot. The universe is explicitly current-universe selected and therefore has survivorship bias.

## Membership

| Sector | Instruments |
| --- | ---: |
| Financial Services | 6 |
| Information Technology | 4 |
| Healthcare | 4 |
| Fast Moving Consumer Goods | 3 |
| Automobile and Auto Components | 2 |
| Metals and Mining | 2 |
| Energy | 1 |
| Telecommunication | 1 |
| Consumer Durables | 1 |
| Industrials / Capital Goods | 1 |
| **Total** | **25** |

The manifest stores Kite `instrumentToken`; `exchangeToken` is deliberately excluded. A refresh-quality check found one existing-master identity conflict: the local RELIANCE row currently exposes `instrumentToken=2885` and `exchangeToken=738`, while the canonical Kite identity used by the verified historical dataset is `instrumentToken=738561`, `exchangeToken=2885`. The manifest therefore freezes `738561` and records the conflict explicitly. The Phase 3 instrument master must be refreshed/reconciled before RELIANCE is treated as download-ready; this task does not silently substitute the exchange token.

`TATAMOTORS` was not present as a unique active NSE EQ record in the synchronized master and was replaced by `TITAN`. This is recorded in the manifest rather than guessed across a symbol transition.

## CAS readiness

Historical CAS coverage for all 25 selected instruments is now represented by the separate immutable `NSE_CAS_ELIGIBILITY_2026_V2` dataset. The research-universe manifest remains unchanged. See [the CAS V2 provenance and coverage report](historical-cas-eligibility-2026-v2.md). Current NFO membership must not be used as a historical substitute.

## Limitations

- This is not a point-in-time historical constituent universe.
- It carries survivorship bias: `CURRENT_UNIVERSE_SELECTED_AT_2026_09_18`.
- Corporate-action review is still required before downloading; historical adjustment remains `UNKNOWN`.
- The local Phase 3 master has a RELIANCE token-field conflict that must be reconciled before download.
- No OHLCV has been downloaded for this universe.

Reference: [Nifty 50 constituent and sector material](https://www.niftyindices.com/docs/default-source/indices/nifty-50/nifty-50-whitepaper_2026.pdf?sfvrsn=41f76335_5), [Nifty 50 overview](https://www.niftyindices.com/indices/equity/broad-based-indices/nifty--50).
