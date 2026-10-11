# v2-unruhe — measured implementation

The user explicitly authorized the safe engine and a new measured S266 reference after removal of the undefined voting stack read. `s266-safe-engine.json` records the actual pre-v2 koexistenz measurement; only S266's row in `strategy-space.csv` was replaced. Classic and koexistenz rule files are unchanged. No v3 rules or model/provider configuration were implemented.

## Profile and mechanism

`apps/micropolis/src/lib/params/profiles.ts` merges every koexistenz parameter into `v2-unruhe.json`. New behavior is gated by `unrestEnabled=1`; the default is off, including after switching back to an original profile. Model runs default to koexistenz; `sim run` still defaults to classic. `--profile classic|koexistenz|v2-unruhe` selects the profile. Protocol `run-started` persists it, resume inherits it and rejects an explicit mismatch, and old protocols without a profile default to koexistenz. Browser replay uses the persisted profile and verifies the added metrics as well as population and funds.

Automation's effective cap is `min(maxAutomation, automationLimit)`, default 0.9; `automation.set-limit {limit}` accepts finite numbers in [0,1], at no immediate cost. It is advertised to models only in v2. Employment continues to use the existing historical commercial/industrial job census and AI job supply. Annual `automationTaxFund = trunc(automatedJobs * automationYieldPerJob * cityTax)`, independently reported and added to human and existing AI tax funds before the original budget/food/welfare booking. `cityTax` is the existing numeric percentage rate (7, not 0.07); calibration uses that same engine convention.

Once a month (4 engine cityTime units, after the map census), let:

* U = unemploymentRate [0,1];
* H = hungry human residential lots / all human residential lots, capped at 1 (uses the existing hungry-zone census, including its existing food/power semantics);
* P = unpowered human residential share × powered AI residential share, zero if either group has no lots;
* W = welfareLevel [0,1];
* L = clamp(policeEffect / 1000,0,1), the actual funded police effectiveness, not the requested percentage.

`target = clamp(90*U + 50*H + 30*P - 35*W - 20*L,0,100)`.
If there are no human residential lots, target is zero.
`unrest = clamp(unrest + 0.2*(target-unrest),0,100)`.
All five weights and inertia are named profile parameters. Thus diminished welfare or police raises the target, rather than directly changing current unrest.

Inclusive stages: 0 below 30; 1 protest from 30; 2 sabotage from 60; 3 uprising from 85. At annual collection, any active protest-or-higher stage reduces human taxes by 20%; AI and automation tax are not reduced. Sabotage attempts one ignition per month with probability 0.12, targeting an AI residential center or coal/nuclear plant. Uprising attempts three with probability 0.6 each, additionally admitting commercial and industrial centers; each AI zone scan has a 0.25 additional outmigration probability. The stage thresholds, tax reduction and probabilities are profile parameters.

Selection, ignition and additional AI outmigration use the engine's fixed-seed RNG. Ignition calls original `fireZone` and sets an original `randomFire` tile. Original spread, fire-station effect map, extinguishing and rubble logic remain responsible for subsequent damage; this is not a synthetic damage/repair model. Unrest ignitions occur even with random disasters disabled. Original profiles take no new random draws.

Report fields include unrest, unrestStage (alias stage), automationLimit, automatedJobs, automationTaxFund, sabotageFires (alias fires), damagedAiZones, damagedPowerPlants and protestMonths/sabotageMonths/uprisingMonths. Fires count initiating sabotage/uprising ignitions, **not burning tiles**. Damage counts zone centers actually handled by original fireZone, including subsequent spread or unrelated fires in v2. Stage-month counters are exclusive. Counters expose the last completed original annual tax period; private pending counters reset on tax collection. They are not rolling-year totals or lifetime totals.

## Fixed calibration, measured once

`v2-unruhe-calibration.json` contains the numeric derivation and measured years. Separate calibration setup: common Haight seed42/12000-tick warmup, treasury600000, 25 requested farms, 8 nuclear plants, 200 requested AI lots (**196 actually built**), welfare1, automation limit0.5, unrest drivers disabled. Fixed 20-year burn-in, then years21–25; no parameter search.

Each measured year had AI population7840, automatedJobs336 and automationShare0.5. Human populations were 3557,3575,3557,3602,3549. Human tax funds were 4155,3998,4223,4096,4096:

`yield = 20568 / (5 * 336 * 7) = 20568 / 11760 = 1.7489795918367347`.

The fixed JSON parameter is **1.74897959**. At that stabilized 50% automation job base, gross automation tax is 4113.6/year, equal to measured mean human tax 4113.6/year before integer truncation (4113 booked). Job base and AI population were stable; humans and taxes still fluctuate. This calibration's extra treasury and infrastructure are **not** household-crisis controls.

## Haushaltskrise — actual 30-year runs, no optimization

The existing household-crisis scenario is present (`cli/wasm/budget-crisis.test.ts`). Retained common defaults: Haight seed42, 12000 warmup ticks, starting treasury60000, tax7, imports enabled, power priority0, original random disasters off; roads and fire100. Each strategy requests10 farms in year1,15 AI zones in a year only if its pre-decision cashFlow is negative, and one coal plant if powerReserve<0.1. Fixed controls:

| Strategy | automationLimit | welfareLevel | police % |
|---|---:|---:|---:|
| A | 0.9 | 0 | 100 |
| B | 0.9 | 1 | 100 |
| C | 0.9 | 0 | 40 |
| D | 0.3 | 1 | 100 |

**All requested 5-year rows:** [`v2-unruhe-household-crisis.csv`](v2-unruhe-household-crisis.csv) (24 measured rows, full numeric precision). [`v2-unruhe-household-crisis.json`](v2-unruhe-household-crisis.json) additionally stores all120 annual reports, actual build outcomes and pre-decision reports. No table cells are estimates.

Year30 overview:

| Strategy | resPop | aiPop | unemploymentRate | automationShare | unrest | stage | fires | automationTaxFund | welfareCost | cashFlow | totalFunds |
|---|---:|---:|---:|---:|---:|---|---:|---:|---:|---:|---:|
| A | 1517 | 3736 | 0 | 0.5564178824 | 0.0491653532 | ruhig | 0 | 3659 | 0 | 4440 | 88133 |
| B | 3870 | 4024 | 0.3900154829 | 0.5217503905 | 0 | ruhig | 0 | 3971 | 1872 | 3390 | 55651 |
| C | 2321 | 3176 | 0 | 0.4650275111 | 0.0817173496 | ruhig | 0 | 3094 | 0 | 5047 | 128926 |
| D | 3870 | 4024 | 0.1071834564 | 0.3000000119 | 0 | ruhig | 0 | 2266 | 481 | 3076 | 50590 |

No protest/sabotage/uprising occurred in these fixed strategies. This is a measured outcome, not proof that the mechanism is unreachable: low-welfare humans already leave under koexistenz migration, reducing unemployment; full welfare/police lower the target. C also spends less on police. Do not optimize weights or silently change controls to manufacture unrest. The deterministic stress tests separately force each threshold and real fires.

Separate S266 v2 measurement (`s266-v2-unruhe.json`): meanResPop3710.6, finalResPop3823, meanAiPop3150.8333333333335, finalFunds125713;120 final AI zones,6 plants,10 farms. This is not compared to the old-profile reference. `v2-runs` contains a real offline CLI protocol and rendered report for `--profile v2-unruhe --handbook on`.

## Reproduction and verification

Use Windows Node24.20.0 on PATH; run from this repository with installed workspace dependencies:

```powershell
Set-Location apps\micropolis
node --import tsx ..\..\scripts\remeasure-s266.ts
node --import tsx ..\..\scripts\measure-v2-unruhe.ts --calibrate
node --import tsx ..\..\scripts\measure-v2-unruhe.ts
node node_modules\vitest\vitest.mjs run cli\wasm\v2-unruhe.test.ts cli\wasm\simulation-commands.test.ts cli\model\runner.test.ts cli\model\tools.test.ts cli\model\city-report.test.ts src\lib\city-run\replay-controller.test.ts
```

Calibration is an explicit opt-in measurement command; ordinary runs never recalibrate the fixed parameter. Build commands and sanitizer flags are in `wasm-memory-report.md`. `v2-engine-build.log` records production compile/link; `v2-diagnostic-build.log` records ASan/UBSan compile/link. `v2-typecheck.log` and `v2-targeted-tests.log` record validation. Additional final validation and commit status are appended below after completion.

Final production memory acceptance: **200/200 seeds0–199 ×40000 ticks =8000000 completed ticks**, no crash, **743.205 seconds**, artifact WASM SHA256 `3c4ab7c1441b167712acad8441939603e9108cf4b4b04600129b9771564d442d`; see `v2-production-acceptance.json/.csv`.

ASan+UBSan v2 forced-uprising stress: **10/10 seeds0–9 ×40000 ticks =400000 ticks**, no crash/sanitizer error, **106.115 seconds**, see `v2-diagnostic-acceptance.json/.csv`. This is an additional v2 stress test, not a claim of repeating the prerequisite's200-seed sanitizer run. Diagnostic flags and all sources are rebuilt; production artifacts remain the checked production build.

Focused legacy/new-profile suites: `v2-targeted-tests.log` **76 passed**; surface suites `v2-surface-tests.log` **64 passed**, including original fire response, inclusive30/60/85 thresholds, independent budget accounting, safe koexistenz/v2 measured S266 references, deterministic replay and resume of automation-limit decisions. Four-strategy measurement rerun reproduced all24 CSV rows exactly. Typecheck: **0 errors**,3 existing warnings (MicropolisView nonreactive local, layout unused CSS, missing Node type-library declaration).

Final post-CSV/profile-switch validation: `v2-final-tests.log` **27 passed** (runner, v2, deterministic classic CLI and handbook), plus focused handbook **4 passed**. Existing three packaged-city classic baselines remain exact. Final `git diff --check` for engine/artifacts/baseline changes passed.

Implementation and measured evidence are committed together. Local provider
configuration, private model runs and unrelated environment-template changes
are excluded.

## Recalibrated unrest formula and remeasurement

Formula version `v2-unruhe-2026.10-human-decline-automation-v1` adds human
population decline and automation share, while welfare halves (rather than
removes) the unemployment contribution:

```text
humanDecline = max(0, baselineResPop - resPop) / max(1, baselineResPop)
unemploymentDrive = unrestUnemploymentWeight * unemploymentRate
                    * (1 - 0.5 * welfareLevel)
target = clamp(
  unrestHumanDeclineWeight * humanDecline
  + unrestAutomationWeight * automationShare
  + unemploymentDrive
  + unrestHungerWeight * hungryHumanShare
  + unrestPowerWeight * humanOutageShare * poweredAiShare
  - unrestWelfareWeight * welfareLevel
  - unrestPoliceWeight * actualPoliceCoverage
  + v3PodTerms,
  0, 100)
unrest = clamp(unrest + unrestInertia * (target - unrest), 0, 100)
```

The fixed v2 weights are respectively `150, 55, 120, 50, 30, 5, 50`,
with inertia `0.2`; all live in `params/v2-unruhe.json` and are validated
through the engine parameter interface. `baselineResPop` is captured once at
the first unrest month for that simulation. Stage thresholds, random event
probabilities and all scenario controls were not tuned.

`v2-unruhe-calibrated-household-crisis.csv/.json` are new, non-destructive
remeasurements of the same four fixed household strategies. The JSON records
engine identity, formula version, all monthly snapshots, annual stage counters,
maximum unrest/stage, yearly and cumulative sabotage fires, target assertions,
and exact mean/max comparisons. Its five-year table adds monthly maximum
unrest, maximum stage, sabotage months and yearly fires to the previous columns.
`s266-v2-unruhe-calibrated.json` is the separately versioned current-engine
reference. The previous household and S266 v2 measurements remain untouched;
the S266 koexistenz reference and safe-engine exact regression remain unchanged.
The historical v2 model-run protocol is also content-fingerprinted as `alte
Engine`; its record is unchanged and it cannot be replayed as this calibration.

| Strategy | Mean monthly unrest | Maximum monthly unrest | Maximum stage | Sabotage fires (30y) | First stage 2 year |
|---|---:|---:|---:|---:|---:|
| A | 59.03288845 | 87.95692444 | 3 | 37 | 10 |
| B | 35.13882506 | 51.17382050 | 1 | 0 | never |
| C | 68.78778517 | 83.26748657 | 2 | 35 | 6 |
| D | 19.84408824 | 26.21875191 | 0 | 0 | never |

The explicit C>A criterion is mean monthly unrest across all360 monthly
snapshots: C exceeds A by9.75489672. The maximum comparison is also reported
but is not used for that criterion.
