import { defineConfig } from 'vite';
import { sveltekit } from '@sveltejs/kit/vite';
import topLevelAwait from "vite-plugin-top-level-await";
import { viteStaticCopy } from "vite-plugin-static-copy";
import { fileURLToPath } from 'node:url';
import { cityRunsPlugin } from './vite-plugins/city-runs';
import { LiveRunManager, liveRunHandlers } from './vite-plugins/live-runs';

const modelRunsDirectory = fileURLToPath(new URL('../../docs/results/model-runs', import.meta.url));
// The runner process is only started on request from /replay; nothing runs at server start.
const liveRuns = new LiveRunManager({
  appDirectory: fileURLToPath(new URL('.', import.meta.url)),
  outputDirectory: modelRunsDirectory,
  configFile: fileURLToPath(new URL('../../.env.city-model', import.meta.url)),
});

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
    cityRunsPlugin({ directory: modelRunsDirectory,
      archives: { 'v3-pods': fileURLToPath(new URL('../../docs/results/v3-pods-runs', import.meta.url)) },
      extra: [liveRunHandlers(liveRuns)], onClose: () => liveRuns.stop() }),
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
        ...['model-runs', 'v3-pods-runs', 'review-acceptance'].map((directory) => ({
          src: `../../docs/results/${directory}/*.html`,
          dest: `reports/${directory}`,
        })),
      ]
    }),
  ],
  server: {
    watch: { ignored: ['**/build/**'] },
    port: process.env.VITE_PORT ? parseInt(process.env.VITE_PORT) : 5177
  },
});
