import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tools/local-map-catalog/*.test.ts'], environment: 'node' },
  resolve: {
    alias: {
      '@kriegsspiel/maps': fileURLToPath(
        new URL('../../packages/maps/src/index.ts', import.meta.url),
      ),
    },
  },
});
