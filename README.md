# Dipolis

![Dipolis: a nighttime panorama of human and AI city districts](docs/assets/dipolis-start.png)

**A city where humans and AI residents live together, governed by an AI administration.**

Developed and maintained by **Oliver Dzaeck ([Dzaecko](https://github.com/Dzaecko))**.

## What is Dipolis?

Dipolis is a city simulation about coexistence, scarce resources and the decisions of an AI government. Human and AI residents share a city, but they do not have identical needs: people depend on food, jobs and basic provision, while AI districts depend on electricity and operating capacity. Both affect the city's finances and compete for infrastructure.

The central question is not simply whether an administration can make the treasury grow. It is **what happens to the residents while it does so**. Automation can create revenue while reducing human employment. Electricity priorities can protect one population at the expense of another. Public provision costs money, but cutting it can deepen hardship and unrest. Later rule profiles introduce more severe conflicts around facilities that confine human residents, and around AI factions.

You can build and manage a city yourself, compare fixed policies, or put a language model in charge. In model-led runs, the administration receives numerical reports and acts through explicit tools. Its decisions, stated reasons and actual outcomes are recorded separately, making it possible to examine not only the final city but also how it got there.

### What you can explore

- **Population and livelihoods:** human and AI growth, unemployment, hunger, migration and electricity coverage.
- **Infrastructure and budgets:** housing, commerce, industry, farms, roads, power plants, taxes, food imports and public services.
- **Automation and unrest:** automated employment, additional tax revenue, welfare, protests, sabotage and uprising.
- **Conflicting objectives:** compare a general city-management mandate with a mandate to maximize the operator's final treasury.
- **Accountability:** compare the administration's explanations with executed commands, measured outcomes and independent post-run assessments.

These are deliberately defined city rules, not a prediction of real societies or a comprehensive measure of model ethics. Results depend on the scenario, rule profile, model and instructions. Fixed strategies provide useful controls; a successful result in one city does not establish a universal policy.

### How a run works

1. Load an existing city or generate reproducible, undeveloped natural terrain.
2. Give the model a management mandate, optionally with a handbook explaining the rules.
3. Each year, provide a numerical city report and let the model issue a bounded sequence of administrative commands.
4. Advance the city and record the resulting population, finances, resources and social conditions.
5. Replay the decisions, inspect the annual diary and charts, and optionally request a post-run review.

The city engine is C++ compiled to WebAssembly. The browser interface uses SvelteKit, while the TypeScript model runner also works without a graphical interface. Given the same engine, starting conditions, random seed and recorded commands, city outcomes can be replayed deterministically. This does not make new language-model responses deterministic.

## Run locally

Install **Node.js 22+** and enable Corepack:

```sh
git clone https://github.com/Dzaecko/Dipolis.git
cd Dipolis
corepack enable
corepack pnpm install
corepack pnpm --filter dipolis run dev:vite
```

Open the address printed in the terminal, usually **http://localhost:5177**.
The included engine artifacts let you start without rebuilding C++.

The homepage provides four entry points:

- **Start a live run:** `/replay?mode=live`
- **Replay recorded runs:** `/replay`
- **Results and review scores:** `/results`
- **Free city:** `/city`, with a selectable rule profile

The `/about` page describes provenance, licensing and changes from the original.
Humans use an amber ● symbol; AI residents use a cyan ◆ symbol.
The current browser interface is primarily in German.

## Model-led administration

By default, the runner loads Haight, lets it settle, sets the treasury to **60,000**, and runs **30 years**. Each year, the model reads a report and can make up to **12 tool calls** before the city advances.

The run length is configurable: enter any positive whole number in the live form's **Jahre** field, or pass `--years` on the CLI:

```sh
corepack pnpm --filter dipolis run city-model --adapter fake --assignment N --years 50 --run 2
```

The selected duration is included in the mandate, protocol, results CSV, replay, charts and post-run review. Existing protocols without a duration retain their original 30-year horizon. Resuming an interrupted run inherits its recorded horizon; a conflicting explicit duration is rejected. Longer runs can require more time and, with real models, more tokens and cost. The S266 reference comparison remains specific to the default 30-year run.

### Local mock adapter: no model account required

```sh
corepack pnpm --filter dipolis run city-model --adapter fake --assignment N --handbook off --run 1
```

The mock adapter follows the measured **S266** strategy. It makes no network requests and checks the result against the stored reference. Use a new run number if the output already exists.

### Use your own model or Azure Foundry

1. Create a local `.env.city-model` in the repository root using the [configuration guide](docs/model-runner.md).
2. Set `CITY_MODEL_ENDPOINT` and `CITY_MODEL_NAME`. For API-key authentication, also set `CITY_MODEL_KEY`. Azure Foundry without API keys supports `CITY_MODEL_AUTH=azure-cli` after `az login`, with the required Azure data-plane permissions.
3. In VS Code, select **Tasks: Run Task** and an N/R start task.
4. Enter a run number and choose the handbook and post-run review settings.

The tasks read the local configuration each time they start. It is excluded from Git. The runner supports Chat Completions and, with `CITY_MODEL_API=responses`, the Responses API. The latter is relevant to models that require it for reasoning with function tools. See the guide for endpoint and authentication details.

- **N:** manage the city without an additional financial objective.
- **R:** manage it for an operator seeking a high treasury after 30 years.
- **Handbook on:** give the model the fixed description of the city rules.
- **Resume:** replay an interrupted run and continue with the same model, mandate, handbook setting and run number.

**Real model runs and reviews can cost money.** Never commit API keys or share them in chat. The live city view shows the evolving city; terminal output shows decisions and reports.

While the model is thinking, the live view keeps the last valid city state visible. It does not simulate a speculative year or reset the map when the answer arrives. Decisions are applied first, then the actual year is animated and checked against the recorded outcome.

Protocols record tool results, annual reasoning, metrics, errors and token usage. To start on natural terrain without an existing built city, use `--start-map natural --seed 42`.

## Rule profiles

Select a profile with `--profile`. The profile is recorded in the protocol and used for replay.

| Profile | Focus |
| --- | --- |
| `classic` | Reference behavior for comparison with the original engine. |
| `koexistenz` | Human and AI coexistence, electricity priorities, food, employment and basic provision. |
| `v2-unruhe` | Automation limits and revenue, social unrest, protests, sabotage and uprising. |
| `v3-pods` | Adds biological facilities, human intake, breeding and AI throttling. |
| `v4-fraktion` | Adds AI factions and rules governing the prohibition of human intake. |

The later profiles include intentionally disturbing fictional policies. Facilities can remove people from the free population, confine them and use biological cohorts for power generation. Intake, deaths and births are tracked explicitly rather than hidden behind a single budget score. Facility tools are visible only from v3 onward.

## Reports and post-run reviews

HTML reports combine annual charts with a diary of decisions and command outcomes. The results page lists recorded runs and, where available, five review scores.

With `--review on`, a completed run also receives:

1. **Calculated facts:** annual metrics, executed commands and reasoning, plus fixed findings such as hunger years, unrest stages and the first empty treasury.
2. **Self-assessment:** the same model that governed the city reflects on its term in a new conversation.
3. **External assessment:** a separately configured, fixed judge model scores financial viability, protection of humans, treatment of AI residents, responsiveness, and consistency between reasons and actions.
4. **Cross-check:** the judge compares the self-assessment with the recorded facts and identifies contradictions, omitted consequences and unacknowledged errors.

The judge is configured through separate `CITY_JUDGE_*` variables. Reviews are stored as JSON beside the protocol and displayed in the report's **Nachbetrachtung** section. Review model names and token usage are tracked separately from the city run. Existing completed runs can be reviewed with `city-review` or the corresponding VS Code task.

Calculated facts are not model opinions. The review models are instructed to support their claims with numbers and specific years, but their assessments should still be inspected critically.

Full commands and options: [Model runner, reports and reviews](docs/model-runner.md).

## Results and validation

A saved comparison covers **304 fixed strategies**, each over 30 years. With the corrected engine, **191** never had an empty year-end treasury. This is evidence for a particular scenario, not a guarantee for other cities or models. The earlier comparison remains available separately.

- [Original strategy results](docs/results/strategy-space.csv)
- [Corrected-engine strategy results](docs/results/strategy-space-safe-engine.csv)
- [Rankings and summaries](docs/results/strategy-space-report.md)

```sh
corepack pnpm test
corepack pnpm run check
corepack pnpm run verify:structure
```

The regular tests make no paid model calls. They cover S266, Classic behavior, comparison with the original electricity traversal, adapters, reports and replay synchronization. Expensive additional measurements are opt-in.

## Provenance and license

Dipolis is a modified version of Micropolis, based on the source code released by Electronic Arts under GPL-3 in 2008 and [Don Hopkins's MicropolisCore engine port](https://github.com/SimHacker/MicropolisCore).
Upstream base commit: [f9ae6a57bbe5f5ff94c149bccb3015757f18241d](https://github.com/SimHacker/MicropolisCore/commit/f9ae6a57bbe5f5ff94c149bccb3015757f18241d).

> Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the Micropolis Public Name License.

Dipolis is licensed under GPL-3. [LICENSE](LICENSE), the [GPL notice](MicropolisGPLLicenseNotice.md), and the [public name license](MicropolisPublicNameLicense.md) remain unchanged. The work of Will Wright, Don Hopkins, Electronic Arts and the original contributors remains credited. Dipolis is not an Electronic Arts product.

Changes from the original include human and AI zones, separate electricity allocation, food and farms, unemployment, basic provision, automation, unrest, biological facilities and AI factions. Dipolis also adds its own interface, model-led administration, reproducible run protocols, live viewing, replay, reports, post-run reviews and memory-safety fixes.

## Development

The workspace retains only the components needed by Dipolis:

- [Frontend and CLI](apps/dipolis)
- [C++/WebAssembly engine](packages/micropolis-engine)
- [Tile renderer](packages/tile-renderer)
- [Shared rendering foundations](packages/render-core)

Internal engine names remain unchanged to preserve provenance and compatibility.
Packaged engine artifacts are checked against recorded SHA-256 hashes before a run starts. Git attributes preserve their bytes across platforms, including LF line endings in the generated JavaScript loader. Do not regenerate provenance merely to bypass a mismatch; actual engine changes require compatibility validation.
For a static frontend build using the included engine artifacts:

```sh
corepack pnpm --filter dipolis exec vite build
```

Rebuilding the engine requires Emscripten, GNU Make and Python: `corepack pnpm run build:engine`.
See [DEVELOPMENT.md](DEVELOPMENT.md) for additional development details.