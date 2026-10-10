import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  server: {
    allowedHosts: true,
    proxy: { '/games': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } },
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
