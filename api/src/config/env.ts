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

const baseEnvSchema = z.object({
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
  EMAIL_FROM: z.string().min(1).default('Sceptre Drive <no-reply@sceptre.local>'),
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
  // --- Paystack (Ghana) ---
  // `mock` needs no credentials; `test` and `live` select the real provider
  // (P13-D10). The refinements below refuse to boot when a non-mock mode is
  // missing the credential it needs.
  PAYSTACK_MODE: z.enum(['mock', 'test', 'live']).default('mock'),
  PAYSTACK_SECRET_KEY: optionalNonEmpty(z.string().min(8)),
  PAYSTACK_WEBHOOK_SECRET: optionalNonEmpty(z.string().min(8)),
  PAYSTACK_BASE_URL: z.string().url().default('https://api.paystack.co'),
  // Routing label for the provider's mandatory email field, never a contact
  // channel (P13-D7). Phase 15 points this at a domain the business owns.
  PAYSTACK_EMAIL_DOMAIN: z.string().min(3).default('sceptre-drive.example'),
})

/**
 * The payment credentials fail closed at boot, and the message names the
 * variable: a missing key must not surface later as a 500 from the first charge.
 */
const envSchema = baseEnvSchema.superRefine((value, ctx) => {
  if (value.PAYSTACK_MODE !== 'mock' && !value.PAYSTACK_SECRET_KEY) {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYSTACK_SECRET_KEY'],
      message: `PAYSTACK_SECRET_KEY is required when PAYSTACK_MODE is '${value.PAYSTACK_MODE}'`,
    })
  }
  if (value.PAYSTACK_MODE === 'live' && value.NODE_ENV !== 'production') {
    ctx.addIssue({
      code: 'custom',
      path: ['PAYSTACK_MODE'],
      message: "PAYSTACK_MODE='live' is only allowed when NODE_ENV=production",
    })
  }
})

export type ParsedEnv = z.infer<typeof envSchema>

/**
 * Parses and validates the environment without touching the process, so the
 * fail-closed rules can be asserted in a test. The module-level load below is
 * the only caller that turns a failure into an exit.
 */
export function parseEnv(source: NodeJS.ProcessEnv): ParsedEnv {
  const parsed = envSchema.safeParse(source)
  if (!parsed.success) {
    const issues = parsed.error.issues
      .map((issue) => `  - ${issue.path.join('.') || '(root)'}: ${issue.message}`)
      .join('\n')
    throw new Error(`Invalid environment configuration:\n${issues}`)
  }
  return parsed.data
}

function loadEnv(source: NodeJS.ProcessEnv): ParsedEnv {
  try {
    return parseEnv(source)
  } catch (error) {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  }
}

const data = loadEnv(process.env)

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

/**
 * Origins that only exist while developing: the admin console, the desktop
 * renderer's Vite server, and an unpackaged Electron build. Production must list
 * its own (`CORS_ORIGINS` is required there, above).
 *
 * These are added rather than left to the operator because the failure mode is
 * invisible: the browser sends `OPTIONS`, the API answers 204, and no POST is
 * ever made — the API log shows a healthy preflight and the terminal simply does
 * nothing.
 */
const DEV_CORS_ORIGINS = [
  'http://localhost:3000',
  'http://localhost:5173',
  'http://localhost:4000',
  'app://sceptre-drive',
] as const

const corsOrigins =
  data.NODE_ENV === 'production'
    ? csv(data.CORS_ORIGINS)
    : [...new Set([...csv(data.CORS_ORIGINS), ...DEV_CORS_ORIGINS])]

export const env = {
  ...data,
  corsOrigins,
  trustedOrigins: csv(data.BETTER_AUTH_TRUSTED_ORIGINS),
  /**
   * Paystack signs webhooks with the secret key; the dedicated variable exists
   * so a rotation can be staged without changing the charge key. Absent in both
   * places the webhook cannot be verified, so Plan 03 refuses the request
   * rather than trusting an unsigned body.
   */
  paystackWebhookSecret: data.PAYSTACK_WEBHOOK_SECRET ?? data.PAYSTACK_SECRET_KEY ?? null,
} as const

export type Env = typeof env
