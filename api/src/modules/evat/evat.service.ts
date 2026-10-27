import { type DbExecutor, db } from '@sceptre/db'
import {
  certificateProblem,
  EVAT_ERROR_CODES,
  EVAT_MAX_ATTEMPTS,
  type EvatCertificate,
  evatDueAt,
  evatRetryDelayMinutes,
  isEvatOverdue,
} from '@sceptre/shared'
import { assertBranchAccess, resolveBranchFilter } from '../../auth/scope.ts'
import { env } from '../../config/env.ts'
import { AppError, ConflictError, NotFoundError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { logger } from '../../logger.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import * as settingsService from '../platform/settings.service.ts'
import {
  type EInvoicingProvider,
  EVAT_SERVICE_CODES,
  type EvatCertification,
  type EvatDocument,
  type EvatSeller,
  getEvatProvider,
} from './evat.provider.ts'
import {
  countSubmissions,
  findBranchForDocument,
  findRefundDocument,
  findSaleDocument,
  findSubmissionByRefundId,
  findSubmissionBySaleId,
  findSubmissionJoinedById,
  findSubmissionRowByIdForUpdate,
  insertQueuedSubmission,
  promoteAllWaitingRefunds,
  promoteWaitingRefundsForSale,
  selectDueSubmissions,
  selectRefundDocumentLines,
  selectRefundDocumentTenders,
  selectSaleDocumentLines,
  selectSaleDocumentTenders,
  selectSubmissionPage,
  selectSubmissionSummary,
  updateSubmission,
} from './evat.repository.ts'
import type {
  EvatCertificateView,
  EvatListFilters,
  EvatListQuery,
  EvatSubmissionJoinedRow,
  EvatSubmissionPage,
  EvatSubmissionRow,
  EvatSubmissionView,
  EvatSummary,
} from './evat.types.ts'

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

// --- The state machine (P14-D36) ---------------------------------------------

/** The delay before the next attempt, from the one ladder in shared. */
function retryAt(from: Date, attempt: number): Date {
  return new Date(from.getTime() + evatRetryDelayMinutes(attempt) * 60_000)
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message.slice(0, 300) : 'The E-VAT provider failed'
}

function attentionPatch(code: string, message: string) {
  return {
    status: 'ATTENTION' as const,
    nextAttemptAt: null,
    lastErrorCode: code,
    lastErrorMessage: message.slice(0, 500),
  }
}

/**
 * The seller's identity is the company's, not the branch's (P14-D38): a blank
 * TIN is refused in the service rather than submitted blank, because GRA would
 * reject it with a code that explains nothing and the 24-hour window would keep
 * running.
 */
function missingSellerIdentity(seller: EvatSeller): string | null {
  if (seller.tin.trim().length === 0) return 'tax.sellerTin'
  if (seller.vatNumber.trim().length === 0) return 'tax.sellerVatNumber'
  return null
}

/**
 * Builds the document from the sale or refund's own rows and the seller
 * settings. No customer name, no phone, no tender reference: GRA needs the
 * transaction, not the person.
 */
async function buildDocument(row: EvatSubmissionRow, executor: DbExecutor): Promise<EvatDocument> {
  const [sellerTin, sellerVatNumber] = await Promise.all([
    settingsService.getSettingValue('tax.sellerTin', {}, executor),
    settingsService.getSettingValue('tax.sellerVatNumber', {}, executor),
  ])

  const branchRow = await findBranchForDocument(row.branchId, executor)
  if (!branchRow) {
    throw new AppError(
      500,
      'EVAT_BRANCH_MISSING',
      'The branch this submission names does not exist',
    )
  }
  const seller: EvatSeller = {
    name: branchRow.name,
    tin: sellerTin,
    vatNumber: sellerVatNumber,
    branchCode: branchRow.code,
    address: branchRow.address,
    city: branchRow.city,
    area: branchRow.area,
    phone: branchRow.phone,
  }

  if (row.kind === 'REFUND') {
    if (!row.refundId) {
      throw new AppError(500, 'EVAT_DOCUMENT_MISSING', 'A refund submission names no refund')
    }
    const refundRow = await findRefundDocument(row.refundId, executor)
    if (!refundRow) {
      throw new AppError(
        500,
        'EVAT_REFUND_MISSING',
        'The refund this submission names does not exist',
      )
    }
    const saleRow = await findSaleDocument(refundRow.saleId, executor)
    if (!saleRow) {
      throw new AppError(500, 'EVAT_SALE_MISSING', 'The sale this refund names does not exist')
    }
    const [lines, tenders, invoice] = await Promise.all([
      selectRefundDocumentLines(row.refundId, executor),
      selectRefundDocumentTenders(row.refundId, executor),
      findSubmissionBySaleId(saleRow.id, executor),
    ])
    return {
      kind: 'REFUND',
      documentNumber: refundRow.number,
      // GRA knows the invoice by the number it issued; our receipt number is
      // only the fallback for a sale that was never submitted.
      originalInvoiceNumber: invoice?.providerInvoiceNumber ?? saleRow.receiptNumber,
      occurredAt: refundRow.occurredAt,
      seller,
      currency: 'GHS',
      calculationType: saleRow.taxMode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE',
      totals: {
        baseMinor: refundRow.baseMinor,
        nhilMinor: refundRow.nhilMinor,
        getfundMinor: refundRow.getfundMinor,
        vatMinor: refundRow.vatMinor,
        totalMinor: refundRow.refundedMinor,
      },
      lines: lines.map((line) => ({
        name: line.productName,
        sku: line.productSku,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineTotalMinor: line.lineTotalMinor,
        taxCategory: line.taxCategory,
      })),
      tenders: tenders.map((tender) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
      })),
    }
  }

  if (!row.saleId) {
    throw new AppError(500, 'EVAT_DOCUMENT_MISSING', 'An invoice submission names no sale')
  }
  const saleRow = await findSaleDocument(row.saleId, executor)
  if (!saleRow) {
    throw new AppError(500, 'EVAT_SALE_MISSING', 'The sale this submission names does not exist')
  }
  const baseMinor = saleRow.totalMinor - saleRow.taxTotalMinor
  if (baseMinor < 0) {
    throw new AppError(500, 'EVAT_TOTALS_INVALID', 'The sale taxes exceed its total')
  }
  const [lines, tenders] = await Promise.all([
    selectSaleDocumentLines(row.saleId, executor),
    selectSaleDocumentTenders(row.saleId, executor),
  ])

  return {
    kind: 'INVOICE',
    documentNumber: saleRow.receiptNumber,
    originalInvoiceNumber: null,
    occurredAt: saleRow.occurredAt,
    seller,
    currency: 'GHS',
    calculationType: saleRow.taxMode === 'EXCLUSIVE' ? 'EXCLUSIVE' : 'INCLUSIVE',
    totals: {
      baseMinor,
      nhilMinor: saleRow.nhilMinor,
      getfundMinor: saleRow.getfundMinor,
      vatMinor: saleRow.vatMinor,
      totalMinor: saleRow.totalMinor,
    },
    lines: lines.map((line) => ({
      name: line.name,
      sku: line.sku,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineTotalMinor: line.totalMinor,
      taxCategory: line.taxCategory,
    })),
    tenders: tenders.map((tender) => ({
      method: tender.method,
      amountMinor: tender.amountMinor,
    })),
  }
}

/** True when the invoice a refund names has certified; false when it has not. */
async function invoiceCertifiedForRefund(
  refundId: string | null,
  executor: DbExecutor,
): Promise<boolean> {
  if (!refundId) return false
  const refundRow = await findRefundDocument(refundId, executor)
  if (!refundRow) return false
  const invoice = await findSubmissionBySaleId(refundRow.saleId, executor)
  return invoice?.status === 'CERTIFIED'
}

/**
 * Writes the eight certificate fields and, for an invoice, releases the refunds
 * that were waiting for it — in the same transaction, so a refund cannot be
 * stranded by a crash between the two writes (P14-D37).
 */
async function certify(
  row: EvatSubmissionRow,
  certificate: EvatCertificate,
  executor: DbExecutor,
): Promise<EvatSubmissionRow | null> {
  const stamp = new Date(certificate.stampedAt)
  const updated = await updateSubmission(
    row.id,
    {
      status: 'CERTIFIED',
      providerInvoiceNumber: certificate.providerInvoiceNumber,
      sdcId: certificate.sdcId,
      serial: certificate.serial,
      signature: certificate.signature,
      internalData: certificate.internalData,
      machineCode: certificate.machineCode,
      stampedAt: stamp,
      qrPayload: certificate.qrPayload,
      certifiedAt: new Date(),
      nextAttemptAt: null,
      lastErrorCode: null,
      lastErrorMessage: null,
    },
    executor,
  )
  if (row.kind === 'INVOICE' && row.saleId) {
    await promoteWaitingRefundsForSale(row.saleId, executor)
  }
  return updated
}

/** A certificate that is missing a field, or whose stamp will not parse, is not a certificate. */
function certificateFailure(
  candidate: Partial<EvatCertificate>,
): { code: string; message: string } | null {
  const problem = certificateProblem(candidate)
  if (problem) return { code: EVAT_SERVICE_CODES.CERTIFICATE_INCOMPLETE, message: problem }
  const stamp = new Date(candidate.stampedAt ?? '')
  if (Number.isNaN(stamp.getTime())) {
    return {
      code: EVAT_SERVICE_CODES.CERTIFICATE_INCOMPLETE,
      message: 'Certificate is missing a valid stampedAt',
    }
  }
  return null
}

/**
 * A provider call cannot be allowed to hold the row lock and a pool connection
 * forever: `EVAT_TIMEOUT_MS` bounds it, and a timeout is "we do not know" rather
 * than a refusal, so it takes the retryable path.
 */
async function certifyWithinTimeout(
  provider: EInvoicingProvider,
  document: EvatDocument,
): Promise<EvatCertification> {
  let timer: ReturnType<typeof setTimeout> | undefined
  try {
    return await Promise.race([
      provider.certify(document),
      new Promise<EvatCertification>((resolve) => {
        timer = setTimeout(
          () =>
            resolve({
              ok: false,
              code: EVAT_SERVICE_CODES.PROVIDER_UNAVAILABLE,
              message: `The E-VAT provider did not answer within ${env.EVAT_TIMEOUT_MS}ms`,
              retryable: true,
            }),
          env.EVAT_TIMEOUT_MS,
        )
      }),
    ])
  } finally {
    if (timer) clearTimeout(timer)
  }
}

/**
 * One attempt, on one row, inside the caller's transaction.
 *
 * `ATTENTION` and `CERTIFIED` are refused rather than resubmitted: an operator
 * releases a stuck document by hand, and a certified one is finished. That is
 * also why the ninth automatic attempt cannot happen — the eighth refusal has
 * already moved the row out of the retryable states.
 */
export async function submit(
  submissionId: string,
  executor: DbExecutor = db,
): Promise<EvatSubmissionRow | null> {
  const row = await findSubmissionRowByIdForUpdate(submissionId, executor)
  if (!row) return null
  if (row.status !== 'QUEUED' && row.status !== 'RETRY' && row.status !== 'WAITING_FOR_INVOICE') {
    return row
  }

  // The candidate list is read outside this transaction, so a second poller may
  // have picked the same row. Under the lock, a ladder that has not elapsed is
  // not ours to spend — otherwise two workers collapse 1/2/5… into 0/0/0 and
  // burn the eight attempts without giving GRA a chance to recover.
  const now = new Date()
  if (row.nextAttemptAt && row.nextAttemptAt.getTime() > now.getTime()) return row

  // A refund may have been promoted by the sweep without its invoice being
  // certified; re-check rather than spend an attempt on a refusal we can see.
  if (
    row.status === 'WAITING_FOR_INVOICE' &&
    !(await invoiceCertifiedForRefund(row.refundId, executor))
  ) {
    return row
  }

  const attempts = row.attempts + 1
  const submittedAt = now
  await updateSubmission(row.id, { status: 'SUBMITTING', attempts, submittedAt }, executor)

  let document: EvatDocument
  try {
    document = await buildDocument(row, executor)
  } catch (error) {
    // A document that cannot be built (a missing row, taxes above the total) is
    // data, not a provider condition. Rolling the transaction back would leave
    // the row `QUEUED` and throw again every five minutes, so it becomes a row
    // a person can see and act on instead of a silent retry.
    return updateSubmission(
      row.id,
      attentionPatch(EVAT_SERVICE_CODES.DOCUMENT_INVALID, messageOf(error)),
      executor,
    )
  }
  const missing = missingSellerIdentity(document.seller)
  if (missing) {
    return updateSubmission(
      row.id,
      attentionPatch(
        EVAT_SERVICE_CODES.SELLER_IDENTITY_MISSING,
        `Set ${missing} in settings before GRA can certify this document`,
      ),
      executor,
    )
  }

  let provider: EInvoicingProvider
  try {
    provider = getEvatProvider()
  } catch (error) {
    return updateSubmission(
      row.id,
      attentionPatch(EVAT_SERVICE_CODES.PROVIDER_NOT_READY, messageOf(error)),
      executor,
    )
  }

  let result: EvatCertification
  try {
    result = await certifyWithinTimeout(provider, document)
  } catch (error) {
    // A thrown provider call is "we do not know", never "refused": the same
    // payload may succeed on the next rung of the ladder.
    result = {
      ok: false,
      code: EVAT_SERVICE_CODES.PROVIDER_UNAVAILABLE,
      message: messageOf(error),
      retryable: true,
    }
  }

  if (result.ok) {
    const failure = certificateFailure(result.certificate)
    if (failure) {
      return updateSubmission(row.id, attentionPatch(failure.code, failure.message), executor)
    }
    return certify(row, result.certificate, executor)
  }

  // A wrong security key is configuration, not a transient refusal: retrying it
  // eight times over twenty hours would only delay the person who must fix it.
  if (result.code === EVAT_ERROR_CODES.INVALID_SECURITY_KEY) {
    return updateSubmission(row.id, attentionPatch(result.code, result.message), executor)
  }

  // `E700` means GRA already signed this document. Creating a second
  // certificate is the one thing we must not do, so the only recoverable path
  // is to adopt the one that exists (research fact 10).
  if (result.code === EVAT_ERROR_CODES.ALREADY_SIGNED) {
    if (!provider.fetchCertificate) {
      return updateSubmission(
        row.id,
        attentionPatch(
          result.code,
          'GRA already has this document and this provider cannot look it up; a person must reconcile it',
        ),
        executor,
      )
    }
    let fetched: EvatCertification | null = null
    try {
      fetched = await provider.fetchCertificate(document.documentNumber)
    } catch {
      fetched = null
    }
    if (!fetched || !fetched.ok) {
      return updateSubmission(
        row.id,
        attentionPatch(
          result.code,
          'GRA already has this document but its certificate could not be retrieved; a person must reconcile it',
        ),
        executor,
      )
    }
    const failure = certificateFailure(fetched.certificate)
    if (failure) {
      return updateSubmission(row.id, attentionPatch(failure.code, failure.message), executor)
    }
    return certify(row, fetched.certificate, executor)
  }

  if (result.retryable && attempts < EVAT_MAX_ATTEMPTS) {
    return updateSubmission(
      row.id,
      {
        status: 'RETRY',
        nextAttemptAt: retryAt(submittedAt, attempts),
        lastErrorCode: result.code,
        lastErrorMessage: result.message.slice(0, 500),
      },
      executor,
    )
  }

  return updateSubmission(row.id, attentionPatch(result.code, result.message), executor)
}

// --- Reads (P14-D40: every submission has a visible state) --------------------

function certificateOf(row: EvatSubmissionJoinedRow): EvatCertificateView | null {
  const {
    providerInvoiceNumber,
    sdcId,
    serial,
    signature,
    internalData,
    machineCode,
    stampedAt,
    qrPayload,
  } = row
  if (
    !providerInvoiceNumber ||
    !sdcId ||
    !serial ||
    !signature ||
    !internalData ||
    !machineCode ||
    !stampedAt ||
    !qrPayload
  ) {
    return null
  }
  return {
    providerInvoiceNumber,
    sdcId,
    serial,
    signature,
    internalData,
    machineCode,
    stampedAt: stampedAt.toISOString(),
    qrPayload,
  }
}

/**
 * `overdue` is derived on every read and never stored: a certified document is
 * finished whatever the clock says, and everything else past `due_at` is late.
 */
function toView(row: EvatSubmissionJoinedRow, now: Date): EvatSubmissionView {
  return {
    id: row.id,
    kind: row.kind,
    status: row.status,
    overdue: row.status !== 'CERTIFIED' && isEvatOverdue(row.dueAt, now),
    attempts: row.attempts,
    branchId: row.branchId,
    terminalId: row.terminalId,
    saleId: row.saleId,
    refundId: row.refundId,
    documentNumber: row.documentNumber,
    dueAt: row.dueAt.toISOString(),
    nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
    provider: row.provider,
    certificate: certificateOf(row),
    lastErrorCode: row.lastErrorCode,
    lastErrorMessage: row.lastErrorMessage,
    submittedAt: row.submittedAt?.toISOString() ?? null,
    certifiedAt: row.certifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** A date-only boundary (midnight UTC = midnight Accra) means the whole day, inclusive. */
function inclusiveEnd(date: Date): Date {
  const isMidnight =
    date.getUTCHours() === 0 &&
    date.getUTCMinutes() === 0 &&
    date.getUTCSeconds() === 0 &&
    date.getUTCMilliseconds() === 0
  return isMidnight ? new Date(date.getTime() + 86_400_000 - 1) : date
}

export async function listSubmissions(
  user: SessionUser,
  query: EvatListQuery,
): Promise<EvatSubmissionPage> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const now = new Date()
  const filters: EvatListFilters = {
    branchId,
    status: query.status,
    kind: query.kind,
    overdue: query.overdue,
    from: query.from,
    to: query.to ? inclusiveEnd(query.to) : undefined,
    limit: query.limit,
    offset: query.offset,
    now,
  }
  const [rows, total] = await Promise.all([
    selectSubmissionPage(filters),
    countSubmissions(filters),
  ])
  return { submissions: rows.map((row) => toView(row, now)), total, branchId }
}

export async function getSubmission(user: SessionUser, id: string): Promise<EvatSubmissionView> {
  const row = await findSubmissionJoinedById(id)
  if (!row) throw new NotFoundError('Submission not found')
  assertBranchAccess(user, row.branchId)
  return toView(row, new Date())
}

/**
 * A manager's retry is refused by the permission, not by this function: the
 * route asks for `evat.retry`, which only an admin holds. This is the
 * administrative release of a stuck document — `attempts` is history and is not
 * reset (P14-D40).
 */
export async function retrySubmission(
  user: SessionUser,
  actor: AuditActor,
  id: string,
): Promise<EvatSubmissionView> {
  await db.transaction(async (tx) => {
    const row = await findSubmissionRowByIdForUpdate(id, tx)
    if (!row) throw new NotFoundError('Submission not found')
    assertBranchAccess(user, row.branchId)
    if (row.status === 'CERTIFIED') {
      throw new ConflictError('A certified submission cannot be retried')
    }
    if (row.status === 'SUBMITTING') {
      throw new ConflictError('This submission is being submitted right now')
    }

    // Retrying a refund whose invoice has not certified must not queue it: the
    // attempt would be spent on a refusal GRA is right to make (E701), and with
    // a lenient provider a credit note could exist before its invoice.
    const waiting = row.kind === 'REFUND' && !(await invoiceCertifiedForRefund(row.refundId, tx))
    const status = waiting ? 'WAITING_FOR_INVOICE' : 'QUEUED'
    const nextAttemptAt = waiting ? null : new Date()
    await updateSubmission(id, { status, nextAttemptAt }, tx)
    await writeAudit(
      {
        ...actor,
        action: 'evat.submission.retried',
        entity: 'evat_submission',
        entityId: id,
        branchId: row.branchId,
        before: {
          status: row.status,
          attempts: row.attempts,
          nextAttemptAt: row.nextAttemptAt?.toISOString() ?? null,
        },
        after: { status, nextAttemptAt: nextAttemptAt?.toISOString() ?? null },
      },
      tx,
    )
  })

  return getSubmission(user, id)
}

export async function getSummary(user: SessionUser): Promise<EvatSummary> {
  const branchId = resolveBranchFilter(user, null)
  const counts = await selectSubmissionSummary(branchId)
  const now = Date.now()
  return {
    queued: counts.queued,
    certified: counts.certified,
    retrying: counts.retrying,
    attention: counts.attention,
    overdue: counts.overdue,
    oldestOverdueMinutes: counts.oldestDueAt
      ? Math.max(0, Math.floor((now - counts.oldestDueAt.getTime()) / 60_000))
      : null,
  }
}

// --- Health (P14-D40) ---------------------------------------------------------

/** A health check is a provider call; the console may ask, but not per keystroke. */
export const EVAT_HEALTH_CACHE_MS = 60_000

let healthCache: { checkedAt: Date; result: { ok: boolean; detail?: string } } | null = null

export interface EvatHealth {
  ok: boolean
  detail?: string
  checkedAt: string
  /** True when this answer was reused rather than asked for again. */
  cached: boolean
}

/**
 * At most one provider health check a minute. A failure is a failure, not a
 * throw: an unreachable GRA must not make the console page itself look broken,
 * and the detail says what to fix without naming a credential.
 */
export async function checkProviderHealth(now: Date = new Date()): Promise<EvatHealth> {
  if (healthCache && now.getTime() - healthCache.checkedAt.getTime() < EVAT_HEALTH_CACHE_MS) {
    return {
      ...healthCache.result,
      checkedAt: healthCache.checkedAt.toISOString(),
      cached: true,
    }
  }

  let result: { ok: boolean; detail?: string }
  try {
    result = await getEvatProvider().healthCheck()
  } catch (error) {
    result = { ok: false, detail: messageOf(error) }
  }
  healthCache = { checkedAt: now, result }
  return { ...result, checkedAt: now.toISOString(), cached: false }
}

/** Test seam: the cache is process-local, like the provider it caches. */
export function resetEvatHealthCache(): void {
  healthCache = null
}

// --- The worker (P14-D40) -----------------------------------------------------

/** One bounded batch; the next run takes the rest. */
export const EVAT_QUEUE_BATCH = 50

export interface EvatRunSummary {
  promoted: number
  processed: number
  certified: number
  retrying: number
  attention: number
  failed: number
}

/**
 * One worker run: promote refunds whose invoice has certified, then submit the
 * due rows.
 *
 * Every row is its own transaction and its own try/catch, so one bad payload
 * cannot stop the other forty-nine. The log line carries `{ submissionId,
 * status, attempts, code }` and nothing else: the document holds money and a
 * TIN, and a log is storage like any other. A crash before the enqueue of a
 * doorbell is harmless — the row is still `QUEUED`, and the five-minute sweep
 * reads the same table.
 */
export async function processEvatSubmissions(
  options: { limit?: number } = {},
): Promise<EvatRunSummary> {
  const summary: EvatRunSummary = {
    promoted: 0,
    processed: 0,
    certified: 0,
    retrying: 0,
    attention: 0,
    failed: 0,
  }

  try {
    summary.promoted = await db.transaction((tx) => promoteAllWaitingRefunds(tx))
  } catch (error) {
    logger.error(
      { queue: 'evat-submit', error: error instanceof Error ? error.name : 'unknown' },
      'e-vat sweep could not promote waiting refunds',
    )
  }

  const due = await selectDueSubmissions(new Date(), options.limit ?? EVAT_QUEUE_BATCH)
  for (const candidate of due) {
    try {
      const row = await db.transaction((tx) => submit(candidate.id, tx))
      if (!row) {
        summary.failed += 1
        continue
      }
      if (row.status === 'CERTIFIED') summary.certified += 1
      if (row.status === 'RETRY') summary.retrying += 1
      if (row.status === 'ATTENTION') summary.attention += 1
      summary.processed += 1
      logger.info(
        {
          submissionId: row.id,
          status: row.status,
          attempts: row.attempts,
          code: row.lastErrorCode ?? null,
        },
        'e-vat submission processed',
      )
    } catch (error) {
      summary.failed += 1
      logger.error(
        {
          submissionId: candidate.id,
          error: error instanceof Error ? error.name : 'unknown',
        },
        'e-vat submission failed; the next sweep will retry it',
      )
    }
  }

  return summary
}
