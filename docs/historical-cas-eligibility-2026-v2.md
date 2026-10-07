# NSE CAS Eligibility 2026 V2

Dataset version: `NSE_CAS_ELIGIBILITY_2026_V2`  
Supported interval: `[2026-08-03, 2026-09-19)`  
Timezone: `Asia/Kolkata`  
Identity: canonical Kite `instrumentToken`

## Evidence and semantics

NSE states that Phase 1 CAS applies to cash-segment stocks on which derivative contracts are available. The CAS archive provides dated exchange reports beginning 03-Aug-2026, and NSE's derivatives reports expose the dated contract/security-list evidence used to classify the selected securities. These dated exchange lists are treated as exhaustive for their stated effective date: presence means `ELIGIBLE`, absence means `NOT_ELIGIBLE`. No selected security was absent during the supported interval. Evidence was not inferred from current Kite state, candle coverage, strategy behavior, or exchange tokens.

The source does not establish any membership boundary inside 2026-08-03 through 2026-09-18 for the frozen 25-name set. Each record therefore uses one half-open interval: `[2026-08-03, 2026-09-19)`.

## Coverage

All 25 frozen instruments are `ELIGIBLE`; `NOT_ELIGIBLE=0`, `UNKNOWN=0`, and membership changes=0.

| Symbol | instrumentToken | Status | validFrom | validTo |
| --- | ---: | --- | --- | --- |
| RELIANCE | 738561 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| HDFCBANK | 341249 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| ICICIBANK | 1270529 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| SBIN | 779521 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| AXISBANK | 1510401 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| KOTAKBANK | 492033 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| BAJFINANCE | 81153 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| TCS | 2953217 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| INFY | 408065 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| HCLTECH | 1850625 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| WIPRO | 969473 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| BHARTIARTL | 2714625 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| MARUTI | 2815745 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| M&M | 519937 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| TITAN | 897537 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| HINDUNILVR | 356865 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| ITC | 424961 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| NESTLEIND | 4598529 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| SUNPHARMA | 857857 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| DRREDDY | 225537 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| CIPLA | 177665 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| APOLLOHOSP | 40193 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| LT | 2939649 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| TATASTEEL | 895745 | ELIGIBLE | 2026-08-03 | 2026-09-19 |
| JSWSTEEL | 3001089 | ELIGIBLE | 2026-08-03 | 2026-09-19 |

## Provenance

- NSE CAS applicability page and circular index: [Closing Auction Session](https://www.nseindia.com/static/products-services/closing-auction-session)
- NSE operational circular: `NSE/CMTR/73362`, 18-Mar-2026
- NSE dated CAS archive: [Closing Auction Session historical data](https://www.nseindia.com/static/reports/closing-auction-session-historical-data)
- NSE derivatives report system: [All Reports - Derivatives](https://www.nseindia.com/all-reports-derivatives)

The local deterministic record is defined in `apps/api/src/modules/historical-market-data/session-policy.ts`. No credentials, transient session data, exchangeToken values, or OHLCV data are stored in this dataset.
