import type { PgBoss } from 'pg-boss'
import { logger } from '../logger.ts'
import {
  recomputeAllAbcClasses,
  runDueCountSchedules,
  scanOversellTriggers,
} from '../modules/counts/counts.service.ts'
import { expireDueLots } from '../modules/loyalty/loyalty.service.ts'

export const LOYALTY_EXPIRY_QUEUE = 'loyalty-expiry'

/** Daily at 00:05 Africa/Accra; `missed: 'once'` catches up after an outage. */
export const LOYALTY_EXPIRY_CRON = '5 0 * * *'

/**
 * Phase 12 cycle-count jobs (P12-D34). All three are idempotent: the count
 * worker is guarded by `next_due_at` and the partial unique on `schedule_id`,
 * the ABC recompute is an upsert, and the trigger scan is guarded by the
 * partial unique on `trigger_product_id`.
 */
export const INVENTORY_COUNT_SCHEDULE_QUEUE = 'inventory-count-schedule'
export const INVENTORY_COUNT_SCHEDULE_CRON = '0 2 * * *'
export const INVENTORY_ABC_RECOMPUTE_QUEUE = 'inventory-abc-recompute'
export const INVENTORY_ABC_RECOMPUTE_CRON = '0 3 * * *'
export const INVENTORY_TRIGGER_SCAN_QUEUE = 'inventory-trigger-scan'
export const INVENTORY_TRIGGER_SCAN_CRON = '30 3 * * *'

/**
 * Phase 13 payment jobs (P13-D16). Both are idempotent: the refund job re-reads
 * `refund_tender.status` and does nothing unless it is `PENDING`, and the
 * reconcile sweep only touches payments that have been `PENDING` for more than
 * ten minutes. Their workers and schedules are registered in Plans 05 and 07
 * with the code they run.
 */
export const POS_REFUND_DISPATCH_QUEUE = 'pos-refund-dispatch'
export const POS_PAYMENT_RECONCILE_QUEUE = 'pos-payment-reconcile'
/** Nightly at 01:20 Africa/Accra, after the inventory jobs, before the sweep is due. */
export const POS_PAYMENT_RECONCILE_CRON = '20 1 * * *'

/** Accra is UTC+0 all year, but the zone is named rather than assumed. */
export const INVENTORY_JOB_TZ = 'Africa/Accra'

async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  const existing = await boss.getQueue(name)
  if (!existing) await boss.createQueue(name)
}

/** Registers queues, workers, and schedules on a started pg-boss instance. */
export async function registerJobHandlers(boss: PgBoss): Promise<void> {
  await ensureQueue(boss, LOYALTY_EXPIRY_QUEUE)
  await ensureQueue(boss, INVENTORY_COUNT_SCHEDULE_QUEUE)
  await ensureQueue(boss, INVENTORY_ABC_RECOMPUTE_QUEUE)
  await ensureQueue(boss, INVENTORY_TRIGGER_SCAN_QUEUE)

  await boss.work(LOYALTY_EXPIRY_QUEUE, async () => {
    const summary = await expireDueLots()
    logger.info({ queue: LOYALTY_EXPIRY_QUEUE, ...summary }, 'loyalty expiry run complete')
    return summary
  })

  await boss.work(INVENTORY_COUNT_SCHEDULE_QUEUE, async () => {
    const summary = await runDueCountSchedules()
    logger.info(
      { queue: INVENTORY_COUNT_SCHEDULE_QUEUE, ...summary },
      'count schedule run complete',
    )
    return summary
  })

  await boss.work(INVENTORY_ABC_RECOMPUTE_QUEUE, async () => {
    const summary = await recomputeAllAbcClasses()
    logger.info({ queue: INVENTORY_ABC_RECOMPUTE_QUEUE, ...summary }, 'ABC recompute complete')
    return summary
  })

  await boss.work(INVENTORY_TRIGGER_SCAN_QUEUE, async () => {
    const summary = await scanOversellTriggers()
    logger.info(
      { queue: INVENTORY_TRIGGER_SCAN_QUEUE, ...summary },
      'oversell trigger scan complete',
    )
    return summary
  })

  await boss.schedule(LOYALTY_EXPIRY_QUEUE, LOYALTY_EXPIRY_CRON, null, {
    tz: 'Africa/Accra',
    missed: 'once',
  })

  for (const schedule of [
    {
      queue: INVENTORY_COUNT_SCHEDULE_QUEUE,
      cron: INVENTORY_COUNT_SCHEDULE_CRON,
    },
    {
      queue: INVENTORY_ABC_RECOMPUTE_QUEUE,
      cron: INVENTORY_ABC_RECOMPUTE_CRON,
    },
    {
      queue: INVENTORY_TRIGGER_SCAN_QUEUE,
      cron: INVENTORY_TRIGGER_SCAN_CRON,
    },
  ] as const) {
    await boss.schedule(schedule.queue, schedule.cron, null, {
      tz: INVENTORY_JOB_TZ,
      missed: 'once',
    })
    logger.info(
      { queue: schedule.queue, cron: schedule.cron, tz: INVENTORY_JOB_TZ },
      'inventory job schedule registered',
    )
  }

  logger.info(
    { queue: LOYALTY_EXPIRY_QUEUE, cron: LOYALTY_EXPIRY_CRON, tz: 'Africa/Accra' },
    'loyalty expiry schedule registered',
  )
}
