import { defineConfig } from 'drizzle-kit'
import './src/load-env.ts'

const url = process.env.DATABASE_URL
if (!url) {
  throw new Error('DATABASE_URL is required to run drizzle-kit (set it in the repository .env)')
}

export default defineConfig({
  dialect: 'postgresql',
  schema: './src/schema/*.ts',
  out: './migrations',
  dbCredentials: { url },
  strict: true,
  verbose: true,
})
