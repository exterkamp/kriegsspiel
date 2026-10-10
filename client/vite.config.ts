import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';

export default defineConfig({
  plugins: [svelte()],
  // `/games` (REST and WebSocket) goes to the game server, so the page needs no CORS or host config.
  server: {
    allowedHosts: true,
    proxy: { '/games': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } },
  },
  resolve: {
    // Svelte's client build, not its server build, when vitest runs under jsdom.
    ...(process.env.VITEST ? { conditions: ['browser'] } : {}),
    alias: {
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
