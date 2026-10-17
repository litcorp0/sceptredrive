import { dirname, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { config } from 'dotenv'
import { defineConfig } from 'drizzle-kit'

const here = dirname(fileURLToPath(import.meta.url))

// Load the repository-root .env regardless of where the CLI is invoked from.
config({ path: resolve(here, '../.env'), quiet: true })

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required to run drizzle-kit (set it in the repository .env)')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/modules/**/*.schema.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
