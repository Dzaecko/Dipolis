# @micropolis/render-core

Dipolis viewport, map composition, render descriptions, measurement, software
raster, and WebGPU compositor. Internal package names preserve port API
compatibility.

There are no runtime package dependencies. TypeScript, WebGPU types, and Vitest
are development tools. The tile renderer and app consume TypeScript source
exports, so no separate library build is required before app tests.

```bash
pnpm --filter @micropolis/render-core run build
pnpm --filter @micropolis/render-core run test
```

See [simulation references and upstream provenance](../../documentation/README.md).
