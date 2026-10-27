import type { PgBoss } from 'pg-boss'
import { logger } from '../logger.ts'
import {
  recomputeAllAbcClasses,
  runDueCountSchedules,
  scanOversellTriggers,
} from '../modules/counts/counts.service.ts'
import { expireDueLots } from '../modules/loyalty/loyalty.service.ts'
import { reconcileStaleTransfers } from '../modules/payables/payables.service.ts'
import type { PaymentRow } from '../modules/payments/payments.repository.ts'
import { findStalePending } from '../modules/payments/payments.repository.ts'
import { dispatchPendingRefunds, getPayment } from '../modules/payments/payments.service.ts'
import type { DeviceAuthContext } from '../modules/sync/sync.types.ts'

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
/** Nightly at 01:20 Africa/Accra: the shops are shut and the night is quiet. */
export const POS_PAYMENT_RECONCILE_CRON = '20 1 * * *'

/**
 * The refund sweep. The enqueue after a commit is the fast path; this catches a
 * tender whose enqueue was lost while the process was down (P13-D16, P13-D26).
 */
export const POS_REFUND_DISPATCH_CRON = '*/15 * * * *'

/** Accra is UTC+0 all year, but the zone is named rather than assumed. */
export const INVENTORY_JOB_TZ = 'Africa/Accra'

/**
 * Phase 14 supplier transfers (P14-D31, P14-D47). Every fifteen minutes the
 * sweep verifies the transfers still open after ten minutes. It never finalises
 * an OTP: that is a human's second factor, not a job's.
 */
export const PAYABLES_TRANSFER_RECONCILE_QUEUE = 'payables-transfer-reconcile'
export const PAYABLES_TRANSFER_RECONCILE_CRON = '*/15 * * * *'

/**
 * Phase 14 E-VAT submissions (P14-D40). The database row is the queue; this is
 * the doorbell that wakes the worker early, and the five-minute schedule is the
 * sweep that finds anything whose doorbell was lost.
 */
export const EVAT_SUBMIT_QUEUE = 'evat-submit'
export const EVAT_SUBMIT_CRON = '*/5 * * * *'

async function ensureQueue(boss: PgBoss, name: string): Promise<void> {
  const existing = await boss.getQueue(name)
  if (!existing) await boss.createQueue(name)
}

/**
 * The live boss, published by `registerJobHandlers`. The upload path enqueues
 * through `enqueueRefundDispatch` rather than importing pg-boss, so a process
 * without the job runner (a test, a one-off script) degrades to the sweep.
 */
let jobBoss: PgBoss | null = null

/**
 * Enqueues one refund's provider dispatch. Called **after** the upload
 * transaction commits (P13-D26): a provider call cannot be rolled back with the
 * document, so it never runs inside that transaction. A missing or failing queue
 * is a warning, not a throw — the sweep reads the same rows from the database.
 */
export async function enqueueRefundDispatch(refundId: string): Promise<void> {
  if (!jobBoss) {
    logger.warn(
      { queue: POS_REFUND_DISPATCH_QUEUE, refundId },
      'no queue runner; the refund sweep will dispatch it',
    )
    return
  }
  await jobBoss.send(POS_REFUND_DISPATCH_QUEUE, { refundId })
}

/**
 * Rings the doorbell for one submission. Called **after** the document's
 * transaction commits: the row is already `QUEUED`, so a lost send costs a few
 * minutes, never a submission. The payload carries an id and nothing else — the
 * document holds money and a TIN, and a queue payload is storage like any other.
 */
export async function enqueueEvatSubmission(submissionId: string): Promise<void> {
  if (!jobBoss) {
    logger.warn(
      { queue: EVAT_SUBMIT_QUEUE, submissionId },
      'no queue runner; the five-minute sweep will submit it',
    )
    return
  }
  await jobBoss.send(EVAT_SUBMIT_QUEUE, { submissionId })
}

/** A payment nobody settled within this window is what the sweep exists for. */
export const PAYMENT_RECONCILE_STALE_MINUTES = 10

/** One night, one bounded batch: the next night takes the rest (P13-D16). */
export const PAYMENT_RECONCILE_LIMIT = 200

export interface PaymentReconcileSummary {
  checked: number
  settled: number
  failed: number
}

function deviceForPayment(row: PaymentRow): DeviceAuthContext {
  return { deviceId: row.deviceId, terminalId: row.terminalId, branchId: row.branchId }
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 200) : 'unknown error'
}

/**
 * Verifies the payments no webhook ever settled (P13-D12, P13-D16).
 *
 * The refresh is `getPayment(..., { refresh: true })` — the exact call
 * `GET /api/pos/payments/:id?refresh=1` makes — so the five-second throttle, the
 * row lock and the state machine stay one implementation rather than two. That
 * throttle is also why stale means ten minutes: a payment the till is still
 * polling is not the sweep's business.
 *
 * A failure is per payment and logged without a body, because one stranded
 * reference must not hide the other 199.
 */
export async function reconcileStalePayments(
  options: { olderThanMinutes?: number; limit?: number } = {},
): Promise<PaymentReconcileSummary> {
  const minutes = options.olderThanMinutes ?? PAYMENT_RECONCILE_STALE_MINUTES
  const stale = await findStalePending(
    new Date(Date.now() - minutes * 60_000),
    options.limit ?? PAYMENT_RECONCILE_LIMIT,
  )

  let settled = 0
  let failed = 0

  for (const payment of stale) {
    try {
      const view = await getPayment(deviceForPayment(payment), payment.id, { refresh: true })
      // `getPayment` only acts on PENDING, so anything the webhook already
      // settled arrives here as PAID without a provider call.
      if (view.status === 'PAID') settled += 1
    } catch (error) {
      failed += 1
      logger.warn(
        { paymentId: payment.id, message: errorMessage(error) },
        'payment reconcile failed',
      )
    }
  }

  return { checked: stale.length, settled, failed }
}

/** Registers queues, workers, and schedules on a started pg-boss instance. */
export async function registerJobHandlers(boss: PgBoss): Promise<void> {
  jobBoss = boss

  await ensureQueue(boss, LOYALTY_EXPIRY_QUEUE)
  await ensureQueue(boss, INVENTORY_COUNT_SCHEDULE_QUEUE)
  await ensureQueue(boss, INVENTORY_ABC_RECOMPUTE_QUEUE)
  await ensureQueue(boss, INVENTORY_TRIGGER_SCAN_QUEUE)
  await ensureQueue(boss, POS_REFUND_DISPATCH_QUEUE)
  await ensureQueue(boss, POS_PAYMENT_RECONCILE_QUEUE)
  await ensureQueue(boss, PAYABLES_TRANSFER_RECONCILE_QUEUE)

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

  await boss.work(POS_REFUND_DISPATCH_QUEUE, async () => {
    const summary = await dispatchPendingRefunds()
    logger.info({ queue: POS_REFUND_DISPATCH_QUEUE, ...summary }, 'refund dispatch run complete')
    return summary
  })

  await boss.work(POS_PAYMENT_RECONCILE_QUEUE, async () => {
    const summary = await reconcileStalePayments()
    logger.info(
      { queue: POS_PAYMENT_RECONCILE_QUEUE, ...summary },
      'payment reconcile run complete',
    )
    return summary
  })

  await boss.work(PAYABLES_TRANSFER_RECONCILE_QUEUE, async () => {
    const summary = await reconcileStaleTransfers()
    logger.info(
      { queue: PAYABLES_TRANSFER_RECONCILE_QUEUE, ...summary },
      'transfer reconcile run complete',
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
    {
      // 01:20: the last shift has closed and the night is quiet, before the
      // inventory jobs start (P13-D16).
      queue: POS_PAYMENT_RECONCILE_QUEUE,
      cron: POS_PAYMENT_RECONCILE_CRON,
    },
  ] as const) {
    await boss.schedule(schedule.queue, schedule.cron, null, {
      tz: INVENTORY_JOB_TZ,
      missed: 'once',
    })
    logger.info(
      { queue: schedule.queue, cron: schedule.cron, tz: INVENTORY_JOB_TZ },
      'recurring job schedule registered',
    )
  }

  logger.info(
    { queue: LOYALTY_EXPIRY_QUEUE, cron: LOYALTY_EXPIRY_CRON, tz: 'Africa/Accra' },
    'loyalty expiry schedule registered',
  )

  // The sweep, not the happy path: an immediate enqueue usually wins the race,
  // and this finds anything that was enqueued while the process was down.
  await boss.schedule(POS_REFUND_DISPATCH_QUEUE, POS_REFUND_DISPATCH_CRON, null, {
    tz: INVENTORY_JOB_TZ,
    missed: 'once',
  })
  logger.info(
    { queue: POS_REFUND_DISPATCH_QUEUE, cron: POS_REFUND_DISPATCH_CRON, tz: INVENTORY_JOB_TZ },
    'refund dispatch sweep registered',
  )

  // The transfer sweep: a webhook that never arrived leaves an intent open, and
  // only a verify can tell us whether the money moved (P14-D31).
  await boss.schedule(PAYABLES_TRANSFER_RECONCILE_QUEUE, PAYABLES_TRANSFER_RECONCILE_CRON, null, {
    tz: INVENTORY_JOB_TZ,
    missed: 'once',
  })
  logger.info(
    {
      queue: PAYABLES_TRANSFER_RECONCILE_QUEUE,
      cron: PAYABLES_TRANSFER_RECONCILE_CRON,
      tz: INVENTORY_JOB_TZ,
    },
    'transfer reconcile sweep registered',
  )
}
