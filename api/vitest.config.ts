import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    environment: 'node',
    setupFiles: ['./test/setup.ts'],
    include: ['src/**/*.test.ts'],
    restoreMocks: true,
    // Integration suites share one gikautos_test database; run files serially
    // so fixtures like the last-active-admin assertion stay deterministic.
    fileParallelism: false,
  },
})
