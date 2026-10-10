import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vite';

export default defineConfig({
  // `/games` (REST and WebSocket) goes to the game server, so the page needs no CORS or host config.
  server: {
    allowedHosts: true,
    proxy: { '/games': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true } },
  },
  resolve: {
    alias: {
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
