import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'

// `bun run --filter api test` runs with cwd=api, so Bun never loads the repo-root .env.
// Mirror api/src/config/env.ts and read it explicitly; dotenv never overrides real env vars.
config({ path: resolve(dirname(fileURLToPath(import.meta.url)), '../../.env'), quiet: true })

process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ??
  'postgresql://sceptre_drive:sceptre_drive@localhost:5433/sceptre_drive_test'
process.env.CORS_ORIGINS = 'http://localhost:3000'
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'test-only-secret-value-32-characters-minimum'
process.env.ADMIN_EMAIL ??= 'admin@sceptre.test'
process.env.ADMIN_PASSWORD ??= 'test-admin-password-123'
// Device-facing POS endpoints: the PowerSync token endpoint answers 503 when
// this is unset, so the sync suites configure a local instance explicitly.
process.env.POWERSYNC_URL ??= 'http://localhost:8080'
process.env.POWERSYNC_AUDIENCE ??= 'http://localhost:8080'
