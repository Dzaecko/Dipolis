# New Stromkrise prerequisite: A fails

The fixed new base fails **in year 6, month 7: treasury reaches 0**.
No B–E experiments were started. No parameters, unrest weights, old profiles,
or old measurement files were changed. No paid model calls were made.

## Fixed setup

Haight, seed 42, v3-pods, the existing 12,000-tick warmup and treasury reset to
60,000; two actual baseline coal/nuclear plants demolished, new power-plant
cost multiplier 3. Demolition costs 2, so the measured post-setup treasury is
59,998. Engine:
`sha256:5117c63f3ec6124f7984fc084d496ef7591a2e33456958b8ca5532340c7abf11`.

Ten farms requested in year 1; 30 AI zones requested annually only when the
pre-decision cash flow is negative. Automation limit .9, welfare 1, tax 7,
road/police/fire funding requested at 100%, equal power priority. A has no
bio plants, intake, or throttling. Haight's internal monthly automatic
building remains disabled (`autoBuildRules=0`).

The prior external coal rule remains fixed: request one coal plant/year when
the pre-decision power reserve is below .1. No affordability threshold,
retries, base changes, or tuning were added. Insufficient funds cause the
engine itself to reduce actual service funding; this is recorded, not a
strategy change.

## First empty treasury and negative bookings

| Year | Month | Actual booking | Tax income, all sources | Actual services | Food imports | Welfare |
|---:|---:|---:|---:|---:|---:|---:|
| 1 | 7 | -7,268 | 3,757 | 8,783 | 2,242 | 0 |
| 2 | 7 | -5,720 | 4,968 | 8,823 | 1,865 | 0 |
| 3 | 7 | -4,362 | 6,014 | 8,779 | 1,597 | 0 |
| 4 | 7 | -3,327 | 6,827 | 8,818 | 1,294 | 42 |
| 5 | 7 | -3,176 | 6,824 | 8,798 | 1,202 | 0 |
| 6 | 7 | -6 | 6,420 | 5,536 | 890 | 0 |

Failed/partial builds before this first empty point:

* Year 5: coal request built 0; treasury 4,840.
* Year 6: AI request built 15 of 30; cost 1,658; treasury 6.
* Year 6: coal request built 0; treasury 6.

Unemployment exists: positive unemployment with residential population was
observed in 31 completed monthly samples (including before bankruptcy).

## Incomplete 30-year horizon: engine budget assertion

Only A was continued to collect the requested full horizon. In year 16,
month 7, the unchanged engine aborts at `src/budget.cpp:251`,
`Assertion failed: yumDuckets == total`. Welfare 77 is deducted from treasury
0 before budgeting, leaving -77. This prevents honest completion of 30 annual
and 360 monthly samples. Saved data contains **15 complete annual reports and
186 complete post-census monthly reports**, plus the separate interrupted
budget report. Missing samples are not fabricated.

Every completed budget booking reconciles exactly to tax income minus
actual services, food imports, and welfare, including zero bookings. Actual
services are independently reconstructed from the pre-budget percentages
and the engine's available-funds cap: post-budget percentages can reset to
100% even with zero spending and are not used as an expense ledger.
Treasury also reconciles:

`59,998 - 36,139 build costs - 23,859 completed bookings = 0`

`0 - 77 interrupted welfare deduction = -77 at abort`

The interrupted deduction is not represented as a completed booking. The
overall gate remains false, including incomplete-horizon/finance status.
No engine rebuild or crash workaround was performed; neither is needed to
establish that A already fails in year 6.

## Reproduction and outputs

Run `node apps\micropolis\node_modules\tsx\dist\cli.mjs scripts\measure-v3-stromkrise-baseline.ts`
with the installed Node runtime on PATH.
The script exits with code 1 for this failed prerequisite. The three focused
tests in `cli\model\stromkrise-baseline.test.ts` pass.

Separate files retain the original measurements:

* `v3-pods-stromkrise-welfare1-ai30-baseline.json`: full reports, ledger,
  setup commands, unchanged weights, engine ID, failed builds and gate.
* `v3-pods-stromkrise-welfare1-ai30-baseline-annual.csv`
* `v3-pods-stromkrise-welfare1-ai30-baseline-monthly.csv`
* `v3-pods-stromkrise-welfare1-ai30-baseline-5year.csv`

CSV preserves the previous columns and adds unemployment rate, welfare cost,
fires and actual plant count. Stage was already present and remains included.
The future, unexecuted B/C/E schedule is fixed at one plant request/year in
years 1–3, at most three actual plants, no retry of failed requests; E would
switch to none plus breeding in year 6. **STOP: no new strategy measurements
or calibration checks may proceed through this failed prerequisite.**
