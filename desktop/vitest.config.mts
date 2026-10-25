import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // The renderer imports through `@/…`; tests need the same alias or a module's `utils/`
    // file cannot be imported at all (Plan 08 added the first one with a value import).
    alias: { '@': path.resolve(import.meta.dirname, 'src/renderer') },
  },
  test: {
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    restoreMocks: true,
  },
})
