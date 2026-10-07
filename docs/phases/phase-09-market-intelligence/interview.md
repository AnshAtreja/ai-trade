# Phase 09 Interview Notes - Market Intelligence & Feature Layer

**Status:** 9A, 9B, 9C and 9D COMPLETE. 9E IN PROGRESS; Phase 9 is still open.

## The simple story

Phase 8 built a reproducible historical research system, but a strategy setup still lacked a single trustworthy vocabulary for its surrounding market conditions. The live scanner had some day-high and momentum calculations; replay had another market-state projection. Neither was a versioned, stand-alone *description* of the market at a precise time. The danger was that a future feature or model could quietly calculate a number one way in history and another way live, or include a candle that had not closed yet.

9A adds the foundation for that vocabulary. Picture a finished one-minute RELIANCE bar. We convert it to a canonical observation, advance a small per-instrument accumulator, and publish a snapshot of facts: session high/low, distance from those levels, session VWAP, ATR, opening gap and minutes since open. Every field carries its own availability state. The same calculation engine accepts either a persisted historical candle or a completed live-style candle. The snapshots describe the market; they never say BUY or approve an order.

```text
completed historical candle ----\
                                -> one normalized observation -> one feature engine -> immutable snapshot
completed live-style candle ----/
```

Live *deployment* of this pipeline is 9E, not 9A. Sector, benchmark and breadth were added in 9B; regime labels are 9C; historical quality/ablation is 9D. This distinction is important in an interview: 9A and 9B are verified backend foundations, not a claim that the entire intelligence layer is in production.

## Why not just put this in the scanner?

The production scanner's feature calculator supports the existing candidate rules. Changing it would risk changing the frozen Phase 8 baseline. A scanner feature can also be threshold-oriented (near a high, breaking a high, momentum bias), whereas 9A is strictly descriptive: a numeric distance, a VWAP, or a data-quality status. The strategy engine similarly owns setup decisions, not a general purpose feature registry. A separate module preserves these ownership boundaries and gives later research a stable, independently versioned input contract.

We reused what the repo already knew: common 1m/5m bucket timing, historical and live candle types, IST trade dates, the NSE cash calendar and the instrument-specific CAS policy. The new calculations are only where the existing code did not have equivalent semantics. One example: replay's `averagePrice` weights **closing price** by volume; 9A VWAP uses **typical price** `(high + low + close)/3` times per-bar volume. Renaming the replay value “VWAP” would have been easy but wrong.

## How point-in-time safety works

A historical candle's timestamp is its *opening* instant. At 09:15, you do not yet know that minute's high, low, close or full volume. The snapshot is timestamped 09:16, after the bar is complete. The engine rejects reads with an as-of time before that close. Its state advances one finalized bar at a time, in order. A test changes a later candle and confirms the earlier snapshot is identical. Another test sends the same ordered observations through both adapters and compares every snapshot exactly.

The engine never calls the wall clock to decide whether data is stale. A caller supplies an explicit simulated or live as-of time. This is essential for deterministic replay: a backtest run next week must not produce different features merely because the calendar on the machine changed.

## What the first features mean

- **Session high/low:** maximum observed high and minimum observed low since the official session opened. Distance is `(high-close)/high` or `(close-low)/low`, multiplied by 100. A positive number is distance in percent, not a trading signal.
- **Session VWAP:** volume-weighted average of each completed candle's typical price. It resets each session. If volume is unavailable or zero, VWAP is *unavailable*, not `0`.
- **ATR:** simple mean of the most recent 14 true ranges within the session. The first bar uses high-low; later bars also consider movement from the previous close. Before 14 bars, ATR is `INSUFFICIENT_HISTORY`, not a misleading 14-bar value built from one bar. This is a consciously versioned intraday definition, not an implied daily Wilder ATR.
- **Gap percent:** first observed session open relative to an explicitly supplied previous session close. If that previous close is missing, the gap is unavailable. A later missing opening candle invalidates session gap quality.
- **Session time:** minutes elapsed from the official exchange open at *bar close*. OPEN is the first 60 minutes; CLOSE is the final 60. The remaining period is MID. Muhurat and CAS boundaries matter here.

The schema already reserves names for later volume, opening-range, relative-strength, market and sector features, but they are `null` plus `NOT_APPLICABLE`. A zero means a real zero. We did not fill placeholders with invented values.

## The real issue we found

Our first special-session test failed. On Muhurat day, the authoritative calendar opens at 13:45 and closes at 14:45, but the instrument session policy returned the ordinary 15:30 close. My first resolver combined the special opening time with the ordinary closing time, accidentally creating a hybrid session that never existed.

The failing test showed the exact discrepancy. The fix was not to change the calendar or session policy used by Phase 8. The 9A resolver now takes **both boundaries from the calendar on a special session**, and uses the instrument policy's continuous close on normal CAS days. The Muhurat, CAS and holiday tests then passed. This is a good example of why “market open/close” cannot be one hardcoded constant.

There was also a test-writing mistake: I tried to assert a conflicting duplicate after the engine had already advanced to the next minute. At that point it was correctly an *out-of-order* bar. I moved the duplicate assertion before advancing, leaving separate coverage for both conditions. That is not a production defect; it is an example of keeping the test's setup faithful to the behavior it claims to test.

## Data quality and tradeoffs

A missing minute latches `DATA_GAP` for session accumulators and ATR. We keep the current candle's raw OHLC available, but do not present a partial-day high, VWAP or cumulative volume as complete research context. We do not forward-fill or synthesize anything. The strictness can discard potentially useful partial features for the rest of that session; later consumers could adopt a separately versioned recovery definition if evidence warrants it.

The engine stores at most 14 true ranges per instrument/interval, plus scalar accumulators and one immutable snapshot. This avoids rescanning the entire day each minute and bounds per-instrument history. A 25-instrument, 9,375-observation test completed in 146 ms alone and 474 ms within the concurrent full API suite, retaining 350 true ranges. Process peak RSS was 89 MB and 121 MB respectively; neither is isolated feature-engine memory or a real-market throughput SLA.

Snapshot identity includes schema and definition versions, instrument, source dataset/stream identity, interval, candle-close time, session/calendar/policy identity, values and quality. It omits wall-clock telemetry. If a calculation changes materially, it must become a new version rather than silently altering `MARKET_FEATURES_V1` research meaning.

## Testing and operational boundary

The focused tests covered calculations, 1m/5m close timing, session reset, gaps, stale reads, lack of history, non-finite input rejection, future invariance, historical/live-style equivalence, immutable snapshots, deterministic IDs, Muhurat, CAS and holidays. All 13 passed. The full API suite passed 35 files and 276 tests. Docker/Postgres was healthy, Prisma `SELECT 1` and a repository count succeeded, and the suite was rerun with DB access so Prisma tests actually executed. Ordinary sandboxed Vitest output had misleading self-skipped DB tests; a green test count by itself was not sufficient evidence of DB integration.

No Phase 8 artifact, historical candle, frozen strategy, parameter, scanner rule, risk limit, paper account or Kite order path changed. The new engine has no broker dependency and no persistence side effect.

## 30-second answer

> “After finishing the historical research platform, I started a versioned market-feature layer. I built one incremental engine for finalized historical and live-style candles, with deterministic snapshot IDs and explicit quality states. It computes session levels, VWAP, ATR, gap and time context without lookahead. A special-session test caught a Muhurat closing-time mismatch, which I corrected at the feature-session resolver without touching the frozen trading strategies.”

## 60-90 second answer

> “Phase 8 could replay and evaluate strategies, but we did not have a canonical, versioned description of the market state around a setup. I made a small, stand-alone feature engine that takes completed candles from either historical or live-style adapters and outputs immutable snapshots. The snapshot time is the candle close, so full-bar values cannot appear a minute early. It has per-feature quality states rather than using zero for missing data, and it only retains 14 true ranges plus session accumulators per instrument. We tested historical/live equivalence and changed a future candle to prove earlier output was unaffected. One genuine bug appeared around special NSE sessions: the first resolver combined Muhurat’s special opening time with the ordinary closing time. A boundary test caught it, and the resolver now lets the authoritative calendar define both special-session boundaries while normal CAS days use instrument policy. This was the 9A research foundation; sector context and regime labels followed as separate backend work, while live integration remains later. No frozen strategies or order paths were changed.”

## Follow-up questions

**Why wait until bar close?** Because high, low, full volume and close are unknowable at bar open. Publishing early would leak future information into replay.

**Why not precompute the whole day?** That would make a future candle accessible to earlier snapshots. Incremental state mirrors chronological observation and uses bounded memory.

**What if a candle is missing?** The current candle's OHLC is still factual, but session-derived values become `DATA_GAP` and null until the next session; no synthetic bar is created.

**How is VWAP different from the replay average price?** Replay currently weights closes by volume. 9A explicitly defines typical-price bar VWAP and versions that formula. They should not be conflated.

**Is historical/live equivalence fully proven?** It is proven for the same ordered, normalized completed OHLCV observations in bounded tests. Real Kite stream volume semantics and actual live subscription remain unverified until 9E.

**Can 9A calculate live features for any future trading day now?** No. The current authoritative CAS eligibility data ends at 2026-09-19. Rather than guess a later instrument's closing boundary, the resolver rejects it. Extending that source and validating real stream semantics are 9E prerequisites.

**What would force a V2?** A change to ATR smoothing/period, VWAP input price, gap reference, session reset, quality semantics, time bucket definitions, or source availability timing.

## Phase 9B - The next question

9A could say what a stock was doing by itself: its VWAP, ATR, gap and session levels. But a stock up 1% can mean different things depending on whether the broad market is up 2%, its sector is down 1%, or most stocks are advancing. 9B adds those comparisons. The key is that these remain *facts*, not “trade this stock” rules.

```text
25 frozen research equities ------> one shared sample-breadth state
                                  -> one breadth state per frozen sector

NIFTY 50 index observations ------> broad benchmark context
sector index observations --------> sector benchmark context

one equity feature snapshot + these shared contexts
    -> equity-vs-market, equity-vs-sector, sector-vs-market returns
```

The architecture has two deliberately separate universes. The **tradable universe** is NSE cash EQ and stays behind the Phase 3 scanner filter. The **context universe** consists of NSE `INDICES` records and static sector membership metadata. An index may be observed without becoming a stock to scan or trade. This mattered because the local Kite master labels indices `instrumentType=EQ`; only checking `instrumentType` would be unsafe. The existing tradable filter also checks `segment`, so an `INDICES` row is excluded. A regression test demonstrates this isolation.

## Where the 9B facts came from

We inspected the actual local Phase 3 instrument repository rather than copying token lists from a website. It held `NIFTY 50` and seven sector indices as active NSE `INDICES` rows, with canonical instrument tokens. A read-only PostgreSQL-backed test now compares all eight frozen registry entries to that synchronized master. The registry has stable IDs such as `NIFTY_50` and `NIFTY_IT`; business logic refers to these IDs instead of scattering raw tokens across calculators. Its version is `NSE_MARKET_CONTEXT_2026_V1`, with registry identity `e987d9599c8c8e8b6e39bb40`.

But **instrument metadata is not price data**. The historical table contained zero rows for those index tokens. We attempted a fresh read-only Kite connection check using the existing shared broker adapter; it returned `AUTH_REQUIRED` / `KITE_AUTH_EXPIRED`. Consequently, we could not honestly claim that Kite's index historical endpoint worked, and we did not download anything. The context engine works with actual finalized index observations when supplied, and tests use explicitly synthetic observations. Without an index candle at runtime, index level and relative-return fields are null with `INSUFFICIENT_HISTORY`. No official index price is fabricated from constituents.

This is a useful interview distinction: “I verified that the master contained the benchmark identities, but I did not confuse that with having a verified benchmark data feed.”

## Sector membership and survivorship

The frozen Phase 8 research universe names 25 stocks and their current sector display labels. That is not a historical sector-constituent archive. We map those display labels once into stable IDs such as `INFORMATION_TECHNOLOGY` and `FINANCIAL_SERVICES`, with a taxonomy version and a known-as-of date of 2026-09-18. HCLTECH resolves to Information Technology, then to the NIFTY IT benchmark; every stock also links to NIFTY 50.

The default policy refuses to use that *current* membership for earlier historical dates. A research caller may explicitly enable `allowBackcastCurrentMembership`; the result then says `EXPLICIT_HISTORICAL_BACKCAST`, and the policy changes the snapshot identity. That opt-in makes the survivorship assumption visible. It does **not** prove that HCLTECH had the same membership at every earlier minute. A proper effective-dated constituent dataset remains a later data-quality task.

There are honest holes in V1. Telecommunication, consumer durables and industrials have no exact verified sector benchmark in this registry. We do not substitute an approximately related index: the sector benchmark is `NOT_APPLICABLE`, while sector *sample breadth* can still be computed from the frozen members when coverage is sufficient.

## What relative strength means here

This is not RSI. It is a simple percentage-point comparison of returns:

```text
stock return over H       = (stock close now / stock close exactly H earlier - 1) * 100
market return over H      = (index close now / index close exactly H earlier - 1) * 100
stock vs market over H    = stock return - market return
```

We froze four intraday horizons: 5, 15, 30 and 60 minutes. Sector comparisons use the same formula for stock versus sector index and sector index versus broad index. For example, if the stock rose 10%, its sector rose 7%, and NIFTY 50 rose 5% over the same five-minute horizon, the outputs are +3, +5 and +2 **percentage points** respectively. They are factual comparisons, not scores or buy recommendations.

The endpoint H minutes earlier must exist **exactly** in the same session. We do not grab the nearest bar or forward-fill. If there is too little warmup, the field is `INSUFFICIENT_HISTORY`; if a bar is missing inside the window, it is `DATA_GAP`. A current index bar can be up to 60 seconds older than the equity bar, never newer. Each metric reports the actual index observation time, so a consumer can see that synchronization lag. Beyond 60 seconds it becomes `STALE`, not a plausible-looking number.

## The breadth denominator problem

This is one of the most important 9B design choices. Imagine only five of 25 stocks have arrived at 09:16 and four are advancing. “80% advancing” would sound like a market-wide fact, but it would really describe four of five currently received ticks. We therefore froze the denominator as the 25-stock research sample. Each snapshot exposes expected, available and coverage counts.

Our V1 gates require **at least 80% coverage and at least two available stocks** before returning a percentage. At 20 of 25, coverage is 80%; with 15 advancing and five declining, advance percentage is 75% of the *20 available stocks*. At 19 of 25, the advancing count remains factual, but the percentage becomes null and quality becomes `INSUFFICIENT_COVERAGE`. One-stock sectors also fail the two-member gate even at 100% coverage. This is deliberately a **sample breadth**, not official exchange-wide NSE breadth.

Advancing/declining compares a fresh close with an explicitly provided previous-session close. No previous close means the stock is not an available breadth constituent; the engine does not use its opening price as a silent substitute. Above-VWAP breadth has a separate available count and coverage gate because a stock may have a valid price but missing volume/VWAP. One test deliberately keeps price breadth at 80% while VWAP breadth falls to 76%, proving that the VWAP percentage is withheld independently.

## Real engineering constraints in 9B

The first benchmark fixture accidentally expected a full 375-minute day on a CAS date. The Phase 9A engine rejected the bar after the true 360-minute continuous session. That was correct behavior. We moved the full-length performance fixture to a pre-CAS normal session and kept a separate CAS test proving that a stock bar is rejected after its continuous close. An observed index bar is treated on its own terms; 9B does not blindly apply cash-equity CAS close to indices. Actual index-specific timing was still unverified **at the 9B handoff**; 9C subsequently checked it against persisted real observations.

We also had to prevent a second form of subtle inaccuracy: a benchmark first seen long after the exchange opening minute has only an *observed* high and low. It cannot claim the full-session high/low. The calendar gives trading-date and known opening evidence; if the first benchmark bar is late, range-distance quality becomes `DATA_GAP`. We reject holiday raw rows but do not force equity CAS closing semantics on indices.

The performance choice was incremental breadth. Each new stock observation replaces that stock's contribution in an accumulator, and old contributions expire after the frozen one-minute freshness window. We never recalculate all 25 constituents just because another stock asks for market context. Market and sector snapshots are cached as immutable objects for the current timestamp and state revision; 25 stock reads reference the same market object and one object per sector. Return histories retain at most 61 one-minute points per instrument/index, enough for the 60-minute horizon. Strategy state and execution accounts are not involved.

A representative synthetic fixture processed 25 equities and two benchmarks over 375 minutes: 10,125 updates and 9,375 instrument-context evaluations. The focused test took about 472 ms and observed 108 MB process peak RSS; the full API suite under concurrent load took about 833 ms and observed 110 MB. The final context state held at most 61 points for each of 27 series, 50 market/sector breadth entries, a bounded expiry queue and ten cached sector snapshots. These are bounded-test measurements, not production latency guarantees.

## Safety and evidence

Phase 9B adds `MARKET_CONTEXT_V1` and `MARKET_CONTEXT_DEFINITIONS_V1`. `INSUFFICIENT_COVERAGE` is a deliberate 9B context quality extension; it did not change Phase 9A's existing feature schema. Identities include context-universe version, source dataset/stream identities, timestamp and explicit membership policy. Inputs are only finalized 1m bars or 9A close-timestamped equity snapshots. A later benchmark bar cannot be read at an earlier time. A bounded historical-versus-live-style adapter test produces identical market, sector and relative snapshots from the same ordered observations.

The 9B tests passed: 17 focused deterministic tests and one PostgreSQL-backed registry test. The full API suite passed 37 files / 294 tests, including the frozen Phase 8 evidence tests. TypeScript lint/build passed. No index candles were fetched or persisted, no Phase 8 equity dataset ID changed, and no scanner rule, v1 strategy, paper account, risk control or Kite order API was touched.

## 9B interview answer, 30 seconds

> “In 9B I added a versioned market-context layer around the existing stock features. I separated index benchmarks from tradable equities, mapped the frozen 25-stock universe to stable sector IDs, and computed exact-horizon stock-versus-index returns and coverage-aware breadth. The hardest conceptual issue was avoiding misleading numbers from sparse or stale observations, so every context field has freshness and coverage metadata. At that handoff I had verified benchmark identities in PostgreSQL, but I did not claim real index history because the Kite session was expired and no index candles were stored. The real-history gate was resolved later in 9C.”

## 9B interview answer, 60-90 seconds

> “Phase 9A described a stock in isolation; Phase 9B asked how it behaved relative to its sector and the market. I first inspected the Kite instrument master and found NIFTY 50 and sector indices under `INDICES`, while the scanner's tradable universe excludes that segment. I froze a separate context registry and a stable sector taxonomy for the 25-stock research set. The engine accepts finalized equity features and observed index candles in chronological order, calculates exact 5/15/30/60-minute percentage-point return differences, and maintains one incremental breadth state for the sample and one per sector. It refuses to report breadth percentages below 80% coverage or with fewer than two constituents; above-VWAP breadth has its own coverage gate. Market and sector snapshots are immutable and shared across stock reads, while return histories stay bounded. At the 9B handoff the local master identities were verified but historical index access remained unverified because the shared Kite session had expired. The module reported unavailable context instead of inventing data. Phase 9C later established real historical support without changing 9B's trading-decision boundary.”

## 9B follow-up questions

**Is this official NSE market breadth?** No. It is explicitly `NSE_EQ_25_BREADTH_2026_V1`, the frozen 25-stock research sample. Its denominator and coverage are visible.

**Why not use constituent prices to rebuild NIFTY 50?** That would not be the official index and would require weights, membership history and corporate-action semantics we do not possess. Missing index values stay missing.

**What if the benchmark skips a minute?** We can use its latest *closed* observation for up to 60 seconds and show its timestamp. An exact return anchor or window gap produces unavailable quality; a later observation is never pulled backward.

**Why is backcast an opt-in?** A sector mapping recorded in September 2026 is not evidence that it held in 2025. Default strict mode refuses to silently put today's membership into yesterday's research.

**Why did you not persist context snapshots?** They are deterministic functions of source observations, context registry/version and policy. Persisting every per-minute context would create a large secondary dataset without a demonstrated need. A separately identified context dataset can be added after real benchmark acquisition if research needs it.

**What remained at the 9B handoff?** 9C could define factual regime labels only with explicit unavailable quality. Real benchmark history and index-session verification were still needed before a trustworthy historical regime study; 9C could not treat sample breadth as the full exchange or quietly infer absent index prices. The real-data gate was resolved in 9C, while the sample-breadth limitation remains.

## Phase 9C - Turning facts into careful labels

9B gave us measurements. 9C asks whether those measurements tell a coherent story. If the broad index is rising, near its observed session high, and most of our 25-stock sample is both advancing and above VWAP, we can describe that snapshot as an upward trend. If those pieces disagree, we say `UNCERTAIN`. This is a **description of the market now**, not a prediction that the next candle will rise and not an instruction to buy.

```text
9B factual market + sector context
       -> 9C versioned regime engine
          -> broad-market trend, volatility activity, sample breadth
          -> sector trend, volatility activity, relative performance
       -> later research may inspect these descriptions
```

The first design decision was to avoid one giant label such as “bullish” or “high-volatility market.” Direction and volatility are different questions. A market can be trending up in a calm way, or trending up with unusually large five-minute moves. The snapshot therefore has **separate** trend and volatility dimensions. A sector has its own trend/volatility context and a separate factual comparison with NIFTY 50. Nothing in this module opens an order, changes a strategy parameter or filters a setup.

### Why an upward index alone is not enough

Suppose NIFTY rises but only a small part of our stock sample is advancing. That index move may be driven by a few heavily weighted names. We do not force `TRENDING_UP`; the engine records which evidence supports the move and which evidence conflicts. The V1 directional rule requires four groups to agree: 15/30-minute index direction, location near the observed session high/low, advance/decline of our frozen stock sample, and the sample's above-VWAP share. We explicitly call this **25-stock sample breadth**, not “NSE market breadth.” Each group has coverage and freshness checks inherited from 9B. If a benchmark is missing, stale or gapped, or too few stocks are observed, the trend is `UNCERTAIN` with a quality reason.

The thresholds live in one `MARKET_REGIME_V1` registry with a hash, rather than scattered conditional checks. Up requires +0.12% on 15 minutes, +0.20% on 30 minutes, within 0.40% of the observed session high, and at least 55% advancing and above VWAP. Down mirrors those signs. A muted, balanced market can be `RANGE_BOUND`; incomplete or conflicting evidence stays `UNCERTAIN`. These are frozen descriptive rules, **not** chosen from Phase 8 profitability. `HIGH`, `MEDIUM` and `LOW` evidence strength describe rule agreement, not probabilities of future performance. There is no hidden “confidence = 80% chance of going up” claim.

### The volatility wrinkle

9B has official index prices but not reliable index volume or an index VWAP/ATR. It would be misleading to pretend we computed a full official volatility measure. V1 therefore labels a narrow, factual proxy: the absolute exact five-minute index return. We compare it with the median of up to 60 **earlier** unique observations. With fewer than 20 earlier observations or a zero median, the result is `UNKNOWN`. A current move at least twice the prior median is `HIGH`; at most half is `LOW`; in between is `NORMAL`. We classify the current observation **before** adding it to history. This small ordering choice is what prevents the current or a future large move from changing the historical baseline it is judged against.

This proxy is not time-of-day normalized. The open may naturally be more active than midday. We measured the real historical distribution without changing the frozen definition after seeing it. The baseline intentionally persists across sessions; the 9B return horizons and session highs reset on the actual trading session. There is no hysteresis in V1. The real transition counts are evidence for later research; any smoothing would become a separately versioned V2, not a silent change to V1.

### Sector context without recommendations

The same engine can describe an IT sector index and IT sample breadth, then compare IT's 15-minute return with NIFTY 50. At least +0.10 percentage point is `OUTPERFORMING_MARKET`; at most -0.10 is `UNDERPERFORMING_MARKET`; a small difference is `INLINE_WITH_MARKET`. These are relative measurements, not `BUY_IT` or `SELL_IT`. Some sectors in the frozen sample have one stock or no exact verified sector benchmark. The correct output there is unavailable/uncertain, not a guessed sector index.

The snapshot stores structured reason codes and the values that led to them. That lets a later researcher explain *why* a particular minute was labeled a trend. We also deliberately did not create an `EVENT_DRIVEN` label. A large move or high volatility does not prove news caused it; genuine event evidence belongs to the later event-data phase.

### The real-data gate: a blocked start, then a controlled recovery

The first 9C implementation had only synthetic fixtures. On 2026-09-29 the shared Kite adapter's read-only profile check returned `AUTH_REQUIRED`, `verified=false`, `KITE_AUTH_EXPIRED`; PostgreSQL had **no index candles for any of the eight registered tokens**. That was an honest stop, not a claim that Kite did not support index history. We did not bypass the broker adapter, download blindly, or build an index from the 25 equity constituents. The user reconnected Kite. A fresh authoritative profile check then returned `CONNECTED`, `hasStoredSession=true`, `verified=true`. There was no authentication code bug to fix.

The next decision was to **probe before downloading a year**. We asked the existing historical provider for 15 one-minute bars for each registered index over one bounded window. All eight replied with 15 contiguous bars, so the source was actually usable. We additionally inspected two index streams on a normal day, the short 2025 Muhurat session, the unusual Sunday Budget session and a post-CAS date. Only after those checks did we use the existing five-day chunked downloader for the year. This ordering made a potentially expensive acquisition conditional on real endpoint support.

### Index time is not equity time

A subtle bug would have been to apply our cash-equity CAS close rule to NIFTY and sector indices. Eligible equities end continuous trading at 15:15 IST after the CAS change; the observed index histories still contained their ordinary 375 minute bars through 15:30. We therefore gave the index context dataset its own versioned session semantics, while still using the authoritative calendar for holidays and special days. The persisted tests confirmed every index has 375 bars on a normal day and post-CAS day, 60 on Muhurat, and 375 on the Budget Sunday. That is a practical lesson: **reusing a calendar is good; assuming all instruments share identical session boundaries is not**.

The provider also returned raw bars on four dates the authoritative calendar calls holidays. We kept those rows for provenance but excluded them from the policy-valid context view. Conversely, the calendar expected two index minutes the provider did not return: NIFTY AUTO and NIFTY FMCG both lack 15:17 IST on 2025-12-15. A narrow read-only retry returned the adjacent minutes but not that one. We recorded the gap; we did not insert a synthetic price or call it an exchange outage without independent evidence. Six index series have 243/243 complete sessions; the other two have 242 complete and one incomplete each. Across all eight, policy-valid coverage is **726,478/726,480** expected minutes.

### Separate identity, same trusted storage pipeline

We did not change the frozen Phase 8 equity OHLCV or its dataset IDs. The eight index tokens are persisted by the existing generic historical repository, then identified by a **separate versioned context manifest**: `NSE_INDEX_CONTEXT_2025_2026_V1`, dataset ID `0671adf35f4fae2f1d4ec05a`. The distinction is logical, not a new physical database table. The manifest includes benchmark registry, provider, range, actual rows, calendar/session policy, gaps and canonical content hash. Operational `fetchedAt` timestamps stay in database metadata, outside the stable hash. Running the manifest and analysis twice yielded exactly the same IDs and byte-identical files. That matters because a research label is only reproducible if we can say **which source observations and rules produced it**.

### What the real replay actually found

We fed eligible equity bars through 9A, merged them with actual index bars in 9B, then ran the **same frozen 9C engine**, not a simplified research-only classifier. The 22 incomplete frozen-equity instrument-sessions were excluded by the strict historical eligibility contract; index holes stayed visible. The run evaluated **90,330 market frames** and **901,050 sector frames**. Broad-market trend was `UNCERTAIN` **77,449 times (85.74%)**, `RANGE_BOUND` 9,099, `TRENDING_DOWN` 2,190 and `TRENDING_UP` 1,592. This is a very cautious classifier. We did **not** lower thresholds to make the pie chart look more exciting: that would change the experiment after seeing the data.

Volatility labels were `NORMAL` 47,011, `LOW` 24,287, `HIGH` 17,797 and `UNKNOWN` 1,235. The unknown category includes point-in-time warm-up/unavailable-return cases, not an assumed zero move. The artifact contains monthly and half-hour distributions, each supported sector's trend/volatility/relative state and breadth/quality coverage. One-stock sectors and sectors without a verified matching index remain unavailable rather than guessed. Importantly, breadth is explicitly a **25-stock sample**, not all NSE stocks; current-as-of sector membership is backcast and can introduce historical survivorship limitations. Every index volume observation was zero, so an official index VWAP or volume signal was **not** invented.

### A real transition measurement, not a tuning decision

The frozen labels changed state **5,787** times over 243 observed sessions. Mean state-run length was about **14.98 minutes**, median **3 minutes**, average **23.81 flips per session**. There were zero direct `TRENDING_UP` to `TRENDING_DOWN` flips; 65 directional changes passed through `UNCERTAIN`. Short median runs and many flips are important behavior to investigate, but 9C is descriptive. We did not add smoothing or hysteresis after seeing the result. That would require a separately versioned definition and later validation. Nor did we ask whether momentum made money in an uptrend; strategy P&L by regime is a **9D question**, not evidence for 9C labels.

### How we checked the time-machine rule on real data

Using persisted NIFTY 50/NIFTY IT plus the 25 equities, historical adapters and completed-live-style adapters produced identical snapshot IDs over a bounded real 45-minute fixture. Then we changed an index candle **after** a chosen timestamp; all earlier IDs stayed unchanged. Withholding one benchmark minute caused a lagged as-of read and `DATA_GAP`, not a future lookup or forward fill. The full API suite passed **40 files / 311 tests**, including actual PostgreSQL-backed cases, and TypeScript lint/build passed. A full-year descriptive run took about **137 seconds** with roughly **498 MB observed peak RSS**; a repeat took about 143 seconds / 508 MB. These are whole-process observations, not a live-serving SLA. State stayed bounded, and volatile runtime/RSS were kept out of the stable artifact.

### What 9C does not prove

At the 9C handoff, these labels had **not** been shown to predict price, improve a strategy, or be safe as an order filter. Phase 9D subsequently tested historical context associations and found no conditioned group passing its sample gate; Phase 9E's real live-feed parity remains unverified. The high `UNCERTAIN` share, two source gaps, zero index volume, 25-stock sample breadth, current-membership backcast and absence of time-of-day normalization all remain visible limitations. Phase 9 is still open. No live orders, operational paper state, strategy rules or Phase 8 research baselines were touched.

### Interview answer, 30 seconds

> “I built and validated a deterministic market-regime layer on top of stock features and real NIFTY/sector index history. I verified the broker source before downloading, versioned the index dataset separately from the equity backtest, modeled index sessions separately from equity CAS rules, and preserved missing/holiday-data diagnostics. The labels describe trend and volatility with explicit quality gates; they are not trading signals. Real-data future-invariance tests and a repeat byte-identical analysis verified reproducibility.”

### Interview answer, 60-90 seconds

> “Phase 9C turned our point-in-time stock and market features into versioned market and sector descriptions. Direction and volatility are separate: an uptrend needs agreement between index returns, position in the observed session range, and coverage-gated advancing/above-VWAP breadth from our 25-stock sample. The volatility label is a five-minute return activity proxy compared against earlier observations, not a claim of official index volatility. The first real-data gate stopped correctly because our Kite session had expired and we had no index history. After reconnection, I tested all eight historical endpoints with bounded requests, then acquired and audited one year of index bars through the existing pipeline. We discovered that post-CAS index bars continue to 15:30 even when eligible equities stop at 15:15, and that Kite omitted two exact index minutes while returning raw bars on four calendar holidays. We kept those facts explicit in a separate versioned context manifest. A real 9A-to-9C replay produced market/sector distributions and transition statistics; repeating it gave byte-identical artifacts. I tested historical/live-style parity and that changing a future candle cannot change earlier labels. About 86% of broad-market frames were uncertain; I recorded that instead of tuning the frozen definition to make it look more decisive. We have not yet tested predictive value or wired these labels into live trading.”

### Likely follow-up questions

**Why not use an index as a proxy for exchange-wide breadth?** An index is weighted by its constituents; breadth is a count-like participation measure. Our breadth is explicitly the frozen 25-equity sample with coverage, not the entire exchange.

**Why keep holiday rows if they are invalid for research?** Raw source provenance and policy-valid research are different layers. Deleting the raw rows would hide what the provider actually returned; treating them as live sessions would violate the calendar.

**Why so many `UNCERTAIN` labels?** The frozen rule needs several independent pieces of evidence to agree. Quality can be available while the signals disagree or miss thresholds. The descriptive count is evidence for 9D review, not permission to tune V1 after seeing results.

**Why are index bars in the same database table as equities?** We reused the generic historical repository and distinct canonical tokens, while giving index research its own version, policy and content identity. It is logical separation; a physical split would be an operational migration and was not needed for this gate.

**Does 9C show better trading performance?** No. It measures the integrity and behavior of descriptive labels only. Strategy-by-regime P&L or ablation belongs to 9D and was not run.

## Future chapter prompts

9D evidence and limitations are recorded below. The 9E chapter records implemented live integration separately from the still-unverified real-provider gate; do not confuse a synthetic parity test with a completed live smoke.

## Phase 9D - Can market context explain the frozen setup outcomes?

**Current gate:** Complete as retrospective, sample-gated research. The definitive numbers belong in the content-addressed Phase 9D result and [validation record](feature-ablation-validation.md).

### The simple question

Phase 9C could say things like “the broad market is trending up,” “sector relative return is positive,” or “sample breadth is weak” at a particular completed minute. That is useful context, but it does **not** prove that any of those facts improve a trade. Phase 9D asks a narrower research question: *when an existing Phase 8 strategy setup happened, what was the market context available at that decision, and what eventually happened to the unchanged historical trade?* The answer is a description of associations, not a trading rule.

```text
frozen Phase 8 setup + existing historical execution outcome
                    |
                    | join at the completed one-minute decision close
                    v
frozen Phase 9A stock features + 9B market/sector context + 9C regime
                    |
                    v
feature-conditioned tables with sample sizes, folds and data quality
```

An attractive `TRENDING_UP` slice does not turn into “trade only in uptrends.” That would be a new strategy, with its own version and a fresh test period. The four Phase 8 v1 strategies, their parameters and execution assumptions stay frozen. Previously examined TEST periods are labeled retrospective audit data, not a new tuning set.

### The first obstacle: the baseline was deliberately compact

The Phase 8E baseline stores 48 strategy/fold/partition analytics results, but its long-running checkpoint was compacted to avoid the enormous memory cost of storing every event and equity point. That was the right choice for Phase 8E; one earlier checkpoint had grown to roughly 831 MB. The consequence for 9D is that the final compact artifact does **not** contain every setup timestamp and trade row needed for a feature join. Aggregate P&L by fold cannot tell us whether a particular setup occurred under a high-volatility market frame.

The 9D solution is a **research-only capture hook** on the existing optimized walk-forward runner. We replay the same frozen historical candles through the same scanner, strategy registry and paper execution, and record setup evaluations and trade rows. Each fold/partition is a separate worker with an atomic, identity-hashed capture file. On resume, completed files are checked and skipped. We do not use a new strategy implementation or a simplified `exit - entry` P&L formula.

There is another subtle counting trap: a scanner may report `SETUP_DETECTED` on successive evaluations with the same setup identity. Those are multiple evaluations, **not** multiple independent trades. The capture preserves evaluation count but the join deduplicates strategy/fold-specific setup identity before attaching context. A closed trade links to one setup, not to every repeated evaluation. Likewise, overlapping walk-forward folds are not independent copies of market history; partition and fold provenance remain on each observation.

### The second obstacle: one child execution ID did not reproduce

The first full Fold 1 TRAIN capture processed all 1,165,875 eligible candles, then stopped on a strict comparison for `opening-momentum:v1`. Its setup/order/fill/trade counts and every requested partition metric matched the frozen Phase 8E result. A diagnostic replay showed that the only `analytics` field differing was `metadata.runId`: the old compact baseline had `d7c6d634f3114c58`, while the current replay produced `21e4c619e5d8d617`. Phase 8C builds this child ID from the shared replay ID and the complete order/fill/trade ledgers. The compact baseline did not retain those ledgers, so we cannot honestly attribute the mismatch to a particular unfilled order or claim byte-identical execution internals.

We did **not** change the historical result or silently skip the check. The capture now compares every metric and all substantive analytics fields exactly, permits only that isolated child-ID field to differ, and records each old/new ID pair with fold and strategy provenance in the research artifact. A focused test changes net P&L and confirms the comparison still fails. This is a good interview lesson: an opaque hash mismatch needs investigation, but a content hash of detailed audit ledgers is not the same thing as the measured economic outcome. We preserve the discrepancy and its uncertainty instead of pretending it never happened.

### The third obstacle: regime history must advance even when there is no setup

The 9C volatility label compares the current five-minute index move with a median of **earlier** observations. If we only ran the regime engine at timestamps where a strategy setup exists, the median would depend on the strategy's setup schedule. A rare setup might see a different “history” from a frequent setup, even though both inhabit the same market. That is a subtle form of research inconsistency.

The 9D context join therefore advances the existing 9A, 9B and 9C engines on **every** available market frame, just as the validated 9C descriptive run did. It only writes context snapshots at requested setup times. Before joining, it recomputes the stored index-context manifest read-only and checks the frozen dataset identity. After the full stream, it checks index/equity observation counts, market/sector update counts and broad trend/volatility distributions against the frozen 9C artifact. That is stronger than simply seeing that some labels look plausible.

### The time-machine rule

A one-minute historical bar is timestamped at its **start**, but its high, low, close and volume are known only at its **end**. The setup join records the original replay timestamp and a separate `decisionAvailableAt = replayTimestamp + 60 seconds`. Every 9A/9B/9C snapshot and benchmark observation must be at or before that decision time. A later index candle, breadth update, sector return or volatility sample cannot be pulled backward. Missing and stale features remain explicit quality categories; they are not coerced to zero or forward-filled. The two known missing index minutes stay missing. Index VWAP is unavailable because observed index volume is zero, not because the study forgot to calculate it.

### Why a good-looking slice may still be weak evidence

Phase 9D froze its research specification **before** outcome analysis: semantic signed/ATR/breadth/session-distance bins, five session-relative time buckets, four two-way interactions, a 30-closed-trade/two-fold sample gate, concentration checks and a no-significance-claim policy. TRAIN is primary, VALIDATION is a separate consistency check, and the already observed TEST history is retrospective only. Every feature table carries setup and trade counts, fold breakdown and quality. The current frozen baseline has relatively few closed trades per strategy/partition, so a pretty percentage in a tiny slice cannot become a validated filter. The high 9C `UNCERTAIN` share and current-sector-membership backcast are limitations to report, not thresholds to revise after seeing outcomes.

### The fourth obstacle: a long run lost its database connection

The historical capture is not a one-minute script. It runs four strategies through four chronological folds and three independent partitions, including more than a million eligible candles in a single TRAIN partition. PostgreSQL disappeared while the first run was about to start fold-03/TEST. The worker correctly failed instead of treating a database error as an empty historical session. Eight partition captures had already been atomically written and content-hashed. Once the project's PostgreSQL container was started again, the coordinator validated and **reused all eight**, then finished the remaining four. The work did not have to restart from fold 01.

Fold-04/TRAIN also showed why progress telemetry matters. It slowed for several minutes near 675,000 of 1,180,500 candles. PostgreSQL remained healthy and the Node worker was still present; macOS showed a temporary stuck/compressed-memory state. It later resumed and completed. We did not guess that the algorithm was broken, kill a healthy partition, or turn a slow research task into an unreviewed optimization. A useful interview lesson is to separate an actual failed dependency from a long but progressing computation, and to make partition boundaries restart-safe.

### What the completed study actually found

All 12 capture partitions passed the frozen Phase 8E metric comparison. The point-in-time join produced **31,944/31,944** requested instrument/time snapshots, with no missing context point. It processed 726,478 benchmark observations and exactly reproduced the frozen Phase 9C market-stream and regime-distribution counts. It recorded **720,800 scanner/strategy setup evaluations**, but only **55,080 distinct fold-specific setup identities** and **160 closed strategy-partition trade records**. Those 160 records include overlapping folds, so even that number is not 160 independent unseen trades.

This distinction is central. A large number of setup evaluations can look like a rich research sample, but the actual outcome sample is tiny. The frozen spec required at least 30 closed trades across two folds with five trades in each before calling a conditioned slice sufficient. **No feature-conditioned group passed that gate.** The final artifact reports every pre-registered slice anyway: 1,659 descriptive contrasts, including 377 allowed interactions, and no statistical significance claims or hidden winner selection. All six feature families are `INSUFFICIENT_EVIDENCE` for outcome-based use. That is a *completed validation result*, not a failed experiment or permission to relax the threshold after seeing the answer.

The breakdown baseline generated setup observations but **zero closed trades**, so there is no valid profit-based feature ablation for it. Breakout had 19 TRAIN, 15 VALIDATION and 22 TEST closed trade records; momentum had 21, 19 and 16; opening-momentum had 14, 16 and 18. Most completed trades happened while market trend was `UNCERTAIN`; for momentum, all closed trades in all three partitions were in that label. Only 6,376 of 55,080 distinct setup identities had an `AVAILABLE` market-trend feature; 48,678 were `INSUFFICIENT_HISTORY`. This is a feature-availability and sample limitation, not proof that an `UNCERTAIN` regime is good or bad for trading.

Other context is useful to inspect but not to trade on yet. Market 15-minute returns were available for 20,900 setup identities, sector-relative state for 18,739 and ATR% for 23,403. Index VWAP remained unavailable for all identities because the provider's index volume is zero; we did not invent an index volume series. A redundancy check found correlation of about 0.885 between 15-minute instrument-vs-market and instrument-vs-sector relative returns among 11,359 paired observations. That suggests overlapping descriptive information, not a learned feature-selection verdict. The 25-stock breadth denominator and today's sector membership backcast to history remain honest research limitations.

There was also the one old-versus-new child execution ID difference described above. It is present in the final artifact with exact fold/strategy provenance, while all substantive analytics match. We cannot retroactively explain the underlying detailed order-ledger difference because the old compact baseline did not retain that ledger. A strong interview answer acknowledges this unresolved audit limitation rather than saying every byte of historical execution reproduced.

The result is content-addressed (`245e39306b2220f184c9a36f`), and repeating the read-only context join and analysis produced the same artifact IDs and bytes. Phase 9D is complete as **descriptive research infrastructure**, but 9E's real-live gate is still open. No v1 strategy was filtered, tuned, or declared deployable.

## Phase 9E - Moving the research context into a live observer

### What changed, in plain language

In 9A-9C, we had deterministic code that could turn **finished historical candles** into features, market/sector comparisons and regime labels. That is not yet a live product. For 9E, I connected those same engines to the running Kite market stream. The important phrase is *same engines*: live and historical use the same calculations after their source data is converted to the same completed-candle contract. I did not rewrite a special “live version” of market regime or change how any strategy decides to trade.

```text
Kite tick -> normalized current market state -> completed 1m candle
                                                -> existing 9A features
                                                -> existing 9B context
                                                -> existing 9C regime
                                                -> read-only API and UI
```

This remains an **observer**, not a decision-maker. The Intelligence page can say “NIFTY context is stale” or “sample breadth is 60%,” but no code turns that into “approve momentum” or an order. That matters especially because Phase 9D found no feature-conditioned trading group with enough outcomes to pass its pre-registered sample gate.

### Problem 1: a live tick bus can silently lose intermediate ticks

The existing event bus is intentionally latest-value-wins. That is sensible when updating a screen: if five prices arrive before the UI refreshes, showing the newest one is useful. It is **not** sensible for OHLCV aggregation. If a high or low arrives in an intermediate tick and the bus coalesces it away, a minute bar built from bus events would be wrong.

I used the `LatestMarketStateStore.onAppliedTick` hook instead. It receives each valid, deduplicated, ordered tick after the existing parser and normalizer. The new minute assembler keeps one open bar per subscribed token, settles it only after the minute ends, rejects late revisions, and leaves empty minutes empty. The strategy-side candle aggregator was not changed. A test verifies that at 09:16:00 the 09:15 bar is not yet published until the settling delay has elapsed. That prevents “knowing” a candle's close or high before the candle is complete.

### Problem 2: Kite volume is cumulative, but VWAP needs each minute's volume

A quote's `volume` is the session cumulative quantity, not an independent one-minute amount. Adding each tick's volume would wildly overcount. The adapter instead uses the increase between successive cumulative readings. When it observes the first minute from the official session open, that cumulative number belongs to the first minute; if TradePilot starts at 11:00, it does **not** pretend the 11:00 cumulative number happened only in that minute. It marks minute volume unavailable, so the session VWAP cannot be presented as complete. This is a conscious limitation until a verified historical warm-up/backfill is added. No synthetic candle or guessed volume is created.

### Problem 3: indices must be observed but never traded

9B needs NIFTY 50 and seven sector indices. They are valid Kite WebSocket subscriptions and appear in latest market state, but they must not enter the scanner universe. We kept two conceptual universes: 25 frozen equity observations for research-sample breadth and eight index observations for context. The existing `isTradableNseEquity` filter rejects `INDICES` even if Kite calls the instrument type `EQ`. A focused test feeds every index identity to that predicate. The live service also asserts that a context index never enters its equity feature path. Subscribing to an index is not equivalent to authorizing it as an order instrument.

### Problem 4: the historical CAS list ends before today's live date

For CAS-eligible cash equities, ordinary continuous trading ends at 15:15; other cash equities and indices continue to 15:30. The frozen Phase 8 CAS membership evidence ends at 2026-09-19. Reusing it on September 30 would silently assume that no F&O stock was introduced or excluded. That would corrupt session boundaries and create false missing bars.

So 9E has a **separate operational policy**. It is designed to read an NSE date-specific daily F&O contract file, derive the active individual-stock underlyings, reconcile each symbol to the existing Kite instrument identity, and atomically save a dated file hash and provenance. Kite is used for the token, not for eligibility. If the report cannot be fetched, parsed, dated or reconciled, the relevant equity is `UNKNOWN` and does not enter the finalized live feature path. Indices use a separate normal-close rule and never inherit equity CAS.

The provider owns its file parser, while session policy consumes dated eligible symbols. A future direct NSE CM security-master CAS field can therefore replace the F&O source without rewriting market-close decisions. The parser recognizes stock futures **and options** but excludes index contracts, checks report date/expiry and rejects implausibly short files. A snapshot binds effective date, source hash, optional cross-check hash, per-symbol reconciliation and disagreements. The guessed direct NSE URL had returned 404, so I removed it as a default. NSE's official website showed a 29 September contract master but not a 30 September one during the post-close inspection, and its static underlyings page was last updated in 2024. I would not promote either into 30 September's CAS truth. Designing a fail-closed adapter is different from proving that an external daily feed is available in production; Phase 9 cannot close on synthetic file tests alone.

### Problem 5: live data can disappear without the last label disappearing

If the socket disconnects after producing a nice-looking `TRENDING_UP` label, the last in-memory object still exists. An API that returns it without freshness would falsely imply the market is *currently* trending up. The service therefore returns availability and age with every read. A disconnected or auth-failed stream, stale benchmark or old equity frame becomes `UNAVAILABLE` with an explicit reason; the old context/regime is not served as current. Reconnect clears unfinished bars and volume baselines, waits for a full minute, and restores desired subscriptions. Errors in the observational listener are counted and logged at a bounded rate while the underlying market store continues to update.

### What we actually proved

Synthetic historical/live-style equivalence covers all three engines: the same ordered finished one-minute bars produced identical feature, market-context and regime IDs. A representative full-session test fed 25 equities plus eight benchmarks for 360 minutes: 11,880 completed bars, 9,000 feature evaluations, 360 market updates and 3,600 sector updates. It ran in about 0.6-1.25 seconds across focused/full-suite runs, with bounded maps and rolling histories. Those are test-fixture results, not a real-tick rate SLA. The full API suite passed 42 files/330 tests **with PostgreSQL-backed cases actually running**, and both API and web builds passed.

After the user refreshed Kite, the read-only profile check passed and the WebSocket connected. The first subscription attempt exposed a separate data-structure limit: the stream's startup index held only the first 50,000 of 114,443 persisted instruments, so a valid NIFTY 50 token in PostgreSQL looked unknown. I added an on-demand Phase 3 repository lookup for subscribed tokens rather than loading every instrument into memory. Then the first equity subscription exposed stale `NSE:RELIANCE` metadata (`2885/738` locally versus `738561/2885` in the current Kite master). I ran the existing instrument sync, not a manual token correction. It completed with zero failures; all 25 equities and eight benchmarks then matched, and the socket showed 33/33 subscriptions active. The market was already closed, so this proves connectivity and identity registration, not live minute bars, provider-volume parity or regime updates. CAS remained `SOURCE_UNAVAILABLE`/`UNKNOWN`; no order was placed. Phase 9E and Phase 9 stay open until the current official source and open-market behavior are verified.

The final full test run caught a further subtle issue: a PostgreSQL persistence test used the fixed mock RELIANCE identity against the shared database, passed, and quietly overwrote the authoritative row again. I replaced that fixture with a uniquely named test instrument and cleanup, reran the database suite, and repeated the normal instrument sync. This is a useful interview lesson: passing tests are not enough if the tests mutate shared reference data. A post-suite identity smoke was what exposed the side effect.

### Interview-ready answer

> “I integrated our historical market-intelligence engines with the live Kite stream without changing trading decisions. The UI event bus coalesced ticks, which is fine for display but unsafe for building candles, so I used a lossless applied-tick hook and published only settled one-minute bars. Eight benchmark subscriptions remain context-only. I separated daily operational CAS eligibility from the frozen historical mapping and made missing or stale NSE evidence fail closed. During the real Kite smoke I found two practical identity problems: a 50,000-row startup index missed valid benchmark tokens, and the local RELIANCE row was stale. I fixed the lookup boundary and refreshed metadata through the existing Kite sync; all 33 subscriptions then became active. Because the market had closed and the current NSE CAS master was still unavailable through a verified route, I reported those limits rather than calling Phase 9 complete or turning descriptive labels into trading filters.”

### Short interview answer

> “For Phase 9D I built a retrospective feature-ablation pipeline around four frozen historical strategies. The earlier backtest artifact was intentionally compact, so I replayed the unchanged strategies with a research-only capture, checked every partition against the frozen analytics, and joined each setup to market and sector context available at that candle's close. All 31,944 requested context points joined and the full regime stream reproduced. The run survived a PostgreSQL outage because completed partition captures were atomic and resumable. The important result was a limitation: despite 720,800 setup evaluations, there were only 160 overlapping-fold trade records and no conditioned slice met our pre-registered sample gate. I reported feature quality, concentration and redundancy, but did not turn any attractive historical slice into a strategy filter or use the already-seen TEST data for tuning.”
