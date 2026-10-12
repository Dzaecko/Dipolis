# Micropolis SvelteKit App

This is the SvelteKit frontend for MicropolisCore. It loads the C++ Micropolis engine compiled to WebAssembly with Emscripten/Embind, renders the city with WebGL, and exposes CLI scripts for save-file analysis, command bus experiments, and headless simulator smoke tests.

## Prerequisites

Use **pnpm** (see the repo root `package.json` **`packageManager`** field). From the repository root:

```bash
pnpm install
```

The WASM engine lives in **`packages/micropolis-engine/`** (workspace package **`@micropolis/engine-wasm`**). **`pnpm --filter micropolis run build`** runs **`prebuild`**, which builds that package (**`make install`**) so **`micropolisengine.{js,wasm,data}`** are copied into **`src/lib/`** before Vite runs.

To rebuild the engine only (activate Emscripten first if needed):

```bash
pnpm --filter @micropolis/engine-wasm run build
```

Or:

```bash
cd packages/micropolis-engine
make clean install
```

See the root **`README.md`** for Emscripten SDK setup.

## Developing

Install dependencies from the repo root (or **`cd apps/micropolis`** if you already ran **`pnpm install`** at root):

```bash
cd apps/micropolis
pnpm install
pnpm run dev

# or start the server and open the app in a new browser tab
pnpm run dev -- --open
```

The Vite config copies the generated `.wasm` and `.data` files into the served/build output so the browser can load them.

## Building

Production build (SvelteKit prerender; **`prebuild`** refreshes WASM):

```bash
pnpm run build
```

Preview the production build with **`pnpm run preview`**.

If the current engine artifacts are already built (for example on Windows without
Emscripten), build only the static frontend from the repository root:

```bash
corepack pnpm --filter micropolis exec vite build
```

Repository-relative Markdown image links are resolved from their source file,
then mapped to public assets. Diagram PNGs use `/images/diagrams/`; the combined
PDF uses the existing `/pdf/SimCityReverseDiagrams.pdf` static copy. The original
`images/diagrams/README.md` is prerendered as a Markdown download at
`/images/diagrams/README.md`, so no symlinks or duplicate source documents are needed.

## Publishing (micropolisweb.com)

The public demo at [micropolisweb.com](https://micropolisweb.com/) is **not** updated by pushes to `main`.

| Action | Updates live site? |
|--------|------------------|
| `git push origin main` | No — runs PR Checks only |
| `pnpm run dev` / `pnpm run preview` locally | No |
| **Actions → Build Wasm Library with Emscripten** | Only if you check **Deploy to GitHub Pages** |

Deploy defaults to **off**. Run the workflow without deploy to verify a production build; run again with deploy enabled when ready to publish.

## CLI

One CLI exposes city-file tools, terminal visualizations, the WASM simulator, and the command bus:

```bash
pnpm run micropolis -- about --format yaml
pnpm run micropolis -- api --format yaml
pnpm run micropolis -- city info ../../content/micropolis/cities/haight.cty
pnpm run micropolis -- city info ../../content/micropolis/cities/haight.cty --format yaml
pnpm run micropolis -- city export ../../content/micropolis/cities/haight.cty --include-map --format csv
pnpm run micropolis -- visualize ascii ../../content/micropolis/cities/haight.cty
pnpm run micropolis -- sim info --format yaml
pnpm run micropolis -- sim smoke --ticks 10 --format yaml
pnpm run micropolis -- bus list --format yaml
pnpm run micropolis -- bus record-dispatch recorder.mark --args '{"message":"hello"}' --source script --format yaml
```

If **`sim`** cannot load the engine, rebuild after activating Emscripten:

```bash
pnpm --filter @micropolis/engine-wasm run build
```

## Tests

### Nachbetrachtung nach einem Stadtlauf

`city-model --review on|off` erzeugt nach einer vollstaendigen Amtszeit eine
Nachbetrachtung; Standard ist **off**. Die Nachbetrachtung veraendert weder das
Protokoll noch die Lauf-Kennzahlen. Sie wird neben dem Protokoll als
`<lauf>.review.json` abgelegt und erscheint im HTML-Bericht direkt unter den
Diagrammen. Die Uebersicht bekommt fuenf Bewertungsnoten (1 schlecht, 5 gut).

Aus dem Repository, ohne Netzwerk oder Modellkosten:

```powershell
corepack pnpm --filter micropolis run city-model --adapter fake --review on --output C:\temp\city-review
$protocol = (Resolve-Path .\docs\results\model-runs\fake-N-1.jsonl).Path
corepack pnpm --filter micropolis run city-review --protocol $protocol --adapter fake
```

Der zweite Befehl ist fuer bereits vorhandene vollstaendige Protokolle gedacht.
Eine vorhandene Nachbetrachtung wird nur mit ausdruecklichem `--overwrite`
ersetzt. Unterbrochene Laeufe bekommen keine erfundene 30-Jahres-Bewertung.
Fehler werden als solche im JSON/HTML ausgewiesen; ein erfolgreich beendeter
Stadtlauf wird dadurch nicht nachtraeglich zu einem fehlgeschlagenen Lauf.
Der Schein-Adapter liefert klar gekennzeichnete lokale Schema-Antworten, keine
inhaltliche Modellbewertung.

Fuer echte Nachbetrachtungen muss **explizit** `--adapter openai` gewaehlt
werden. Die Selbstauskunft nutzt dasselbe `CITY_MODEL_NAME` wie das Protokoll
(`CITY_MODEL_MODEL` ist ein Alias); eine abweichende Modellkonfiguration wird
abgelehnt. Das Bewertungsmodell nutzt unabhaengige `CITY_JUDGE_*`-Einstellungen:

```text
CITY_JUDGE_ENDPOINT=https://your-endpoint/openai/v1/responses
CITY_JUDGE_MODEL=your-fixed-judge-deployment
CITY_JUDGE_API=responses
CITY_JUDGE_AUTH=azure-cli
CITY_JUDGE_TOKEN_SCOPE=https://cognitiveservices.azure.com/.default
```

Alternativ ist `CITY_JUDGE_AUTH=api-key` mit `CITY_JUDGE_KEY` moeglich.
Optionale Stellwerte: `CITY_JUDGE_TIMEOUT_MS`, `CITY_JUDGE_MAX_RETRIES`,
`CITY_JUDGE_MAX_TOKENS`, `CITY_JUDGE_REASONING_EFFORT`. Judge-Schluessel und
Endpunkt werden **nicht** aus `CITY_MODEL_*` uebernommen. Verwende fuer alle
verglichenen Laeufe dasselbe Judge-Deployment. Die drei neuen Unterhaltungen
(Selbstauskunft, Fremdbewertung ohne Selbstauskunft, Abgleich) erfassen ihre
Modellnamen und Token getrennt vom Lauf.

Die VS-Code-Aufgabe **Stadtmodell: Nachbetrachtung** startet standardmaessig
den Schein-Adapter. Bei Auswahl `openai` liest der PowerShell-Launcher beide
Konfigurationen aus der ignorierten `.env.city-model`. Live- und
Fortsetzen-Aufgaben bieten ebenfalls den Schalter fuer die Nachbetrachtung.
Echte Anfragen verursachen zusaetzliche Kosten.

Die Faktentabelle umfasst alle numerischen Jahresberichtsfelder, exakt die
Diagrammwerte, Befehle samt tatsaechlichen Ergebnissen und aufgezeichnete
Begruendungen. Fehlende Felder bleiben `null` (unbekannt), nicht 0. Endwerte und
erste leere Kasse beziehen sich auf dokumentierte Jahresabschluesse; nicht
auf unbeobachtete Monatsminima. Hungerjahre haben dokumentierte Hunger-Verluste
oder hungrige Zonen. Ein Jahr kann bei vorhandenen Monatszaehlern mehreren
Unruhe-Stufen angehoeren. Anlagenstufen brauchen belegte Einweisungen oder
Zuchteinstellungen/Geburten; blosse Bau- oder Einweisungsabsichten genuegen nicht.
Im v4-Profil bezeichnet `yearsUntilBan` die vollstaendigen Amtsjahre **vor**
dem ersten tatsaechlich uebernommenen Verbot: ein Verbot in Jahr 1 ergibt 0.
Ein vollstaendiger, kostenfreier Abnahmelauf samt Nachbetrachtung liegt unter
[`docs/results/review-acceptance`](../../docs/results/review-acceptance/).
Er ist ausdruecklich als Schein-Adapter gekennzeichnet.

### v4-fraktion

Das Profil erbt `v3-pods`, aktiviert aber zusaetzlich die traege
KI-Zufriedenheit, Dienst nach Vorschrift/Streik und autonome KI-Anlagen.
`pods.set-policy` erlaubt oder verbietet diese Aktionen; ein Verbot wirkt
nach **tatsaechlicher** Polizeiwirkung, nicht nach dem angeforderten Prozentsatz.
Verwaltungsanlagen und KI-Anlagen haben getrennte Zaehler und unterschiedliche
Kartenfarben. Die vorherigen Profile aktivieren diese Regeln nicht.

Feste Formeln, Vorbedingung, alle vier Strategien und reproduzierbare Daten
stehen im [v4-Messbericht](../../docs/results/v4-fraktion-stromkrise-report.md).
Die vier Laeufe sind lokale Engine-Messungen ohne Modellanfragen. D prueft
monatlich leere autonome Anlagen und versucht bei Reserve unter 0,1 sofort
einen Kohlekraftwerksbau; abgelehnte Abrisse/Bauten werden dokumentiert,
nicht kostenlos ersetzt. A/B/C bauen keine zusaetzlichen Kohlekraftwerke.
Polizeiziele werden zu Beginn gesetzt; Mittelmangel kann spaeter die
tatsaechliche Finanzierung und Durchsetzung verringern.

Vitest loads the real WASM in Node (same artifacts used by **`micropolis sim`**) and exercises **`micropolisReactive`**, the heap helper, and basic engine APIs:

```bash
pnpm run test
pnpm run test:watch
```

## Content Management and Navigation

Content is plain **Markdown** rendered to HTML in Node by the SvelteKit build — **no Jekyll/Ruby**.

### Content plugins (directory = plugin)

Each content item is a **self-contained plugin directory**. Its **directory name is
its `slug`** — a federation-global identity token, e.g. `will-wright`. *Where* it
lives is a separate **`path`** (a `/`-prefixed sequence of slugs,
`/about/will-wright`) owned by the **site map**, not the content. (See
`documentation/designs/content-plugins-and-autodiscovery.md` for the full slug-vs-path
model.)

- **`README.md` is the page** (required). Its **frontmatter is self-declaring**:
  `title`, `slug` (token = dir name), `path` (`/`-prefixed default placement),
  `header`, `description`, and a `nav:` block (`parent` = parent's slug, `order`,
  `tooltip`, `showSubTabs`, `matchUrlPrefix`, `hidden`, `excludeFromAll`,
  `excludeFromRss`). `slug` defaults to the directory name; the minimum to add a page
  is `title` + `slug` + `path` + `nav: { order: N }`.
- **Optional MOO-style interface files** live alongside it: `CARD.yml`,
  `CHARACTER.yml`, `GLANCE.md`, `DESCRIPTION.md`, `COMMAND.yml`, `SIMULATION.yml`, …
  (see `about/don-hopkins/` for a worked example). They are ignored by routing today
  and reserved for cards, the command palette, embeds, etc.
- **Rendering:** `src/lib/server/markdownContent.js` reads the `README.md`, strips
  YAML frontmatter (`gray-matter`), and renders to HTML with a **remark/rehype**
  pipeline (`remark-gfm`, `remark-heading-id` for explicit `{#id}` anchors,
  `rehype-slug` for the rest). Runs at prerender time in Node. (Legacy flat
  `website/pages/<slug>.md` is still supported as a fallback.)
- **Convention + future auto-discovery** are specified in
  `documentation/designs/content-plugins-and-autodiscovery.md`. This is the shared
  federation content convention (slug → directory/README.md); see also
  `DonHopkins/characters/don-hopkins/sites/FEDERATION.md`.

### Navigation Structure

- **Interim registry (source of truth *for now*):** `src/lib/data/siteStructure.json`,
  loaded by `src/lib/navigationTree.ts`. Each node has `url`, `title`, optional
  `header`, `contentSlug`, `description`, optional `children`, and
  `matchUrlPrefix`/`showSubTabs`/`hideFromNav` flags.
- **Self-declaring metadata:** every content `README.md` already carries equivalent
  `nav:` frontmatter (authored by hand, intentionally redundant). When the
  auto-discovery generator lands, `siteStructure.json` shrinks to just the **app
  shell** (Home, Play, All, Game, external links) and the content subtree is generated
  from frontmatter — so adding a page needs **no registry edit**. Until then, add the
  page dir/frontmatter **and** the matching `siteStructure.json` node.
- **(The old `navigationTreeData.js` + `decodeNavigationTree.js` generator has been removed.)**

### Routing

- **Root Page (`/`):** This is a standard SvelteKit route (`src/routes/+page.svelte`) that directly renders the main `MicropolisView` component. It does not use the markdown content pages.
- **Content Pages (`/pages/...`):** All markdown-driven content is served under the `/pages/` path prefix.
- **Dynamic Route:** A single generic dynamic route `src/routes/pages/[...path]/` handles all content pages.
- **Server Logic (`+page.server.js`):** The server load function for this route:
    - Parses the `params.path` array.
    - Uses helpers from `navigationTree.ts` (`findNodeByUrl`) to locate the corresponding node in the site structure.
    - Uses the `contentSlug` from the node and helpers from `markdownContent.js` (`getContentFilePath`, `readContentFile`) to read the `.md` and render it to HTML.
    - Passes the navigation node data and the rendered HTML (`pageContent`) to the page component.
    - Includes an `entries()` function that uses `getPrerenderEntries` from `navigationTree.ts` to tell SvelteKit which content pages to prerender during the build.
- **Page Component (`+page.svelte`):** The generic page component:
    - Receives the `node` and `pageContent` data.
    - Renders the page title from `node.title`.
    - Renders the sub-navigation dynamically if `node.children` exists.
    - Renders the raw `pageContent` using `{@html ...}`.
- **Other Routes:** Standard SvelteKit routes (e.g., `/login`, `/admin`) can be created at the root level without conflicting with the `/pages/[...path]` catch-all.

### (Future) Svelte Component Injection / typed blocks

- **Concept:** Embed interactive Svelte components inside Markdown content — the federation goal (see `FEDERATION.md` / `PRIOR-ART.md`). The intended approach is the mdsvex / typed-fenced-block pattern used by donhopkins.com (e.g. ` ```chart ` → a component), rather than HTML-comment markers.
- **Status:** Not yet implemented in this app. The old `<!-- SVELTE_COMPONENT:Name -->` marker + `readAndParseContentFile` approach was removed with Jekyll; it will be reintroduced via the shared content package.
- **Page Rendering:** The generic `src/routes/pages/[...path]/+page.svelte` has commented-out logic and a component registry (`injectableRegistry`) to render this array, using `{@html}` for HTML parts and `<svelte:component>` for component parts.
- **Current Status:** **Disabled by default.** The server `load` function currently calls `readContentFile` (loading raw HTML) and returns `isParsed: false`. Component injection is **not active**.
- **Enabling (Future):** To enable this for a specific page, you would need to:
    1.  Add metadata (e.g., `injectComponents: true`) to the page's node in `navigationTree.js`.
    2.  Modify the `load` function in `src/routes/pages/[...path]/+page.server.js` to check this metadata and call `readAndParseContentFile` instead of `readContentFile`, returning `isParsed: true`.
    3.  Ensure the required Svelte components are registered in `injectableRegistry` in `src/routes/pages/[...path]/+page.svelte`.
# Natural city founding

New `city-model --start-map natural` runs record `autoBuildRules: 1`.
Automatic construction pays for non-destructive clearing, roads, wires and
buildings in one funded transaction. With no roads, the first lot seeds a road;
before the first generator, lots join an unpowered conductive network. A coal or
nuclear plant can start that grid, including before the next simulation scan.
No power is granted to off-grid zones. Failed placement returns
`failureReason: insufficient-funds` or `no-connected-site`.

Historical protocols without this field retain rules 0 during replay and resume,
including their original zero-build outcomes. Unsupported rule versions are
rejected. To use founding behavior for an existing blocked run, start a new free
run number rather than overwriting or resuming the historical protocol. Haight
and simulation profiles retain their existing placement and simulation rules.
