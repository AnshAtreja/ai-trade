# Phase 09 — Market Intelligence & Feature Layer

**Status:** `9A, 9B, 9C and 9D complete; 9E in progress; Phase 9 open`

## Goal

Create a deterministic market-intelligence and feature layer that describes market context without becoming a trading rule by itself. Phase 9A established the typed feature foundation. Phase 9B added a separate benchmark/context universe, frozen sector taxonomy, coverage-aware sample breadth and point-in-time relative returns. Phase 9C validated the frozen regime engine against real, separately identified index history and produced descriptive distributions. Phase 9D joined frozen strategy setups and outcomes to point-in-time context for a retrospective, sample-gated ablation. Phase 9E now has a deterministic live observer, API and UI; Kite authentication/WebSocket and all 33 subscriptions passed after hours, while a current authoritative NSE CAS source and open-market finalized-bar verification remain pending.

## Subphase plan

1. 9A feature engine foundation and canonical schema: complete, backend-only by design.
2. 9B instrument, sector and market context: complete as backend infrastructure; real benchmark history was acquired during 9C.
3. 9C market-regime engine: complete, including real historical context, quality/transition analysis and deterministic artifact verification.
4. 9D historical validation and ablation: complete as descriptive research; no trading filter validated.
5. 9E live integration and Phase 9 closure: deterministic integration/API/UI implemented; real provider/CAS/live-smoke gate pending.

See [roadmap.md](roadmap.md) for gates, [implementation.md](implementation.md) for verified behavior, [real-data-validation.md](real-data-validation.md) for the 9C dataset/results, [feature-ablation-validation.md](feature-ablation-validation.md) for the 9D study, [live-integration.md](live-integration.md) for 9E readiness and [interview.md](interview.md) for the engineering story.

## In scope

- Market regime engine with **separate** dimensions: trend (`TRENDING_UP`, `TRENDING_DOWN`, `RANGE_BOUND`, `UNCERTAIN`); volatility (`HIGH`, `NORMAL`, `LOW`, `UNKNOWN`); sample-breadth confirmation; sector relative state. `EVENT_DRIVEN` is deferred until independently verified event evidence exists. High volatility alone does not imply a news event.
- Market + sector context:
  - stock
  - sector index
  - NIFTY
  - broad market
- Relative strength engine:
  - stock vs sector
  - stock vs index
  - sector vs broad market
- Intraday feature engine research:
  - VWAP and VWAP distance
  - opening range
  - ATR
  - realized volatility
  - relative volume
  - gap %
  - volume acceleration
  - range expansion
  - market breadth
  - time-of-day
  - distance from high/low

## Out of scope

- Kronos integration
- ML/meta-labeling
- News/RAG
- LLM decisioning
- Live orders
- Treating features as automatic buy/sell rules

## Depends on

Phase 8 historical data, replay, execution, and analytics foundations.

## Key modules / paths

- `apps/api/src/modules/market-intelligence/`
- `apps/api/src/modules/scanner/` integration points, if needed
- `docs/ROADMAP.md`

## Acceptance checks

- [x] Regime/context/features are deterministic for the same bounded fixture data.
- [x] Feature and regime calculations cannot see future fixture candles.
- [x] Strategy implementations are not duplicated or changed.
- [x] Output is structured context, not trade authority.
- [x] Real benchmark historical coverage, regime distributions and transitions are validated before 9C closure.

## Notes

This phase answers: "What context surrounds this setup?" It does not answer: "Should this trade be taken?"
