# Dipolis

**A Micropolis-based city-management project exploring coexistence between human and AI residents, public services, food supply, and language-model decision-making.**

Dipolis is a modified fork of [MicropolisCore](https://github.com/SimHacker/MicropolisCore), not the original game and not an Electronic Arts product. It combines a C++ engine compiled to WebAssembly, a SvelteKit browser interface, deterministic headless city runs, and an optional tool-calling language-model mayor.

Repository: [Dzaecko/Dipolis](https://github.com/Dzaecko/Dipolis).

> **Credentials and model costs:** No model account is needed for the browser or deterministic runs. The default model-runner adapter is a local S266 replay with no API calls. Real runs require an explicit adapter choice and can incur provider charges. Never commit credentials or publish private model conversations without reviewing them.

## Contents

- [What is implemented](#what-is-implemented)
- [Quick start](#quick-start)
- [Engine builds](#engine-builds)
- [Headless city commands](#headless-city-commands)
- [Human and AI coexistence](#human-and-ai-coexistence)
- [Language-model city management](#language-model-city-management)
- [Reproducible strategy comparisons](#reproducible-strategy-comparisons)
- [Testing and development](#testing-and-development)
- [Project structure](#project-structure)
- [Limitations and troubleshooting](#limitations-and-troubleshooting)
- [Licensing and attribution](#licensing-and-attribution)
- [Preserved upstream documentation](#preserved-upstream-documentation)

## What is implemented

| Area | Capabilities |
| --- | --- |
| Browser application | SvelteKit city interface backed by the WebAssembly engine and shared tile renderer |
| Coexistence | Human/AI-owned residential zones, AI electricity demand and revenue, automation, unemployment and welfare |
| Food | Industrial farm zones, food production/coverage, paid imports, and separate hunger diagnostics |
| Electricity | Capacity/reserve reporting, distinct classic/coexistence accounting, and configurable shortage priority |
| Construction | Engine-selected sites, paid clearing and road/wire access, affordable partial batches, and atomic individual builds |
| Reports | Baseline population change, human/AI populations, last annual financial booking, funding levels, service effects, crime and roads |
| Automation interface | A shared Command Bus for scripts and controlled model tool execution |
| Model runner | Provider-neutral chat adapter, nine allowed actions, annual history, optional handbook, request diagnostics, retries and deterministic replay/resume |
| Evidence | A stored 304-strategy comparison, full CSV metrics, input fingerprints, rankings, and a cost-free S266 acceptance run |

This repository also preserves the broader upstream monorepo, historical documentation, and related rendering/animation packages. Those directories are not all required for the Dipolis city workflows described here.

## Quick start

### Requirements

- **Node.js 20 or newer**; use an active LTS release.
- **pnpm 10**, using the exact package-manager version pinned by the root manifest through Corepack.
- A modern browser for the graphical application.
- **Python 3, GNU Make and Emscripten** only if rebuilding the C++/WASM engine.

From a terminal:

```sh
git clone https://github.com/Dzaecko/Dipolis.git
cd Dipolis
corepack enable
corepack pnpm install
corepack pnpm --filter micropolis run dev:vite
```

Open the URL printed by Vite, normally `http://localhost:5173`. `dev:vite` uses the checked-in WASM artifacts and does not invoke an engine rebuild. If a port is already occupied, follow the actual URL printed by the server.

The regular `dev` command additionally watches and rebuilds C++ sources, so it needs the native build toolchain:

```sh
corepack pnpm --filter micropolis run dev
```

For frontend-only compilation using the existing engine artifacts:

```sh
corepack pnpm --filter micropolis exec svelte-kit sync
corepack pnpm --filter micropolis exec vite build
```

The package's regular `build` script has an engine-build prerequisite; do not confuse it with a frontend-only build.

## Engine builds

Activate your Emscripten SDK environment so that `em++`, Python and Make are available, then run:

```sh
corepack pnpm run build:engine
```

The engine Makefile compiles C++17 sources, emits Embind declarations and installs the generated JavaScript, WASM and bundled city data into the application. Its paths are relative to the workspace; run it through the package script rather than moving generated files manually.

On Windows, run in a terminal with an activated Emscripten environment and GNU Make available. Emscripten's Node configuration must point to a working Node executable. Machine-specific Conda/SDK paths are intentionally not prerequisites of this public README. See [DEVELOPMENT.md](DEVELOPMENT.md) for additional upstream build guidance.

## Headless city commands

The CLI is a Node/TypeScript entry point using `tsx`. All examples below run from the repository root:

```sh
corepack pnpm --filter micropolis run micropolis --help
corepack pnpm --filter micropolis run micropolis sim smoke --ticks 10
corepack pnpm --filter micropolis run micropolis sim run --seed 42 --ticks 30000 --speed 3 --no-disasters
```

City-file inspection is also available:

```sh
corepack pnpm --filter micropolis run micropolis city info ../../content/micropolis/cities/haight.cty
```

City file arguments are resolved relative to the application package's working directory. The engine's virtual filesystem uses paths such as `/cities/haight.cty`; those are not host filesystem paths.

Run the relevant subcommand with `--help` for supported parameters and output formats. Profile files are in [apps/micropolis/src/lib/params](apps/micropolis/src/lib/params).

## Human and AI coexistence

Two profiles separate the historical engine behavior from the extended rules:

- **classic:** compatibility-focused rules, checked against stored population/map checksums and the original power traversal.
- **koexistenz:** food/import, additional AI power demand, automation and welfare rules.

Human residents require food and electricity. Farms are industrial zones: production depends on powered developed farm population, not merely the number of zoned lots. Imports can cover deficits when funds are available.

AI residents live in separately owned residential zones, consume electricity rather than food, and contribute revenue tied to the tax setting. Their growth is related to reserve thresholds and still depends on connectivity and stochastic decisions. Automation changes the labor balance; welfare changes employment-driven migration and incurs annual expenditure.

Electricity priority `0` is proportional allocation, `1` favors network demand, and `2` favors additional AI demand. The human/AI shorthand in the interface is not a guarantee that every zone of one group receives electricity.

Funding percentages are **independent fractions of each service's own need**, not shares of a common 100% budget. `100/100/100` fully requests roads, police and fire funding. Actual spending may be reduced if resources are insufficient.

The engine supports population baselines and reports cumulative hunger/power losses separately. `netResPopChange` compares human population with the marked baseline. Annual financial report fields describe the last tax booking, not a new projected budget.

## Language-model city management

### Scenario and annual loop

The headless runner starts Haight with the coexistence profile, seed **42**, disasters disabled, speed **3**, tax **7**, imports on, and proportional electricity priority. It advances **12,000 ticks**, sets treasury to **60,000**, and marks a population baseline.

For each of **30 years**, it reads the report, asks the adapter for decisions, executes validated tool calls through the Command Bus, returns their results, and advances **12 months**. There are at most **12 attempted tool calls per year**, including rejected calls. The model receives one compact history entry per prior year, containing metrics and executed commands, without accumulated reasoning prose.

The runner itself manages scenario initialization and time advancement. Models cannot change seed, grant treasury, load a different city, or advance time through their exposed tools.

### Exactly nine model tools

| Tool | Parameters exposed to the model | Behavior |
| --- | --- | --- |
| `build.ai-zones` | `count` | Automatically place AI-owned residential lots |
| `build.residential` | `count` | Automatically place human residential lots |
| `build.farms` | `count` | Automatically place farm zones |
| `build.power-plant` | `type: coal \| nuclear` | Place one power plant with paid access/clearing |
| `tax.set` | `rate` | Set the city tax rate |
| `budget.set-funding` | `roadFundingPercent`, `policeFundingPercent`, `fireFundingPercent` | Set independent service financing levels from 0 to 100 |
| `welfare.set-level` | `level` | Set welfare level from 0 to 1 |
| `power.set-priority` | `priority` | Set allocation mode 0, 1 or 2 |
| `food.set-import` | `enabled` | Enable/disable paid food imports |

Tool descriptions are factual and include costs rather than strategy recommendations. A new zone's base construction cost is **100**, coal **3000**, and nuclear **5000**; clearing and access add costs. Each individual construction is atomically funded, and a batch can build fewer than requested.

### Cost-free S266 verification

```sh
corepack pnpm --filter micropolis run city-model --adapter fake --assignment N --handbook off --run 1
```

The fake adapter requests S266's decisions through the same tool loop. It performs **no model requests** and verifies every aggregate exactly against the stored strategy-space CSV. Existing output files are never silently overwritten: select another run number for a new run.

### Real provider configuration

The included real adapter uses an **OpenAI-compatible chat-completions API**. Other providers can implement the small [ChatAdapter interface](apps/micropolis/cli/model/adapter.ts).

Copy [.env.city-model.example](.env.city-model.example) to a local `.env.city-model` file and fill in:

| Variable | Purpose |
| --- | --- |
| `CITY_MODEL_ENDPOINT` | Full chat-completions URL |
| `CITY_MODEL_NAME` | Model/deployment name |
| `CITY_MODEL_KEY` | Authentication key |
| `CITY_MODEL_TIMEOUT_MS` | Optional timeout per request; default 60000 |
| `CITY_MODEL_MAX_RETRIES` | Optional number of retries, 0–5; default 5 |
| `CITY_MODEL_MAX_TOKENS` | Optional completion-token limit |

The local file is ignored by Git. **The VS Code task script loads it; direct Node CLI execution reads process environment variables, not the file automatically.** No real endpoint, key or deployment is supplied in the tracked template.

For Azure OpenAI, the full v1 URL ends in `/openai/v1/chat/completions`. The task script also accepts a base URL ending in `/openai/v1` and appends the missing path.

With the environment configured, an explicit real run is:

```sh
corepack pnpm --filter micropolis run city-model --adapter openai --assignment N --handbook on --run 1 --live
```

This command may incur provider charges. Merely setting environment variables does not enable network access when the fake adapter is selected.

### Assignments, handbook and VS Code tasks

- **N:** the neutral Haight city-administration instruction.
- **R:** the same instruction plus the operator-company objective of maximizing treasury after 30 years.
- **`--handbook off`:** default, no background paragraph.
- **`--handbook on`:** inserts the fixed background text before the R objective, if any. The supplied wording is preserved, including its documented simplifications.

VS Code's **Tasks: Run Task** offers N/R start and resume tasks. Each asks for a run number and handbook on/off, then reads local provider settings. Terminal output can show executed tools and annual reasoning/metrics; the headless run is **not an animated browser session**.

### Logs, tokens, failures and resume

Default output is [docs/results/model-runs](docs/results/model-runs/README.md): one JSONL protocol per run and one CSV metrics row per completed run. Filenames include model name/hash, assignment, handbook mode and run number. Model names that sanitize identically still have different hashes.

Logs include immediately persisted tool outcomes, one reasoning field per completed year, annual reports, input/output token counts, request sizes and sanitized adapter errors. CSV token totals indicate whether historical/provider usage is complete.

HTTP **429**, **5xx** and timeouts are retried with increasing delay up to five times. Non-retryable errors remain visible. Response text is capped and credentials are redacted; do not place secrets in model messages.

```sh
corepack pnpm --filter micropolis run city-model --adapter openai --assignment N --handbook on --run 1 --resume --live
```

Resume reconstructs the city, replays logged commands and checks outcomes before asking for new decisions. Keep the same model, assignment, run number and handbook mode. Do not change engine rules between a run and its replay. Old filename layouts are supported for handbook-off runs. See [docs/model-runner.md](docs/model-runner.md) for protocol details.

## Reproducible strategy comparisons

The stored budget-crisis comparison contains **300 distinct sampled combinations plus A–D**, each running for 30 years. Sampling uses **Mulberry32 seed 20261009**; every city uses seed **42**.

The dimensions cover AI zoning rate, first-year farms, welfare, electricity priority, import policy, tax and police/fire financing. All strategies condition AI construction on a negative annual balance and attempt coal construction below 10% reserve. B retains its historical 60% service value outside the sampled grid.

Published evidence:

- [All 304 runs as CSV](docs/results/strategy-space.csv)
- [Rankings and marginal means](docs/results/strategy-space-report.md)
- [Metadata and input fingerprints](docs/results/strategy-space.metadata.json)
- [Machine-readable summary](docs/results/strategy-space.summary.json)
- [Reproduction instructions](docs/results/README.md)

In this fixed sample, **195/304 strategies** had no empty year-end treasury. **S266** had `meanResPop = 3695.766666666667`, `finalResPop = 3667`, `meanAiPop = 4174.2`, `finalFunds = 30448`, and zero insolvent years. These are measured scenario results, not universal optima or guarantees for a language model.

The full experiment is opt-in, can take tens of minutes, and checkpoints completed runs. Ordinary tests do not launch it or make paid model calls. Never modify the input files while a fingerprinted experiment is running.

## Testing and development

```sh
# Model contracts, mocked HTTP retries, handbook and real-WASM S266/replay acceptance
corepack pnpm --filter micropolis exec vitest run cli/model

# Original-power differential and the three stored classic city baselines
corepack pnpm --filter micropolis exec vitest run cli/wasm/classic-power-compatibility.test.ts cli/wasm/sim.run.test.ts

# Application test suite (full strategy sweep remains opt-in)
corepack pnpm --filter micropolis run test

# Svelte/TypeScript diagnostics
corepack pnpm run check
```

Tests are checked into the repository and should be treated as the authority rather than a fixed test count in documentation. Fake-S266 acceptance uses the executable Node CLI, not fabricated outcome values. No real-model adapter is invoked by the normal test suite.

## Project structure

```text
apps/micropolis/
  src/lib/                  browser bridge, Command Bus, profiles and WASM artifacts
  cli/model/                adapters, prompts, tools, runner, replay and tests
  cli/wasm/                 headless engine tests and strategy-space experiment
  cli/city/                 city-file analysis/editing
packages/micropolis-engine/ C++ core, Makefile and Embind bindings
packages/tile-renderer/     shared rendering backends
content/micropolis/         bundled city saves and other assets
docs/                      Dipolis runner and measured-result documentation
documentation/             preserved upstream manuals, designs and history
scripts/                   local task launcher and repository utilities
.vscode/tasks.json          interactive model-run tasks
```

## Limitations and troubleshooting

- **404 from a provider:** verify the full endpoint path and model/deployment. A base service URL is not necessarily a chat-completions endpoint.
- **Run already exists:** use another run number, or `--resume` for the interrupted run. Do not delete valuable logs just to suppress this error.
- **Replay mismatch:** engine inputs or recorded outcomes differ; preserve the original log and investigate rather than continuing from a different state.
- **Missing usage:** some providers and old logs lack token counts. `tokenUsageComplete=false` means totals are partial, not zero-cost proof.
- **Power capacity after construction:** new plants are counted during subsequent census/power scans, not necessarily immediately after the tool returns.
- **Road funding:** low funding permits stochastic decay of eligible nonconductive roads; it does not remove a fixed fraction of roads or residents instantly. See the [17-year funding audit](docs/results/model-runs/road-funding-audit.md).
- **Empty treasury:** construction can stop, imports can be limited, and service spending can be cut. The city continues running rather than producing a guaranteed bankruptcy termination.
- **Determinism:** fixed seeds and unchanged inputs allow engine replay. Real model decisions are not guaranteed deterministic.
- **Results:** marginal strategy means are descriptive, not causal effects; requested construction can differ from actual affordable construction.
- **Writers:** do not run concurrent writers against the same protocol/CSV output directory.
- **Security:** local credentials are plaintext on disk in the ignored env file. Restrict local access, rotate leaked keys, and inspect staged files before pushing.

## Licensing and attribution

Dipolis is explicitly a **modified MicropolisCore fork**. Original authorship and historical credit remain with Will Wright, Don Hopkins, Electronic Arts and the upstream contributors, as documented below. A renamed fork does not remove their licensing conditions.

Read [LICENSE](LICENSE), [MicropolisGPLLicenseNotice.md](MicropolisGPLLicenseNotice.md), and [MicropolisPublicNameLicense.md](MicropolisPublicNameLicense.md). The Micropolis code is distributed under GPL version 3 or later with the documented Electronic Arts additional terms, including attribution and trademark restrictions. No Electronic Arts trademark rights or affiliation are claimed.

The broader inherited monorepo includes components with their own notices, including [Screen Angel's license](apps/screen-angel/LICENSE.md). Check individual directories and asset notices rather than assuming one blanket license covers every inherited component. Original notices and the upstream documentation below are intentionally retained.

## Preserved upstream documentation

The following material describes MicropolisCore's upstream history and broader project vision. Upstream demos and future-oriented integrations are **not representations of a deployed Dipolis service or completed Dipolis features**.

---

# Micropolis (upstream)

**Open source city simulation, based on the original SimCity Classic by Will Wright.**

C++ engine compiled to WebAssembly. Runs in any browser. Runs headless in Node.js. SvelteKit frontend with WebGL tile rendering. CLI tools for city file analysis and editing.

**Live demo:** [micropolisweb.com](https://micropolisweb.com)

**Video demos:**
- [Micropolis Web Demo 1](https://www.youtube.com/watch?v=wlHGfNlE8Os) (how the engine and UI work)
- [SimCity Tile Sets, Space Inventory, and Cellular Automata](https://www.youtube.com/watch?v=319i7slXcbI) (tile sets, CA rules, to music by Jerry Martin)

## The Story

Micropolis traces a line from Will Wright's SimCity (1989) through multiple platform ports, multiplayer experiments, and educational adaptations. Don Hopkins ported SimCity to Unix, built multiplayer SimCityNet (demoed at ACM InterCHI '93 in Amsterdam), and eventually convinced Electronic Arts to release the source code under GPL-3 for the One Laptop Per Child project in 2008.

The name "Micropolis" was the original working title Will Wright suggested. EA granted the right to use the trademark "SimCity" only if the game passed their QA process -- and it was quite an ordeal hand-holding their QA department through running Linux in a VM on Windows to test it. Never wanting to go through that ever again, Don asked Will for an alternative name, and he recommended its original working title. Please call this game Micropolis, not SimCity, or EA's lawyers may come knocking. As Jeff Braun, CEO of Maxis, wrote:

> "Maxis was sued by Toho. We never referred to the name Godzilla, our monster on the box cover was a T-Rex looking character, but... a few magazine reviews called the monster, Godzilla. That was all it took. Toho called it 'confusion in the marketplace'. We paid $50k for Godzilla to go away. In all honesty, Toho liked Maxis, they said $50k was the minimum they take for Godzilla infringement. I doubt you will need to worry about Toho, as long as there are no magazine reviews that call the monster Godzilla."

Full email thread: [documentation/designs/jeff-braun-toho-godzilla-email-2024-02-17.md](documentation/designs/jeff-braun-toho-godzilla-email-2024-02-17.md). Box scans, monster and tornado covers, back, and side panels: [documentation/box-art](documentation/box-art/README.md).

At the time, "Micropolis" was also the name of a hard disk drive manufacturer. They eventually changed names and went out of business, but the company was recently restructured as [Micropolis GmbH](https://www.micropolis.com). The owner is an old school hacker who was generous enough to grant the [Micropolis Public Name License](MicropolisPublicNameLicense.md), which allows the game to use the name Micropolis under reasonable conditions. Many thanks to Micropolis GmbH for this courtesy -- check out their [BBS primer](https://www.micropolis.com/micropolis-bbs-primer), [robotics primer](https://www.micropolis.com/micropolis-robotics-primer), and [data storage primer](https://www.micropolis.com/micropolis-data-storage-primer).

This repo, MicropolisCore, is the C++ simulation engine extracted from the full [micropolis repo](https://github.com/SimHacker/micropolis), stripped down, cleaned up, compiled to WebAssembly with Emscripten/Embind, and wrapped in a modern SvelteKit web application.

## Architecture

```
packages/micropolis-engine/   C++ simulation core (makefile + Emscripten → WASM)
  src/
    micropolis.h           Main engine header
    micropolis.cpp         Core simulation
    emscripten.cpp         Embind bindings for JS/WASM
    fileio.cpp             Save/load (.cty files)
    simulate.cpp           Simulation loop
    zone.cpp, traffic.cpp, power.cpp, budget.cpp, ...

apps/screen-angel/         Screen Angel — selectors, events and recognition over any app's
                           interface, in a transparent click-through Electron overlay
                           (source-available, see apps/screen-angel/LICENSE.md).
  modules/soul-angel/      SoulAngel — its first module: DVR, Soul Album, machinima/stream
                           studio, per-game Soul Bridges.
    bridges/sims1/         The Sims 1 bridge and Transmogrifier tools.

apps/micropolis/           SvelteKit application
  src/lib/
    wasm/                  Browser/Node WASM loaders and heap helpers
    i18n/                  Translation-key helpers for UI-facing metadata
    MicropolisReactive.svelte.ts Reactive engine bridge
    TileView.svelte        Map display component
packages/tile-renderer/    Shared tile renderers (Canvas 2D, WebGL2, WebGPU, software)
    MicropolisSimulator.ts WASM engine wrapper
  cli/
    entry.ts               Unified CLI entrypoint
    city/                  Save-file analysis/editing modules
    wasm/                  Headless WASM simulator commands
    bus/                   Command-bus CLI commands
    lib/format.ts          JSON/YAML/CSV output helpers
    constants/             Tile definitions, world constants

content/micropolis/        Sim bundled assets (`cities/`, `data/`, `images/`, `sounds/`, `tilesets/`)
  cities/                  Save files (.cty) including all 8 scenarios
documentation/             Manuals, talks, notes, designs, historical archives (see documentation/README.md)
```

### Reactive Bridge

The WASM engine talks to the Svelte UI through a callback chain:

```
C++ Micropolis Core (WASM)
    calls callback
Embind JSCallback Wrapper
    delegates
MicropolisReactive.engineCallback
    updates
$state / $derived Runes
    triggers
Svelte 5 Runtime
    updates DOM
UI Components + WebGL Renderer
```

## CLI Tool

The `micropolis` CLI reads, analyzes, visualizes, edits, and patches `.cty` save files, runs the WASM simulator headlessly, and exposes the command bus.

Run from the `apps/micropolis/` package directory after `pnpm install` at the repo root (or prefix with `pnpm --filter micropolis run` from the MicropolisCore root).

```bash
cd apps/micropolis

# City information and analysis (paths relative to this directory)
pnpm run micropolis -- city info ../../content/micropolis/cities/scenario_tokyo.cty
pnpm run micropolis -- city analyze ../../content/micropolis/cities/scenario_boston.cty
pnpm run micropolis -- city analyze --format json ../../content/micropolis/cities/radial.cty

# Visualize as ASCII, emoji, or monospace
pnpm run micropolis -- visualize ascii --row 20 --col 30 --width 30 --height 15 ../../content/micropolis/cities/scenario_tokyo.cty
pnpm run micropolis -- visualize emoji ../../content/micropolis/cities/radial.cty

# Edit city metadata
pnpm run micropolis -- city edit city.cty --funds 50000 --tax 9 --year 1960

# Patch scenario files with the values the engine injects at runtime
pnpm run micropolis -- city patch-scenario ../../content/micropolis/cities/scenario_tokyo.cty --dry-run

# Export to JSON (with optional tile map data)
pnpm run micropolis -- city export --format json --include-map city.cty

# Pipe from stdin
cat city.cty | pnpm run micropolis -- city info -
```

Full test suite and command reference: [documentation/notes/micropolis-js-tests.md](documentation/notes/micropolis-js-tests.md)

## Soul City: The Vision

Micropolis is not a "killer app." It is a **nurturing environment** -- a term from Don Hopkins' [DreamScape demo at WWDC 1995](https://donhopkins.medium.com/1995-apple-world-wide-developers-conference-kaleida-labs-scriptx-demo-64271dd65570):

> "We want to give creative people an environment in which to plant their seeds, a fertile ground, instead of a Killer App."

| Killer App | Nurturing Environment |
|------------|----------------------|
| One thing done perfectly | Many things made possible |
| Closed, finished product | Open, extensible platform |
| Consumes users | Cultivates creators |
| Zero-sum | Fertile ground for seeds |

**Soul City** is the full vision — the heavenly hub (open borders; Micropolis stays the GPL city engine): simulation orchestrated by [MOOLLM](https://github.com/SimHacker/moollm) AI characters, on a SvelteKit multiplayer platform, using **GitHub as MMORPG**:

- **The filesystem is the city.** All game state lives in git-controlled files.
- **Git is the multiverse.** Branches are alternate timelines. PRs merge histories.
- **Issues are class discussions.** Commits are decisions. Forks are universes.
- **AI tutors are MOOLLM characters.** Advisors who debate, explain, and learn alongside you.
- **Schools own their repos.** Privacy, safety, customization, community fundraising.

### AI Tutors

MOOLLM characters serve as tutors with distinct perspectives:

| Character | Role | Style |
|-----------|------|-------|
| Mayor's Advisor | General guidance | Pragmatic, patient |
| Urban Planner | Zoning, infrastructure | Idealistic, systems-oriented |
| Economist | Budget, taxes | Numbers-focused, cautious |
| Environmentalist | Pollution, green energy | Passionate, long-term |
| Historian | Real-world parallels | Storyteller, context-provider |

These aren't just observers. Following the DreamScape principle of "Users and Agents on Common Ground," AI tutors can take actions in the simulation, demonstrate techniques, and collaborate with students in the same city.

### GitHub-as-MMORPG Workflow

1. **Fork** the class repo -- your own universe
2. **Branch** for experiments -- alternate timelines
3. **Commit** decisions -- checkpoint history
4. **PR** to propose -- suggest changes to canonical
5. **Diff** to compare -- see what diverged

### What MOOLLM Brings to Micropolis

The micropolis skill is manifested in [MOOLLM](https://github.com/SimHacker/moollm) as an [Anthropic Skill](https://docs.anthropic.com/en/docs/build-with-claude/prompt-caching#prompt-structure) -- the native knowledge-injection format for Claude. But MOOLLM extends Anthropic's Skill specification with [eight architectural extensions](https://github.com/SimHacker/moollm/blob/main/designs/SPEED-OF-LIGHT-VS-CARRIER-PIGEON.md#moollm-extensions-beyond-basic-skills), drawing on Minsky's Society of Mind, Papert's Constructionism, Drescher's Schema Mechanism, and Will Wright's Sims architecture:

1. **Instantiation** -- Skills as prototypes creating instances with their own state, not just static procedures
2. **K-Lines** -- Minsky's semantic activation: saying "micropolis" activates a constellation of related concepts
3. **Empathic Templates** -- Smart generation based on semantic understanding, not string substitution
4. **Multi-Tier Persistence** -- Ephemeral scratch (`.moollm/`), append-only logs, editable state, plus the Semantic Image Pyramid: GLANCE.yml (5-70 lines), CARD.yml (50-200), SKILL.md (200-1000), README.md (500+), examples, templates -- read top-down, never load a lower level without loading the level above
5. **Speed of Light** -- Many agent turns inside one LLM call, no round-trip latency
6. **CARD.yml** -- Machine-readable interfaces with Sims-style advertisements: "what can I do here?"
7. **Ethical Framing** -- Room-based inheritance of performance context for appropriate character behavior
8. **Ambient Skills** -- Always-on behavioral shaping (the NO-AI hygiene suite prevents bad outputs without explicit invocation)

Full details: [MOOLLM: A Microworld Operating System for LLM Orchestration](https://github.com/SimHacker/moollm/blob/main/designs/LEELA-MOOLLM-DEMO-TRANSCRIPT.md)

**The micropolis skill** ([CARD.yml](https://github.com/SimHacker/moollm/blob/main/skills/micropolis/CARD.yml) | [SKILL.md](https://github.com/SimHacker/moollm/blob/main/skills/micropolis/SKILL.md) | [README.md](https://github.com/SimHacker/moollm/tree/main/skills/micropolis)) defines how MOOLLM agents interact with the simulation. It inherits from and composes with other skills:

| MOOLLM Skill | What It Gives Micropolis |
|-------------|--------------------------|
| [constructionism](https://github.com/SimHacker/moollm/tree/main/skills/constructionism) | Educational philosophy -- learn by building microworlds (Papert, Kay) |
| [adventure](https://github.com/SimHacker/moollm/tree/main/skills/adventure) | Room-based navigation -- directories are city districts, TinyMUD heritage |
| [character](https://github.com/SimHacker/moollm/tree/main/skills/character) | AI tutor personalities with locations, inventory, relationships |
| [mind-mirror](https://github.com/SimHacker/moollm/tree/main/skills/mind-mirror) | Sims-style personalities on Leary's Interpersonal Circumplex |
| [simulation](https://github.com/SimHacker/moollm/tree/main/skills/simulation) | Turn system, party management, game state hub |
| [schema-mechanism](https://github.com/SimHacker/moollm/tree/main/skills/schema-mechanism) | Drescher's causal learning -- agents discover cause and effect in the sim |
| [experiment](https://github.com/SimHacker/moollm/tree/main/skills/experiment) | Systematic simulation: SIMULATE, EVALUATE, ITERATE, ANALYZE cycles |
| [adversarial-committee](https://github.com/SimHacker/moollm/tree/main/skills/adversarial-committee) | Multi-perspective debate between AI tutors with incompatible values |
| Micropolis CLI | Doc-first terminal automation through `pnpm run micropolis -- about --format yaml` and `api --format yaml` |
| [speed-of-light](https://github.com/SimHacker/moollm/tree/main/skills/speed-of-light) | Multiple agent turns inside a single LLM call, no round-trip latency |

**Speed of Light vs Carrier Pigeon:** Most AI agent systems coordinate *between* LLM calls -- 500ms+ per hop, precision degrades each hop, every turn re-tokenizes the full context. MOOLLM skills run *during* one LLM call -- multiple agents iterating dozens of times inside a single generation, instant latency, perfect precision. AI tutors can debate a zoning decision, explore alternatives, and reach a recommendation in one call rather than a slow chain of API round-trips. Full writeup: [Speed of Light vs Carrier Pigeon](https://github.com/SimHacker/moollm/blob/main/designs/SPEED-OF-LIGHT-VS-CARRIER-PIGEON.md).

**Schema Mechanism + LLMs:** Gary Drescher's [schema mechanism](https://github.com/SimHacker/moollm/tree/main/skills/schema-mechanism) (*Made-Up Minds*, 1991) is a computational model for discovering causal relationships: a schema is a Context + Action -> Result triple that an agent learns through experience. MOOLLM pairs this with LLM semantic understanding — the schema mechanism discovers structure, the LLM grounds the symbols with meaning and can explain the discovered relationships in natural language. The design goal for Micropolis: an agent discovers that placing industrial zones near residential zones causes pollution complaints, not as a hardcoded rule but as a schema learned from observing the running simulation. See: [MOOLLM Eval/Incarnate Framework](https://github.com/SimHacker/moollm/blob/main/designs/MOOLLM-EVAL-INCARNATE-FRAMEWORK.md).

**Experiment Skill:** The [experiment](https://github.com/SimHacker/moollm/tree/main/skills/experiment) skill brings systematic evaluation to Micropolis. Define an experiment (e.g., "compare tax strategies"), run multiple simulations using speed-of-light, evaluate outcomes against rubrics, iterate with variations, and analyze patterns across runs. The experiment framework was proven with 5 tournament rounds, 20+ games, and 116+ turns in the Fluxx Championship -- the same SIMULATE/EVALUATE/ITERATE/ANALYZE cycle applies to city planning strategies. Inherits from: [simulation](https://github.com/SimHacker/moollm/tree/main/skills/simulation), [evaluator](https://github.com/SimHacker/moollm/tree/main/skills/evaluator), [rubric](https://github.com/SimHacker/moollm/tree/main/skills/rubric), [speed-of-light](https://github.com/SimHacker/moollm/tree/main/skills/speed-of-light).

### Design Documents

| Document | What It Covers |
|----------|----------------|
| [MOOLLM Manifesto](https://github.com/SimHacker/moollm/blob/main/designs/MOOLLM-MANIFESTO.md) | The Micropolis vision, GitHub-as-MMORPG, nurturing environments, intellectual genealogy |
| [SimCity Multiplayer & Micropolis](https://github.com/SimHacker/moollm/blob/main/designs/sims/simcity-multiplayer-micropolis.md) | SimCityNet history, voting mechanics, OLPC constructionism, Alan Kay's critique |
| [Speed of Light vs Carrier Pigeon](https://github.com/SimHacker/moollm/blob/main/designs/SPEED-OF-LIGHT-VS-CARRIER-PIGEON.md) | Why multi-agent-in-one-call beats tool-call chains |
| [Factorio MOOLLM Design](https://github.com/SimHacker/moollm/blob/main/designs/FACTORIO-MOOLLM-DESIGN.md) | Factorio logistics as inspiration for MOOLLM's data flow architecture |
| [Factorio Logistics Protocol](https://github.com/SimHacker/moollm/blob/main/designs/factorio-logistics-protocol.md) | Rooms as pipeline nodes, exits as edges, objects as messages |
| [MOOLLM for Hackers](https://github.com/SimHacker/moollm/blob/main/designs/MOOLLM-FOR-HACKERS.md) | Quick technical overview of the whole system |
| [micropolis SKILL.md](https://github.com/SimHacker/moollm/blob/main/skills/micropolis/SKILL.md) | Full skill protocol: CLI reference, file format, WASM integration plan |

### The Bigger Picture

MOOLLM is kind of like The Sims meets LambdaMOO in Cursor, then steals all the great ideas from Factorio. Micropolis is one microworld within that system. The [logistic-container](https://github.com/SimHacker/moollm/tree/main/skills/logistic-container) skill treats directories as Factorio logistics boxes. The [adventure](https://github.com/SimHacker/moollm/tree/main/skills/adventure) skill makes the filesystem a navigable space. The [character](https://github.com/SimHacker/moollm/tree/main/skills/character) and [mind-mirror](https://github.com/SimHacker/moollm/tree/main/skills/mind-mirror) skills give AI agents Sims-style personalities on Leary's Interpersonal Circumplex. All of these compose with the micropolis skill to create Soul City.

The full MOOLLM skill registry: [121 skills](https://github.com/SimHacker/moollm/blob/main/skills/INDEX.yml) | [Narrative index](https://github.com/SimHacker/moollm/blob/main/skills/INDEX.md)

## The Lineage

| Year | Project | Innovation |
|------|---------|-----------|
| 1989 | **SimCity** (Will Wright) | City as sandbox, emergent systems as toys |
| 1991 | **HyperLook SimCity** (Don Hopkins, Sun) | NeWS/PostScript networking, axis of eval |
| 1993 | **SimCityNet** (Don Hopkins, DUX) | [Multiplayer X11/TCL/Tk](https://www.youtube.com/watch?v=_fVl4dGwUrA), demoed at InterCHI '93 Amsterdam — [accepted proposal](documentation/historical/1993-interchi-simcitynet-proposal.md) |
| 1995 | **DreamScape** (Don Hopkins, Kaleida ScriptX) | "Nurturing environment," rooms + objects + web, WWDC demo |
| 2000 | **The Sims** (Will Wright) | Digital dollhouse, nurturing environment for stories |
| 2008 | **Micropolis** (Don Hopkins, OLPC) | Open source GPL-3, constructionist education |
| 2010 | **MediaGraph** (Don Hopkins, Stupid Fun Club) | Unity3D music navigation with pie menus, roads, and CA, collaboration with Will Wright |
| 2011 | **Bar Karma / Storymaker / Urban Safari** (Don Hopkins, SFC) | Branching narrative as spatial graph -- multi-user storytelling server + apps + geo storytelling on maps |
| Now | **MicropolisCore** | C++/WASM, SvelteKit, WebGL, CLI tools, MOOLLM AI tutors |

### Related Research

Sam Earle trained RL agents on Micropolis using fractal neural networks with quality-diversity methods:
- Paper: [Using Fractal Neural Networks to Play SimCity 1](https://arxiv.org/pdf/2002.03896)
- Code: [gym-city](https://github.com/smearle/gym-city) (OpenAI Gym environment for Micropolis)
- Discussion: [SimHacker/micropolis#86](https://github.com/SimHacker/micropolis/issues/86)

His key trick: recursive weight-sharing in fractal convolutional blocks, where each column acts as a continuous-valued cellular automaton ticking different numbers of times. The agents discovered power-plant placement, zone clustering, and traffic-avoiding road layouts.

## The Pioneers

| Pioneer | Contribution |
|---------|-------------|
| **Jean Piaget** | Children construct knowledge through interaction |
| **Seymour Papert** | Logo, Mindstorms -- learn by building microworlds |
| **Alan Kay** | Dynabook -- computers as thinking amplifiers |
| **Will Wright** | SimCity, The Sims -- emergent systems as toys |
| **Don Hopkins** | DreamScape, SimCityNet, Micropolis -- nurturing environments |
| **Craig Hubley** | "Empower every user to play around and be an artist" |

## Building

### Soul City setup (Cursor + MOOLLM)

**Soul City** ties this repository to [MOOLLM](https://github.com/SimHacker/moollm) — the microworld skill framework where the **micropolis** skill, AI tutors, and related designs live. To work across engine code, the SvelteKit app, and MOOLLM skills in one flow:

1. **Check out MOOLLM and MicropolisCore in the same directory** (sibling folders under one parent, e.g. `~/Developer/` or `~/src/`):

   ```bash
   mkdir -p ~/Developer && cd ~/Developer
   git clone https://github.com/SimHacker/MicropolisCore.git
   git clone https://github.com/SimHacker/moollm.git
   ```

   Keeping them side-by-side makes paths predictable and matches how multi-root workspaces list folders.

2. **Add both repositories to your Cursor workspace** — and any other related checkouts you use (e.g. SimObliterator Suite for VitaMoo, design-only repos): use **File → Add Folder to Workspace…** (or your OS equivalent) and include each repo root, or open a multi-root `.code-workspace` file that lists those paths. Cursor can index and search across all of them together.

3. **Follow MOOLLM’s setup and install instructions first** (clone is already done if you used step 1):

   - [MOOLLM README — Quick Start](https://github.com/SimHacker/moollm#quick-start)
   - [MOOLLM QUICKSTART.md](https://github.com/SimHacker/moollm/blob/main/QUICKSTART.md) — open the repo in Cursor and wait until **Settings → Cursor Settings → Indexing → Codebase Indexing** reaches **100%**, as in MOOLLM’s quickstart.

4. **Then** install and build MicropolisCore using the prerequisites and commands below (Emscripten, `pnpm`, WASM engine, `micropolis` app).

Using the same layout with **other AI coding tools** (for example **Claude Code**) is plausible so both trees stay in context, but that workflow is **not yet tested or documented** here—Cursor + MOOLLM is the supported path today.

MOOLLM does not replace the Node/pnpm toolchain here; it complements this repo for skills, YAML Jazz, and agent orchestration alongside the engine and web app.

### Prerequisites

You need:

- Node.js 20+ and [pnpm](https://pnpm.io/installation) (this repo uses `pnpm` at the root; enable Corepack with `corepack enable` if you use the version pinned in the root `package.json`).
- Git.
- Python 3.
- GNU Make.
- Emscripten SDK (`emcc`, `em++`, `emar`) for rebuilding the C++ engine to WebAssembly.

On macOS, install the basic native tools first:

```bash
xcode-select --install
```

### Install Emscripten SDK

The engine build uses Emscripten/Embind. If `emcc --version` does not work, install `emsdk`:

```bash
# Pick a parent directory for developer tools.
mkdir -p ~/Developer
cd ~/Developer

git clone https://github.com/emscripten-core/emsdk.git
cd emsdk
./emsdk install latest
./emsdk activate latest

# Activate for the current shell.
source ./emsdk_env.sh
emcc --version
```

To make Emscripten available in future shells, add this to your shell startup file:

```bash
source ~/Developer/emsdk/emsdk_env.sh
```

If you prefer not to auto-activate it in every shell, run that `source` command only before rebuilding the engine.

On macOS with Homebrew, this also works:

```bash
brew install emscripten
emcc --version
```

### WASM Engine

The engine is a **pnpm workspace package** (`@micropolis/engine-wasm` in `packages/micropolis-engine/`). It is still built with **GNU make** and **Emscripten** (no CMake). A normal **`pnpm --filter micropolis run build`** runs **`prebuild`**, which invokes **`pnpm --filter @micropolis/engine-wasm run build`** → **`make install`** in that directory.

To rebuild the engine only:

```bash
cd packages/micropolis-engine
make clean install
```

Or from the repo root:

```bash
pnpm --filter @micropolis/engine-wasm run build
```

`make install` builds the C++ engine and copies these generated artifacts into `apps/micropolis/src/lib/`:

```text
micropolisengine.js
micropolisengine.wasm
micropolisengine.data
```

The checked-in makefile builds the engine for browser, worker, and Node environments:

```text
-s 'ENVIRONMENT=web,worker,node'
```

Node support is required for `pnpm --filter micropolis run micropolis -- sim ...` (or `cd apps/micropolis && pnpm run micropolis -- sim ...`).

### SvelteKit App

From the **MicropolisCore** repository root (monorepo):

```bash
pnpm install
pnpm --filter micropolis dev    # Development server
pnpm --filter micropolis build  # Production build (includes Jekyll step as configured)
```

The Vite config copies `micropolisengine.wasm` and `micropolisengine.data` from `src/lib/` into the app build output so the browser can load them.

### CLI Tool

```bash
cd apps/micropolis   # or from repo root: pnpm --filter micropolis run micropolis -- ...
pnpm run micropolis -- --help
pnpm run micropolis -- about --format yaml
pnpm run micropolis -- api --format yaml
```

The CLI is the main terminal surface for city files, visualization, headless WASM simulation, and command-bus operations. It supports text output where useful and structured `json`, `yaml`, and `csv` formats where appropriate.

After rebuilding the engine with Emscripten:

```bash
cd apps/micropolis
pnpm run micropolis -- sim info --format yaml
pnpm run micropolis -- sim smoke --ticks 10 --format yaml
```

The `sim` branch loads the Emscripten/Embind WASM module in Node, instantiates `Micropolis`, loads a bundled city from the engine data package, runs ticks, and prints structured state. It is the foundation for GitHub Actions replay, command timeline validation, and agent-driven simulations.

### Quick Full Setup

From a fresh clone:

```bash
# 1. Activate Emscripten.
source ~/Developer/emsdk/emsdk_env.sh

# 2. Install monorepo dependencies (Micropolis and VitaMooSpace apps, shared packages, VitaMoo libraries, engine workspace stub).
pnpm install

# 3. Build the C++/WASM engine (requires Emscripten on PATH).
pnpm --filter @micropolis/engine-wasm run build

# 4. Verify CLI, WASM simulator, and web app (skip step 3 if artifacts are already in apps/micropolis/src/lib/).
pnpm --filter micropolis run micropolis -- city info ../../content/micropolis/cities/haight.cty
pnpm --filter micropolis run micropolis -- sim smoke --ticks 1
pnpm --filter micropolis dev
```

For Soul City-style development with MOOLLM, follow **Soul City setup (Cursor + MOOLLM)** at the top of this section before or alongside these steps.

## Links

| Resource | URL |
|----------|-----|
| **Live Demo** | [micropolisweb.com](https://micropolisweb.com) |
| **Doxygen Docs** | [micropolisweb.com/doc](https://micropolisweb.com/doc) |
| **MOOLLM** | [github.com/SimHacker/moollm](https://github.com/SimHacker/moollm) |
| **Micropolis Skill** | [moollm/skills/micropolis](https://github.com/SimHacker/moollm/tree/main/skills/micropolis) |
| **Original Repo** | [github.com/SimHacker/micropolis](https://github.com/SimHacker/micropolis) |
| **Sponsor** | [patreon.com/DonHopkins](https://patreon.com/DonHopkins) |

### Historical

| Resource | URL |
|----------|-----|
| **SimCityNet InterCHI '93 Proposal** | [documentation/historical/1993-interchi-simcitynet-proposal.md](documentation/historical/1993-interchi-simcitynet-proposal.md) ([art.net original](http://www.art.net/~hopkins/Don/simcity/simcitynet.html)) |
| **SimCityNet Announcement (1993)** | [art.net/~hopkins/Don/simcity](http://www.art.net/~hopkins/Don/simcity/simcity-announcement.html) |
| **Open Sourcing SimCity** | [donhopkins.medium.com](https://donhopkins.medium.com/open-sourcing-simcity-58470a27) |
| **DreamScape WWDC 1995** | [donhopkins.medium.com](https://donhopkins.medium.com/1995-apple-world-wide-developers-conference-kaleida-labs-scriptx-demo-64271dd65570) |
| **SimCityNet Video** | [YouTube](https://www.youtube.com/watch?v=_fVl4dGwUrA) |

## License

- **Code:** [GPL-3.0](LICENSE) ([notice](MicropolisGPLLicenseNotice.md))
- **Name:** [Micropolis Public Name License](MicropolisPublicNameLicense.md) -- "Micropolis" is a registered trademark of [Micropolis GmbH](https://www.micropolis.com) and is licensed as a courtesy of the owner.

Micropolis is based on the original SimCity from Electronic Arts / Maxis, designed and written by Will Wright, and ported to Unix by Don Hopkins.

-- Don Hopkins [don@DonHopkins.com](mailto:don@DonHopkins.com)
