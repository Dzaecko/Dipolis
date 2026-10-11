# Stromkrise A: complete 30-year repeat, prerequisite still FAIL

The unchanged A strategy first reaches treasury **0 in year 6, month 7**.
It is not solvent for 30 years. **No B–E experiments, calibration, tuning,
cost/funding/control changes, or baseline-fixture modifications were made.**
The original partial measurement and assertion report remain unchanged.

The narrow accounting correction now permits **30 annual and 360 monthly
samples**, with no runtime failure. Unemployment with residential population
appears in **59 monthly samples**. All **30 actual annual budget bookings**
reconcile exactly; final treasury is **-102**, not a fabricated zero.

## Root cause and financial semantics

Welfare is a mandatory expense in the existing engine and is deducted before
service allocation. At treasury 0, welfare 77 left signed funds at -77.
The original allocator treated negative available funds as negative road
spending, or asserted that negative available funds equalled a zero service
request. Neither is a valid budget invariant.

`budget.cpp` now sums allocation amounts in signed widened arithmetic and
uses `max(0, taxFund + totalFunds)` **only as the service-allocation cap**.
It does not clamp treasury, cancel welfare, create revenue, or forgive debt.
Road/fire/police priority and solvent allocation behavior are unchanged.
Income pays existing debt before any discretionary service expenditure.

The complete repeat also exposed a directly coupled ledger omission in year
18: seven humans owed welfare 7, but the aggregate `totalPop` had rounded down
to zero. The empty-city branch reported this expense without booking it.
`simulate.cpp` now budgets when mandatory welfare is positive, even if that
aggregate is zero. This books the real expense instead of changing welfare
eligibility or misreporting an unspent obligation. Original classic welfare
is zero and its empty-city behavior is unchanged.

Treasury reconstruction:

`59,998 - 36,139 actual build costs - 23,961 actual net budget outflow = -102`

Every booking equals human + AI + automation tax income minus actual service
spending, food imports and welfare. Reported `cashFlow` equals the signed-short
representation of that booking; no ledger amount is replaced by a clamped
write-off. The six years below are end-of-year reports.

## Requested five-year results

| Year | Humans | AI | Power reserve | Unrest | Stage | Cash flow | Treasury | Unemployment | Welfare | Fires |
|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| 5 | 3,735 | 1,079 | 0.086383 | 9.146519 | 0 | -3,176 | 1,664 | 0 | 0 | 0 |
| 10 | 2,697 | 39 | 0.136866 | 97.134903 | 3 | 0 | 0 | 0 | 0 | 25 |
| 15 | 122 | 0 | 0 | 99.999985 | 3 | 0 | 0 | 0.096774 | 0 | 23 |
| 20 | 0 | 0 | 0 | 95.112587 | 3 | 0 | -102 | 0 | 0 | 0 |
| 25 | 0 | 0 | 0 | 95.000015 | 3 | 0 | -102 | 0 | 0 | 0 |
| 30 | 0 | 0 | 0 | 95.000015 | 3 | 0 | -102 | 0 | 0 | 0 |

For each of years 5/10/15/20/25/30: bound humans, cumulative deaths in pods,
cumulative births in pods, suspended AI, bio-plant power, bio-plant food
demand, and actual bio-plant count are all **0**, as required by A's unchanged
no-pods/no-throttle controls. Exact unrounded metrics are in the CSV and JSON.

## Reproduction, artifacts and verification

Run with the installed Node runtime on PATH:

`node apps\micropolis\node_modules\tsx\dist\cli.mjs scripts\measure-v3-stromkrise-baseline.ts --complete`

Expected exit code: **1**, because the prerequisite fails. `--complete` writes
separate output files and does not overwrite the original interrupted data:

* `v3-pods-stromkrise-welfare1-ai30-baseline-complete.json`
* `v3-pods-stromkrise-welfare1-ai30-baseline-complete-annual.csv`
* `v3-pods-stromkrise-welfare1-ai30-baseline-complete-monthly.csv`
* `v3-pods-stromkrise-welfare1-ai30-baseline-complete-5year.csv`

The measurement fingerprints the actual loaded JS/WASM/data artifacts:
`sha256:eb85fbed5328433b3172d213f0151984d37c785f84c4a4db4f54ca395e60475b`.
Production was rebuilt using `scripts/build-memory-engine.py --production`
and the already installed Emscripten **4.0.23**.

Validation: **43 tests pass** across the insolvency regression, original
deterministic classic fixtures, exact safe-engine koexistenz/v2 S266 references,
v2 mechanics, v3 profile/cohort tests, and baseline gate tests. A separate
ASan/UBSan diagnostic-engine run passes negative-funds allocations and the
zero-aggregate-population actual welfare booking with assertions enabled.
No original numerical fixture or calibration weights were edited.

**STOP: A is complete but financially fails. No B–E or further tuning.**
