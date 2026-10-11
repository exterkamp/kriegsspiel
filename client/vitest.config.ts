import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

/**
 * Runs the framework-free `*.test.ts` suites under `src/legacy`. The Angular components are tested with
 * `ng test` (`*.spec.ts`, see angular.json), which uses its own build.
 */
export default defineConfig({
  test: { include: ['src/**/*.test.ts'] },
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
