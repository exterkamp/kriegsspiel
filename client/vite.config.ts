import { fileURLToPath } from 'node:url';
import { defineConfig, type Plugin } from 'vite';

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
  plugins: [adminRedirect],
  build: {
    rollupOptions: {
      input: {
        main: fileURLToPath(new URL('index.html', import.meta.url)),
        admin: fileURLToPath(new URL('admin/index.html', import.meta.url)),
      },
    },
  },
  // `/games` (REST and WebSocket) goes to the game server, so the page needs no CORS or host config.
  server: {
    allowedHosts: true,
    proxy: {
      '/games': { target: process.env.API_URL ?? 'http://localhost:3000', ws: true },
      '/admin/api': { target: process.env.API_URL ?? 'http://localhost:3000' },
    },
  },
  resolve: {
    alias: {
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
