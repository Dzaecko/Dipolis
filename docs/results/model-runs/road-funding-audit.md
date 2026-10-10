# Road funding and interrupted-run audit

## Evidence and scope

This audit uses the existing [assignment N protocol](openai-N-1.jsonl) and previously
measured offline replay data. No new real-model requests or tests were run for this
documentation update. The measurement snapshot used Node v22.14.0 on Windows,
Haight/koexistenz, seed 42, disasters disabled, speed 3, tax 7, food imports on,
power priority 0, 12,000 warm-up ticks and a 60,000 treasury baseline.

The historical protocol has 152 records: 17 consecutive completed years, 134
decision-journal entries and one failure marker. Year 17 ended in calendar year
2033; the failure occurred in relative year 18. There are **no partial-year-18
decision entries** to reproduce. The old failure marker does not retain the
original HTTP status, response body or error kind. Request size alone cannot
establish why that provider request failed.

Offline replay reproduced 117 recorded calls and compared 1,020 historical report
fields with zero tool-result mismatches and zero report mismatches. This verifies
the recorded trajectory under the measured engine snapshot, not a fresh model
completion or a guarantee across future engine versions.

## Historical context and request sizes

Sizes below are UTF-8 bytes, not tokens, HTTP headers or billing estimates. The
state basis is the first decision request for relative year 18: the old logged
report after 17 completed years and their history. The compact comparison uses
that same old report, **without adding the newer funding/effect/crime/physical-road
report fields**. It is not the size of a future resumed request with today's full
report.

| Quantity | Bytes | Interpretation |
| --- | ---: | --- |
| Old serialized year context | 37,024 | Exact reconstruction of the historical context |
| Retained reasons within old history | 14,190 | UTF-8 reason text retained by the old history format |
| Reconstructed old-style request | 49,877 | Current prompt/tools with old context; not the exact original HTTP body |
| New compact year context | 14,414 | Same state/report basis; reason-free history strings |
| New compact request | 27,245 | Current wire encoder, prompt/tools and the same old report basis |

The original HTTP request was not captured. The 49,877-byte estimate uses current
tool definitions and prompt, the logged model and no `max_tokens`; historical tool
definitions were unavailable for this reconstruction. An original optional token
limit would also change the body. Consequently, the exact old **context** size
must not be confused with an exact old **HTTP request** size. New request-byte
events measure the encoded JSON body directly; token usage is separately reported
by the provider. Historical missing token usage cannot be recovered from bytes.

## Funding semantics and deterioration mechanism

The historical model set road/police/fire funding to 30/35/35. These are independent
percentages of each service's annual need, not allocations that must sum to 100.
Current model arguments are `roadFundingPercent`, `policeFundingPercent` and
`fireFundingPercent`; old `road`/`police`/`fire` arguments are translated on replay.
The report distinguishes current percentages, annual needs, effective strengths,
`crimeAverage`, weighted `roadTotal` and physical `roadTileCount`.

In the replay, road funding remained approximately 30% (floating-point reporting),
with `roadEffect` 9; police/fire funding remained approximately 35%, with effects
350 each. A 30% setting is not an effect of 30 or an annual spend of 30 money units.
The initial fully funded effects were road 32 and police/fire 1,000.

The [road scan implementation](../../../packages/micropolis-engine/src/simulate.cpp#L1225-L1268)
enables deterioration below road effect 30. It first requires a random 1-in-512
gate, excludes tiles with `CONDBIT`, then compares the effect with a uniform 0–31
draw. At effect 9, the per-eligible-tile, per-full-scan probability is

$$
p = \frac{1}{512}\frac{31-9}{32} = \frac{22}{16384}
  = 0.0013427734375.
$$

There are 48 full map scans per simulated year. For a continually eligible tile
at constant effect 9, the corresponding idealized loss probabilities are
$1-(1-p)^{48} \approx 6.246\%$ per year and
$1-(1-p)^{48\cdot17} \approx 66.594\%$ over 17 years. These are mechanism-based
probabilities, not a prediction that every road or every seeded run loses that
fraction. Conductive road tiles are excluded from this deterioration branch.

`roadTotal` is a scan-time weighted census: heavy traffic adds weight and bridges
add extra weight. It is not the number of physical road tiles. The offline map
scan's `roadTiles` measurement is the physical count corresponding to the current
report's `roadTileCount` concept. The audit separately tracks the initial cohort
of nonconductive road tiles still present as roads.

## Logged-policy replay: annual measurements

Year 0 is the post-warm-up baseline. In every completed replay year, road/police/fire
effects were 9/350/350. Counts and balances below are measured, not inferred from
the funding percentages.

| Relative year | Weighted roads | Physical roads | Initial nonconductive roads remaining | Crime index | Human resident points | AI resident points | Treasury |
| ---: | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| 0 | 2,738 | 2,375 | 2,022 | 29 | 3,585 | 0 | 60,000 |
| 1 | 2,575 | 2,322 | 1,969 | 96 | 3,611 | 0 | 58,101 |
| 2 | 2,342 | 2,207 | 1,854 | 97 | 3,702 | 57 | 55,632 |
| 3 | 2,161 | 2,085 | 1,732 | 98 | 4,111 | 128 | 53,948 |
| 4 | 2,029 | 1,988 | 1,635 | 99 | 4,582 | 262 | 53,553 |
| 5 | 1,918 | 1,882 | 1,529 | 104 | 4,979 | 320 | 53,602 |
| 6 | 1,818 | 1,782 | 1,429 | 105 | 4,792 | 437 | 54,280 |
| 7 | 1,715 | 1,692 | 1,339 | 103 | 4,377 | 559 | 55,869 |
| 8 | 1,633 | 1,616 | 1,263 | 103 | 4,315 | 635 | 58,313 |
| 9 | 1,545 | 1,531 | 1,178 | 105 | 4,918 | 730 | 60,974 |
| 10 | 1,474 | 1,465 | 1,112 | 110 | 4,961 | 812 | 64,285 |
| 11 | 1,397 | 1,388 | 1,035 | 109 | 4,649 | 915 | 68,168 |
| 12 | 1,333 | 1,324 | 971 | 107 | 4,507 | 1,008 | 72,523 |
| 13 | 1,271 | 1,263 | 910 | 107 | 4,489 | 1,059 | 76,941 |
| 14 | 1,200 | 1,196 | 843 | 108 | 4,463 | 1,142 | 81,554 |
| 15 | 1,150 | 1,145 | 792 | 110 | 4,713 | 1,245 | 86,433 |
| 16 | 1,097 | 1,093 | 740 | 113 | 4,808 | 1,348 | 91,487 |
| 17 | 1,044 | 1,044 | 691 | 113 | 4,637 | 1,415 | 96,682 |

By year 17:

- Weighted roads fell from 2,738 to 1,044: **61.870%** (about 62%).
- Physical roads fell from 2,375 to **1,044**, not 1,043: **56.042%**.
- Only 691 of the initial 2,022 nonconductive roads remained: **65.826% lost**.
- Crime rose from 29 to 113 while human resident points rose from 3,585 to 4,637,
  AI resident points reached 1,415 and treasury rose from 60,000 to 96,682.

Thus the recorded city grew despite substantial road degradation. That is not
evidence that underfunding has no infrastructure cost, nor proof that lower road
funding caused the growth. The replay retains the model's other recorded actions.

## Fixed-policy comparisons and confounding

Two additional pre-existing offline trajectories used the same baseline, tax 7,
imports on and power priority 0, with **no additional construction**. Each requested
police/fire funding of 100% annually, while road funding was either 30% or 100%.

| Requested road funding | Final human resident points | Final treasury | First year treasury reached zero | Final weighted roads | Final physical roads |
| ---: | ---: | ---: | ---: | ---: | ---: |
| 30% | 1,268 | 0 | 13 | 1,085 | 1,084 |
| 100% | 214 | 0 | 8 | 1,745 | 1,743 |

These are single seeded trajectories, not an ensemble or a controlled estimate of
road quality's population effect. Treasury exhaustion triggers funding cuts in
roads→fire→police priority order, so requested 100/100/100 is not maintained after
funds run out. In the road-100 trajectory, police effect fell to 576 in year 8,
then police/fire effects were zero in year 9 and road effect fell to 21. In the
road-30 trajectory, police effect fell to 7 in year 13; later fire funding also fell.

The higher final population in the road-30 comparison must **not** be interpreted
as evidence that bad roads are beneficial. Different spending, dates of insolvency,
automatic service cuts and subsequent simulation feedback confound that reading.
Neither comparison reproduces all of the model's construction and policy actions.

## Current runner safeguards

The [runner documentation](../../model-runner.md) describes the current retry and
resume behavior. New diagnostics retain sanitized HTTP status/response text and
error kind; they cannot retroactively restore the old failure information. Resume
replays completed years without model requests, reproduces journaled partial tools
and returns `alreadyExecuted` feedback. For this historical interruption there are
no partial-year-18 tools. Compact history removes repeated reasons, while annual
reasons remain in the local protocol once per completed year. New response events
track provider token usage and request bytes; legacy missing tokens stay unknown,
with blank token cells when legacy completed CSV rows are migrated.