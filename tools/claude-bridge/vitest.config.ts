import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: { include: ['tools/claude-bridge/*.test.ts'], environment: 'node' },
});
