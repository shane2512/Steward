import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['packages/*/test/**/*.test.ts', 'apps/*/test/**/*.test.ts'],
    exclude: ['**/node_modules/**', 'spikes/**'],
    // DB tests share one steward_test database; run files serially.
    fileParallelism: false,
  },
});
