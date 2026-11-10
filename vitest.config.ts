import { defineConfig } from 'vitest/config';
import { resolve } from 'node:path';

export default defineConfig({
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@shared': resolve(__dirname, 'src/shared'),
    },
  },
  test: {
    environment: 'node',
    include: ['tests/**/*.test.ts'],
    setupFiles: ['tests/setup-generation-authorization.ts'],
    // The full suite runs ~4.4k tests on 4 workers; sql.js FileDatabase snapshots, real child processes and
    // ffmpeg probes can be 3-5x slower than in isolation. The 5 s default turned load into false failures
    // (licensing, pipeline-cache, director-batch). Assertions are unaffected; only the time budget changes.
    testTimeout: 20_000,
    hookTimeout: 30_000,
  },
});
