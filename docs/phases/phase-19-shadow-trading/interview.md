# Phase 19 Interview Notes - Full Shadow Trading

**Status:** NOT STARTED

This is intentionally a skeleton. Do not describe planned behavior as implemented behavior. Fill it from code, tests, incidents, artifacts, and verified operational results when the phase is completed.

## The simple explanation

Explain in plain language how this phase solves running the complete live decision path without sending broker orders.

Use a before-and-after story:

```text
Before this phase:
[what the system can and cannot do]

After this phase:
[the new verified capability and its boundary]
```

## Why the phase exists

Document the concrete limitation in earlier phases that made this work necessary. Explain why it belongs in a separate phase instead of being folded into a scanner, strategy, risk, or execution shortcut.

## Architecture

Add the actual implemented flow:

```text
authoritative inputs
    -> adapters / validation
    -> core phase logic
    -> explicit output
    -> downstream consumers
```

Name what is shared, what is isolated, what is persisted, and what is deterministically recomputable.

## Problems actually encountered

After implementation, record each real issue separately:

### Problem

What failed, became unsafe, produced incorrect semantics, or did not scale?

### Root cause

What evidence identified the cause?

### Fix

What changed, and why was it the smallest correct fix?

### Verification

Which test, artifact, benchmark, or operational check proved the fix?

Focus especially on live/research divergence, timing, data outages, decision logging, broker-write isolation, and mismatch investigation.

Do not invent a dramatic failure if the implementation was straightforward. In that case, document the main risks anticipated and the tests that prevented them.

## Architectural decisions

For every important decision, capture:

- alternatives considered;
- why the chosen design fit the existing architecture;
- what remains deliberately out of scope;
- what would cause the decision to be revisited.

## Tradeoffs

State what became safer, simpler, faster, or more reproducible, and what cost was accepted in exchange.

## Safety and research integrity

Document:

- live-order reachability;
- operational paper-state impact;
- data and identity versioning;
- leakage protections where applicable;
- degraded/missing-data behavior;
- human authorization boundaries.

## How it was tested

List focused tests, integration tests, database-backed checks, deterministic/equivalence tests, and any production-shaped validation. Include exact counts and artifact identities only after they exist.

## A good 30-second interview answer

> "[Write a concise problem, design, hardest issue, and verified outcome. Do not claim unimplemented capability.]"

## A 60-90 second interview answer

> "[Explain the architecture, one meaningful problem and fix, the key tradeoff, and the safety boundary.]"

## Strong technical-problem story

Use this structure:

```text
symptom
    -> evidence/profile
    -> root cause
    -> design change
    -> equivalence/safety verification
    -> measured result
```

## Follow-up questions to prepare

- Why was this phase separate from the previous one?
- What were the rejected alternatives?
- How did you prevent silent failure or unsafe fallback?
- How is the behavior versioned and reproduced?
- What evidence would make you change the design?
- What remains unproven?

## Honest limitations

Record unresolved technical, data, statistical, regulatory, or operational limitations. Never rewrite them away when the phase is marked complete.

