import type { DbExecutor } from '@sceptre/db'
import { evatDueAt } from '@sceptre/shared'
import { env } from '../../config/env.ts'
import { AppError } from '../../http/errors.ts'
import * as settingsService from '../platform/settings.service.ts'
import {
  findRefundDocument,
  findSaleDocument,
  findSubmissionByRefundId,
  findSubmissionBySaleId,
  insertQueuedSubmission,
} from './evat.repository.ts'

/**
 * Queueing and certification (P14-D34 … P14-D40).
 *
 * The database is the queue and the pg-boss job is the doorbell: a submission
 * row is written inside the transaction that writes the document, so a crash
 * between the commit and the enqueue loses nothing but a notification.
 *
 * Nothing here writes to `sale` or `refund`. The certificate is a separate
 * fact that lives beside the document and never inside it, which is what makes
 * "certification leaves the document byte-identical" provable rather than
 * promised.
 */

/** The configured provider's name, read without constructing it: queueing must never fail. */
function providerName(): string {
  return env.EVAT_PROVIDER === 'gra' ? 'GRA' : 'MOCK'
}

/**
 * Queues a sale's invoice inside the caller's transaction. Returns the new
 * submission id, or null when there is nothing to enqueue: the flag is off, the
 * sale already has a submission, or a concurrent upload won the insert.
 *
 * `flag.evatSubmission` false stops the *intake*. It does not stop a row that
 * already exists from being certified: a flag turns off the queue, not the
 * obligation (P14-D40).
 */
export async function queueForSale(saleId: string, executor: DbExecutor): Promise<string | null> {
  const enabled = await settingsService.getSettingValue('flag.evatSubmission', {}, executor)
  if (!enabled) return null

  const existing = await findSubmissionBySaleId(saleId, executor)
  if (existing) return null

  const saleRow = await findSaleDocument(saleId, executor)
  if (!saleRow) {
    throw new AppError(500, 'EVAT_SALE_MISSING', 'The sale this submission names does not exist')
  }

  const inserted = await insertQueuedSubmission(
    {
      kind: 'INVOICE',
      branchId: saleRow.branchId,
      terminalId: saleRow.terminalId,
      saleId,
      refundId: null,
      status: 'QUEUED',
      dueAt: evatDueAt(saleRow.occurredAt),
      provider: providerName(),
    },
    executor,
  )
  if (inserted) return inserted.id

  // A concurrent upload of the same sale won the partial unique; the replay is
  // a no-op and the existing row is the answer.
  return (await findSubmissionBySaleId(saleId, executor))?.id ?? null
}

/**
 * Queues a refund's credit note. A refund can only be certified against a
 * certified invoice (GRA `E701` otherwise), so a refund whose sale has not
 * certified starts as `WAITING_FOR_INVOICE` rather than failing (P14-D37):
 * retrying an uncertified invoice forever would be a self-inflicted outage.
 */
export async function queueForRefund(
  refundId: string,
  executor: DbExecutor,
): Promise<string | null> {
  const enabled = await settingsService.getSettingValue('flag.evatSubmission', {}, executor)
  if (!enabled) return null

  const existing = await findSubmissionByRefundId(refundId, executor)
  if (existing) return null

  const refundRow = await findRefundDocument(refundId, executor)
  if (!refundRow) {
    throw new AppError(
      500,
      'EVAT_REFUND_MISSING',
      'The refund this submission names does not exist',
    )
  }

  const invoice = await findSubmissionBySaleId(refundRow.saleId, executor)
  const status = invoice?.status === 'CERTIFIED' ? 'QUEUED' : 'WAITING_FOR_INVOICE'

  const inserted = await insertQueuedSubmission(
    {
      kind: 'REFUND',
      branchId: refundRow.branchId,
      terminalId: refundRow.terminalId,
      saleId: null,
      refundId,
      status,
      dueAt: evatDueAt(refundRow.occurredAt),
      provider: providerName(),
    },
    executor,
  )
  if (inserted) return inserted.id

  return (await findSubmissionByRefundId(refundId, executor))?.id ?? null
}
