import { PgBoss } from 'pg-boss'
import { env } from '../config/env.ts'
import { logger } from '../logger.ts'

let boss: PgBoss | null = null

/**
 * Starts the shared pg-boss instance against the API database. pg-boss installs
 * and migrates its own `pgboss` schema on first boot; `attempts` rides out a
 * database that is still coming up (about 2.5 minutes with backoff).
 */
export async function startBoss(): Promise<PgBoss> {
  if (boss) return boss

  const instance = new PgBoss({
    connectionString: env.DATABASE_URL,
    instanceName: 'api',
  })
  instance.on('error', (error) => logger.error({ err: error }, 'pg-boss error'))
  instance.on('warning', (warning) => logger.warn({ warning }, 'pg-boss warning'))

  await instance.start({ attempts: 10 })
  boss = instance
  logger.info('pg-boss started')
  return instance
}

/** Stops the shared instance, giving active jobs a short grace window. */
export async function stopBoss(): Promise<void> {
  const instance = boss
  if (!instance) return
  boss = null
  await instance.stop({ timeout: 5_000 })
  logger.info('pg-boss stopped')
}
