process.env.NODE_ENV = 'test'
process.env.LOG_LEVEL = 'silent'
process.env.DATABASE_URL =
  process.env.TEST_DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5433/gikautos_test'
process.env.CORS_ORIGINS = 'http://localhost:3000'
process.env.BETTER_AUTH_TRUSTED_ORIGINS = 'http://localhost:3000'
process.env.BETTER_AUTH_SECRET = 'test-only-secret-value-32-characters-minimum'
process.env.ADMIN_EMAIL ??= 'admin@gikautos.test'
process.env.ADMIN_PASSWORD ??= 'test-admin-password-123'
// Device-facing POS endpoints: the PowerSync token endpoint answers 503 when
// this is unset, so the sync suites configure a local instance explicitly.
process.env.POWERSYNC_URL ??= 'http://localhost:8080'
process.env.POWERSYNC_AUDIENCE ??= 'http://localhost:8080'
