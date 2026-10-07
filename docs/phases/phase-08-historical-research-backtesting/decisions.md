# Phase 08 Research Decisions

## Calendar identity

`NSE_CASH_2025_2026_V2` is authoritative because it models the documented February 1, 2026 NSE Capital Market special session while preserving the previous session semantics. Phase 8E must use the current authoritative identity, not an older prompt that names V1.

## Instrument token identity

Kite `instrumentToken` is the token used for historical-data requests. `exchangeToken` is a separate broker/exchange identifier and must never be substituted in historical API calls.

## Incomplete sessions

Canonical observations remain preserved. Strict research consumers reject incomplete sessions with explicit data-gap reasons. There is no global deletion and no synthetic repair.

## Baseline interpretation boundary

Phase 8E and 8F describe frozen baseline behavior. Phase 8F.2 measures robustness and cost sensitivity. Phase 8F.3 may perform controlled selection only under a new, explicitly versioned experiment. No result is allowed to silently rewrite the baseline.

The completed 8F.2 workload contains 768 parameter results and 96 cost rows. Its legacy parameter-classification projection is not authoritative: the worker persisted summary values but omitted durable closed-trade expectancy and expectancy-R inputs, causing active groups to be misclassified as `INSUFFICIENT_ACTIVITY`. Classification recovery must use a separately versioned, deterministic sidecar and prove that its recovered execution values match the preserved rows exactly. The cost scenarios retain the frozen baseline strategy settings and are evaluated on TEST only; perturbed parameters never enter TEST. Any later selection requires the separately versioned 8F.3 method and cannot retroactively change the 8F.2 specification or Phase 8E baseline.

## Operational safety

Replay, historical execution, walk-forward, and robustness workers are research-only. They do not use the live market store, operational paper account, or Kite order endpoints.

## Final evidence gate

Phase 8F.4 freezes its source SHA-256 values and gate rules before reading strategy outcomes. It retains each validated v1 baseline as a comparator, records validated-successor status separately, and distinguishes factual research interest from standalone deployment evidence. The conservative gate requires at least 30 TEST trades, no more than one negative-expectancy TEST fold, and no locally sensitive parameter groups for a standalone-evidence claim. These are project gate criteria, not universal statistical thresholds. All four baselines fail at least one criterion, and 8F.3 selected no successor. Momentum's positive aggregate TEST result remains a reason for further context research, not a deployment decision. Breakdown's zero closed trades and failed activity search route it to redesign before more optimization.

Future context, regime, Kronos, meta-label, or news additions must create separately versioned research candidates. Their incremental value should be measured by comparing the unchanged v1 baseline with baseline plus feature/model under the same data and execution contract. Phase 8F.4 itself performs no replay or parameter search, and Phase 9 does not inherit a profitable production strategy.
