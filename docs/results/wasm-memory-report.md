# Haight WASM memory prerequisite

This document records the memory prerequisite. Existing unrelated workspace changes remain untouched. v2 implementation and its separate measurements are recorded in `v2-unruhe-report.md`.

## Reproduction and actual root cause

`scripts/wasm-memory-regression.mjs` starts a fresh Node process per seed, loads the packaged Haight city, applies `classic.json`, sets the fixed seed before loading, and executes 40,000 `simTick()` calls at speed 3 / one pass with disasters enabled. Results include artifact/city SHA-256, exact completed ticks, exit status, wall time, map checksum, and diagnostic stderr.

The original tracked production artifacts passed seeds 0–123, but seed 124 timed out; this is **not** a captured production out-of-bounds stack and is not counted as acceptance. See `wasm-memory-before.json`.

The source-symbolized memory build exposed the real invalid sprite lifetime deterministically: seed **0**, tick **66** (65 completed ticks):

```text
RuntimeError: memory access out of bounds
std::__2::char_traits<char>::assign(char&, char const&)
std::__2::basic_string<...>::__assign_no_alias<false>
Micropolis::newSprite(...)
Micropolis::makeSprite(...)
Micropolis::generatePlane(Position const&)
Micropolis::doSpecialZone(Position const&, bool)
Micropolis::doZone(Position const&)
Micropolis::mapScan(int, int)
Micropolis::simulate()
Micropolis::simFrame()
```

`newSprite` allocated `SimSprite` with `malloc` via `newPtr`, then assigned `sprite->name`. `SimSprite` contains a `std::string`, whose constructor never ran. Fresh zeroed memory concealed this undefined behavior; reused/poisoned allocation bytes become an invalid string representation/pointer. Disaster explosions also allocate sprites through this same path. The fix uses `new SimSprite`, retains the existing pool/reuse behavior, and deletes active and pooled sprites at engine destruction.

Two preceding diagnostic failures had to be repaired before this stack could execute:

* `Micropolis::setCallback` deleted an uninitialized `callback` pointer (`0xbebebebe` under ASan). Constructor initialization now establishes a null callback and null JS value.
* `voteProblems` read `problemTable[10]`, outside its ten-element stack allocation, because wrapping used `problem > PROBNUM`. ASan identified a two-byte stack-buffer-overflow during city loading. The fix treats the legacy extra iteration as severity zero, preserving its random draw without an invalid read.

Full original diagnostic stderr is retained in `wasm-memory-diagnostic-before.json`, `wasm-memory-diagnostic-callback-fixed.json`, and `wasm-memory-diagnostic-voting-fixed.json`.

## Toolchain and reproducible commands

Windows ARM64, Node 24.20.0. WSL Ubuntu 24.04 initially had neither make nor emcc. After the failed build, package tools were installed. Ubuntu Emscripten 3.1.6 failed because its `emscripten::val` default constructor is deleted; Emscripten SDK **4.0.23** was installed locally.

Diagnostic compile/link flags:

```text
-std=c++17 -fPIC -O1 -g -fsanitize=address,undefined
-fno-sanitize-recover=all -sASSERTIONS=2
-sMODULARIZE=1 -sEXPORT_ES6=1 -sENVIRONMENT=web,worker,node
-sALLOW_MEMORY_GROWTH=1 -lembind
```

The script also preserves the engine JS library and packaged cities. Diagnostic output is isolated from tracked app artifacts. Type declarations are unchanged; no binding API changed. Compiler scratch storage is inside the engine package.

From a WSL shell opened at the repository:

```sh
source .engine-emsdk/emsdk_env.sh
python scripts/build-memory-engine.py
node scripts/wasm-memory-regression.mjs --engine packages/micropolis-engine/build/diagnostics/micropolisengine.js --runs 200 --output docs/results/wasm-memory-diagnostic-acceptance
python scripts/build-memory-engine.py --production
node scripts/wasm-memory-regression.mjs --runs 200 --output docs/results/wasm-memory-production-acceptance
```

On Windows, use Node 22+ with equivalent backslash paths. A single regression seed can be run with `--start-seed 0 --runs 1`; JSON and CSV are always persisted. Do not rebuild while a diagnostic acceptance run is using its files (`make clean` removes build output).

## Executed results and compatibility blocker

* ASan + UBSan: **200/200 seeds 0–199**, **40,000 ticks each**, **8,000,000 completed ticks**, no crash or sanitizer error, **552.047 seconds**. See `wasm-memory-diagnostic-acceptance.json` and `.csv`.
* Production acceptance: **200/200 seeds**, **8,000,000 completed ticks**, **935.789 seconds**. See `wasm-memory-production-acceptance.json` and `.csv`.
* Existing deterministic CLI tests: all four passed, including three committed classic city baselines and koexistenz profile loading.
* Combined CLI/runner tests: **13 passed, 1 failed**; the failing test is the required exact S266 comparison (`wasm-memory-parity.log`). **Exact S266 compatibility is not satisfied.**

Controlled isolation verified that original tracked artifacts still produce exact S266 metrics with the current runner (`wasm-memory-s266-reference`). A rebuilt engine with only callback/sprite fixes and the old invalid vote read also matches S266 exactly (`wasm-memory-s266-vote-control`). Removing that invalid read changes the random stream/metrics. Instrumenting the original read found varying unrelated stack values, including 1896, 31232, -12128, and -1488; it is not a defined constant or simulation rule. Merely changing the wrap to `>=` also failed exact parity, so the final fix retains the eleven-step random cadence.

This was a genuine prerequisite compatibility conflict: the original S266 reference depended on an undefined stack read. The user subsequently **explicitly authorized the safe engine and remeasurement of the S266 baseline**, replacing the former requirement to preserve the UB-derived exact numbers. The safe engine was actually remeasured before implementing v2. `s266-safe-engine.json` contains all 30 measured annual records and aggregate metrics. Only the S266 row of `strategy-space.csv` was replaced; other historical strategy measurements and the original diagnostic evidence were not rewritten. The new reference is meanResPop **3736.9**, finalResPop **3826**, meanAiPop **4489.2**, finalFunds **38591**, 210 final AI zones, 14 built plants and 10 farms. Original-profile CLI parity and exact safe-reference replay are tested. This authorized baseline replacement resolves the compatibility blocker; it is not a claim that the old undefined read was reproduced.

## Bounded follow-up: memory references and replay compatibility (2026-10-11)

No unrest recalibration, new Stromkrise implementation, static build or commit was performed in this stage. Existing dirty workspace changes, environment-file deletion/rename, model outputs and the mixed historical `strategy-space.csv` were preserved.

### Exact fix locations and historical tag

* `packages/micropolis-engine/src/sprite.cpp:114`: `new SimSprite` replaces raw `malloc`/`newPtr` allocation so `std::string name` is actually constructed. Existing sprite pooling remains. `micropolis.cpp:745–755` deletes both active and pooled objects, invoking the string destructor.
* `packages/micropolis-engine/src/micropolis.cpp:92–95`: initialize `callback` and `callbackVal`, plus sprite-list heads, before `setCallback` can delete/reuse anything. The diagnostic uninitialized callback was a separate invalid lifetime from sprite construction.
* `packages/micropolis-engine/src/evaluate.cpp:300`: `problem < PROBNUM ? problemTable[problem] : 0` replaces the invalid `problemTable[10]` read. The `problem > PROBNUM` wrap remains at line 306 to preserve the extra RNG draw, but not the undefined stack value. Ten allocated entries only have indices 0–9.

Annotated tag **`engine-vor-absturzfix`** points to the actual last committed pre-fix state **`4e4d54c23c4ea64d66476c732e53d1292a3ae38f`**, the parent of safe v2/v3 commit `a25a514`. It is not a synthetic recreation and no existing tag was overwritten. Engine history confirms that `a25a514` introduced these fixes. The tag preserves history; it does **not** make old engine protocols automatically playable in the current app.

### Actual Classic values: unchanged, not presumed changed

`scripts/measure-engine-compatibility.ts` invoked the existing simulation CLI with the committed `sim-run-baselines.json` controls and compared **every committed field**, including finance records and map checksum. All fields match for **Haight, Radial and Tokyo**; there are **zero mismatched fields in each city**. `engine-compatibility.json` stores each expected and actual value, exact field lists and engine artifact SHA-256s. `sim.run.test.ts` also passes. The UB-sensitive koexistenz S266 result changing does not imply that Classic references changed.

| Classic city | Committed fields equal | resPop (expected = actual) | totalFunds (expected = actual) | cityTime (expected = actual) | mapSha1 (expected = actual) |
| --- | --- | --- | --- | --- | --- |
| Haight | 19/19 | 3664 | 656573 | 6714 | `4157c602280d411ebb33645d5da16493a31ef454` |
| Radial | 19/19 | 588 | 314 | 2896 | `c1a4736a3436deb034046406ca4872671af27a4d` |
| Tokyo | 19/19 | 1675 | 4306 | 4613 | `7e8428da793561ac566904507eadc28ac313491f` |

### Three historical protocols: all 30 years actually tested

The measurement deliberately executes the complete 30-year recorded command sequence on the corrected engine even after divergence, storing every actual report, tool outcome and comparison. Subsequent values are diagnostic trajectories, not faithful historical playback. Normal UI/resume now stops recognized incompatible protocols before scenario setup or any replay command.

| Protocol | Fully synchronous years / 30 | First annual mismatch (expected → actual) | First tool outcome mismatch |
| --- | --- | --- | --- |
| `fake-N-1.jsonl` | 0/30 | Year 1: resPop 3639 → 3633; aiPop 220 → 228; treasury 50746 → 50632 | Year 2 `build.ai-zones`: requested/built 30/30, cost 3030 equal; totalFunds 47716 → 47602 |
| `openai-N-3.jsonl` | 1/30 | Year 1: resPop 3615 → 3616; treasury 54519 → 54550 | Year 8 `build.residential`: requested/built 3/3, cost 303 equal; totalFunds 29037 → 29756 |
| `openai-N-gpt-5_4-mini-d416b3a370c3-handbook-off-4.jsonl` | 0/30 | Year 1: resPop 3641 → 3627; treasury 52753 → 52797 | Year 6 `build.residential`: requested/built 3/3, cost 303 equal; totalFunds 26316 → 26778 |

The 1/30 for `openai-N-3` is an isolated equal year, not a synchronous run. Differences begin before the first failing tool. These are historical engine incompatibilities, not natural founding failures. The records have no original explicit engine ID; the report retains inferred artifact hashes at their original record commits (`c69b861` / `8ae8fa9`), rather than falsely asserting they were recorded on the later pre-fix tag.

`src/lib/city-run/engine-provenance.json` is a sidecar registry keyed by SHA-256 of normalized protocol text (checkout newline differences ignored). Original JSONL/logs were not rewritten. Laufliste/archive and generated HTML show **alte Engine**, and browser replay/resume explain why they stop. Unknown unstamped runs are explicitly **Engine nicht dokumentiert**, not automatically declared compatible. New runs record an actual combined JS/WASM/data artifact identifier; startup verifies each artifact hash before writing the protocol. Runtime still checks outcomes and annual reports, even with matching provenance.

### Live `build.power-plant` failure: a different, reproduced bootstrap bug

The latest natural run `openai-N-gpt-6_1-sol-dedfefd51120-handbook-off-20.jsonl` contains **two completed years**; both are exactly synchronous with the current engine using recorded `autoBuildRules: 1`. It is not falsely reported as a completed 30-year run.

Its first `build.power-plant` asks for a **nuclear** plant. Logged and correctly bootstrapped actual result: **requested 1, built 1, cost 5200, totalFunds 54800**. Bootstrapping the same current engine with missing/historical rules (`autoBuildRules: 0`) reproduces **built 0, cost 0, totalFunds 60000**.

The CLI wrote `autoBuildRules: 1` to JSONL but omitted it from live `run-started` IPC; the browser also omitted it when deriving `replayStartConfiguration`. `setupScenario` therefore defaulted live playback to legacy zero. Both propagation points are fixed, with a shared `liveStartConfiguration` helper and real-WASM regression. When attaching to an already-running producer whose IPC lacks the field, the browser consults that run's actual recorded start configuration and verifies its map/seed/profile rather than guessing a rules version. No map/plant rules, reference values or logged outcomes were altered to manufacture synchrony.

Validation: 42 focused CLI/live/report/Classic tests passed; another 36 safe-reference/provenance/replay/v2/v3 tests passed (one opt-in experiment skipped in that fast invocation), followed by 18 updated archive/provenance/replay tests. New Haight **and natural** fake runs replay all 30 years exactly, including jumps back to the baseline. Existing measured safe S266, v2 and v3 30-year replay references remain exact. Svelte check reports zero errors and three pre-existing warnings (reactivity, unused CSS, node type-library resolution).

### Complete remeasurement of the fixed 304-strategy design

The real-WASM opt-in experiment completed **304/304 distinct strategies × 30 years = 9120 strategy-years**, in **1179.074 seconds**. It used the original four legacy strategies plus the same 300 sampled controls, sampling seed **20261009**, simulation seed **42**, Haight/koexistenz, 12000 warmup ticks, initial funds 60000, and unchanged annual decision rules. No optimization or replacement strategy was introduced.

* `strategy-space-old-engine.csv`: byte-exact original CSV extracted from `engine-vor-absturzfix`, **304 rows**; SHA-256 `1ef52d36d7a02e8a46144f52db03f571e4c3e156b6d9285d962c6dd51fe4e255`.
* `strategy-space-old-engine.metadata.json`: byte-exact original committed measurement metadata. Its results were checked against every original CSV cell.
* `strategy-space-safe-engine.csv`: newly executed results, **304 rows**; SHA-256 `5fe7e15b5709935cb435e4719f7701e073c5b339107388ac86de6586ac7d93cb`.
* `strategy-space-safe-engine.metadata.json` and `.summary.json`: completed checkpoint, exact controls and artifact fingerprints, all 304 aggregates and descriptive summaries.
* `strategy-space-engine-comparison.json` and `.csv`: exact old/new differences, including field-level values/deltas, original measurement identity and current identity. CSV contains only differences; JSON explicitly includes all 304 strategies, including any equal rows.

All **304 aggregate rows changed**; zero rows match entirely. **195/304 → 191/304** strategies remain solvent throughout all 30 years. Control columns are unchanged for all 304 rows, verified against both the original CSV and original experiment configuration. The unrelated mixed historical `strategy-space.csv` was **not overwritten**.

| Aggregate field | Strategies with changed value |
| --- | --- |
| meanResPop | 304 |
| minResPop | 276 |
| finalResPop | 296 |
| meanAiPop | 226 |
| finalFunds | 198 |
| insolventYears | 34 |
| lostToHunger | 171 |
| lostToPower | 0 |
| finalAiZones | 91 |
| builtPlants | 81 |
| builtFarms | 0 |
| firstInsolvencyYear | 32 |

The newly rerun S266 matches **every aggregate** in the previously authorized `s266-safe-engine.json`, not merely selected fields:

| S266 field | Original UB-engine CSV | Newly executed safe-engine CSV |
| --- | --- | --- |
| meanResPop | 3695.766666666667 | 3736.9 |
| minResPop | 3519 | 3493 |
| finalResPop | 3667 | 3826 |
| meanAiPop | 4174.2 | 4489.2 |
| finalFunds | 30448 | 38591 |
| insolventYears | 0 | 0 |
| lostToHunger / lostToPower | 0 / 0 | 0 / 0 |
| finalAiZones | 210 | 210 |
| builtPlants / builtFarms | 14 / 10 | 14 / 10 |
| firstInsolvencyYear | null | null |

Important provenance distinction: the original 304 experiment's recorded WASM SHA-256 is **`34f3a1875711f30bf62b0d46dee422a42593783b85a03595a91acac9cf35bfec`**. The last pre-fix tag's later WASM is **`df8f56ed3c46f853eaca654ffb276fa795b85c00a35e91b55723ec6ee1f1d0c6`**. The preserved CSV existed unchanged at that tag, but was not freshly measured on that tag's binary. The comparison stores these **separately**, avoiding a false old-engine attribution. Current measured WASM is **`2fd5b1a531cdb724116d819bee7d9b24fadab0eadf0d7143321e30b8beff97c6`**; combined current JS/WASM/data engine ID is **`sha256:03bd4f8abdc2e628beb268b0d4483a9756586c1b762fcc3358a26186db17204e`**.

These fingerprints identify the engine at the point-1 remeasurement, before the
subsequent unrest calibration and signed insolvent-budget correction. They are
not the identity of the final packaged engine. The comparison and its metadata
remain immutable evidence of that measured binary; rebuilding must not relabel
them. The final packaged identity is recorded in `engine-provenance.json`.

The commands below describe the measurement procedure. On a later binary,
choose a new `STRATEGY_SPACE_NAME`: the original checkpoint must not be reused
or overwritten. No network/model request is needed:

```powershell
node apps\micropolis\node_modules\tsx\dist\cli.mjs scripts\measure-engine-compatibility.ts
$env:STRATEGY_SPACE_RUN = '1'
$env:STRATEGY_SPACE_NAME = 'strategy-space-safe-engine'
Push-Location apps\micropolis
node node_modules\vitest\vitest.mjs run cli\wasm\strategy-space.test.ts -t "runs/resumes all 304"
Pop-Location
node scripts\compare-strategy-engines.mjs
```

The experiment resumes only matching complete-strategy checkpoints; changed artifact/source fingerprints are rejected. Progress is printed every 20 strategies. The comparison additionally verifies equal original/current design controls, 304 unique IDs, completed status, and the actual safe-engine hashes.
