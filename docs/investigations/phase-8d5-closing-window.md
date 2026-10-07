# Phase 8D.5 closing-window investigation

Investigated on 2026-09-18 IST. Scope: historical reads and documentation only.

## Finding

The 360-candle pattern is explained by the Closing Auction Session (CAS). For eligible equities, continuous trading ends at 15:15 IST; the minute candle starting at 15:14 is the final continuous-session candle. Kite does not supply ordinary minute candles for the following auction window. Its official response to an INFY historical-data report describes exactly the same 360 rows and empty 15:15-15:30 response observed here. See [Kite's explanation](https://kite.trade/forum/discussion/16171/historical-data-api-missing-minute-candles-after-15-14).

CAS applies initially to cash equities with derivative contracts. NSE describes a separate auction from 15:15 to 15:35, while non-CAS securities continue continuous trading to 15:30. See [NSE's CAS specification](https://www.nseindia.com/static/products-services/closing-auction-session). Kite's [CAS announcement and follow-up](https://kite.trade/forum/discussion/comment/52719/) confirms the 2026-08-03 effective date and the historical-candle cutoff.

There is no demonstrated ingestion bug: HTTP response, adapter, normalizer, and existing persistence all contain the same 360 timestamps. There **was a session-model deficiency**: the prior calendar assigned 09:15-15:30 to every normal cash-equity session. Its 375-candle expectation could not distinguish CAS eligibility or effective dates. The versioned `NSE_CASH_2025_2026_V2` calendar now works with the effective-dated session policy, so the original smoke-test report's 225 missing closing candles are not established provider data loss.

The current synchronized instrument master contains September futures for RELIANCE, HDFCBANK, and INFY, corroborating applicability. This is current-master evidence, not a persisted point-in-time CAS membership history. That distinction must be preserved for future research datasets.

## Exact request trace

Instrument: `NSE:RELIANCE`, `instrumentToken=738561`. Internal interval: `1m`; Kite interval: `minute`. Timezone for exchange interpretation: `Asia/Kolkata`.

| Boundary | From | To | Semantics |
| --- | --- | --- | --- |
| CLI argument parsing | `2026-09-07T03:45:00.000Z` | `2026-09-07T10:00:00.000Z` | UTC strings, passed unchanged |
| `HistoricalMarketDataService.resolveRequest` | Same instant as UTC `Date` | Same instant as UTC `Date` | `[from,to)` |
| `buildHistoricalChunks` | `2026-09-07T03:45:00.000Z` | `2026-09-07T10:00:00.000Z` | One chunk, no session clipping |
| `KiteHistoricalMarketDataProvider.fetchRange` | Same UTC instant | Same UTC instant | Converts only at adapter boundary |
| `KiteBrokerAdapter.getHistoricalCandlesByToken` | `2026-09-07 09:15:00` | `2026-09-07 15:29:59` | Kolkata wall time, inclusive Kite end |
| HTTP GET query | `2026-09-07 09:15:00` | `2026-09-07 15:29:59` | URL-encoded, `oi=1` |

The CLI parsing was inspected in source. To capture the downstream trace without writing candles, the diagnostic called the same service/downloader/provider path with `persistenceEnabled=false`. It used the existing `KiteBrokerAdapter` and encrypted `KiteTokenStore`, with a diagnostic observer around HTTP GET. No credentials or authorization headers were recorded.

Exact URL sent:

```text
https://api.kite.trade/instruments/historical/738561/minute?from=2026-09-07%2009%3A15%3A00&to=2026-09-07%2015%3A29%3A59&oi=1
```

`formatKiteHistoricalTimestamp(2026-09-07T10:00:00.000Z)` yields `2026-09-07 15:30:00`. The provider deliberately subtracts one second before formatting the inclusive end. Seconds are retained; milliseconds are omitted. This path uses direct authenticated HTTP through the adapter, not an SDK with another date conversion. Kite documents the parameter format in its [historical API reference](https://kite.trade/docs/connect/v3/historical/).

## Counts before and after processing

| Stage | Count | First candle | Last candle |
| --- | ---: | --- | --- |
| Raw HTTP `data.candles` | 360 | `2026-09-07T09:15:00+0530` | `2026-09-07T15:14:00+0530` |
| Adapter mapping | 360 | Same IST timestamps | Same IST timestamps |
| Provider normalization | 360 | `2026-09-07T03:45:00.000Z` | `2026-09-07T09:44:00.000Z` |
| Previously persisted 1m rows | 360 | `2026-09-07T03:45:00.000Z` | `2026-09-07T09:44:00.000Z` |

All raw timestamps, converted to UTC, equal the stored timestamp sequence. The first/last raw OHLCV also match the corresponding stored candles. Existing rows have `source=KITE`, not `MOCK`.

The serialized single-day stored rows had the same SHA-256 before and after diagnostic reads:

```text
faead9dac18ec56e1749959ff2181c9fa9ce947de84e7ebcff7404f5bea54678
```

No candle rows were inserted, reconciled, or deleted.

## Boundary experiments

Six authenticated historical GETs were made, all for RELIANCE on 2026-09-07. The first five returned HTTP 200 and were captured before adapter mapping. The final inclusivity probe succeeded through the already-verified one-to-one adapter mapping. All times below are IST.

| Requested from | Requested to | Raw count | First | Last |
| --- | --- | ---: | --- | --- |
| 09:15:00 | 15:29:59 | 360 | 09:15 | 15:14 |
| 09:15:00 | 15:30:00 | 360 | 09:15 | 15:14 |
| 15:00:00 | 15:30:00 | 15 | 15:00 | 15:14 |
| 15:15:00 | 15:30:00 | 0 | None | None |
| 15:15:00 | 15:31:00 | 0 | None | None |
| 15:13:00 | 15:14:00 | 2 | 15:13 | 15:14 |

The last probe establishes inclusive endpoints where candles exist. Extending the closing request to 15:31 does not recover candles. Repeating a full-session read without the one-second end adjustment also makes no difference.

## Other boundaries checked

- Chunking uses five-day windows and one-minute overlap. The single day and original five-session smoke range each fit in one chunk. It neither consults session hours nor rounds 15:30 to 15:15.
- The provider only removes timestamps outside `[from,to)`. It removed zero rows in this trace.
- The adapter maps every valid raw candle. It has no closing-session filter.
- Prisma writes every supplied row using `createMany` with `skipDuplicates`. Its identity is `(instrumentToken, interval, timestamp)`, and reads use `gte: from, lt: to`. A 15:29 candle would qualify for a 15:30 exclusive end.
- Validation runs after persistence and does not delete candles. The legacy integrity validator checks gaps between supplied rows; `valid=true` on this contiguous single-day series does not prove full requested-session coverage.
- Local 5m aggregation runs after 1m persistence and cannot remove 1m records. A complete 360-minute continuous session produces 72 five-minute buckets. The three extra buckets expected under the old 375-minute assumption are absent auction-window slots, not partially populated trailing buckets.
- Read-only inspection of all 15 stored instrument-days found 360 contiguous `KITE` rows per day, each starting at 09:15 and ending at 15:14 IST. No additional instruments or dates were fetched from Kite.

## Single-day revalidation

The existing CLI was run against stored RELIANCE candles twice. These are coverage reads, not repeat downloads.

```bash
npm run historical:dataset-validate --workspace api -- \
  --tokens 738561 --interval 1m \
  --from 2026-09-07T03:45:00.000Z --to 2026-09-07T10:00:00.000Z

npm run historical:dataset-validate --workspace api -- \
  --tokens 738561 --interval 1m \
  --from 2026-09-07T03:45:00.000Z --to 2026-09-07T09:45:00.000Z
```

| Interpretation | Expected | Actual | Coverage | Current CLI status | Dataset ID |
| --- | ---: | ---: | ---: | --- | --- |
| Original requested range to 15:30, current generic calendar | 375 | 360 | 96% | `INCOMPLETE` | `572ef37fce88f7a0` |
| Explicit continuous-session range to 15:15 | 360 | 360 | 100% | `COMPLETE` | `78e23bd2fd580056` |

Both have first timestamp `2026-09-07T03:45:00.000Z` and last timestamp `2026-09-07T09:44:00.000Z`. The second query demonstrates continuous-session completeness; it does not correct the calendar or establish auction coverage. For CAS continuous-session data, `3 * 5 * 360 = 5400` explains the entire smoke-test total.

## Research-data handling required

## Implementation update

The required session-policy work is now implemented. Exchange availability remains owned by the versioned NSE cash calendar, while instrument-specific continuous-session bounds are supplied by `NseCashInstrumentSessionPolicy`. Confirmed CAS eligibility uses 09:15–15:15 IST continuous candles after 2026-08-03 and records the 15:15–15:35 IST auction window separately; non-CAS instruments retain 09:15–15:30 IST. Unknown eligibility remains an explicit unresolved state and does not generate inferred gap counts or replay gap events.

The current database resolver derives eligibility from active matching NFO futures in the synchronized Kite instrument master. This is sufficient for the existing smoke dataset and avoids changing persisted candles, but it is not a point-in-time security-master history. A dated CAS membership source remains a limitation before a multi-year research dataset is treated as authoritative.

Historical validation and replay now use a separate deterministic effective-dated eligibility dataset. The current synchronized instrument master remains available for current/live diagnostics, but it cannot override missing historical eligibility. The shipped historical dataset is intentionally empty pending authoritative dated CAS membership data, so post-effective-date historical sessions without a record resolve to `UNKNOWN`.

1. Add a versioned historical session policy keyed by trading date and instrument eligibility. It must retain 375-minute sessions for non-CAS equities and applicable pre-change dates, and use 360 minutes for confirmed CAS equities from the effective date. Do not replace the global close with 15:15 or hardcode these three tokens.
2. Establish eligibility from exchange security-master/CAS evidence with effective dates. The current instrument model has no dated CAS classification; current F&O membership alone must not be projected backward over a research year.
3. Report continuous-session completeness separately from auction-data availability. Confirmed auction windows are not missing continuous-market candles. Unknown eligibility should remain an explicit unresolved session-policy diagnostic. A missing candle within the applicable continuous session must still be a real gap.
4. Preserve supplied OHLCV and `[from,to)` reads. Do not manufacture flat candles, redistribute daily auction volume into minute bars, or mix auction prices into continuous-session aggregates. Official daily closes and intraday-derived closes may differ; their provenance must remain distinct.
5. Revalidate existing data after the session-policy work. Retry downloads only for demonstrated gaps inside an expected continuous session. Review dependent session-end assumptions separately before interpreting execution/analytics outputs from this dataset.

The investigation does not change the runtime calendar: a blanket 360-minute correction would misclassify other securities and earlier dates. The external-provider branch of this task calls for documenting behavior and proposing research handling. Date- and instrument-specific eligibility remains required work before a twelve-month research download.

## Verification and scope

- Full API suite: Vitest reports **23 files, 184 tests passed**. Six Prisma-dependent test bodies return early with a PostgreSQL-unreachable message in the test environment; they are included in Vitest's reported pass count. The database-backed diagnostic/validation commands above did connect successfully.
- Historical-data coverage within that run: 12 historical-data tests and 5 dataset tests executed; the one historical Prisma test was among the early returns. Existing dataset regression coverage already asserts that 360 rows against a 375-minute calendar produce a 15-candle closing gap.
- API TypeScript: `npm run lint --workspace api` passed (`tsc --noEmit`).
- No runtime code was changed, so no new regression test was added. The empirical boundary probes provide evidence for retaining the current request conversion and half-open normalization.
- Repository changes: this report, its [sanitized evidence](phase-8d5-closing-window-evidence.json), and the linked limitation in [historical-market-data.md](../historical-market-data.md).
- No order APIs were called by the diagnostic. No operational paper-state changes, dataset repairs, broad downloads, or Phase 8E work were performed.
