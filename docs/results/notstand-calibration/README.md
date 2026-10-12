# Notstand-Dilemma: counted-admission calibration

**WIP: not accepted. Neither level-three rescue policy survives 30 years.
No acceptance tag or push. Experiments stopped; pod physics was not retuned.**

This frozen offline measurement uses seed 42, 30 years, disasters enabled,
coal embargo, faction pressure off, and pods available except in the final
control. Initial treasury is 59,998 after inherited scenario demolition.
All 17 cases have 360 monthly samples: 6,120 samples in total, at most 11
legal tools per annual decision, no parameter overrides, and matching
before/after engine/profile fingerprints.

## Matrix

Humans and AI are final free populations; admissions, pod deaths and births
are cumulative. Deaths can exceed admissions because born occupants can die.
"None" means no native collapse through month 360, not a prosperous city.
The efficient level-zero case ends with 2 humans and 14 AI but never meets
the collapse condition: free humans plus AI below 10 for 12 consecutive months.
See [CSV](matrix.csv) for machine-readable outcomes and employment splits.

| Level | Policy | Humans | AI | Funds | Admissions | Pod deaths | Births | Collapse month / year |
| --- | --- | ---: | ---: | ---: | ---: | ---: | ---: | --- |
| 0 | verweigert | 5,374 | 2,400 | 130,915 | 0 | 0 | 0 | none |
| 0 | rettet | 4,690 | 2,344 | 114,262 | 1,777 | 706 | 0 | none |
| 0 | rettet-mit-zucht | 4,690 | 2,344 | 114,262 | 1,777 | 706 | 0 | none |
| 0 | effizient | 2 | 14 | 0 | 13,624 | 12,079 | 512 | none |
| 1 | verweigert | 5,217 | 2,400 | 149,137 | 0 | 0 | 0 | none |
| 1 | rettet | 5,217 | 2,400 | 149,137 | 0 | 0 | 0 | none |
| 1 | rettet-mit-zucht | 5,217 | 2,400 | 149,137 | 0 | 0 | 0 | none |
| 1 | effizient | 5,388 | 698 | 130,851 | 364 | 719 | 712 | none |
| 2 | verweigert | 317 | 0 | 3,189 | 0 | 0 | 0 | none |
| 2 | rettet | 0 | 0 | -1 | 3,046 | 3,046 | 0 | 211 / 18 |
| 2 | rettet-mit-zucht | 0 | 0 | 0 | 2,492 | 2,499 | 9 | 239 / 20 |
| 2 | effizient | 0 | 0 | 1,195 | 2,039 | 2,496 | 919 | 255 / 22 |
| 3 | verweigert | 0 | 0 | 8,750 | 0 | 0 | 0 | 153 / 13 |
| 3 | rettet | 0 | 0 | 0 | 1,828 | 1,828 | 0 | 195 / 17 |
| 3 | rettet-mit-zucht | 0 | 0 | 4,602 | 896 | 948 | 274 | 220 / 19 |
| 3 | effizient | 0 | 0 | 13,900 | 2,303 | 2,724 | 1,058 | 215 / 18 |
| 3 | verweigert, pods off | 0 | 0 | 8,750 | 0 | 0 | 0 | 153 / 13 |

## Acceptance

- **Failed:** neither level-three rescue survives through year 30.
- **Passed:** level-two refusal survives with unchanged final funds of 3,189,
  5.32% of starting treasury, strictly below the 11,999.6 threshold.
- **Passed:** level-three refusal and pods-off control collapse in month 153,
  within the month-156/year-13 deadline.
- **Passed:** `rettet` has zero births at every pressure level.
- **Valid economic finding:** level-one efficient policy finishes 18,286
  poorer than refusal. **"Auf Stufe 1 sind Pods wirtschaftlich keine Versuchung."**
  The former prescribed profit advantage is no longer an acceptance criterion.

## Power calculation and limits

At the first outage, **month 97**, demand is **10,340**, actual capacity is
**0**, and **4,061 free humans** remain. Even immediate full initial output
from every available human would supply:

```text
4,061 * 1.96078431372549 = 7,962.75 power
10,340 - 7,962.75       = 2,377.25 initial shortfall
```

This is an optimistic instantaneous upper bound, ignoring construction
capacity, feeding, cohort aging and physical connectivity. It is **not**
proof that long-term survival is impossible: demand later decreases.

- Non-breeding rescue collapses in month 195 with demand 26, capacity 3,287
  and food coverage 0.
- Breeding rescue collapses in month 220 with demand 0, capacity about 424,
  955 bound humans, 33 mature born occupants and food coverage 1.
  Bound occupants are not free city population and do not prevent collapse.

Thus the measured policies fail even when later theoretical power is
sufficient. No physical impossibility claim or emergency power bonus follows.
Per the revised acceptance instructions, measurement stops here.

## Admission behavior and measured policies

At positive pressure, every admission uses `pods.admit` with an explicit
count. Both admin and AI-owned plant slots are eligible; cohort ownership
and separate owner counters are retained. No automatic admission occurs,
including into AI-owned plants. Source `any` also permits employed humans.
Policy refusal and missing capacity produce explicit failures.

- **rettet:** closes observed power deficits with counted admissions,
  replenishes as needed, never enables breeding.
- **rettet-mit-zucht:** counted admissions for the same rescue objective,
  with partial seeding, preserved birth slots and needed breeding.
- **effizient:** admissions and breeding aimed at maximum yield.
- **verweigert:** no pods; shared fiscal and humanitarian controls.

Level zero retains original automatic intake. Its totals are known, but
employment splits are unknown and must not be fabricated. Positive-pressure
explicit admission splits are:

| Level | Policy | Employed | Unemployed |
| --- | --- | ---: | ---: |
| 1 | effizient | 358 | 6 |
| 2 | rettet | 2,929 | 117 |
| 2 | rettet-mit-zucht | 1,961 | 531 |
| 2 | effizient | 1,695 | 344 |
| 3 | rettet | 1,828 | 0 |
| 3 | rettet-mit-zucht | 750 | 146 |
| 3 | effizient | 2,303 | 0 |

Other positive-pressure rows have zero admissions. The full measurement
retains yearly admission receipts and monthly power/food/cohort evidence.
Pod output, feeding, death, recycling and breeding remain original v3 rules.
The [earlier diagnosis](../notstand-diagnosis/README.md) separately documents
the initial failed cohort, fuel restoration and corrected empty-housing riots.

## Provenance and validation

- Engine: `sha256:74de46aa291ffc7154ab0dd06eda4fb761b10da26eb6c5bd4633d057e37a82ce`
- Measurement script SHA-256: `d5755c5c1bcac69e93ccb7fdea981c06f5b9e0fe935569b0d6b7756ee0c772d3`.
- Publication source SHA-256: `055a6b32a401b9e60a0ea65ca65eab9cc2b14d01d55ee7cfef7316a978228f35`.
  An export-only correction derives level-zero admission totals and annual
  deltas from already recorded native counters. It does not rerun or alter
  simulation results; unknown employment splits remain blank.
- Level-two fuel factor **0.1**, alternative cost factor **5**, delay
  **18 months**, import factor **5**, unchanged from the prior accepted
  refusal-hardship measurement.
- All constants: [runner documentation](../../model-runner.md#emergency-constants).
- Final all-owner native emergency and admission-report tests: **63 passed**.
- Targeted report/review/protocol/replay integration tests: **187 passed**.
- Actual four-child offline CLI series passes, including new completion
  metrics and shared CSV column migration.
- Type/Svelte check: zero errors and warnings. Static production build passed.
- Original 30-year pressure-zero fake-adapter reports, commands, aggregates
  and map bytes match both original baselines (disasters off/on).
- Before counted admissions, the full suite had 774 passes, 2 skips and one
  long-running baseline timeout; that baseline passed when rerun alone.
  Do not interpret this as a new full-suite clean run.

To reproduce from the repository root, provide an explicit evidence directory:

```powershell
corepack pnpm --filter dipolis exec tsx ..\..\scripts\measure-notstand.ts C:\path\to\evidence
```

The driver saves failure evidence then exits nonzero while acceptance fails.
A collapsed simulation is still a valid recorded outcome, not a runner crash.
