# Dipolis

**A city where humans and AI residents live together — managed by you or a language model.**

Developed and maintained by **Oliver Dzaeck ([Dzaecko](https://github.com/Dzaecko))**.
Dipolis is a modified fork of [MicropolisCore](https://github.com/SimHacker/MicropolisCore), built on the open-source Micropolis city engine.

## What you can do

- Build a city with human and AI residential zones, farms and power plants.
- Manage taxes, food imports, electricity priorities and public services.
- Compare fixed strategies or let a language model make yearly decisions.
- Read reports and inspect the model's decisions live in the terminal.

The city runs in a browser using a C++ engine compiled to WebAssembly. The model runner uses Node.js and TypeScript and works without a graphical interface.

## Run the city in your browser

Install **Node.js 20+** and enable Corepack, then:

```sh
git clone https://github.com/Dzaecko/Dipolis.git
cd Dipolis
corepack enable
corepack pnpm install
corepack pnpm --filter micropolis run dev:vite
```

Open the address printed in the terminal, usually **http://localhost:5173**.
The included engine files let you start without compiling C++.

## Let a model run the city

The runner starts Haight, lets it settle, sets the treasury to **60,000**, and runs **30 years**. Each year, the model reads a report and can make up to **12 tool calls** before the city advances.

### Free trial — no model account needed

```sh
corepack pnpm --filter micropolis run city-model --adapter fake --assignment N --handbook off --run 1
```

This local adapter follows the measured **S266** strategy. It makes no network requests and checks its results against the saved reference. Use a new run number if the output already exists.

### Use your own model

1. Copy [.env.city-model.example](.env.city-model.example) to `.env.city-model` in the repository root.
2. Enter `CITY_MODEL_ENDPOINT`, `CITY_MODEL_NAME` and `CITY_MODEL_KEY`.
3. In VS Code, select **Tasks: Run Task** and choose an N/R start task.
4. Enter a run number and choose handbook **on** or **off**.

The tasks read the local configuration each time. It is excluded from Git. For Azure OpenAI, the full endpoint ends in **/openai/v1/chat/completions**; the task also accepts the **/openai/v1** base URL.

- **N:** manage the city, without an additional financial objective.
- **R:** manage the city for an operator seeking a high treasury after 30 years.
- **Handbook on:** give the model the fixed background description of city rules.
- **Resume tasks:** replay an interrupted run and continue with the same model, assignment, handbook setting and run number.

**Real model runs can cost money.** Never commit API keys or share them in chat. The live output shows decisions and reports, not an animated city view.

Logs contain tool results, annual reasoning, reports, errors and token usage. Details and direct CLI instructions: [Model runner guide](docs/model-runner.md).

## Results and tests

A saved comparison covers **304 fixed strategies**, each over 30 years. In that sample, **195** never had an empty year-end treasury. This is evidence for one scenario, not a guarantee for other cities or models.

- [All strategy results](docs/results/strategy-space.csv)
- [Rankings and summaries](docs/results/strategy-space-report.md)

```sh
corepack pnpm --filter micropolis exec vitest run cli/model
corepack pnpm run check
```

The normal tests do not make paid model calls. S266 must reproduce its stored metrics exactly. Historical behavior is checked separately using the **classic** profile; the extended rules use **koexistenz**.

## Development and credits

Main code: [browser app and CLI](apps/micropolis), [C++ engine](packages/micropolis-engine), and [documentation](documentation).
Rebuilding the engine requires Emscripten, GNU Make and Python: `corepack pnpm run build:engine`.

Dipolis preserves the original work and attribution of **Will Wright, Don Hopkins, Electronic Arts and the MicropolisCore contributors**. It is a modified project, not the original game or an Electronic Arts product.

Read [LICENSE](LICENSE), [the GPL notice and additional terms](MicropolisGPLLicenseNotice.md), and [the Micropolis name license](MicropolisPublicNameLicense.md). Some inherited components have separate licenses, including [Screen Angel](apps/screen-angel/LICENSE.md). No Electronic Arts trademark rights are claimed.