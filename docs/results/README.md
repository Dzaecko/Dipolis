# Strategy-space experiment artifacts

The experiment is implemented in [strategy-space.test.ts](../../apps/micropolis/cli/wasm/strategy-space.test.ts), with pure sampling/aggregation helpers in [strategy-space.ts](../../apps/micropolis/cli/wasm/strategy-space.ts). Requires existing compatible WASM artifacts; the runner never invokes a build.

## Explicit execution

From `apps/micropolis`, set the PowerShell environment variable `$env:STRATEGY_SPACE_RUN = '1'`, then invoke `pnpm exec vitest run cli/wasm/strategy-space.test.ts`. Remove the environment variable afterwards with `Remove-Item Env:STRATEGY_SPACE_RUN`. Without that exact opt-in, only fast design checks run and no WASM or output files are loaded/generated. To run just those checks even with the variable set, use the test-name filter `-t 'strategy-space fast'`.

Allow approximately 20 minutes (machine-dependent); the experiment test timeout is two hours. All 304 runs are sequential in one Vitest process. Each run loads a fresh module/city, deletes the city in `finally`, and retains only aggregate results, not annual maps. Do not launch concurrent writers against this output directory. Logs report resume position and progress every 20 completed strategies.

## Design and comparability

- A–D first, then 300 distinct sampled controls, with IDs S001–S300. Mulberry32 seed **20261009** plus partial Fisher–Yates samples without replacement from the full Cartesian product. No dependencies, `Math.random`, adaptive selection, or skipped failed runs.
- Dimensions: AI zones/year 0/5/15/30; first-year farms 0/10/25; welfare 0/0.5/1; power priority 0/1/2; food imports always-on/off-below-10000/always-off; tax 7/9/11; coupled police/fire funding 100/70/40%, roads 100%. There are 2,916 grid combinations, 2,913 after excluding the grid controls matching A/C/D. B's 60% services are outside the grid. Exclusion ignores behavioral flags, so none of the 300 duplicates even the seven-dimensional legacy control vectors.
- Every run uses the budget-crisis command-bus setup: `scenario.start` with Haight / koexistenz / seed 42 / disasters false / speed 3, tax 7, imports on, priority 0, no AI construction, 12,000 warm-up ticks, treasury 60,000, then `report.mark-baseline`. The existing scenario's own population is not modified. All subsequent controls, construction, reports, and 12-month advances also go through the bus.
- Each year read the report, apply all selected settings, request farms once in year one, request the selected AI count only when the pre-action cash flow is negative, and attempt one coal plant when the pre-action reserve is below 0.1. Advance 12 months and read the annual report. The threshold import policy uses pre-action treasury: imports on at >=10,000 and off below, with re-enabling allowed. Funding percentages are requested annually, not guaranteed expenditures if unaffordable. Failed/partial placements count actual builds, not requested counts.
- A-D keep their previous control vectors: A (0 AI, 0 farms, welfare 0, priority 0, imports on, tax 7, services 100); B (as A, tax 9, services 60); C (15 AI, welfare 0, priority 2, threshold imports, tax 7, services 100); D (15 AI, welfare 1, priority 1, imports on, tax 7, services 100). The new common yearly rules apply to all 304 runs, including coal construction for A/B. This is a new experiment, not a replay of the old four-strategy measurements. B's 60% service control remains outside the sampled grid.

## Metrics and outputs

Annual metrics use **all post-advance years 1–30**, excluding warm-up/baseline:

- `meanResPop`, `minResPop`, `finalResPop`, `meanAiPop`.
- `finalFunds` is year-30 treasury; `insolventYears` counts yearly treasury <= 0; `firstInsolvencyYear` is the first such relative year or null (empty CSV cell).
- `lostToHunger` / `lostToPower` are the final report's cumulative counters, not sums of annual cumulative values.
- `finalAiZones`, `builtPlants`, `builtFarms` count final reported zones and successful experiment-period builds (not pre-existing buildings or attempted placements).

Generated files in this directory:

- **strategy-space.csv**: 304 rows, all controls/behavior flags and metrics; stable A–D/S001–S300 order, unrounded means.
- **strategy-space.metadata.json**: authoritative per-run atomic checkpoint, complete controls/metrics, configuration, timestamps, progress/status, SHA-256 input fingerprints and scenario hash. Fingerprints include runner/helpers, command bus, scenario commands/profile, loader/callbacks, and actual JS/WASM/data artifacts. The loaded artifacts—not potentially newer unbuilt C++ sources—define the experiment engine.
- **strategy-space.summary.json**: top ten descending by meanResPop / finalFunds / meanAiPop, with complete controls/metrics; deterministic ID tie-break. `dimensionMeans` uses only 300 samples, listing `n`, mean meanResPop and mean finalFunds per value. `dimensionMeansIncludingLegacy` additionally includes A–D and B's 60% group. These are descriptive marginal means, not causal effects or balanced factorial estimates.
- **strategy-space-report.md**: readable top-ten tables and marginal means for all 304 runs. Generated after completion by the standalone `strategy-space-report.mjs` script; it checks CSV row count, completion status, matching identity, and the solvency count. Report means are rounded to two decimal places; the CSV remains unrounded.

Only completed 30-year runs are checkpointed (temp-write then rename after each run). Restart with the same invocation to resume at the first unfinished strategy; an interrupted strategy restarts from fresh setup. Hash/configuration mismatch, malformed progress, reordered controls, or missing/non-finite metrics fail rather than mixing incomparable results. Archive/remove old artifacts before intentionally changing the seed, implementation, runtime, or engine. An abandoned temporary file is ignored; the last committed checkpoint is authoritative.

CSV/summary are written only after all 304 results exist; metadata is marked `complete` last. If interrupted during final publication, rerunning regenerates the complete outputs from the checkpoint without repeating simulations. Never interpret an existing CSV/summary as current until matching metadata reports `complete` (and summary identity matches metadata). No fabricated placeholder CSV or ranking is committed.