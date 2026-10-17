import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { dbEnv } from './env.ts'
import * as schema from './schema/index.ts'

export const pool = new Pool({
  connectionString: dbEnv.databaseUrl,
  max: dbEnv.poolMax,
})

export const db = drizzle({ client: pool, schema })

export type Database = typeof db

export async function checkDb(): Promise<void> {
  await pool.query('select 1')
}

export async function closeDb(): Promise<void> {
  await pool.end()
}
