import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import topLevelAwait from "vite-plugin-top-level-await";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from 'node:url';
import { cityRunsPlugin } from './vite-plugins/city-runs';

const modelRunsDirectory = fileURLToPath(new URL('../../docs/results/model-runs', import.meta.url));

export default defineConfig({
  ssr: {
    noExternal: ['@micropolis/render-core', '@micropolis/tile-renderer']
  },
  optimizeDeps: {
    // Workspace packages must stay out of the prebundle cache or HMR serves stale classes
    // missing methods like syncViewportScreenScale / panToKeepWorldAtScreen.
    exclude: ['@micropolis/render-core', '@micropolis/tile-renderer'],
  },
  plugins: [
    cityRunsPlugin({ directory: modelRunsDirectory }),
    sveltekit(),
    topLevelAwait(),
    viteStaticCopy({
      // Copy the built webassembly module and data into place.
      targets: [
        {
          src: "src/lib/micropolisengine.wasm",
          dest: ".",
        },
        {
          src: "src/lib/micropolisengine.data",
          dest: ".",
        },
      ]
    }),
  ],
  server: {
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5177
  },
});
