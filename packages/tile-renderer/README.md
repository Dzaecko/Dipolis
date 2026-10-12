# @micropolis/tile-renderer

Dipolis Canvas/WebGL/WebGPU tile backends and software map export. The internal
package name preserves engine-port compatibility.

The only runtime dependency is `@micropolis/render-core` (`workspace:*`).
Dipolis consumes TypeScript source exports directly; building `dist` is not
required before app tests.

```bash
pnpm --filter @micropolis/render-core run build
pnpm --filter @micropolis/tile-renderer run build
pnpm --filter @micropolis/tile-renderer run test
```

See [simulation references and upstream provenance](../../documentation/README.md).
