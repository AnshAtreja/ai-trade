# Phase 08 Roadmap — Historical Research & Backtesting

**Overall status:** COMPLETE

Phase 8 is the research lab for TradePilot. It takes historical candles through the same scanner and deterministic strategies used by the product, then adds realistic paper execution, analytics, walk-forward evaluation, and robustness research.

## Subphase status

| Subphase | Name | Status |
| --- | --- | --- |
| 8A | Historical data foundation | COMPLETE |
| 8B | Historical replay | COMPLETE |
| 8C | Historical paper execution | COMPLETE |
| 8D | Backtest analytics | COMPLETE |
| 8D.5 | Research dataset readiness | COMPLETE |
| 8E | Walk-forward baseline | COMPLETE |
| 8F.1 | Frozen baseline validation | COMPLETE |
| 8F.2 | Parameter/cost robustness | COMPLETE |
| 8F.3 | Controlled optimization | COMPLETE |
| 8F.4 | Final baseline strategy evidence gate | COMPLETE |

## Frozen research identity

- Universe: `NSE_EQ_RESEARCH_UNIVERSE_2026_V1`
- Manifest: `feaabc0198432edc`
- Calendar: `NSE_CASH_2025_2026_V2`
- CAS policy: `NSE_CAS_ELIGIBILITY_2026_V2`
- 1m dataset: `505dca3f27301e72`
- 5m dataset: `535e2347e56143d9`
- Phase 8E run: `1fd46d5ef1f0e98f`
- Phase 8E result SHA-256: `8070a2f7e6e1c23aafc9cf801d385b2aa064cd004cdfb298e9214594de23c852`
- Phase 8F.2 specification: `PHASE_8F2_ROBUSTNESS_V1`, hash `2de2b491c64f3d223d4e402a43914b070d9a61cc8d010435e41215d6e46ec445`
- Phase 8F.2 result: `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1.json`
- Authoritative repaired 8F.2 classifications: `apps/artifacts/phase8f/robustness-1fd46d5ef1f0e98f-v1-classification-recovered.json` (SHA-256 `6b505345eec692f1d8b04eb5873cf8220b6ec49c0fc5974dccb38113962999e9`)
- Frozen 8F.3 specification: `PHASE_8F3_CONTROLLED_OPTIMIZATION_V1`, hash `89d84e2f98d8daeb5eddcb5c1c9d5e5f6e940cc5c25df64a08847baadf6daa20`
- Phase 8F.3 result: `apps/artifacts/phase8f/controlled-optimization-1fd46d5ef1f0e98f-v1.result.json`, content hash `1af9eeb9148603581258f09114329050ef0a065308bed7b2efd4031285636a58`
- Phase 8F.4 frozen gate spec: `PHASE_8F4_FINAL_EVIDENCE_GATE_V1`, hash `c2e99bf80d39a29784b67253cf3293f3fc091c37974371c30152c4c7c6276865`
- Phase 8F.4 final result: `apps/artifacts/phase8f/phase8-final-evidence-gate-1fd46d5ef1f0e98f-v1.json`, content hash `6c59c07f13635a2705294c0ece95bba7bf4b7f2d76b8f95604acaf0d76ca1f41`

## Research rules

- Historical state advances chronologically, one candle at a time.
- No future candle may enter scanner, strategy, execution, or analytics state.
- Incomplete sessions are excluded when `requireCompleteSession=true`.
- No candle synthesis, interpolation, or forward filling.
- Phase 8 outputs are research artifacts, not live or operational paper state.
- Phase 8F.2 does not select parameters or rank strategies.
- Phase 8F.2 completed 768/768 TRAIN/VALIDATION parameter results and 96/96 TEST cost results with zero perturbed TEST executions. Classification recovery finished separately: 576 active rows were recovered, 192 zero-trade breakdown rows were retained, 18 parameter groups are `LOCALLY_SENSITIVE`, and six breakdown groups are `INSUFFICIENT_ACTIVITY`.
- Phase 8F.3 completed 800 TRAIN candidate-fold executions and one VALIDATION pass of 60 candidate-fold executions across a frozen 15-candidate shortlist. Optimized candidate TEST executions: zero. No candidate passed the pre-registered VALIDATION gates; breakdown had no viable activity candidate. No successor strategy was created.
- Phase 8F.4 validated seven immutable source and support artifacts, retained all four v1 research baselines, recorded zero validated successors, and found insufficient standalone deployment evidence for all four. It performed zero historical replay, parameter search, and optimized TEST executions. Phase 9 is pending.

## Completion gate

Phase 8 closed after controlled optimization and the separately frozen final evidence gate validated. Completion certifies the research process and records its limitations; it does not authorize live trading or assert that any strategy is profitable.
