import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { z } from 'zod'

const here = dirname(fileURLToPath(import.meta.url))

// Load the repository-root .env regardless of the workspace the API runs from.
config({ path: resolve(here, '../../../.env'), quiet: true })

function csv(value: string): string[] {
  return value
    .split(',')
    .map((item) => item.trim())
    .filter((item) => item.length > 0)
}

/** Treats empty or whitespace-only values as absent (common in .env templates). */
function optionalNonEmpty(schema: z.ZodString) {
  return z.preprocess(
    (value) => (typeof value === 'string' && value.trim().length === 0 ? undefined : value),
    schema.optional(),
  )
}

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  BETTER_AUTH_SECRET: z.string().min(32),
  BETTER_AUTH_URL: z.string().url().optional(),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().default(''),
  ADMIN_URL: z.string().url().default('http://localhost:3000'),
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  STAFF_ID_PREFIX: z.string().min(1).max(8).default('GA'),
  STAFF_ID_START: z.coerce.number().int().positive().default(1),
  RESEND_API_KEY: optionalNonEmpty(z.string().min(1)),
  EMAIL_FROM: z.string().min(1).default('GikAutos <no-reply@gikautos.local>'),
  // --- POS device auth / PowerSync ---
  // Instance URL of the PowerSync service. Absent means "sync not configured":
  // the token endpoint answers 503 instead of the API refusing to boot.
  POWERSYNC_URL: optionalNonEmpty(z.string().url()),
  // Must match the `client_auth.audience` of the PowerSync service.
  POWERSYNC_AUDIENCE: optionalNonEmpty(z.string().min(1)),
  // base64url-encoded PKCS8 Ed25519 private key. Required in production;
  // development and test generate an ephemeral key and warn once.
  POS_JWT_PRIVATE_KEY: optionalNonEmpty(z.string().min(1)),
  POS_JWT_KEY_ID: z.string().min(1).max(64).default('pos-v1'),
  POS_JWT_TTL_SECONDS: z.coerce.number().int().min(60).max(86_400).default(900),
})

const parsed = envSchema.safeParse(process.env)

if (!parsed.success) {
  const issues = parsed.error.issues
    .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
    .join('\n')
  console.error(`Invalid environment configuration:\n${issues}`)
  process.exit(1)
}

const data = parsed.data

if (data.NODE_ENV === 'production') {
  const secret = data.BETTER_AUTH_SECRET
  if (!secret || secret.length < 32 || secret.startsWith('replace-')) {
    console.error('BETTER_AUTH_SECRET must be a random 32+ byte secret in production')
    process.exit(1)
  }
  if (data.CORS_ORIGINS.trim().length === 0) {
    console.error('CORS_ORIGINS must list the allowed browser origins in production')
    process.exit(1)
  }
  if (!data.POS_JWT_PRIVATE_KEY) {
    console.error(
      'POS_JWT_PRIVATE_KEY is required in production (run `bun run --filter api keys:generate`)',
    )
    process.exit(1)
  }
}

export const env = {
  ...data,
  corsOrigins: csv(data.CORS_ORIGINS),
  trustedOrigins: csv(data.BETTER_AUTH_TRUSTED_ORIGINS),
} as const

export type Env = typeof env
