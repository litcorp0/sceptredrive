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

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  API_PORT: z.coerce.number().int().positive().max(65535).default(4000),
  DATABASE_URL: z.string().min(1),
  DATABASE_POOL_MAX: z.coerce.number().int().positive().default(10),
  BETTER_AUTH_SECRET: z.string().optional(),
  BETTER_AUTH_URL: z.string().url().optional(),
  BETTER_AUTH_TRUSTED_ORIGINS: z.string().default(''),
  CORS_ORIGINS: z.string().default(''),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  ADMIN_EMAIL: z.string().email().optional(),
  ADMIN_PASSWORD: z.string().min(12).optional(),
  STAFF_ID_PREFIX: z.string().min(1).max(8).default('GA'),
  STAFF_ID_START: z.coerce.number().int().positive().default(1),
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
}

export const env = {
  ...data,
  corsOrigins: csv(data.CORS_ORIGINS),
  trustedOrigins: csv(data.BETTER_AUTH_TRUSTED_ORIGINS),
} as const

export type Env = typeof env
