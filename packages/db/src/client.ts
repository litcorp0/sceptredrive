import { drizzle } from 'drizzle-orm/node-postgres'
import { Pool } from 'pg'
import { dbEnv } from './env.ts'

export const pool = new Pool({
  connectionString: dbEnv.databaseUrl,
  max: dbEnv.poolMax,
})

export const db = drizzle({ client: pool })

export type Database = typeof db

/** An open transaction handle as passed to `db.transaction` callbacks. */
export type DbTransaction = Parameters<Parameters<Database['transaction']>[0]>[0]

/** A pooled connection or an open transaction. */
export type DbExecutor = Database | DbTransaction

export async function checkDb(): Promise<void> {
  await pool.query('select 1')
}

export async function closeDb(): Promise<void> {
  await pool.end()
}
