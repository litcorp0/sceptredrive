import type { PgBoss } from 'pg-boss'
import { logger } from '../logger.ts'
import { expireDueLots } from '../modules/loyalty/loyalty.service.ts'

export const LOYALTY_EXPIRY_QUEUE = 'loyalty-expiry'

/** Daily at 00:05 Africa/Accra; `missed: 'once'` catches up after an outage. */
export const LOYALTY_EXPIRY_CRON = '5 0 * * *'
export const LOYALTY_EXPIRY_TZ = 'Africa/Accra'

/** Registers queues, workers, and schedules on a started pg-boss instance. */
export async function registerJobHandlers(boss: PgBoss): Promise<void> {
  const existing = await boss.getQueue(LOYALTY_EXPIRY_QUEUE)
  if (!existing) await boss.createQueue(LOYALTY_EXPIRY_QUEUE)

  await boss.work(LOYALTY_EXPIRY_QUEUE, async () => {
    const summary = await expireDueLots()
    logger.info({ queue: LOYALTY_EXPIRY_QUEUE, ...summary }, 'loyalty expiry run complete')
    return summary
  })

  await boss.schedule(LOYALTY_EXPIRY_QUEUE, LOYALTY_EXPIRY_CRON, null, {
    tz: LOYALTY_EXPIRY_TZ,
    missed: 'once',
  })
  logger.info(
    { queue: LOYALTY_EXPIRY_QUEUE, cron: LOYALTY_EXPIRY_CRON, tz: LOYALTY_EXPIRY_TZ },
    'loyalty expiry schedule registered',
  )
}
