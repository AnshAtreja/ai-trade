# Phase 9C Real-Data Validation

**Status:** COMPLETE for the Phase 9C descriptive historical gate. This is not Phase 9D quality/ablation or 9E live integration.

## Frozen inputs and artifacts

- Research interval: `[2025-09-18T03:45:00.000Z, 2026-09-18T03:45:00.000Z)`; 1m source bars.
- Eight-index Phase 9B registry: `e987d9599c8c8e8b6e39bb40`.
- Context dataset: `NSE_INDEX_CONTEXT_2025_2026_V1`, ID `0671adf35f4fae2f1d4ec05a`, content SHA-256 `0671adf35f4fae2f1d4ec05a84c008557d7657c5c54c3d11f8d9359f8777eb3d`.
- Calendar: `NSE_CASH_2025_2026_V2`; index continuous-session semantics: `NSE_INDEX_CONTINUOUS_2025_2026_V1` (no individual-equity CAS truncation).
- Frozen regime: `MARKET_REGIME_V1`, definition SHA-256 `971add3bea30843302074c7abe2836fd78999be6d757d904239fb0c8fabf58c3`.
- Descriptive analysis ID: `45b39097f8bf0cfef978486a`; breadth universe `NSE_EQ_25_BREADTH_2026_V1`; frozen equity source ID `505dca3f27301e72`.
- Manifest: `apps/artifacts/phase9c/index-context-0671adf35f4fae2f1d4ec05a-manifest.json` (file SHA-256 `6a06a25ed1f06a6ab6d7bd8d88f43e501a2d1dbf6ddd4af45504bced44caf196`).
- Analysis: `apps/artifacts/phase9c/regime-analysis-45b39097f8bf0cfef978486a-stable.json` (file SHA-256 `6a7bafc13b220d98d56ae5b7e9b0b19b918d6ad5c53e796769a122342474569e`).

The content identity includes normalized index OHLCV, provenance, coverage and policy versions, not database `fetchedAt`, wall time or process RSS. Index and equity observations coexist in the existing generic historical-candle table but have disjoint canonical tokens and **separate research dataset identities**; no separate physical index table was added. This is logical dataset separation, not storage-engine isolation. Acquisition timestamps remain operational database metadata.

## Provider support and coverage

A fresh shared Kite status/profile verification returned `CONNECTED`, `hasStoredSession=true`, `verified=true`. Before acquisition, the existing provider returned 15 contiguous 1m bars for **each** benchmark over `[2026-09-18T03:45Z, 04:00Z)`; all had zero volume and no provider error. All eight were `HISTORICAL_SUPPORTED`. The existing chunked historical downloader then acquired the year without retries or transport errors; the manifest audited the persisted observations. The probe role is broad market for NIFTY 50 and sector for the other seven.

| Benchmark | Token | Expected sessions | Complete / incomplete | Expected 1m | Policy-valid 1m | Missing |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| NIFTY 50 | 256265 | 243 | 243 / 0 | 90,810 | 90,810 | 0 |
| NIFTY ENERGY | 261641 | 243 | 243 / 0 | 90,810 | 90,810 | 0 |
| NIFTY FIN SERVICE | 257801 | 243 | 243 / 0 | 90,810 | 90,810 | 0 |
| NIFTY IT | 259849 | 243 | 243 / 0 | 90,810 | 90,810 | 0 |
| NIFTY AUTO | 263433 | 243 | 242 / 1 | 90,810 | 90,809 | 1 |
| NIFTY FMCG | 261897 | 243 | 242 / 1 | 90,810 | 90,809 | 1 |
| NIFTY HEALTHCARE | 288521 | 243 | 243 / 0 | 90,810 | 90,810 | 0 |
| NIFTY METAL | 263689 | 243 | 243 / 0 | 90,810 | 90,810 | 0 |
| **Total** | | **1,944** | **1,942 / 2** | **726,480** | **726,478** | **2** |

Policy-valid coverage is **99.999725%**. Both missing bars are at `2025-12-15T09:47:00.000Z` (15:17 IST), one each for NIFTY AUTO and NIFTY FMCG. A targeted read-only Kite retry over `[09:46Z, 09:49Z)` returned the neighboring 09:46 and 09:48 bars but not 09:47. This is observed provider absence, not proof of an exchange outage. The bars were not synthesized or forward-filled. Across all eight sources the audit found zero invalid OHLC rows, duplicate timestamps, out-of-order rows, missing whole sessions or unsupported calendar periods. Every returned index row had volume `0`, so index volume/VWAP must not be inferred from it.

Each index also has 375 raw provider bars on each of four calendar holidays: `2026-02-19`, `2026-03-19`, `2026-04-01`, `2026-08-26`. All 12,000 such rows remain in raw persistence and are excluded from the policy-valid context view. A raw provider observation does not override the authoritative calendar.

## Session semantics

Bounded provider probes checked NIFTY 50/NIFTY IT on these dates; persisted PostgreSQL-backed tests verified the same boundaries for every benchmark:

| Session | Observed continuous 1m span | Bars per index | Finding |
| --- | --- | ---: | --- |
| Normal `2025-09-18` | 09:15-15:30 IST | 375 | Ordinary continuous session |
| Muhurat `2025-10-21` | 13:45-14:45 IST | 60 | Calendar special session retained |
| Budget Sunday `2026-02-01` | 09:15-15:30 IST | 375 | Calendar special session retained |
| Post-CAS `2026-09-15` | 09:15-15:30 IST | 375 | Indices continue to 15:30; eligible equities end continuous bars at 15:15 |

The V1 index policy uses authoritative calendar dates/special hours and observed index bars; it deliberately does **not** apply instrument-specific equity CAS eligibility. It is a versioned interpretation of this research interval, not a claim that all future exchange rules or index sessions are known.

## Frozen-regime descriptive output

The real replay passed completed equity 1m bars through 9A, equity/index context through 9B, and the existing frozen 9C classifier. The 22 incomplete frozen-equity instrument-sessions were rejected by `requireCompleteSession=true` (`DATA_GAP`). The index gaps were visible, not filled. The 9C result contains **90,330** market updates, **901,050** sector updates, **726,478** benchmark observations and **2,250,000** eligible equity observations.

| Broad-market trend | Count | Share |
| --- | ---: | ---: |
| TRENDING_UP | 1,592 | 1.7624% |
| TRENDING_DOWN | 2,190 | 2.4244% |
| RANGE_BOUND | 9,099 | 10.0731% |
| UNCERTAIN | 77,449 | 85.7401% |

| Broad-market volatility | Count | Share |
| --- | ---: | ---: |
| HIGH | 17,797 | 19.7022% |
| NORMAL | 47,011 | 52.0436% |
| LOW | 24,287 | 26.8870% |
| UNKNOWN | 1,235 | 1.3672% |

The artifact also retains full monthly and half-hour time-of-day counts for both dimensions, plus per-sector trend, volatility, relative-to-market, sample-breadth coverage and quality counts. The broad-market quality counts were `AVAILABLE=82,005`, `INSUFFICIENT_HISTORY=7,290`, `INSUFFICIENT_COVERAGE=1,035`; quality-available does **not** imply a directional label because the four frozen evidence groups may still disagree. Some one-stock or unindexed sectors remain unavailable by design. Breadth means only the frozen **25-stock research sample**, never all NSE equities; observed mean sample coverage was about 98.85%, with explicit low-coverage frames.

The market transition record contains 5,787 state changes, zero direct `TRENDING_UP`/`TRENDING_DOWN` flips and 65 changes between those directions through `UNCERTAIN`. Average state run length is 14.98 minutes, median 3 minutes, and average flips per observed session 23.81 across 243 sessions. Those are descriptive observations, not evidence of predictive value and not a reason to smooth/tune V1. The volatility classifier used its frozen 20-prior-observation warm-up and 60-prior-sample median; its 5m absolute-return proxy is not official realized volatility or time-of-day normalized.

## Point-in-time and operational verification

On persisted NIFTY 50/NIFTY IT plus all 25 equities, historical and completed-live-style adapters produced identical regime snapshot IDs over a bounded 45-minute fixture. Changing a later index candle left all earlier IDs unchanged. Withholding a benchmark minute produced a lagged as-of read and `DATA_GAP` quality, never a future read. The full analysis was repeated without mutation: manifest ID, analysis ID and both file SHA-256 values stayed byte-identical.

One completed real run took about **137.4 s** with observed peak RSS **497,549,312 bytes**; the repeat took **143.5 s** with peak RSS **508,002,304 bytes**. These are whole-process observations, not an isolated engine SLA. End-state bounds were 25 feature series / 350 retained true ranges, 25 equity and eight benchmark context series / 2,013 return points, 50 breadth entries, and eight volatility series / 480 prior samples. Runtime/RSS are printed as operational telemetry and excluded from the deterministic research artifact.

Verification at the 9C handoff: full API suite **40 files / 311 tests**, including actual PostgreSQL-backed cases; API `lint` (`tsc --noEmit`) and `build` passed. No strategy P&L was read, no threshold/strategy/execution rule was changed, no trading decision or live-order path was added. Phase 9D subsequently completed as separate retrospective research; see [9D validation](feature-ablation-validation.md). Phase 9E live integration is now implemented but remains open pending real provider verification; see [live integration](live-integration.md). The frozen 9C evidence above is unchanged.
