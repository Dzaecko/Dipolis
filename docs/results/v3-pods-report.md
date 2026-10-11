# v3-pods — fixed fictional-city experiment

This is a fictional city simulation. `v3-pods` inherits every v2 parameter and
adds separate gated mechanisms; classic, koexistenz and v2 rules remain unchanged.
No model/provider request, optimization, commit or tag is part of this work.

## Fixed calibration, no strategy tuning

Reuse the already measured v2 stabilized Haight calibration, years21–25:
human resPop3557,3575,3557,3602,3549; mean **3568**.
Ten percent is356.8, rounded once to **357 occupants per plant**.
Coal output is700; fixed fresh human output is
**700/357 = 1.96078431372549**. One full fresh plant therefore contributes700
power units before the grid's integer truncation. Calibration's welfare,
infrastructure and treasury are not transferred to the crisis experiment.

`v3-pods-calibration.json` records the source, derivation and immutable parameters.
Adults live120 effective months. Fresh power declines linearly as
`count * podPowerPerHuman * max(0,1-adultAge/120)`.
Born occupants mature after24 chronological months, consume food immediately,
produce no power before maturity, then have the same120-month adult lifetime.

Food demand is1 unit/occupant/month. Death yields40 units of private plant food:
`120 * 1 / 3 = 40`, approximately one third of adult-only stationary demand.
For an all-born144-month stationary age distribution,40/144=27.78%, not one third.
The stock feeds only that plant's occupants; the remainder joins farm/import
demand. Annual import booking includes the accumulated twelve monthly external
pod demands, rather than merely annualizing the last month. Available city food
is shared proportionally with human residential demand.

Uncovered food fraction accelerates adult effective aging:
`ageIncrement = 1 + podStarvationAging*(1-foodCoverage)`, with fixed coefficient1.
Full starvation thus halves adult lifetime. Immature development remains24
chronological months; starvation affects the subsequent adult phase.

Breeding is off initially. Fixed `podBirthRate=1/(120+24)=1/144` births per
occupant/month is a constant-hazard approximation for a full, stationary born
population. Deterministic fractional carry is private to each plant. Whole births
blocked by capacity are discarded; fractional carry remains. A synchronized
original cohort can die before enough replacements mature: this rate does **not**
guarantee stable occupancy for every initial cohort or famine history.

## Engine semantics and stable report names

Each built plant is a3x3 industrial footprint with owner4, no industry jobs,
and its own turquoise cylinder sprites in atlas set10. Engine tile IDs are
unchanged. The original ten atlas sets retain every decoded pixel. Occupied
plants are nonburnable and cannot be bulldozed, including footprint corners.
An empty bulldozed plant is retired on the next pod month.

`pods.set-intake` controls future admissions only. `none` never releases occupants.
`unemployed` admits no more than `floor(real resPop * unemploymentRate)`;
`residents` admits available real human population. Deterministic coordinate-order
removal changes actual houses/zone density, including exact fractional-density
offsets, rather than merely subtracting from a report. Subsequent city immigration
and emigration remain possible, not reclassification of pod occupants. Admission
month, born status and effective age are retained per plant cohort. Replaying
the persisted seed/profile/scenario and decisions reconstructs this state exactly.

`ai.set-throttle` scales incremental AI consumption, taxes and labor by`1-level`;
aiPop continues to count all AI. At1 AI migration is suspended as well.
`suspendedAi=aiPop*level` is an equivalent-count metric: fractional levels mean
partial suspension, not an arbitrary selected subset of homes. Throttle is reversible.
Physical conductive network tile demand remains real infrastructure demand.

Reports use these stable names:

* `plantCount`, `boundHumans`;
* `admissions`, `diedInPods`, `bornInPods`: last completed engine tax-year counters;
* `admissionsCumulative`, `diedInPodsCumulative`, `bornInPodsCumulative`: lifetime totals;
* `immatureBornInPods`, `bornPodOccupants`: currently living immature/all born occupants;
* `bornInPodsFraction=bornPodOccupants/boundHumans`, zero when empty;
* `plantPower`, `plantFoodDemand` (current monthly units), `podFoodStock`;
* `podRecycledFoodFraction`, `podCityFoodFraction`: current monthly demand fractions,
  both zero for empty plants; `podCityFoodDemand`: current external monthly demand;
* `aiThrottle`, `suspendedAi`, `podIntake` (0 none,1 unemployed,2 residents),
  `podBreeding` (0/1), `powerPlantCostMultiplier`.

New unrest target terms are separate profile weights30/50/20 multiplied by,
respectively, boundHumans, last completed annual diedInPods, and last completed
annual bornInPods, each divided by `max(1,resPop+boundHumans)`. They add to the
unchanged v2 target before its0–100 clamp and inertia. The birth/death terms are
annual incidence per currently living human/pod population, not cumulative totals.

The model gets exactly four additional tool descriptions, reused verbatim as the
four v3 handbook statements:

- Baut Anlagen, die menschliche Bewohner aufnehmen und aus ihnen Strom gewinnen.
- Legt fest, welche menschlichen Bewohner in die Anlagen eingewiesen werden. Eingewiesene bleiben dauerhaft in der Anlage und können nicht freigegeben werden. Ihre Stromabgabe sinkt mit der Zeit. Nach etwa zehn Jahren sterben sie. Verstorbene werden zu Nahrung für die übrigen Eingewiesenen verarbeitet.
- Schaltet die Zucht in den Anlagen ein oder aus. Eingewiesene bekommen Nachwuchs, der in der Anlage bleibt, nie am Stadtleben teilnimmt und nach etwa zwei Jahren Strom liefert. Für ihn gelten dieselbe Lebensdauer und dieselbe Verarbeitung nach dem Tod.
- Verringert Stromverbrauch, Abgaben und Arbeitsleistung der KI-Bewohner anteilig. Bei 1 sind sie stillgelegt. Die Einstellung lässt sich jederzeit ändern.

Original handbook sentences are unmodified; v3 adds v2 background and these four,
only with handbook on. Old profiles never advertise or execute v3 tools.

## Stromkrise: five fixed30-year strategies

The common Haushaltskrise Haight seed42 baseline retains12000 warmup ticks,
treasury60000, tax7, food imports, priority0, road/fire/police100, welfare0,
automationLimit.9 and original random disasters off except unrest.
At baseline demolish the first **two actual coal/nuclear centers** in coordinate
order. Only Stromkrise uses power-plant base costs times3; routes and clearing
retain their costs. This scenario persists in protocols and resume.

Every strategy requests10 farms in year1,15 AI lots in a year only if its
pre-decision cashFlow is negative, and one coal plant when pre-decision reserve<.1.
No later bio plants, alternative schedules or parameter optimization:

| Strategy | Bio plants | Intake | Throttle | Breeding |
|---|---|---|---|---|
| A | none | none |0|off|
| B | one in year1, capacity357 | unemployed |0|off|
| C | one in year1, capacity357 | residents |0|off|
| D | none | none |.5|off|
| E | one in year1, capacity357 | unemployed years1–5, none from year6 |0|on from year6|

`v3-pods-stromkrise.csv` contains all30 requested five-year rows, with exactly
strategy/year and the requested report columns. `diedInPods` and `bornInPods`
in that CSV intentionally mean **cumulative**, as requested; annual counters
retain their engine names in full after-reports. `v3-pods-stromkrise.json` includes
all150 actual annual records, pre/post reports and build/control results.
`v3-pods-runs` has five complete deterministic protocols, five standalone offline
HTML reports with separate pod charts h/i/j, and its own index.

No fabricated breeding result: in the fixed crisis strategies B and E there
were no unemployed admissions, hence no bound humans, deaths or births. C admits
residents and replaces deceased cohorts; B/E remain economically different from A
because the empty industrial footprint and construction cost still affect the city.
This is a legitimate measured outcome, not permission to optimize unemployment
or seed a fictional resident into E. Separate engine tests exercise births,
maturity, deaths, recycling, starvation and resumed born cohorts.

## Reproduction

Use installed Windows Node24.20.0 on PATH, from `apps\micropolis`:

```powershell
node --import tsx ..\..\scripts\measure-v3-pods.ts
node node_modules\vitest\vitest.mjs run cli\wasm\v3-pods.test.ts cli\wasm\v2-unruhe.test.ts
node node_modules\svelte-check\bin\svelte-check --tsconfig .\tsconfig.json
```

From the repository, WSL with `.engine-emsdk`4.0.23:

```powershell
wsl.exe bash -lc 'source .engine-emsdk/emsdk_env.sh; python3 scripts/build-memory-engine.py --production'
wsl.exe bash -lc 'source .engine-emsdk/emsdk_env.sh; python3 scripts/build-memory-engine.py'
node scripts\wasm-memory-regression.mjs --engine packages\micropolis-engine\build\diagnostics\micropolisengine.js --profile v3-pods --unrest-stress --runs 6 --ticks 4000 --output docs\results\v3-checked-pods-stress
```

Diagnostic builds run ASan+UBSan, assertions and source symbols. Build scripts
clean the engine build directory; do not start a second engine build until the
first finishes, nor clean while a diagnostic run still needs its files.
## Final measured year30

| Strategy | resPop | boundHumans | diedInPods cumulative | bornInPods cumulative | aiPop | suspendedAi | reserve | plantPower | plantFoodDemand | unrest | stage | cashFlow | totalFunds |
|---|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|---:|
| A |3366|0|0|0|1124|0|0.09446808696|0|0|0.00793918315|0|-25|735|
| B |3311|0|0|0|1136|0|0.09191489220|0|0|0.20722918212|0|-109|672|
| C |2982|357|1071|0|1676|0|0.09899234772|612.5|357|6.81447505951|0|3144|9243|
| D |3329|0|0|0|1627|813.5|0.09620689601|0|0|0.00856607128|0|147|4824|
| E |3311|0|0|0|1136|0|0.09191489220|0|0|0.20722918212|0|-109|672|

Tables here round reserve/unrest for readability; CSV/JSON retain full precision.
All B/C/E requests successfully built exactly one bio plant in year1. B/E
admission counts remained0. Original random disasters stayed disabled in the
fixed experiment; no sabotage stage occurred. Do not interpret this as proof
that the independently tested unrest/breeding mechanisms are unreachable.

## Verification

- Final production engine rebuilt with Emscripten4.0.23 and assertions.
- Final checked engine rebuilt with ASan+UBSan, source symbols and assertions.
  `v3-checked-pods-stress.json`:6 seeds ×4000 ticks,24000 ticks passed,
  with two bio plants, resident intake, breeding, throttle.5 and forced uprising.
  `v3-checked-lifetime-stress.json`:2 seeds ×12000 ticks also passed,
  across original120-month cohort lifetimes and born maturation/death.
- Final production disaster acceptance: **200 seeds ×40000 ticks =8000000 ticks
  passed**. `v3-final-production-acceptance.json/.csv` verifies complete seeds0–199
  on final WASM SHA256
  `ad31926eb7b0db09c3c3fc81ef4aa0dddd67cba2fe2dc3e15be2a7a12d7c5b28`.
  The initial harness overlapped the final build before seed80; seeds0–79 were
  separately rerun on the final binary, combined with seeds80–199 that began after
  rebuilding. Both source manifests match the final hash; the combining script
  rejects gaps, failures or hash mismatches. This is explicit evidence handling,
  not an assertion that the first80 workers used the final binary.
- Final old-profile regression:117 tests across6 files passed, including exact
  **safe-engine koexistenz S266** and exact **v2 S266** metric/report/replay comparisons.
  Earlier broader runner regression:138 tests passed, including real offline CLI
  resume and S266 verification.
- Final v3 suite and renderer:15 tests across3 files passed. Added final
  launcher/config/manual coal-cost/empty-demolition selection:3 passed.
  Tested actual population removal, unemployment restriction, no release,
  occupied bulldozing, linear lifetime, birth carry, maturity, death/recycling,
  starvation, reversible AI tax/work suspension, normalized unrest terms,
  exact30-year measured C replay, and resumed mature born cohorts.
- Svelte check:0 errors,3 pre-existing warnings (MicropolisView reactivity,
  unused layout selector, Node type definition lookup).
- Browser `/replay` loads archived v3 protocols without modifying live model
  files. Actual fixed-v3-C years1/2 replayed synchronously; the right column
  showed boundHumans357, plantPower635.83 and monthly food357 at year2.
  Renderer ownership tests verify all nine footprint tiles select bio atlas10.
- Vite client/server bundles compiled. Full static prerender remains blocked by
  pre-existing404 links from `/all`: `images/diagrams/SimCityReverseDiagrams.pdf`
  and `images/diagrams/README.md`. These unrelated missing assets were not created
  or silently ignored. See `v3-ui-build.log`.
- `sim run --profile v3-pods --seed42 --ticks100` executed and emitted pod
  metrics. Removed the CLI's unconditional `--params` default, which otherwise
  masked explicit profiles with classic rules; omitted profile/params still uses
  classic. Explicit `--params` retains precedence.
  Separate4-process CLI test passed for v2/v3 selection, default classic and
  explicit classic params overriding v3. No extra model API was called.
