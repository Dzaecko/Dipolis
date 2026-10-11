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
