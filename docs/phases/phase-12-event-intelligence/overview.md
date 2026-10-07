# Phase 12 — Event Intelligence: News + RAG

**Status:** `planned`

## Goal

Ingest and classify market events so unresolved news, filings, announcements, and macro context can become explicit decision inputs or risk filters.

## In scope

- News ingestion:
  - company news
  - market news
  - macro news
- Exchange announcements:
  - NSE/BSE corporate announcements
  - results
  - board meetings
  - corporate actions
  - regulatory filings
- Retrieval and cited context.
- Event classification:
  - `POSITIVE_CATALYST`
  - `NEGATIVE_CATALYST`
  - `RESULTS`
  - `MANAGEMENT`
  - `REGULATORY`
  - `CORPORATE_ACTION`
  - `MACRO`
  - `UNKNOWN`
- Event-risk filter that can skip technically valid setups.

## Out of scope

- Telegram delivery.
- Autonomous order placement.
- Letting an LLM bypass deterministic gates.

## Depends on

Phase 9 context features. Kronos and meta-labeling may enrich this later but are not hard prerequisites for ingestion.

## Key modules / paths

- `apps/api/src/modules/event-intelligence/ (to create)`
- `vector store TBD`

## Acceptance checks

- [ ] Retrieved snippets are cited.
- [ ] Event labels include uncertainty.
- [ ] High-impact unresolved events can block a proposal.
- [ ] Event timestamps are handled without future leakage in historical evaluation.

## Notes

This phase adds event awareness. It does not decide trades by itself.
