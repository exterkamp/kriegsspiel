import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

export default defineConfig({
  resolve: {
    alias: {
      '@kriegsspiel/maps': fileURLToPath(new URL('../packages/maps/src/index.ts', import.meta.url)),
      '@kriegsspiel/engine': fileURLToPath(
        new URL('../packages/engine/src/index.ts', import.meta.url),
      ),
      '@kriegsspiel/protocol': fileURLToPath(
        new URL('../packages/protocol/src/index.ts', import.meta.url),
      ),
    },
  },
});
