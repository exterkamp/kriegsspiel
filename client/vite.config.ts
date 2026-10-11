import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';
import type { Plugin } from 'vite';
import { svelte } from '@sveltejs/vite-plugin-svelte';
import { mapCatalogPlugin } from './dev/mapCatalog.js';

/** `/admin` (no slash) is the admin page; Vite would otherwise fall back to the game page. */
const adminRedirect: Plugin = {
  name: 'admin-redirect',
  configureServer(server) {
    server.middlewares.use((req, res, next) => {
      if (req.url === '/admin' || req.url?.startsWith('/admin?')) {
        res.statusCode = 302;
        res.setHeader('location', req.url.replace('/admin', '/admin/'));
        res.end();
      } else next();
    });
  },
};

export default defineConfig({
  plugins: [svelte(), adminRedirect, mapCatalogPlugin()],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin/index.html', import.meta.url)),
        mapAuthoring: fileURLToPath(new URL('./map-authoring.html', import.meta.url)),
        mapBenchmark: fileURLToPath(new URL('./map-benchmark.html', import.meta.url)),
        tableBenchmark: fileURLToPath(new URL('./table-benchmark.html', import.meta.url)),
      },
    },
  },
  // `/games` (REST and WebSocket), `/scenarios` and `/auth` go to the game server, so the page needs no CORS or host
  // config and the session cookie stays on the page's origin.
  server: {
    allowedHosts: true,
    proxy: {
      '/games': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true },
      '/scenarios': { target: process.env.API_URL ?? 'http://localhost:3000' },
      '/admin/api': { target: process.env.API_URL ?? 'http://localhost:3000' },
      '/auth': { target: process.env.API_URL ?? 'http://localhost:3000' },
    },
  },
  resolve: {
    conditions: ['browser'],
    alias: {
      '@kriegsspiel/maps': fileURLToPath(new URL('../packages/maps/src/index.ts', import.meta.url)),
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
