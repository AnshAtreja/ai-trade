# Historical CAS Eligibility Dataset 2026 V1

## Scope

This version supports `2026-08-03` through `2026-09-18`, inclusive. It contains the three already persisted Phase 8D.5 smoke-test equities:

| Symbol | Kite instrumentToken | Status | Valid from | Valid to |
| --- | ---: | --- | --- | --- |
| HDFCBANK | `341249` | `ELIGIBLE` | 2026-08-03 | 2026-09-19 exclusive |
| INFY | `408065` | `ELIGIBLE` | 2026-08-03 | 2026-09-19 exclusive |
| RELIANCE | `738561` | `ELIGIBLE` | 2026-08-03 | 2026-09-19 exclusive |

The records use the canonical Kite `instrumentToken`, not `exchangeToken`. The mapping is from the existing Phase 3 Kite instrument master and was verified against the persisted NSE equity records.

## Exchange rule and provenance

NSE's Phase 1 CAS rule applies CAS to cash-segment stocks for which derivative contracts are available. NSE's CAS documentation lists the Phase 1 applicability rule, CAS session timings, and the related security-master modification circular. The dated exchange evidence used for this initial slice is:

- NSE CAS applicability and operating guidance: [NSE/CMTR/73362](https://nsearchives.nseindia.com/content/circulars/CMTR73362.pdf), 2026-03-18.
- NSE CAS product documentation and related circular index: [Closing Auction Session](https://www.nseindia.com/static/products-services/closing-auction-session).
- Dated NSE CAS archive covering the supported trading dates: [Closing Auction Session historical data](https://www.nseindia.com/static/reports/closing-auction-session-historical-data).
- NSE's security-master/contract-file mechanism is described in its dated F&O contract-availability circulars, including [NSE/FAOP/73205](https://nsearchives.nseindia.com/content/circulars/FAOP73205.pdf).

The persisted source version is `NSE-CAS-2026-08-03-to-2026-09-18`. Records are immutable application data; backtests do not fetch NSE at runtime.

## Method and limitations

The source semantics are rule-based rather than an exhaustive historical CAS membership export: CAS eligibility is established for this initial slice where the dated NSE CAS/F&O evidence supports the security, then mapped to the unique local Kite token. No `NOT_ELIGIBLE` records are manufactured for absent securities. Securities outside these three mapped records remain `UNKNOWN`.

Source securities represented: 3. Successfully mapped: 3. Unresolved mappings: 0. Membership changes: 0. Uncertain membership dates in the supported slice: none for these three securities. This is sufficient for the existing smoke test, but not yet sufficient to construct the planned 20–30-stock research universe.
