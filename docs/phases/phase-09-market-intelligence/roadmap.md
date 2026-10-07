# Phase 09 Roadmap - Market Intelligence & Feature Layer

**Overall status:** IN PROGRESS. Phase 8 is complete and frozen; Phase 9 is not closed.

| Subphase | Scope | Status |
| --- | --- | --- |
| 9A | Feature foundation, canonical schema, incremental point-in-time engine | COMPLETE |
| 9B | Instrument, sector, benchmark and market-context features | COMPLETE |
| 9C | Market-regime engine and versioned labels | COMPLETE: real index-history gate, descriptive analysis and point-in-time validation passed |
| 9D | Historical feature quality, validation and ablation | COMPLETE: frozen retrospective study; no outcome-based feature validated |
| 9E | Live pipeline integration, parity validation and Phase 9 closure | IN PROGRESS: direct CM MII CAS provider implemented and pre-CAS live gate passed; current-day CM file, post-15:15 behavior and full historical-volume parity remain pending |

## Frozen handoff

- Phase 8 evidence: `apps/artifacts/phase8f/phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1.json`; content hash `6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41`.
- `breakout:v1`, `breakdown:v1`, `momentum:v1`, `opening-momentum:v1` remain immutable research baselines. Phase 8 found zero validated optimized successors.
- Phase 9 features describe market state; they are not signals, trade approvals, risk decisions, or a justification for changing a v1 strategy.

## 9A acceptance

- [x] Versioned `MARKET_FEATURES_V1` snapshot and `MARKET_FEATURE_DEFINITIONS_V1` registry.
- [x] Explicit per-field quality with no zero-as-missing convention.
- [x] Representative session high/low, distance, typical-price VWAP, 14-bar ATR, opening gap and session time features.
- [x] One engine accepts normalized finalized candles from historical and live-style adapters.
- [x] Candle-close availability, no-future invariance, session gap and special/CAS boundary tests.
- [x] Bounded rolling state and a 25-instrument / 9,375-observation test benchmark.
- [x] Full API and PostgreSQL-backed tests, TypeScript checks.

9A through 9D are intentionally backend/research-only by design. They expose typed libraries and research CLI/artifacts, not product screens. Actual live subscription, operator display and consumer wiring are 9E. The existing UI must not imply Phase 9 is complete.

## 9B acceptance

- [x] Context index registry separate from the tradable NSE EQ universe; registry tokens verified against the local synchronized Phase 3 master.
- [x] Frozen stable sector taxonomy and explicit current-as-of membership/backcast policy.
- [x] Versioned market, sector and relative context snapshots, with 5m/15m/30m/60m exact-endpoint returns.
- [x] Shared incremental 25-stock breadth and sector breadth with separate price/VWAP coverage gates.
- [x] No index level synthesized: absent historical benchmark observations yield unavailable context.
- [x] Point-in-time and historical/live-style equivalence tests; bounded state/performance fixture.
- [x] PostgreSQL-backed registry test, full API suite and TypeScript checks.

9B completed the context engine and registry, **not** a historical benchmark dataset. Its initial Kite verification was blocked by an expired session; 9C subsequently cleared that gate and created a separately identified index-context dataset. The later success does not change what was verified at the 9B handoff.

## 9C acceptance

- [x] Authenticated read-only profile verification and bounded historical probes for all eight registered benchmarks.
- [x] Additive year-long 1m index acquisition through the existing provider/downloader, with a versioned context dataset distinct from frozen Phase 8 equity identities.
- [x] Normal, Muhurat, Budget Sunday and post-CAS index timestamps validated; index continuous close does not inherit equity CAS truncation.
- [x] Policy-aware audit: 726,478/726,480 expected 1m index bars, two explicit missing minutes, zero duplicate/out-of-order/invalid rows; raw holiday observations remain outside the policy-valid view.
- [x] Real 9A/9B/9C descriptive market/sector distributions, quality/exclusion counts and transition statistics generated with frozen `MARKET_REGIME_V1`.
- [x] Real-data future-invariance and completed-live-style parity tests; identical manifest and analysis bytes on repeat run.
- [x] Full API/PostgreSQL suite (40 files, 311 tests), API TypeScript lint and build.

The context manifest is `apps/artifacts/phase9c/index-context-0671adf35f4fae2f1d4ec05a-manifest.json`; the stable descriptive artifact is `apps/artifacts/phase9c/regime-analysis-45b39097f8bf0cfef978486a-stable.json`. See [real-data validation](real-data-validation.md) for coverage and limitations.

## Next gates

**9C:** Complete. The prior auth blocker was resolved by user reauthentication, not an authentication code change. Real index history, session boundaries, distribution/transition analysis and point-in-time tests passed. Two Kite-omitted index minutes and zero-volume index data remain explicit limitations; they were not filled or hidden. The regime definition/thresholds were not tuned from these observations or from strategy P&L.

**9D:** Complete. The frozen `PHASE_9D_FEATURE_ABLATION_V1` study captured all 12 Phase 8E fold/partition results, joined all 31,944 requested setup-time context points, reproduced the frozen 9C stream and produced deterministic descriptive artifacts. Every feature family remains `INSUFFICIENT_EVIDENCE` for outcome-based use because no conditioned group passed the pre-registered trade-activity gate. TEST remained retrospective audit data, not selection data. See [9D validation](feature-ablation-validation.md).

**9E:** The lossless applied-tick observer, settled-minute orchestration through 9A/9B/9C, fail-closed operational CAS provider, context subscriptions, read-only API/health and UI are implemented. Synthetic historical/live equivalence and bounded performance passed. On 2026-09-30, refreshed Kite auth and the read-only WebSocket passed; all eight context benchmarks and 25 equities were active after the Phase 3 metadata sync. On 2026-10-01, the corrected pre-CAS session gate was verified during the active session: 33/33 subscriptions were active, settled equity bars reached 9A, 9B and 9C, and API/UI timestamps and breadth agreed. The operational source is now the direct CM MII security master with header-validated CAS parsing; today's CM file was not programmatically retrievable, so post-15:15 CAS behavior remains blocked by `SOURCE_UNAVAILABLE`. Sampled live cumulative volume was monotonic but full historical-volume parity remains unverified. See [live integration](live-integration.md). Phase 9 is not closed and no closure artifact has been issued.
