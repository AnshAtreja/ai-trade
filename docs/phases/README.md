# Phase Documentation

Each phase now has a canonical directory:

```text
docs/phases/phase-XX-short-name/
  overview.md         historical one-file phase note / high-level narrative
  roadmap.md          planned scope, status, dependencies, and acceptance gate
  implementation.md    what was actually built, verified, and limited
  interview.md         detailed interview chapter: story, problems, decisions, tradeoffs, verification, answers
```

Phase 8 also has `decisions.md` because it contains multiple research subphases and frozen identities.

The older root-level `docs/phases/phase-XX-*.md` files have been moved into their matching phase folders as `overview.md`. New phase work must update the folder documents and must not recreate standalone phase files in `docs/phases/`.

For completed phases, `implementation.md` must describe actual behavior and verification rather than copying the roadmap. `interview.md` must be detailed enough to explain the phase without reconstructing it from chat history: before/after, architecture, real problems and fixes, decisions, tradeoffs, tests, safety, limitations, short and long interview answers, and follow-up questions.

For future phases, `implementation.md` and `interview.md` remain explicit skeletons until work is performed. Skeleton prompts are not evidence of implementation and must never change phase status.
