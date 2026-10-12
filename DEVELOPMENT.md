# Dipolis development

Use Node.js 22 or newer and the pnpm version pinned in root `package.json`.
Emscripten and GNU make are needed only when rebuilding the C++/WASM engine;
tests can use the committed engine artifacts.

## Workspace inventory

- `apps/dipolis`: city simulation, browser interface, local runners and reports.
- `packages/micropolis-engine`: original simulation core and Dipolis extensions.
- `packages/render-core`: viewport, map composition, software rendering, WebGPU.
- `packages/tile-renderer`: Canvas/WebGL/WebGPU tile backends and map export.

Internal `@micropolis/*` package names preserve engine-port API compatibility.
No other applications or character-rendering packages are part of the workspace.

## Commands

```bash
pnpm install --frozen-lockfile
pnpm run verify:structure
pnpm run check
pnpm run test

# Build the retained renderer packages and app (requires Emscripten for WASM):
pnpm run build
pnpm run build:engine

# Browser-only development using committed WASM:
pnpm --filter dipolis run dev:vite

# App plus watched engine rebuilds (requires Emscripten):
pnpm --filter dipolis run dev
```

Root tests run render-core, tile-renderer, and app suites. The renderer packages
export TypeScript source, so tests do not require a separate library build.
Root build uses pnpm's dependency ordering; the engine build and app's
`prebuild` install matching WASM artifacts before Vite.

The root makefile is an optional wrapper: `make SKIP_DOXYGEN=1` delegates to
`pnpm run build`, `make build_engine` installs engine artifacts, and
`make build_doxygen` generates API documentation from retained engine sources.
`make install` also copies generated API HTML into `apps/dipolis/build/doc`.
Dependencies must already be installed; the makefile never runs installation.

Do not start real model runs as part of structure, build, or test validation.
The local runner configuration is not a prerequisite for these commands.

## CI and provenance

`pr-checks.yml` validates structure, renderer TypeScript builds, app checks, and
tests. `emscripten_build.yml` manually rebuilds WASM and optionally deploys the
Dipolis static build; deployment is disabled by default.

See [documentation inventory and upstream provenance](documentation/README.md).
The original root GPL and name-license notices remain unchanged.
