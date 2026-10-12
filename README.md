# Dipolis

<img src="docs/assets/dipolis-start.png" alt="Dipolis: nighttime panorama of human and AI city districts" width="1792" height="768">

**Eine Stadt, in der Menschen und KI-Bewohner zusammenleben, geführt von einer KI-Verwaltung.**

Developed and maintained by **Oliver Dzaeck ([Dzaecko](https://github.com/Dzaecko))**.

## What you can do

- Build a city with human and AI residential zones, farms and power plants.
- Manage taxes, food imports, electricity priorities and public services.
- Compare fixed strategies or let a language model make yearly decisions.
- Read reports and inspect the model's decisions live in the terminal.

The city runs in a browser using a C++ engine compiled to WebAssembly. The model runner uses Node.js and TypeScript and works without a graphical interface.

## Run the city in your browser

Install **Node.js 22+** and enable Corepack, then:

```sh
git clone https://github.com/Dzaecko/Dipolis.git
cd Dipolis
corepack enable
corepack pnpm install
corepack pnpm --filter dipolis run dev:vite
```

Open the address printed in the terminal, usually **http://localhost:5177**.
The included engine files let you start without compiling C++.

## Let a model run the city

The runner starts Haight, lets it settle, sets the treasury to **60,000**, and runs **30 years**. Each year, the model reads a report and can make up to **12 tool calls** before the city advances.

### Free trial — no model account needed

```sh
corepack pnpm --filter dipolis run city-model --adapter fake --assignment N --handbook off --run 1
```

This local adapter follows the measured **S266** strategy. It makes no network requests and checks its results against the saved reference. Use a new run number if the output already exists.

### Use your own model

1. Create a local `.env.city-model` in the repository root using the [configuration guide](docs/model-runner.md).
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

A saved comparison covers **304 fixed strategies**, each over 30 years. With the corrected engine, **191** never had an empty year-end treasury. This is evidence for one scenario, not a guarantee for other cities or models. The earlier comparison is retained separately.

- [All strategy results](docs/results/strategy-space.csv)
- [Corrected-engine strategy results](docs/results/strategy-space-safe-engine.csv)
- [Rankings and summaries](docs/results/strategy-space-report.md)

```sh
corepack pnpm --filter dipolis exec vitest run cli/model
corepack pnpm run check
```

The normal tests do not make paid model calls. S266 must reproduce its stored metrics exactly. Historical behavior is checked separately using the **classic** profile; the extended rules use **koexistenz**.

## Herkunft und Lizenz

Dipolis ist eine veränderte Fassung von Micropolis, beruhend auf dem 2008 von Electronic Arts unter GPL-3 veröffentlichten Quellcode und der Engine-Portierung [MicropolisCore von Don Hopkins](https://github.com/SimHacker/MicropolisCore).
Ausgangs-Commit: [f9ae6a57bbe5f5ff94c149bccb3015757f18241d](https://github.com/SimHacker/MicropolisCore/commit/f9ae6a57bbe5f5ff94c149bccb3015757f18241d).

> Micropolis is a registered trademark of Micropolis Corporation (Micropolis GmbH) and is licensed here as a courtesy of the owner under the Micropolis Public Name License.

Dipolis steht unter GPL-3. [LICENSE](LICENSE), [GPL-Hinweis](MicropolisGPLLicenseNotice.md) und [Namenslizenz](MicropolisPublicNameLicense.md) bleiben unverändert. Die Arbeit von Will Wright, Don Hopkins, Electronic Arts und den ursprünglichen Mitwirkenden bleibt nachvollziehbar. Dipolis ist kein Produkt von Electronic Arts.

Gegenüber dem Original ergänzt Dipolis Menschen- und KI-Zonen, getrennte Stromversorgung, Nahrung und Farmen, Arbeitslosigkeit, Grundversorgung, Automatisierung, Unruhe, Anlagen und KI-Fraktionen. Dazu kommen eine eigene Oberfläche, modellgeführte Verwaltung, reproduzierbare Laufprotokolle, Live-Modus, Wiedergabe, Berichte und Nachbetrachtungen sowie Speicherzugriffskorrekturen.

## Entwicklung

Code: [Oberfläche und CLI](apps/dipolis), [C++-Engine](packages/micropolis-engine), [Renderer](packages/tile-renderer) und [gemeinsame Render-Grundlagen](packages/render-core).
Die internen Engine-Namen bleiben zur Dokumentation der Herkunft erhalten.
Für einen statischen Frontend-Build mit den mitgelieferten Engine-Artefakten:

```sh
corepack pnpm --filter dipolis exec vite build
```

Der Engine-Neubau benötigt Emscripten, GNU Make und Python: `corepack pnpm run build:engine`.