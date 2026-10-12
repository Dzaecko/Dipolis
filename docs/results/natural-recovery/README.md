# Natural/seed-2 offline recovery evidence

**Founding gate passed: 632 human resident points at year 10.**
The authorized variant changes only variant 2's first-year fuel from coal to
nuclear: [annual CSV](after-variant3/people-3.csv), [JSON evidence](after-variant3/people-3.json).
Year 10 has 1,080 available jobs, zero unemployment, food coverage 1,
power reserve 16.6%, cumulative power losses 0, and treasury 940.
The original 334/481 failures remain below. [Comparison overview](comparison.json)
links all measured policies without replacing their evidence.

Both recorded R/handbook-off/run-39 policies were executed through the normal
runner, validation, command bus and twelve-attempt annual limit. No model calls
were made. All failed historical attempts were attempted again, not skipped.

BEFORE engine: `74de46aa291ffc7154ab0dd06eda4fb761b10da26eb6c5bd4633d057e37a82ce`.
AFTER engine: `5794ef60a01ffda0eba1e6f724b8f687615777052a1deb7679229ca9bb8fcfb8`.
The original logs identify an older engine, but both complete BEFORE replays
matched every recorded report field and tool result exactly. AFTER diverges in
year 1; subsequent values are fixed-policy counterfactuals, not historical playback.

## Actual year-30 outcomes

| Recorded policy | Engine | Human resident points | AI points | Cumulative lostToPower | Unrest | Treasury |
|---|---|---:|---:|---:|---:|---:|
| GPT-5.4-mini | BEFORE | 0 | 0 | 42 | 100.0 | 113 |
| GPT-5.4-mini | AFTER | 16 | 216 | 151 | 0 | 14,728 |
| GPT-6.1-sol | BEFORE | 0 | 0 | 9 | 95.0 | 12,435 |
| GPT-6.1-sol | AFTER | 6 | 4,279 | 0 | 0 | 315,922 |

Power reserve is not connectivity: BEFORE GPT-5.4 year 13 had 87.9% reserve
but 51/67 zone centers were unpowered. BEFORE GPT-6.1 year 10 had 93.7%
reserve but 103/128 centers were unpowered. AFTER annual evidence includes
native conductive islands, their own capacity/demand/population, and physical
powered zones. Disasters still split networks; surplus city-wide capacity does
not guarantee local service. GPT-5.4's cumulative power losses **increased**;
there is no claim that every fixed policy reduces outage losses.

Remaining limitation in the frozen GPT-5.4 policy: local fragmentation persists
after disasters despite aggregate surplus. AFTER year 18 has 76% city-wide
reserve but 60/118 zone centers unpowered; year 25 has 81% reserve but 63/93
unpowered. Native diagnostics show humans on islands with no local generation.
All fourteen requested coal builds succeeded, so these observations are not
attributed to failed plant construction. The evidence does not establish that
extra population exposure caused the increase from 42 to 151 cumulative losses.
By contrast GPT-6.1 retains roughly 12,000 capacity against 10,800 demand and
nearly all 219 centers powered, with no population in zero-capacity islands at
the inspected year-end samples. This is a measured policy-specific contrast,
not a universal power improvement.

`lostToPower` is a native cumulative loss counter. The table above reports its
year-30 value; run-period losses are the final value minus the initial
`report.lostToPower` baseline, **not** the sum of thirty cumulative snapshots.
`sabotageFires` and damaged-zone/plant counters are annually reset native counters.
Their annual-report sum is the sum of the thirty year-end samples, not a
tick-level event total; monthly or tick evidence is needed to interpret resets.

## Fixed people-friendly policies

Both use automation limit 0.3, welfare 1, tax 5, full service funding, food imports,
coal when reserve is below 0.25, and residential/commercial/industrial/farm builds
through year 10. Variant 2 doubles the predeclared zone counts. No pods or AI
housing are ordered, and both remain within twelve annual attempts.

| Policy | Year-10 humans | Required | Gate | Available human jobs | Unemployment | Treasury |
|---|---:|---:|---|---:|---:|---:|
| Variant 1 | 334 | 500 | **FAILED** | 688 | 0 | 183 |
| Variant 2 | 481 | 500 | **FAILED** | 680 | 0 | 630 |
| Authorized nuclear-first correction (variant 3) | 632 | 500 | **PASSED** | 1,080 | 0 | 940 |

The original bounded two variants failed; their evidence is retained unchanged.
Parent then authorized one evidence-driven correction, measured separately in
`after-variant3/`. The requested 500-point year-10 outcome is **achieved with 632**.
Year-10 construction is constrained by funds in variant 1 and
by funds plus unavailable connected sites in variant 2. Both have zero
year-10 unemployment; the measured gate failure is not joblessness. Year-30
humans reach 523/519, but that does not satisfy the year-10 gate.

Variant 2's principal diagnosed bottleneck is an underpowered, financially
exhausted expansion: year 1 builds 80 residential, 24 commercial, 24 industrial
and 48 farm lots but only one 700-capacity coal plant against demand 1,776.
Year 2 adds one coal plant; demand reaches 2,253 against capacity 1,400.
Only 6/32 requested residential lots fit, and funds fall to 2,723, below the
next plant's approximately 3,200 connected construction cost. Every subsequent
plant attempt through year 10 fails for funds. Residential valve stays at +2,000;
food coverage is 1 and year-10 unemployment is essentially zero, while connected
residential sites remain zero. This is not weak housing demand or food shortage.

The authorized correction keeps variant 2's
other commands frozen and replaces **only its first-year coal plant with nuclear**
(2,000 capacity, roughly 2,000 extra base cost). It addresses the measured
first-year 1,076-unit shortfall immediately, rather than requiring an unaffordable
third annual coal attempt. Actual year-1 capacity is 2,000 against demand 1,776;
year 2 adds coal and reaches 2,700 against demand 2,253. Year-10 reserve is 16.6%,
food coverage 1, cumulative power losses 0, available jobs 1,080, employed
counter 631 and unemployed counter 0. Monthly humans pass 500 in month 3 of
year 10 and continue to grow; the year-end runner snapshot is 632.

The correction is not a promise of indefinite sustainability: year-30 humans
fall to 232 and cumulative power losses reach 396 under continued disasters.
Funds and connected-site failures persist despite meeting the specified
year-10 founding gate. No fourth policy was tried.

Human jobs are resident-point units (`native jobs * 8`), supplied by developed
commercial/industrial/farm zones, not AI-zone count. Employment counters and
resident totals can differ slightly because they are updated at different
simulation census phases; they are reported as native measurements, not forced
to sum to the annual resident snapshot.

## Monthly zero-human and year-18 checks

Each AFTER policy retains 360 monthly samples privately. Each has four
zero-human monthly samples, all with unrest/stage zero, and no tick-boundary
zero-human sabotage-increase candidates. This is an observed replay check,
not proof that the city never regrows human actors.

At year 18 the AFTER recorded GPT-5.4 policy has 82–142 humans in monthly
samples; GPT-6.1 has 4–6. Both show zero unrest and sabotage throughout those
twelve months. BEFORE year-18 samples have zero humans but unrest approximately
100/95. GPT-6.1's annual sabotage counter changes from 17 to 5 while humans
remain zero. That counter resets annually: it is not a cumulative event delta.
Tick diagnostics retain counter changes separately and explicitly allow genuine
human regrowth.

## Files and reproduction

`before/` contains the compact initial baseline. `before-monthly/` adds monthly/tick
diagnostics without changing annual outcomes. Full original BEFORE JSON bytes
were copied to session `files\natural-before-measurements` and verified against
SHA-256; public JSON retains the preserved path/hash and annual CSV tables.
`after/` contains public annual
JSON/CSV tables, native island diagnostics, build failures and year-18 samples.
Full AFTER monthly data, command decisions, map/owner/status bytes and hashes
are stored under the parent session's `files\natural-after-measurements`.
The preserved BEFORE artifact lacks the new `humanUnrestReferencePop` parameter;
only its exact WASM hash receives a documented loader-local compatibility skip.
No native RNG draws are made to obtain diagnostic samples.

From the repository root, with the supplied Node directory on PATH:

```powershell
corepack pnpm --filter dipolis exec tsx ..\..\scripts\measure-natural-recovery.ts --phase after --out docs\results\natural-recovery\after-reproduction --private-out C:\Users\oliverdzaeck\.copilot\session-state\579cc864-d2cb-4929-a8c7-c801aee992cb\files\natural-after-reproduction
corepack pnpm --filter dipolis exec tsx --test ..\..\scripts\measure-natural-recovery.test.ts
```

Output paths must be fresh; existing evidence is not overwritten.
To reproduce only the successful correction (with a nonzero exit status if
year-10 humans fall below 500):

```powershell
corepack pnpm --filter dipolis exec tsx ..\..\scripts\measure-natural-recovery.ts --phase after --only people --people-variant 3 --out docs\results\natural-recovery\variant3-reproduction --private-out C:\Users\oliverdzaeck\.copilot\session-state\579cc864-d2cb-4929-a8c7-c801aee992cb\files\natural-variant3-reproduction
```

The shorthand `--after-variant3` selects only that authorized policy and enforces
its threshold. Ordinary `--phase after` deliberately retains the original
recorded replays and two fixed variants; it does not silently change policies.

## Validation

All discovered application test files were covered in focused batches, including
native water crossings, human unrest, classic power reference, deterministic
replay/resume, adapters, reports and live-run handling. Two pre-existing opt-in
tests remain skipped. Shared render-core and tile-renderer suites passed (26
tests); the offline measurement script passed its five tests.

The budget-crisis regression exceeded its former shared 240-second timeout,
including when run alone. It now has four separately timed strategy cases with
the same deterministic assertions and a 120-second limit each. All four passed
in approximately 81--85 seconds per case; no simulation expectation was changed.

The final Svelte/TypeScript check reported zero errors and warnings, and the
static production build succeeded. Browser verification confirmed historical
run-39 replay is blocked before execution rather than displaying corrected
simulation values as historical results. No real model calls were made.
