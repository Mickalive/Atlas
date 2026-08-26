import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    include: ['test/**/*.test.ts'],
    environment: 'node',
    // Deterministic pacing uses seeded PRNGs, so parallel execution is safe.
  },
});
