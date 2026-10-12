# Micropolis CLI

One CLI exposes the Micropolis modules for humans, scripts, terminal agents, and external tools.

```bash
pnpm run micropolis -- about --format yaml
pnpm run micropolis -- api --format yaml
pnpm run micropolis -- city info ../../../content/micropolis/cities/haight.cty --format yaml
pnpm run micropolis -- city export ../../../content/micropolis/cities/haight.cty --include-map --format csv
pnpm run micropolis -- sim smoke --ticks 10 --format yaml
pnpm run micropolis sim run --city /cities/haight.cty --seed 42 --ticks 30000 --speed 3 --no-disasters
pnpm --filter dipolis run dipolis -- sim series --scenario notstand-v4 --levels 0,1,2,3 --adapter fake
pnpm run micropolis -- bus list --format yaml
```

`sim series` runs Notstand-Dilemma model runs sequentially with the same assignment, duration, seed, and crisis options at each rescue-pressure level. Its default adapter is `fake`, which makes no network calls; select `--adapter openai` only when model calls are intended.

## Tree

- `entry.ts` registers the top-level command tree.
- `meta/` exposes `about` and `api` introspection.
- `lib/format.ts` handles JSON, YAML, and CSV output.
- `constants/` holds Micropolis constants shared by city-file tools.
- `city/` handles `.cty` parsing, editing, analysis, and visualization.
- `wasm/` exposes headless simulator commands using `src/lib/wasm/node.ts`.
- `bus/` exposes command-bus workflows from the terminal.

Browser startup uses `src/lib/wasm/browser.ts`; Node and browser loaders share heap/view/callback helpers under `src/lib/wasm/`.

Use YAML for LLM-facing structured output, JSON for strict machine consumers, CSV for tabular exports, and text for human terminal inspection.
