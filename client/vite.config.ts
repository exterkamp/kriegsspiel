import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        player: fileURLToPath(new URL('./index.html', import.meta.url)),
        mapAuthoring: fileURLToPath(new URL('./map-authoring.html', import.meta.url)),
        mapBenchmark: fileURLToPath(new URL('./map-benchmark.html', import.meta.url)),
      },
    },
  },
  server: { allowedHosts: true },
  resolve: {
    alias: {
      '@kriegsspiel/maps': fileURLToPath(new URL('../packages/maps/src/index.ts', import.meta.url)),
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
