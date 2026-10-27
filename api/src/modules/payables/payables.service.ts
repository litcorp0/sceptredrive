import { randomUUID } from 'node:crypto'
import { type DbExecutor, db } from '@sceptre/db'
import { taxBreakdown, toCsv } from '@sceptre/shared'
import { assertBranchAccess, resolveBranchFilter } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { type CsvExport, csvFilename, enforceExportCap } from '../../http/csv.ts'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { logger } from '../../logger.ts'
import { attachReceiptSupplier, loadReceiptForPayables } from '../inventory/inventory.service.ts'
import type { ReceiptForPayables } from '../inventory/inventory.types.ts'
import * as branchesService from '../org/branches.service.ts'
import {
  getPaymentProvider,
  type ProviderTransferResult,
  ProviderUnavailableError,
} from '../payments/payments.provider.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation, uniqueViolationConstraint } from '../platform/db-errors.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { findOrderById, sumCreditNotesBySupplier } from '../procurement/procurement.repository.ts'
import { getOrderLinesForMatch } from '../procurement/procurement.service.ts'
import { findProductById } from '../products/products.repository.ts'
import { sumSupplierOwed } from '../suppliers/suppliers.repository.ts'
import {
  ensurePaystackRecipient,
  lockSupplier,
  recordInvoiceCosts,
  requirePaymentDetail,
  requireSupplier,
} from '../suppliers/suppliers.service.ts'
import {
  countInvoices,
  countPayments,
  countTransfers,
  findInvoiceById,
  findInvoiceByIdempotency,
  findInvoiceByReceipt,
  findInvoiceBySupplierNumber,
  findPaymentByIdempotency,
  findTransferById,
  findTransferByIdempotency,
  findTransferByReferenceForUpdate,
  insertAllocation,
  insertInvoice,
  insertInvoiceLines,
  insertPayment,
  insertTransfer,
  insertTransferAllocations,
  lockInvoiceForUpdate,
  lockInvoicesForUpdate,
  lockPaymentForUpdate,
  selectAgingInvoiceRows,
  selectAllocationsByInvoice,
  selectAllocationsByPayment,
  selectInvoiceDetailHeader,
  selectInvoicedQuantityByOrderLine,
  selectInvoiceLines,
  selectInvoiceMatchDetail,
  selectInvoicePage,
  selectInvoiceReconciliationRows,
  selectManualPaymentsForReconciliation,
  selectOnAccountBySupplier,
  selectOutstandingBySupplier,
  selectPaymentDetailHeader,
  selectPaymentPage,
  selectSupplierIdsWithActivity,
  selectTransferAllocations,
  selectTransferPage,
  selectTransferReconciliationRows,
  selectTransfersToVerify,
  setInvoiceAmountPaid,
  sumAllocationsForInvoice,
  updateInvoiceLineMatch,
  updateTransfer,
  voidInvoiceRow,
  voidPaymentRow,
} from './payables.repository.ts'
import type { supplierInvoiceLine } from './payables.schema.ts'
import type {
  AgingBucketKey,
  AgingBuckets,
  AgingQuery,
  BalancesQuery,
  InvoiceCreateBody,
  InvoiceCreateResult,
  InvoiceDetail,
  InvoiceListFilters,
  InvoiceListQuery,
  InvoiceListResult,
  InvoiceMatch,
  InvoiceMatchLine,
  InvoiceStatus,
  InvoiceVoidReason,
  PayableAgingSupplierRow,
  PayablesAgingResult,
  PayablesReconciliationResult,
  PaymentCreateBody,
  PaymentCreateResult,
  PaymentDetail,
  PaymentListFilters,
  PaymentListQuery,
  PaymentListResult,
  PaymentVoidReason,
  PostPaymentInput,
  SupplierBalanceResult,
  SupplierBalanceRow,
  SupplierInvoiceRow,
  SupplierPaymentRow,
  SupplierTransferRow,
  TransferCreateBody,
  TransferCreateResult,
  TransferDetail,
  TransferEvent,
  TransferEventOutcome,
  TransferListFilters,
  TransferListQuery,
  TransferListResult,
  TransferListRow,
  TransferReconciliationQuery,
  TransferReconciliationResult,
  TransferReconciliationRow,
  TransferView,
} from './payables.types.ts'

/** Effective invoice line after receipt copy or operator input. */
interface EffectiveLine {
  purchaseOrderLineId?: string | null
  productId: string | null
  description: string | null
  quantity: number
  unitCostMinor: number
}

function addDaysToIsoDate(isoDate: string, days: number): string {
  const date = new Date(`${isoDate}T00:00:00.000Z`)
  date.setUTCDate(date.getUTCDate() + days)
  return date.toISOString().slice(0, 10)
}

function duplicateSupplierNumberError(existing: SupplierInvoiceRow): ConflictError {
  return new ConflictError(
    `Supplier invoice number ${existing.supplierInvoiceNumber} is already recorded as ${existing.number}`,
    { existingInvoiceId: existing.id, number: existing.number },
  )
}

function receiptAlreadyInvoicedError(existing: SupplierInvoiceRow): ConflictError {
  return new ConflictError(`This receipt is already linked to invoice ${existing.number}`, {
    existingInvoiceId: existing.id,
    number: existing.number,
  })
}

const MATCH_SEVERITY = [
  'NOT_ON_ORDER',
  'PRICE_AND_QUANTITY_VARIANCE',
  'QUANTITY_VARIANCE',
  'PRICE_VARIANCE',
  'MATCHED',
  'UNMATCHED',
] as const

/** Worst status across the lines: what the invoice's badge should say. */
function worstMatchStatus(
  rows: readonly { matchStatus: (typeof supplierInvoiceLine.$inferSelect)['matchStatus'] }[],
): (typeof supplierInvoiceLine.$inferSelect)['matchStatus'] {
  for (const status of MATCH_SEVERITY) {
    if (rows.some((row) => row.matchStatus === status)) return status
  }
  return 'UNMATCHED'
}

async function buildInvoiceMatch(
  invoice: SupplierInvoiceRow,
  rows: readonly InvoiceMatchLine[],
): Promise<InvoiceMatch | null> {
  if (rows.length === 0 || !invoice.purchaseOrderId) return null
  const order = await findOrderById(invoice.purchaseOrderId)
  return {
    purchaseOrderId: invoice.purchaseOrderId,
    orderNumber: order?.number ?? '',
    status: worstMatchStatus(rows),
    lines: [...rows],
  }
}

async function loadInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const header = await selectInvoiceDetailHeader(invoiceId)
  if (!header) throw new NotFoundError('Supplier invoice not found')
  const [lines, allocations, matchRows] = await Promise.all([
    selectInvoiceLines(invoiceId),
    selectAllocationsByInvoice(invoiceId),
    selectInvoiceMatchDetail(invoiceId),
  ])
  const match = await buildInvoiceMatch(header.invoice, matchRows)
  return {
    match,
    invoice: {
      ...header.invoice,
      outstandingMinor: header.invoice.totalMinor - header.invoice.amountPaidMinor,
    },
    supplier: header.supplier,
    receipt: header.receipt,
    lines,
    allocations,
  }
}

/**
 * Records a supplier invoice — pre-filled from a goods receipt (`copyFromReceipt`)
 * or standalone. Totals and the Ghana input-tax split are always recomputed
 * server-side: omitted tax fields derive an INCLUSIVE breakdown of the line sum
 * (so `subtotal + vat + nhil + getfund` equals the recorded costs exactly),
 * provided fields treat the lines as net.
 */
export async function createInvoice(
  user: SessionUser,
  actor: AuditActor,
  input: InvoiceCreateBody,
): Promise<InvoiceCreateResult> {
  const branchId = input.branchId ?? user.branchId
  if (!branchId) throw new ValidationError('branchId is required for admins')
  assertBranchAccess(user, branchId)
  const branchRow = await branchesService.getBranch(user, branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  const supplier = await requireSupplier(input.supplierId)

  let receipt: ReceiptForPayables | null = null
  if (input.receiptId) {
    receipt = await loadReceiptForPayables(input.receiptId)
    if (receipt.branchId !== branchId) {
      throw new ConflictError('The receipt belongs to another branch')
    }
    if (receipt.supplierId && receipt.supplierId !== supplier.id) {
      throw new ConflictError('The receipt belongs to another supplier')
    }
    const existing = await findInvoiceByReceipt(input.receiptId)
    if (existing) throw receiptAlreadyInvoicedError(existing)
  }

  if (input.idempotencyKey) {
    const replay = await findInvoiceByIdempotency(branchId, input.idempotencyKey)
    if (replay) return { invoice: await loadInvoice(replay.id), replayed: true }
  }

  const duplicate = await findInvoiceBySupplierNumber(
    supplier.id,
    branchId,
    input.supplierInvoiceNumber,
  )
  if (duplicate) throw duplicateSupplierNumberError(duplicate)

  // Operator-supplied product lines must reference an active product. Copied
  // receipt lines are trusted: the goods already moved even if the product was
  // archived afterwards.
  for (const line of input.lines ?? []) {
    if (!line.productId) continue
    const productRow = await findProductById(line.productId)
    if (!productRow) throw new NotFoundError('Product not found')
    if (!productRow.isActive) throw new ConflictError('The product is archived')
  }

  let effectiveLines: EffectiveLine[]
  if (input.lines && input.lines.length > 0) {
    effectiveLines = input.lines.map((line) => ({
      productId: line.productId ?? null,
      description: line.description ?? null,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
      purchaseOrderLineId: line.purchaseOrderLineId ?? null,
    }))
  } else if (receipt) {
    effectiveLines = receipt.lines.map((line) => ({
      productId: line.productId,
      description: null,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
    }))
  } else {
    throw new ValidationError('Provide invoice lines or copy from a receipt')
  }

  const seenProducts = new Set<string>()
  for (const line of effectiveLines) {
    if (line.productId) {
      if (seenProducts.has(line.productId)) {
        throw new ValidationError('Each product may appear only once in an invoice')
      }
      seenProducts.add(line.productId)
    }
  }

  const lineSum = effectiveLines.reduce((sum, line) => sum + line.quantity * line.unitCostMinor, 0)
  const taxProvided =
    input.vatMinor !== undefined ||
    input.nhilMinor !== undefined ||
    input.getfundMinor !== undefined

  let subtotalMinor: number
  let vatMinor: number
  let nhilMinor: number
  let getfundMinor: number
  let totalMinor: number
  if (taxProvided) {
    subtotalMinor = lineSum
    vatMinor = input.vatMinor ?? 0
    nhilMinor = input.nhilMinor ?? 0
    getfundMinor = input.getfundMinor ?? 0
    totalMinor = subtotalMinor + vatMinor + nhilMinor + getfundMinor
  } else {
    const breakdown = taxBreakdown(lineSum, 'STANDARD', 'INCLUSIVE')
    subtotalMinor = breakdown.baseMinor
    vatMinor = breakdown.vatMinor
    nhilMinor = breakdown.nhilMinor
    getfundMinor = breakdown.getfundMinor
    totalMinor = breakdown.totalMinor
  }

  const dueDate = input.dueDate ?? addDaysToIsoDate(input.invoiceDate, supplier.paymentTermDays)
  if (dueDate < input.invoiceDate) {
    throw new ValidationError('dueDate cannot be before invoiceDate')
  }

  const occurredAt = new Date(`${input.invoiceDate}T00:00:00.000Z`)

  let outcome: { id: string; replayed: boolean }
  try {
    outcome = await db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const raced = await findInvoiceByIdempotency(branchId, input.idempotencyKey, tx)
        if (raced) return { id: raced.id, replayed: true }
      }

      await lockSupplier(supplier.id, tx)
      const number = await allocateFromSequence('payable.invoiceSequence', tx)
      const header = await insertInvoice(
        {
          number,
          supplierId: supplier.id,
          branchId,
          supplierInvoiceNumber: input.supplierInvoiceNumber,
          invoiceDate: input.invoiceDate,
          dueDate,
          receiptId: input.receiptId ?? null,
          purchaseOrderId: input.purchaseOrderId ?? null,
          subtotalMinor,
          vatMinor,
          nhilMinor,
          getfundMinor,
          totalMinor,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdBy: actorLabel(actor),
        },
        tx,
      )
      if (!header)
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create the supplier invoice')

      const insertedLines = await insertInvoiceLines(
        effectiveLines.map((line) => ({
          invoiceId: header.id,
          productId: line.productId,
          description: line.description,
          quantity: line.quantity,
          unitCostMinor: line.unitCostMinor,
          lineTotalMinor: line.quantity * line.unitCostMinor,
        })),
        tx,
      )

      const matchResult = input.purchaseOrderId
        ? await matchInvoiceToOrder(
            input.purchaseOrderId,
            { branchId, supplierId: supplier.id, invoiceId: header.id },
            effectiveLines,
            insertedLines,
            actor,
            tx,
          )
        : null

      if (input.receiptId) await attachReceiptSupplier(input.receiptId, supplier.id, tx)

      await recordInvoiceCosts(
        supplier.id,
        effectiveLines.map((line) => ({
          productId: line.productId,
          unitCostMinor: line.unitCostMinor,
        })),
        occurredAt,
        tx,
      )

      await writeAudit(
        {
          ...actor,
          action: 'supplier_invoice.created',
          entity: 'supplier_invoice',
          entityId: header.id,
          branchId,
          after: {
            number,
            supplierId: supplier.id,
            supplierCode: supplier.code,
            supplierInvoiceNumber: input.supplierInvoiceNumber,
            totalMinor,
            receiptId: input.receiptId ?? null,
            purchaseOrderId: input.purchaseOrderId ?? null,
            matchStatus: matchResult?.status ?? null,
          },
        },
        tx,
      )

      return { id: header.id, replayed: false }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const constraint = uniqueViolationConstraint(error)
      // Replay first: a parallel create with the same key may commit while this
      // attempt loses the insert race (READ COMMITTED, Phase 4 D23 pattern).
      if (input.idempotencyKey) {
        const replay = await findInvoiceByIdempotency(branchId, input.idempotencyKey)
        if (replay) return { invoice: await loadInvoice(replay.id), replayed: true }
      }
      if (constraint === 'supplier_invoice_supplier_number_unique') {
        const existing = await findInvoiceBySupplierNumber(
          supplier.id,
          branchId,
          input.supplierInvoiceNumber,
        )
        if (existing) throw duplicateSupplierNumberError(existing)
      }
      if (constraint === 'supplier_invoice_receipt_unique' && input.receiptId) {
        const existing = await findInvoiceByReceipt(input.receiptId)
        if (existing) throw receiptAlreadyInvoicedError(existing)
      }
    }
    throw error
  }

  const invoice = await loadInvoice(outcome.id)
  return { invoice, replayed: outcome.replayed }
}

/**
 * Compares each invoice line to the order line it belongs to (PROC-04).
 *
 * Advisory by design: every difference is recorded with both values and the
 * payable posts anyway, because a documentation gap must never stop a supplier
 * being paid. The only 4xx outcomes are structural — a foreign branch, a
 * cancelled order, or a line that is not on the named order.
 */
async function matchInvoiceToOrder(
  purchaseOrderId: string,
  scope: { branchId: string; supplierId: string; invoiceId: string },
  effectiveLines: readonly EffectiveLine[],
  insertedLines: readonly {
    id: string
    productId: string | null
    quantity: number
    unitCostMinor: number
  }[],
  actor: AuditActor,
  executor: DbExecutor,
): Promise<{
  status: (typeof supplierInvoiceLine.$inferSelect)['matchStatus']
  orderNumber: string
  variances: Record<string, unknown>[]
}> {
  const order = await getOrderLinesForMatch(
    purchaseOrderId,
    { branchId: scope.branchId, supplierId: scope.supplierId },
    executor,
  )
  const alreadyInvoiced = await selectInvoicedQuantityByOrderLine(
    purchaseOrderId,
    scope.invoiceId,
    executor,
  )

  const explicitByProduct = new Map<string, string>()
  for (const line of effectiveLines) {
    if (line.productId && line.purchaseOrderLineId) {
      explicitByProduct.set(line.productId, line.purchaseOrderLineId)
    }
  }

  const links: {
    invoiceLineId: string
    purchaseOrderLineId: string | null
    matchStatus: (typeof supplierInvoiceLine.$inferSelect)['matchStatus']
  }[] = []
  const variances: Record<string, unknown>[] = []
  let status: (typeof supplierInvoiceLine.$inferSelect)['matchStatus'] = 'MATCHED'

  for (const line of insertedLines) {
    if (!line.productId) continue

    const explicitId = explicitByProduct.get(line.productId)
    if (explicitId && !order.lines.some((candidate) => candidate.id === explicitId)) {
      throw new ValidationError('That order line is not on the named purchase order')
    }

    const orderLine =
      order.lines.find((candidate) => candidate.id === explicitId) ??
      order.lines.find((candidate) => candidate.productId === line.productId)

    if (!orderLine) {
      status = 'NOT_ON_ORDER'
      links.push({
        invoiceLineId: line.id,
        purchaseOrderLineId: null,
        matchStatus: 'NOT_ON_ORDER',
      })
      variances.push({
        invoiceLineId: line.id,
        productId: line.productId,
        status: 'NOT_ON_ORDER',
        invoicedQuantity: line.quantity,
        invoicedUnitCostMinor: line.unitCostMinor,
      })
      continue
    }

    const priceVariance = line.unitCostMinor !== orderLine.unitCostMinor
    const invoicedAfter = (alreadyInvoiced.get(orderLine.id) ?? 0) + line.quantity
    const quantityVariance = invoicedAfter > orderLine.receivedQuantity

    const lineStatus = priceVariance
      ? quantityVariance
        ? 'PRICE_AND_QUANTITY_VARIANCE'
        : 'PRICE_VARIANCE'
      : quantityVariance
        ? 'QUANTITY_VARIANCE'
        : 'MATCHED'

    links.push({
      invoiceLineId: line.id,
      purchaseOrderLineId: orderLine.id,
      matchStatus: lineStatus,
    })

    if (lineStatus !== 'MATCHED') {
      status = lineStatus
      variances.push({
        invoiceLineId: line.id,
        purchaseOrderLineId: orderLine.id,
        status: lineStatus,
        invoicedQuantity: line.quantity,
        receivedQuantity: orderLine.receivedQuantity,
        invoicedUnitCostMinor: line.unitCostMinor,
        orderedUnitCostMinor: orderLine.unitCostMinor,
      })
    }
  }

  if (links.length > 0) await updateInvoiceLineMatch(links, executor)

  if (links.length > 0 || variances.length > 0) {
    await writeAudit(
      {
        ...actor,
        action: 'supplier_invoice.matched',
        entity: 'supplier_invoice',
        entityId: scope.invoiceId,
        branchId: scope.branchId,
        after: {
          purchaseOrderId,
          orderNumber: order.orderNumber,
          variances,
        },
      },
      executor,
    )
  }

  return { status, orderNumber: order.orderNumber, variances }
}

/**
 * Voids an invoice while it is untouched (net allocations must be zero). The
 * supplier invoice number becomes reusable; the linked receipt keeps its slot
 * so double-invoicing stays impossible.
 */
export async function voidInvoice(
  user: SessionUser,
  actor: AuditActor,
  invoiceId: string,
  reason: InvoiceVoidReason,
): Promise<SupplierInvoiceRow> {
  return db.transaction(async (tx) => {
    const invoice = await lockInvoiceForUpdate(invoiceId, tx)
    if (!invoice) throw new NotFoundError('Supplier invoice not found')
    assertBranchAccess(user, invoice.branchId)
    if (invoice.status === 'VOID') return invoice

    const netAllocated = await sumAllocationsForInvoice(invoiceId, tx)
    if (netAllocated !== 0) {
      throw new ConflictError('Release the payments allocated to this invoice before voiding it', {
        netAllocatedMinor: netAllocated,
      })
    }

    const voided = await voidInvoiceRow(
      invoiceId,
      { voidReason: reason, voidedBy: actorLabel(actor), voidedAt: new Date() },
      tx,
    )
    if (!voided) throw new AppError(500, 'INTERNAL_ERROR', 'Failed to void the supplier invoice')

    await writeAudit(
      {
        ...actor,
        action: 'supplier_invoice.voided',
        entity: 'supplier_invoice',
        entityId: invoiceId,
        branchId: invoice.branchId,
        before: { status: invoice.status, amountPaidMinor: invoice.amountPaidMinor },
        after: { status: 'VOID', reason },
      },
      tx,
    )

    return voided
  })
}

/** Clock-skew tolerance for paidAt; anything further ahead is a typo. */
const PAYMENT_CLOCK_SKEW_MS = 5 * 60_000

/**
 * The settlement actor. A webhook has no staff behind it, and the audit says so
 * rather than borrowing the manager who initiated the transfer (P14-D25).
 */
const SYSTEM_PAYSTACK_ACTOR: AuditActor = {
  actorId: 'system:paystack',
  actorStaffId: null,
  ip: null,
  userAgent: null,
  requestId: null,
}

async function loadPayment(paymentId: string, executor: DbExecutor = db): Promise<PaymentDetail> {
  const header = await selectPaymentDetailHeader(paymentId, executor)
  if (!header) throw new NotFoundError('Supplier payment not found')
  const allocations = await selectAllocationsByPayment(paymentId, executor)
  const allocatedMinor = allocations.reduce((sum, row) => sum + row.amountMinor, 0)
  return {
    payment: header.payment,
    supplier: header.supplier,
    allocations,
    allocatedMinor,
    unallocatedMinor: header.payment.amountMinor - allocatedMinor,
  }
}

export interface PostPaymentOptions {
  /**
   * The session-shaped guard only an HTTP caller can make. The settlement path
   * has no session and passes nothing; the structural branch rule below still
   * applies to both, so dropping the session check does not widen either caller.
   */
  authorizeInvoice?: (invoice: SupplierInvoiceRow) => void
}

/**
 * The allocation core: the one place a `supplier_payment` is written, called by
 * the manual form and by a settled Paystack transfer (P14-D22).
 *
 * Every money rule lives here, in this order: the supplier is locked and ACTIVE,
 * the invoices are locked FOR UPDATE in sorted id order, each invoice belongs to
 * the supplier, the branch and is not VOID, and each allocation fits the
 * remaining balance. The invoice projection is recomputed from the ledger and the
 * audit row carries `onAccountMinor`.
 *
 * What is *not* here is session-shaped: branch access and the paid-at clock. The
 * caller keeps those, and the settlement supplies its own actor and clock.
 */
export async function postSupplierPaymentInTransaction(
  input: PostPaymentInput,
  actor: AuditActor,
  executor: DbExecutor,
  options: PostPaymentOptions = {},
): Promise<SupplierPaymentRow> {
  // A retried key returns the payment it already wrote. The unique index on
  // `(branch_id, idempotency_key)` is the backstop beyond this read.
  if (input.idempotencyKey) {
    const replay = await findPaymentByIdempotency(input.branchId, input.idempotencyKey, executor)
    if (replay) return replay
  }

  const seenInvoices = new Set<string>()
  for (const allocation of input.allocations) {
    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor < 1) {
      throw new ValidationError('Allocation amounts must be positive whole numbers')
    }
    if (seenInvoices.has(allocation.invoiceId)) {
      throw new ValidationError('Each invoice may appear only once in a payment')
    }
    seenInvoices.add(allocation.invoiceId)
  }
  const allocatedTotal = input.allocations.reduce((sum, row) => sum + row.amountMinor, 0)
  if (allocatedTotal > input.amountMinor) {
    throw new ValidationError('Allocations cannot exceed the payment amount')
  }

  await lockSupplier(input.supplierId, executor)
  const number = await allocateFromSequence('payable.paymentSequence', executor)

  const lockedInvoices = await lockInvoicesForUpdate(
    input.allocations.map((allocation) => allocation.invoiceId),
    executor,
  )
  const invoicesById = new Map(lockedInvoices.map((row) => [row.id, row]))

  // Validate in sorted id order (matches the lock order above).
  const sortedAllocations = [...input.allocations].sort((a, b) =>
    a.invoiceId.localeCompare(b.invoiceId),
  )
  for (const allocation of sortedAllocations) {
    const invoice = invoicesById.get(allocation.invoiceId)
    if (!invoice) throw new NotFoundError('Supplier invoice not found')
    if (invoice.supplierId !== input.supplierId) {
      throw new ConflictError('The invoice belongs to another supplier')
    }
    if (invoice.status === 'VOID') {
      throw new ConflictError(`Invoice ${invoice.number} is void and cannot receive payments`)
    }
    options.authorizeInvoice?.(invoice)
    if (invoice.branchId !== input.branchId) {
      throw new ConflictError('The invoice belongs to another branch')
    }
    const outstanding = invoice.totalMinor - invoice.amountPaidMinor
    if (allocation.amountMinor > outstanding) {
      throw new ConflictError(
        `Allocation exceeds the outstanding balance of invoice ${invoice.number}`,
        { invoiceId: invoice.id, outstandingMinor: outstanding },
      )
    }
  }

  const payment = await insertPayment(
    {
      number,
      supplierId: input.supplierId,
      branchId: input.branchId,
      method: input.method,
      amountMinor: input.amountMinor,
      reference: input.reference,
      paidAt: input.paidAt,
      paymentDetailId: input.paymentDetailId,
      note: input.note,
      idempotencyKey: input.idempotencyKey,
      createdBy: actorLabel(actor),
    },
    executor,
  )
  if (!payment) {
    throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create the supplier payment')
  }

  for (const allocation of sortedAllocations) {
    await insertAllocation(
      {
        paymentId: payment.id,
        invoiceId: allocation.invoiceId,
        kind: 'APPLY',
        amountMinor: allocation.amountMinor,
        createdBy: actorLabel(actor),
      },
      executor,
    )
    const invoice = invoicesById.get(allocation.invoiceId)
    if (!invoice) continue
    const paid = invoice.amountPaidMinor + allocation.amountMinor
    const status: InvoiceStatus =
      paid >= invoice.totalMinor ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN'
    await setInvoiceAmountPaid(invoice.id, paid, status, executor)
  }

  await writeAudit(
    {
      ...actor,
      action: 'supplier_payment.created',
      entity: 'supplier_payment',
      entityId: payment.id,
      branchId: input.branchId,
      after: {
        number,
        supplierId: input.supplierId,
        method: input.method,
        amountMinor: input.amountMinor,
        allocations: sortedAllocations,
        onAccountMinor: input.amountMinor - allocatedTotal,
      },
    },
    executor,
  )

  return payment
}

/**
 * The manual form: authorise, check the clock, hand the money rules to the core.
 * Nothing else about a payment is decided here (P14-D22).
 */
export async function createPayment(
  user: SessionUser,
  actor: AuditActor,
  input: PaymentCreateBody,
): Promise<PaymentCreateResult> {
  const branchId = input.branchId ?? user.branchId
  if (!branchId) throw new ValidationError('branchId is required for admins')
  assertBranchAccess(user, branchId)
  const branchRow = await branchesService.getBranch(user, branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  const supplier = await requireSupplier(input.supplierId)

  const paidAt = new Date(input.paidAt)
  if (Number.isNaN(paidAt.getTime())) throw new ValidationError('paidAt must be a valid timestamp')
  if (paidAt.getTime() > Date.now() + PAYMENT_CLOCK_SKEW_MS) {
    throw new ValidationError('paidAt cannot be in the future')
  }

  if (input.paymentDetailId) {
    await requirePaymentDetail(supplier.id, input.paymentDetailId)
  }

  if (input.idempotencyKey) {
    const replay = await findPaymentByIdempotency(branchId, input.idempotencyKey)
    if (replay) return { payment: await loadPayment(replay.id), replayed: true }
  }

  let paymentId: string
  try {
    paymentId = await db.transaction(async (tx) => {
      const payment = await postSupplierPaymentInTransaction(
        {
          branchId,
          supplierId: supplier.id,
          method: input.method,
          amountMinor: input.amountMinor,
          paidAt,
          paymentDetailId: input.paymentDetailId ?? null,
          reference: input.reference ?? null,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          allocations: input.allocations ?? [],
        },
        actor,
        tx,
        { authorizeInvoice: (invoice) => assertBranchAccess(user, invoice.branchId) },
      )
      return payment.id
    })
  } catch (error) {
    if (isUniqueViolation(error) && input.idempotencyKey) {
      const replay = await findPaymentByIdempotency(branchId, input.idempotencyKey)
      if (replay) return { payment: await loadPayment(replay.id), replayed: true }
    }
    throw error
  }

  return { payment: await loadPayment(paymentId), replayed: false }
}

/**
 * Voids a payment and releases every net allocation through compensating
 * RELEASE rows (D8): invoices flip back to their recomputed status, the
 * unallocated remainder stops counting as on-account credit. A voided payment
 * is never deleted; re-voiding is a conflict.
 */
export async function voidPayment(
  user: SessionUser,
  actor: AuditActor,
  paymentId: string,
  reason: PaymentVoidReason,
): Promise<PaymentDetail> {
  return db.transaction(async (tx) => {
    const payment = await lockPaymentForUpdate(paymentId, tx)
    if (!payment) throw new NotFoundError('Supplier payment not found')
    assertBranchAccess(user, payment.branchId)
    if (payment.status === 'VOID') throw new ConflictError('The payment is already void')

    const allocations = await selectAllocationsByPayment(paymentId, tx)
    const netByInvoice = new Map<string, { applyRowId: string | null; net: number }>()
    for (const row of allocations) {
      const entry = netByInvoice.get(row.invoiceId) ?? { applyRowId: null, net: 0 }
      if (row.kind === 'APPLY') entry.applyRowId = row.id
      entry.net += row.amountMinor
      netByInvoice.set(row.invoiceId, entry)
    }

    const releasable = [...netByInvoice.entries()]
      .filter(([, entry]) => entry.net > 0)
      .sort((a, b) => a[0].localeCompare(b[0]))
    const lockedInvoices = await lockInvoicesForUpdate(
      releasable.map(([invoiceId]) => invoiceId),
      tx,
    )
    const invoicesById = new Map(lockedInvoices.map((row) => [row.id, row]))

    const released: { invoiceId: string; invoiceNumber: string; amountMinor: number }[] = []
    for (const [invoiceId, entry] of releasable) {
      const invoice = invoicesById.get(invoiceId)
      if (!invoice) throw new NotFoundError('Supplier invoice not found')

      await insertAllocation(
        {
          paymentId,
          invoiceId,
          kind: 'RELEASE',
          amountMinor: -entry.net,
          reversesAllocationId: entry.applyRowId,
          createdBy: actorLabel(actor),
        },
        tx,
      )

      const paid = Math.max(0, invoice.amountPaidMinor - entry.net)
      const status: InvoiceStatus =
        paid >= invoice.totalMinor ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN'
      await setInvoiceAmountPaid(invoiceId, paid, status, tx)
      released.push({ invoiceId, invoiceNumber: invoice.number, amountMinor: entry.net })
    }

    const voided = await voidPaymentRow(
      paymentId,
      { voidReason: reason, voidedBy: actorLabel(actor), voidedAt: new Date() },
      tx,
    )
    if (!voided) throw new AppError(500, 'INTERNAL_ERROR', 'Failed to void the supplier payment')

    await writeAudit(
      {
        ...actor,
        action: 'supplier_payment.voided',
        entity: 'supplier_payment',
        entityId: paymentId,
        branchId: payment.branchId,
        before: { status: 'COMPLETED', amountMinor: payment.amountMinor },
        after: { status: 'VOID', reason, released },
      },
      tx,
    )

    return loadPayment(paymentId, tx)
  })
}

export async function getPayment(user: SessionUser, paymentId: string): Promise<PaymentDetail> {
  const detail = await loadPayment(paymentId)
  assertBranchAccess(user, detail.payment.branchId)
  return detail
}

export async function listPayments(
  user: SessionUser,
  query: PaymentListQuery,
): Promise<PaymentListResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters: PaymentListFilters = {
    supplierId: query.supplierId ?? null,
    branchId,
    method: query.method ?? null,
    status: query.status ?? null,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : null,
    to: query.to ? new Date(`${addDaysToIsoDate(query.to, 1)}T00:00:00.000Z`) : null,
    limit: query.limit,
    offset: query.offset,
  }
  const [payments, total] = await Promise.all([selectPaymentPage(filters), countPayments(filters)])
  return { payments, total, branchId }
}

export async function getInvoice(user: SessionUser, invoiceId: string): Promise<InvoiceDetail> {
  const detail = await loadInvoice(invoiceId)
  assertBranchAccess(user, detail.invoice.branchId)
  return detail
}

export async function listInvoices(
  user: SessionUser,
  query: InvoiceListQuery,
): Promise<InvoiceListResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters: InvoiceListFilters = {
    supplierId: query.supplierId ?? null,
    branchId,
    receiptId: query.receiptId ?? null,
    status: query.status ?? null,
    overdue: query.overdue,
    variance: query.variance ?? false,
    asOfDate: new Date().toISOString().slice(0, 10),
    from: query.from ?? null,
    to: query.to ?? null,
    limit: query.limit,
    offset: query.offset,
  }
  const [invoices, total] = await Promise.all([selectInvoicePage(filters), countInvoices(filters)])
  return { invoices, total, branchId }
}

const AGING_BUCKET_KEYS: AgingBucketKey[] = [
  'current',
  'days1To30',
  'days31To60',
  'days61To90',
  'over90',
]

/** UTC calendar day (YYYY-MM-DD) for a Date. */
function isoDay(date: Date): string {
  return date.toISOString().slice(0, 10)
}

/** Fixed aging buckets from days past due; due today or later is Current. */
export function bucketPayableDaysPastDue(daysPastDue: number): AgingBucketKey {
  if (daysPastDue > 90) return 'over90'
  if (daysPastDue > 60) return 'days61To90'
  if (daysPastDue > 30) return 'days31To60'
  if (daysPastDue > 0) return 'days1To30'
  return 'current'
}

function utcMidnight(isoDate: string): number {
  const [year, month, day] = isoDate.split('-').map(Number)
  return Date.UTC(year ?? 0, (month ?? 1) - 1, day ?? 1)
}

function payableAging(
  dueDate: string,
  asOf: string,
): { daysPastDue: number; bucket: AgingBucketKey } {
  const daysPastDue = Math.floor((utcMidnight(asOf) - utcMidnight(dueDate)) / 86_400_000)
  return { daysPastDue, bucket: bucketPayableDaysPastDue(daysPastDue) }
}

function emptyAgingBuckets(): AgingBuckets {
  return { current: 0, days1To30: 0, days31To60: 0, days61To90: 0, over90: 0 }
}

/**
 * Balances view: per supplier, invoices outstanding minus on-account credit
 * (completed payments recorded without an allocation). Managers see their own
 * branch; admins see every branch combined or one branch.
 */
export async function listSupplierBalances(
  user: SessionUser,
  query: BalancesQuery,
): Promise<SupplierBalanceResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const [outstandingRows, onAccountRows, creditBySupplier] = await Promise.all([
    selectOutstandingBySupplier(branchId, isoDay(new Date())),
    selectOnAccountBySupplier(branchId, null),
    sumCreditNotesBySupplier(branchId, null),
  ])

  const bySupplier = new Map<string, SupplierBalanceRow>()
  for (const row of outstandingRows) {
    bySupplier.set(row.supplierId, {
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      branchId,
      invoiceOutstandingMinor: row.outstandingMinor,
      onAccountMinor: 0,
      creditMinor: 0,
      owedMinor: row.outstandingMinor,
      overdueMinor: row.overdueMinor,
      invoiceCount: row.invoiceCount,
    })
  }
  for (const row of onAccountRows) {
    if (row.onAccountMinor === 0) continue
    const balance = bySupplier.get(row.supplierId) ?? {
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      branchId,
      invoiceOutstandingMinor: 0,
      onAccountMinor: 0,
      creditMinor: 0,
      owedMinor: 0,
      overdueMinor: 0,
      invoiceCount: 0,
    }
    balance.onAccountMinor = row.onAccountMinor
    bySupplier.set(row.supplierId, balance)
  }
  for (const [creditSupplierId, credit] of creditBySupplier) {
    if (credit.totalMinor === 0) continue
    const balance = bySupplier.get(creditSupplierId) ?? {
      supplierId: creditSupplierId,
      supplierCode: credit.code,
      supplierName: credit.name,
      branchId,
      invoiceOutstandingMinor: 0,
      onAccountMinor: 0,
      creditMinor: 0,
      owedMinor: 0,
      overdueMinor: 0,
      invoiceCount: 0,
    }
    balance.creditMinor = credit.totalMinor
    bySupplier.set(creditSupplierId, balance)
  }
  for (const balance of bySupplier.values()) {
    balance.owedMinor =
      balance.invoiceOutstandingMinor - balance.onAccountMinor - balance.creditMinor
  }

  const balances = [...bySupplier.values()].sort(
    (a, b) => b.owedMinor - a.owedMinor || a.supplierName.localeCompare(b.supplierName),
  )
  return { balances, branchId }
}

/**
 * Aging report: outstanding invoices bucketed by days past due as of `asOf`
 * (defaults to today). On-account credit is reported per supplier but never
 * netted into the buckets (D9).
 */
export async function getAging(user: SessionUser, query: AgingQuery): Promise<PayablesAgingResult> {
  const asOf = query.asOf ?? isoDay(new Date())
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const supplierId = query.supplierId ?? null

  const [invoiceRows, onAccountRows, creditBySupplier] = await Promise.all([
    selectAgingInvoiceRows({ branchId, supplierId }),
    selectOnAccountBySupplier(branchId, supplierId),
    sumCreditNotesBySupplier(branchId, supplierId),
  ])

  const bySupplier = new Map<string, PayableAgingSupplierRow>()
  const ensureSupplier = (row: {
    supplierId: string
    supplierCode: string
    supplierName: string
  }): PayableAgingSupplierRow => {
    let supplierRow = bySupplier.get(row.supplierId)
    if (!supplierRow) {
      supplierRow = {
        supplierId: row.supplierId,
        supplierCode: row.supplierCode,
        supplierName: row.supplierName,
        buckets: emptyAgingBuckets(),
        totalOutstandingMinor: 0,
        onAccountMinor: 0,
        creditMinor: 0,
        invoices: [],
      }
      bySupplier.set(row.supplierId, supplierRow)
    }
    return supplierRow
  }

  for (const row of invoiceRows) {
    const supplierRow = ensureSupplier(row)
    const { daysPastDue, bucket } = payableAging(row.dueDate, asOf)
    supplierRow.buckets[bucket] += row.outstandingMinor
    supplierRow.totalOutstandingMinor += row.outstandingMinor
    supplierRow.invoices.push({
      invoiceId: row.invoiceId,
      number: row.number,
      supplierInvoiceNumber: row.supplierInvoiceNumber,
      dueDate: row.dueDate,
      outstandingMinor: row.outstandingMinor,
      daysPastDue,
      bucket,
    })
  }
  for (const row of onAccountRows) {
    if (row.onAccountMinor === 0) continue
    ensureSupplier(row).onAccountMinor = row.onAccountMinor
  }
  for (const [creditSupplierId, credit] of creditBySupplier) {
    if (credit.totalMinor === 0) continue
    const existing = bySupplier.get(creditSupplierId)
    if (existing) existing.creditMinor = credit.totalMinor
  }

  const suppliers = [...bySupplier.values()].sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName),
  )
  const totals = emptyAgingBuckets()
  let totalOutstandingMinor = 0
  let totalOnAccountMinor = 0
  for (const supplierRow of suppliers) {
    for (const key of AGING_BUCKET_KEYS) totals[key] += supplierRow.buckets[key]
    totalOutstandingMinor += supplierRow.totalOutstandingMinor
    totalOnAccountMinor += supplierRow.onAccountMinor
  }

  return {
    asOf,
    branchId,
    suppliers,
    totals,
    creditNotesMinor: [...creditBySupplier.values()].reduce(
      (sum, value) => sum + value.totalMinor,
      0,
    ),
    totalOutstandingMinor,
    totalOnAccountMinor,
  }
}

/**
 * Payables ageing as a file (RPT-05, P14-D17).
 *
 * Built from the rows `getAging` returns rather than from a second query, so a manager's
 * file lists their suppliers instead of a single `TOTAL` row and the screen and the file
 * cannot diverge. On-account credit and credit notes keep their own columns and are never
 * netted into the buckets (P11-D9).
 */
export async function exportAging(user: SessionUser, query: AgingQuery): Promise<CsvExport> {
  const aging = await getAging(user, query)
  const branchCode = aging.branchId
    ? (await branchesService.getBranch(user, aging.branchId)).code
    : 'all-branches'

  type Row = {
    branchCode: string
    supplierId: string
    supplierCode: string
    supplierName: string
    currentMinor: number
    days1To30Minor: number
    days31To60Minor: number
    days61To90Minor: number
    over90Minor: number
    totalOutstandingMinor: number
    onAccountMinor: number
    creditMinor: number
  }

  const rows: Row[] = aging.suppliers.map((supplier) => ({
    branchCode,
    supplierId: supplier.supplierId,
    supplierCode: supplier.supplierCode,
    supplierName: supplier.supplierName,
    currentMinor: supplier.buckets.current,
    days1To30Minor: supplier.buckets.days1To30,
    days31To60Minor: supplier.buckets.days31To60,
    days61To90Minor: supplier.buckets.days61To90,
    over90Minor: supplier.buckets.over90,
    totalOutstandingMinor: supplier.totalOutstandingMinor,
    onAccountMinor: supplier.onAccountMinor,
    creditMinor: supplier.creditMinor,
  }))
  enforceExportCap(rows.length)

  rows.push({
    branchCode,
    supplierId: 'TOTAL',
    supplierCode: '',
    supplierName: '',
    currentMinor: aging.totals.current,
    days1To30Minor: aging.totals.days1To30,
    days31To60Minor: aging.totals.days31To60,
    days61To90Minor: aging.totals.days61To90,
    over90Minor: aging.totals.over90,
    totalOutstandingMinor: aging.totalOutstandingMinor,
    onAccountMinor: aging.totalOnAccountMinor,
    creditMinor: aging.creditNotesMinor,
  })

  return {
    filename: csvFilename(
      'payables-aging',
      aging.branchId ? branchCode : null,
      `asof-${aging.asOf}`,
    ),
    csv: toCsv(
      [
        { key: 'branchCode', header: 'branch_code' },
        { key: 'supplierId', header: 'supplier_id' },
        { key: 'supplierCode', header: 'supplier_code' },
        { key: 'supplierName', header: 'supplier_name' },
        { key: 'currentMinor', header: 'current_minor' },
        { key: 'days1To30Minor', header: 'days_1_30_minor' },
        { key: 'days31To60Minor', header: 'days_31_60_minor' },
        { key: 'days61To90Minor', header: 'days_61_90_minor' },
        { key: 'over90Minor', header: 'over_90_minor' },
        { key: 'totalOutstandingMinor', header: 'total_outstanding_minor' },
        { key: 'onAccountMinor', header: 'on_account_minor' },
        { key: 'creditMinor', header: 'credit_notes_minor' },
      ],
      rows,
    ),
  }
}

/**
 * Ageing totals only, for read models outside this module (analytics).
 *
 * Deliberately built from `selectAgingInvoiceRows` + `payableAging`, not a second SQL
 * `CASE`: the bucket boundaries must be the ones this service owns. On-account credit is
 * never netted into the buckets (D9), matching `getAging`.
 */
export async function getAgingTotals(
  branchId: string | null,
  asOf: string,
  executor: DbExecutor = db,
): Promise<AgingBuckets> {
  const rows = await selectAgingInvoiceRows({ branchId, supplierId: null }, executor)
  const totals = emptyAgingBuckets()
  for (const row of rows) {
    totals[payableAging(row.dueDate, asOf).bucket] += row.outstandingMinor
  }
  return totals
}

/**
 * Read-only invariant check: every invoice's paid amount equals its signed
 * allocations and its status follows from them; every supplier's owed figure
 * (balances query path) equals the suppliers module's independent
 * `sumSupplierOwed` SQL. Throws on the first mismatch; tests and the Plan 07
 * walkthrough call it after fixture dances.
 */
export async function reconcilePayables(
  executor: DbExecutor = db,
): Promise<PayablesReconciliationResult> {
  const drift = (message: string, details: Record<string, unknown>): AppError =>
    new AppError(500, 'PAYABLES_DRIFT', message, details)

  const invoiceRows = await selectInvoiceReconciliationRows(executor)
  for (const row of invoiceRows) {
    if (row.amountPaidMinor !== row.netAllocatedMinor) {
      throw drift(
        `Invoice ${row.number} paid ${row.amountPaidMinor} but allocations sum to ${row.netAllocatedMinor}`,
        {
          invoiceId: row.id,
          amountPaidMinor: row.amountPaidMinor,
          netAllocatedMinor: row.netAllocatedMinor,
        },
      )
    }
    if (row.status === 'VOID') {
      if (row.netAllocatedMinor !== 0) {
        throw drift(`Void invoice ${row.number} still has net allocations`, { invoiceId: row.id })
      }
      continue
    }
    const expected: InvoiceStatus =
      row.netAllocatedMinor >= row.totalMinor
        ? 'PAID'
        : row.netAllocatedMinor > 0
          ? 'PARTIAL'
          : 'OPEN'
    if (row.status !== expected) {
      throw drift(`Invoice ${row.number} status ${row.status} should be ${expected}`, {
        invoiceId: row.id,
        status: row.status,
        expected,
      })
    }
  }

  const supplierIds = await selectSupplierIdsWithActivity(executor)
  const [outstandingRows, onAccountRows] = await Promise.all([
    selectOutstandingBySupplier(null, isoDay(new Date()), executor),
    selectOnAccountBySupplier(null, null, executor),
  ])
  const owedBySupplier = new Map<string, number>()
  for (const row of outstandingRows) owedBySupplier.set(row.supplierId, row.outstandingMinor)
  for (const row of onAccountRows) {
    owedBySupplier.set(
      row.supplierId,
      (owedBySupplier.get(row.supplierId) ?? 0) - row.onAccountMinor,
    )
  }
  for (const supplierId of supplierIds) {
    const derived = owedBySupplier.get(supplierId) ?? 0
    const independent = await sumSupplierOwed(supplierId, executor)
    if (derived !== independent) {
      throw drift(
        `Supplier ${supplierId} owed ${derived} from balances but ${independent} independently`,
        { supplierId, derived, independent },
      )
    }
  }

  return { invoicesChecked: invoiceRows.length, suppliersChecked: supplierIds.length }
}

/* -------------------------------------------------------------------------- */
/*                       Supplier transfers (P14-D22 … D47)                   */
/* -------------------------------------------------------------------------- */

/** A transfer must be verifiable for at least a quarter of an hour before the sweep takes it. */
export const TRANSFER_RECONCILE_STALE_MINUTES = 10
export const TRANSFER_RECONCILE_LIMIT = 100

/** `sdt-<uuid>`: 40 characters of Paystack's 16–50 alphabet (P14 research 2). */
export function mintTransferReference(): string {
  return `sdt-${randomUUID()}`
}

/** Integer-only minor-unit formatting for operator-facing messages. */
function formatMinor(minor: number): string {
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(minor)
  return `${sign}GHS ${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/**
 * The transfer as the API returns it. `recipientCode` is deliberately absent: it
 * is money-routing state that is never returned, logged or exported (P14-D28).
 */
function toTransferView(row: TransferListRow): TransferView {
  return {
    id: row.id,
    branchId: row.branchId,
    supplierId: row.supplierId,
    supplierCode: row.supplierCode,
    supplierName: row.supplierName,
    paymentDetailId: row.paymentDetailId,
    method: row.method,
    amountMinor: row.amountMinor,
    reference: row.reference,
    idempotencyKey: row.idempotencyKey,
    status: row.status,
    provider: row.provider,
    providerTransferCode: row.providerTransferCode,
    providerTransferId: row.providerTransferId,
    reason: row.reason,
    note: row.note,
    failureCode: row.failureCode,
    failureMessage: row.failureMessage,
    paymentId: row.paymentId,
    unallocatedMinor: row.unallocatedMinor,
    initiatedBy: row.initiatedBy,
    finalizedAt: row.finalizedAt?.toISOString() ?? null,
    settledAt: row.settledAt?.toISOString() ?? null,
    lastVerifiedAt: row.lastVerifiedAt?.toISOString() ?? null,
    createdAt: row.createdAt.toISOString(),
  }
}

/** The provider's result, in the shape the one state writer consumes. */
export function transferEventFromProvider(result: ProviderTransferResult): TransferEvent {
  return {
    reference: result.reference,
    status: result.status,
    transferCode: result.transferCode,
    transferId: result.transferId,
    amountMinor: Number.isSafeInteger(result.amountMinor) ? result.amountMinor : null,
    failureCode: result.failureCode,
    failureMessage: result.failureMessage,
    occurredAt: result.transferredAt ? new Date(result.transferredAt) : null,
    feeMinor: result.feeMinor,
  }
}

async function loadTransferDetail(
  transferId: string,
  executor: DbExecutor = db,
): Promise<TransferDetail> {
  const row = await findTransferById(transferId, executor)
  if (!row) throw new NotFoundError('Supplier transfer not found')
  const [allocations, payment] = await Promise.all([
    selectTransferAllocations(transferId, executor),
    row.paymentId ? loadPayment(row.paymentId, executor) : Promise.resolve(null),
  ])
  return {
    transfer: toTransferView(row),
    allocations,
    payment,
    // A success with no payment is money that moved and is not in the books; a
    // reversal with a payment is money that came back and is still posted. Both
    // need a person, and neither is fixed by a webhook (P14-D46).
    attention:
      (row.status === 'SUCCESS' && row.paymentId === null) ||
      (row.status === 'REVERSED' && row.paymentId !== null),
  }
}

/**
 * The settlement: a `supplier_payment` through the same allocation core the
 * manual form uses, with the transfer's own identity (P14-D22–D26).
 *
 * The plan is re-read against each invoice's remaining balance. What still fits
 * is applied; the rest stays on account and is written to `unallocated_minor`.
 * A shortfall is not a failure: the supplier has the money either way, and a
 * settlement that threw would leave money gone with no payment row.
 */
async function settleTransfer(
  executor: DbExecutor,
  transfer: SupplierTransferRow,
  event: TransferEvent,
  providerPatch: Partial<SupplierTransferRow>,
): Promise<TransferEventOutcome> {
  const plan = await selectTransferAllocations(transfer.id, executor)
  const locked = await lockInvoicesForUpdate(
    plan.map((row) => row.invoiceId),
    executor,
  )
  const invoicesById = new Map(locked.map((row) => [row.id, row]))

  const survivors: { invoiceId: string; amountMinor: number }[] = []
  const shortfall: {
    invoiceId: string
    invoiceNumber: string
    plannedMinor: number
    remainingMinor: number
  }[] = []

  for (const planned of plan) {
    const invoice = invoicesById.get(planned.invoiceId)
    const eligible =
      invoice &&
      invoice.status !== 'VOID' &&
      invoice.supplierId === transfer.supplierId &&
      invoice.branchId === transfer.branchId
    if (!eligible) {
      shortfall.push({
        invoiceId: planned.invoiceId,
        invoiceNumber: invoice?.number ?? '',
        plannedMinor: planned.amountMinor,
        remainingMinor: 0,
      })
      continue
    }
    const remaining = Math.max(0, invoice.totalMinor - invoice.amountPaidMinor)
    const applied = Math.min(planned.amountMinor, remaining)
    if (applied < planned.amountMinor) {
      shortfall.push({
        invoiceId: planned.invoiceId,
        invoiceNumber: invoice.number,
        plannedMinor: planned.amountMinor,
        remainingMinor: remaining,
      })
    }
    if (applied > 0) survivors.push({ invoiceId: planned.invoiceId, amountMinor: applied })
  }

  const allocatedMinor = survivors.reduce((sum, row) => sum + row.amountMinor, 0)
  const unallocatedMinor = transfer.amountMinor - allocatedMinor
  const paidAt = event.occurredAt ?? new Date()

  const payment = await postSupplierPaymentInTransaction(
    {
      branchId: transfer.branchId,
      supplierId: transfer.supplierId,
      method: transfer.method,
      amountMinor: transfer.amountMinor,
      paidAt,
      paymentDetailId: transfer.paymentDetailId,
      reference: transfer.reference,
      note: transfer.note,
      // The replay guard: one settled payment per transfer, enforced by the
      // unique `(branch_id, idempotency_key)` the manual form already uses.
      idempotencyKey: `transfer:${transfer.id}`,
      allocations: survivors,
    },
    SYSTEM_PAYSTACK_ACTOR,
    executor,
  )

  await updateTransfer(
    transfer.id,
    {
      ...providerPatch,
      status: 'SUCCESS',
      paymentId: payment.id,
      settledAt: paidAt,
      unallocatedMinor,
      failureCode: null,
      failureMessage: null,
    },
    executor,
  )

  await writeAudit(
    {
      ...SYSTEM_PAYSTACK_ACTOR,
      action: 'supplier_transfer.settled',
      entity: 'supplier_transfer',
      entityId: transfer.id,
      branchId: transfer.branchId,
      after: {
        paymentId: payment.id,
        reference: transfer.reference,
        plannedMinor: transfer.amountMinor,
        allocatedMinor,
        unallocatedMinor,
        feeMinor: event.feeMinor,
      },
    },
    executor,
  )

  // Only when the plan and the posting disagree. A zero-shortfall settlement is
  // the normal case and does not deserve a second row nobody reads.
  if (unallocatedMinor > 0) {
    await writeAudit(
      {
        ...SYSTEM_PAYSTACK_ACTOR,
        action: 'supplier_transfer.allocation_shortfall',
        entity: 'supplier_transfer',
        entityId: transfer.id,
        branchId: transfer.branchId,
        after: {
          paymentId: payment.id,
          reference: transfer.reference,
          plannedMinor: transfer.amountMinor,
          allocatedMinor,
          unallocatedMinor,
          invoices: shortfall,
        },
      },
      executor,
    )
  }

  return {
    matched: true,
    transferId: transfer.id,
    paymentId: payment.id,
    status: 'SUCCESS',
  }
}

const TRANSFER_TERMINAL_STATUSES = new Set<SupplierTransferRow['status']>([
  'SUCCESS',
  'FAILED',
  'REVERSED',
  'BLOCKED',
  'REJECTED',
])

const TRANSFER_FAILURE_STATUSES: Partial<
  Record<TransferEvent['status'], SupplierTransferRow['status']>
> = {
  failed: 'FAILED',
  blocked: 'BLOCKED',
  rejected: 'REJECTED',
  reversed: 'REVERSED',
}

/**
 * The one transfer state writer. The webhook, `verify`, the initiate response and
 * the sweep all land here, so there is a single state machine (P14-D31).
 *
 * Only `success` posts a payment. A failed, blocked or rejected transfer writes
 * a status and nothing else. A reversal never un-posts what was posted: the
 * payment stays and the reconciliation raises it for a person (P14-D46).
 */
export async function applyTransferEvent(
  executor: DbExecutor,
  event: TransferEvent,
): Promise<TransferEventOutcome> {
  const transfer = await findTransferByReferenceForUpdate(event.reference, executor)
  if (!transfer) {
    // An event that names no transfer is not a failure: the webhook records it
    // as IGNORED so Paystack stops retrying.
    return { matched: false, transferId: null, paymentId: null, status: null }
  }

  const providerPatch: Partial<SupplierTransferRow> = {
    providerTransferCode: event.transferCode ?? transfer.providerTransferCode,
    providerTransferId: event.transferId ?? transfer.providerTransferId,
    lastVerifiedAt: new Date(),
  }

  if (event.status === 'success') {
    // The provider's amount is not ours to book: a success for another amount is
    // never posted, and the transfer stays open with the reason attached. A
    // missing amount (0 is not a legal transfer) is not a mismatch.
    if (
      event.amountMinor !== null &&
      event.amountMinor > 0 &&
      event.amountMinor !== transfer.amountMinor
    ) {
      await updateTransfer(
        transfer.id,
        {
          ...providerPatch,
          failureCode: 'AMOUNT_MISMATCH',
          failureMessage: `The provider reported ${event.amountMinor} pesewas for a ${transfer.amountMinor}-pesewa transfer`,
        },
        executor,
      )
      await writeAudit(
        {
          ...SYSTEM_PAYSTACK_ACTOR,
          action: 'supplier_transfer.amount_mismatch',
          entity: 'supplier_transfer',
          entityId: transfer.id,
          branchId: transfer.branchId,
          after: {
            reference: transfer.reference,
            expectedAmountMinor: transfer.amountMinor,
            providerAmountMinor: event.amountMinor,
          },
        },
        executor,
      )
      return {
        matched: true,
        transferId: transfer.id,
        paymentId: transfer.paymentId,
        status: transfer.status,
      }
    }

    // Money that came back is never posted again by a stale success. A reversal
    // is terminal for the intent; a person settles what really happened.
    if (transfer.status === 'REVERSED') {
      await updateTransfer(transfer.id, providerPatch, executor)
      return {
        matched: true,
        transferId: transfer.id,
        paymentId: transfer.paymentId,
        status: transfer.status,
      }
    }

    // Already settled: a replayed webhook inserts its event row and changes
    // nothing else (P14-D25).
    if (transfer.paymentId) {
      await updateTransfer(transfer.id, providerPatch, executor)
      return {
        matched: true,
        transferId: transfer.id,
        paymentId: transfer.paymentId,
        status: transfer.status,
      }
    }

    return settleTransfer(executor, transfer, event, providerPatch)
  }

  const failureStatus = TRANSFER_FAILURE_STATUSES[event.status]
  if (failureStatus) {
    // Money that already moved is never downgraded by a stale failure event; a
    // reversal is the one terminal move a success may take.
    if (
      transfer.status === 'REVERSED' ||
      (transfer.status === 'SUCCESS' && event.status !== 'reversed')
    ) {
      await updateTransfer(transfer.id, providerPatch, executor)
      return {
        matched: true,
        transferId: transfer.id,
        paymentId: transfer.paymentId,
        status: transfer.status,
      }
    }

    await updateTransfer(
      transfer.id,
      {
        ...providerPatch,
        status: failureStatus,
        failureCode: event.failureCode ?? failureStatus.toLowerCase(),
        failureMessage:
          event.failureMessage ??
          `The provider reported the transfer ${failureStatus.toLowerCase()}`,
      },
      executor,
    )
    await writeAudit(
      {
        ...SYSTEM_PAYSTACK_ACTOR,
        action:
          failureStatus === 'REVERSED' ? 'supplier_transfer.reversed' : 'supplier_transfer.failed',
        entity: 'supplier_transfer',
        entityId: transfer.id,
        branchId: transfer.branchId,
        after: {
          reference: transfer.reference,
          status: failureStatus,
          failureCode: event.failureCode,
          failureMessage: event.failureMessage,
          // A reversal keeps the payment: only a manager's `voidPayment` reverses
          // a ledger entry (P14-D46).
          paymentId: transfer.paymentId,
        },
      },
      executor,
    )
    return {
      matched: true,
      transferId: transfer.id,
      paymentId: transfer.paymentId,
      status: failureStatus,
    }
  }

  // pending / otp: the provider has moved nothing. A terminal row is never
  // reopened by a late or replayed event.
  if (!TRANSFER_TERMINAL_STATUSES.has(transfer.status)) {
    await updateTransfer(
      transfer.id,
      {
        ...providerPatch,
        status: event.status === 'otp' ? 'AWAITING_OTP' : 'PENDING',
      },
      executor,
    )
    return {
      matched: true,
      transferId: transfer.id,
      paymentId: null,
      status: event.status === 'otp' ? 'AWAITING_OTP' : 'PENDING',
    }
  }

  await updateTransfer(transfer.id, providerPatch, executor)
  return {
    matched: true,
    transferId: transfer.id,
    paymentId: transfer.paymentId,
    status: transfer.status,
  }
}

async function assertTransferPlan(
  user: SessionUser,
  input: { supplierId: string; branchId: string; amountMinor: number },
  allocations: readonly { invoiceId: string; amountMinor: number }[],
): Promise<void> {
  const seen = new Set<string>()
  let total = 0
  for (const allocation of allocations) {
    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor < 1) {
      throw new ValidationError('Allocation amounts must be positive whole numbers')
    }
    if (seen.has(allocation.invoiceId)) {
      throw new ValidationError('Each invoice may appear only once in a transfer')
    }
    seen.add(allocation.invoiceId)
    total += allocation.amountMinor
  }
  if (total > input.amountMinor) {
    throw new ValidationError('Allocations cannot exceed the transfer amount')
  }

  // The plan is validated here so a transfer cannot name a foreign invoice; the
  // settlement re-reads the balances and is authoritative about what fits.
  for (const allocation of allocations) {
    const invoice = await findInvoiceById(allocation.invoiceId)
    if (!invoice) throw new NotFoundError('Supplier invoice not found')
    if (invoice.supplierId !== input.supplierId) {
      throw new ConflictError('The invoice belongs to another supplier')
    }
    assertBranchAccess(user, invoice.branchId)
    if (invoice.branchId !== input.branchId) {
      throw new ConflictError('The invoice belongs to another branch')
    }
    if (invoice.status === 'VOID') {
      throw new ConflictError(`Invoice ${invoice.number} is void and cannot receive a transfer`)
    }
  }
}

/**
 * Records the intent: the transfer row, its plan and the balance precheck, all
 * before the provider is called (P14-D29). The supplier is paid when the
 * provider says the money moved, not here.
 */
export async function createSupplierTransfer(
  user: SessionUser,
  actor: AuditActor,
  input: TransferCreateBody,
): Promise<TransferCreateResult> {
  const branchId = input.branchId ?? user.branchId
  if (!branchId) throw new ValidationError('branchId is required for admins')
  assertBranchAccess(user, branchId)
  const branchRow = await branchesService.getBranch(user, branchId)
  if (!branchRow.isActive) throw new ConflictError('The branch is inactive')

  const supplier = await requireSupplier(input.supplierId)
  const detail = await requirePaymentDetail(supplier.id, input.paymentDetailId)
  // A destination Paystack cannot address is refused before the intent exists:
  // a `PENDING` transfer nobody can send is a row the sweep will verify forever.
  if (detail.method === 'BANK' && !detail.bankCode) {
    throw new ConflictError(
      'This bank detail has no bank code, so Paystack cannot create a recipient',
    )
  }
  if (detail.method === 'MOMO' && !detail.momoNetwork) {
    throw new ConflictError('This mobile-money detail has no network')
  }
  const allocations = input.allocations ?? []
  await assertTransferPlan(
    user,
    { supplierId: supplier.id, branchId, amountMinor: input.amountMinor },
    allocations,
  )

  const replay = await findTransferByIdempotency(branchId, input.idempotencyKey)
  if (replay) {
    return {
      transfer: await loadTransferDetail(replay.id),
      replayed: true,
      providerUnavailable: false,
    }
  }

  // The balance is a precondition, not a hope: a console that submits a 2 000 GHS
  // transfer against a 200 GHS balance has produced a support ticket (P14-D29).
  const provider = getPaymentProvider()
  let balanceMinor: number | null
  try {
    balanceMinor = (await provider.getBalance())?.balanceMinor ?? null
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The payment provider is unavailable')
    }
    throw error
  }
  if (balanceMinor === null) {
    throw new AppError(
      409,
      'PROVIDER_BALANCE_UNAVAILABLE',
      'Paystack reports no GHS balance to transfer from',
    )
  }
  if (balanceMinor < input.amountMinor) {
    throw new AppError(
      409,
      'INSUFFICIENT_PROVIDER_BALANCE',
      `The Paystack balance is ${formatMinor(balanceMinor)} but this transfer needs ${formatMinor(input.amountMinor)}`,
      { balanceMinor, amountMinor: input.amountMinor },
    )
  }

  const reference = mintTransferReference()
  const reason = input.note ?? `Supplier payment ${supplier.code}`

  let created: { id: string; replayed: boolean }
  try {
    created = await db.transaction(async (tx) => {
      const raced = await findTransferByIdempotency(branchId, input.idempotencyKey, tx)
      if (raced) return { id: raced.id, replayed: true }

      const row = await insertTransfer(
        {
          branchId,
          supplierId: supplier.id,
          paymentDetailId: detail.id,
          method: detail.method,
          amountMinor: input.amountMinor,
          reference,
          idempotencyKey: input.idempotencyKey,
          status: 'PENDING',
          provider: provider.name,
          reason,
          note: input.note ?? null,
          initiatedBy: actorLabel(actor),
        },
        tx,
      )
      if (!row) throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create the supplier transfer')

      await insertTransferAllocations(
        allocations.map((allocation) => ({
          transferId: row.id,
          invoiceId: allocation.invoiceId,
          amountMinor: allocation.amountMinor,
        })),
        tx,
      )

      await writeAudit(
        {
          ...actor,
          action: 'supplier_transfer.created',
          entity: 'supplier_transfer',
          entityId: row.id,
          branchId,
          after: {
            reference,
            supplierId: supplier.id,
            supplierCode: supplier.code,
            paymentDetailId: detail.id,
            method: detail.method,
            amountMinor: input.amountMinor,
            allocations,
            balanceMinor,
          },
        },
        tx,
      )

      return { id: row.id, replayed: false }
    })
  } catch (error) {
    if (isUniqueViolation(error)) {
      const replay = await findTransferByIdempotency(branchId, input.idempotencyKey)
      if (replay) {
        return {
          transfer: await loadTransferDetail(replay.id),
          replayed: true,
          providerUnavailable: false,
        }
      }
    }
    throw error
  }

  if (created.replayed) {
    return {
      transfer: await loadTransferDetail(created.id),
      replayed: true,
      providerUnavailable: false,
    }
  }

  let recipientCode: string
  let result: ProviderTransferResult
  try {
    recipientCode = await ensurePaystackRecipient(supplier.id, detail.id)
    await updateTransfer(created.id, { recipientCode })
    result = await provider.initiateTransfer({
      reference,
      amountMinor: input.amountMinor,
      recipientCode,
      reason,
      currency: 'GHS',
    })
  } catch (error) {
    // "We do not know" is `PENDING`, never a failure: the sweep verifies.
    if (error instanceof ProviderUnavailableError) {
      return {
        transfer: await loadTransferDetail(created.id),
        replayed: false,
        providerUnavailable: true,
      }
    }
    throw error
  }

  await db.transaction(async (tx) => {
    await applyTransferEvent(tx, transferEventFromProvider(result))
    await writeAudit(
      {
        ...actor,
        action: 'supplier_transfer.initiated',
        entity: 'supplier_transfer',
        entityId: created.id,
        branchId,
        after: { reference, transferCode: result.transferCode, status: result.status },
      },
      tx,
    )
  })

  return {
    transfer: await loadTransferDetail(created.id),
    replayed: false,
    providerUnavailable: false,
  }
}

/**
 * The OTP a bank or the business owner's phone received. Only a transfer the
 * provider is actually holding an OTP for may be finalised; anything else is a
 * conflict, and a wrong code is the provider's own message with no row change
 * (P14-D24).
 */
export async function finalizeSupplierTransfer(
  user: SessionUser,
  actor: AuditActor,
  transferId: string,
  otp: string,
): Promise<TransferDetail> {
  const row = await findTransferById(transferId)
  if (!row) throw new NotFoundError('Supplier transfer not found')
  assertBranchAccess(user, row.branchId)
  if (row.status !== 'AWAITING_OTP') {
    throw new ConflictError('This transfer is not waiting for an OTP', { status: row.status })
  }
  if (!row.providerTransferCode) {
    throw new ConflictError('The transfer has no provider code to finalise')
  }

  let result: ProviderTransferResult
  try {
    result = await getPaymentProvider().finalizeTransfer({
      transferCode: row.providerTransferCode,
      otp,
    })
  } catch (error) {
    if (error instanceof ProviderUnavailableError) {
      throw new AppError(503, 'PROVIDER_UNAVAILABLE', 'The payment provider is unavailable')
    }
    throw error
  }

  // `otp` means the provider refused the code: 400 with its words, and the row
  // stays exactly where it was.
  if (result.status === 'otp') {
    throw new ValidationError(result.failureMessage ?? 'The provider did not accept the OTP')
  }

  await db.transaction(async (tx) => {
    await applyTransferEvent(tx, {
      ...transferEventFromProvider(result),
      reference: result.reference || row.reference,
    })
    await writeAudit(
      {
        ...actor,
        action: 'supplier_transfer.finalized',
        entity: 'supplier_transfer',
        entityId: row.id,
        branchId: row.branchId,
        after: {
          reference: row.reference,
          transferCode: result.transferCode,
          status: result.status,
        },
      },
      tx,
    )
  })

  return loadTransferDetail(row.id)
}

/** One manual refresh through the same state writer the webhook uses. */
export async function verifySupplierTransfer(
  user: SessionUser,
  transferId: string,
): Promise<TransferDetail> {
  const row = await findTransferById(transferId)
  if (!row) throw new NotFoundError('Supplier transfer not found')
  assertBranchAccess(user, row.branchId)

  await updateTransfer(row.id, { lastVerifiedAt: new Date() })

  try {
    const result = await getPaymentProvider().verifyTransfer(row.reference)
    await db.transaction(async (tx) => {
      await applyTransferEvent(tx, transferEventFromProvider(result))
    })
  } catch (error) {
    if (!(error instanceof ProviderUnavailableError)) throw error
  }

  return loadTransferDetail(row.id)
}

export interface TransferReconcileSummary {
  checked: number
  settled: number
  failed: number
}

/**
 * The catch-up sweep (P14-D31, P14-D47). It verifies; it never finalises: an OTP
 * is a human's second factor, and a job that guesses it can drain the balance.
 *
 * One transfer's failure is logged and the loop continues — one stranded
 * transfer must not hide the other 99.
 */
export async function reconcileStaleTransfers(
  options: { olderThanMinutes?: number; limit?: number } = {},
): Promise<TransferReconcileSummary> {
  const minutes = options.olderThanMinutes ?? TRANSFER_RECONCILE_STALE_MINUTES
  const stale = await selectTransfersToVerify(
    new Date(Date.now() - minutes * 60_000),
    options.limit ?? TRANSFER_RECONCILE_LIMIT,
  )

  let settled = 0
  let failed = 0

  for (const transfer of stale) {
    try {
      const result = await getPaymentProvider().verifyTransfer(transfer.reference)
      const outcome = await db.transaction(async (tx) =>
        applyTransferEvent(tx, transferEventFromProvider(result)),
      )
      if (outcome.status === 'SUCCESS') settled += 1
      logger.info({ transferId: transfer.id, status: outcome.status }, 'transfer verified')
    } catch (error) {
      failed += 1
      logger.warn(
        {
          transferId: transfer.id,
          message: error instanceof Error ? error.message.slice(0, 200) : 'unknown error',
        },
        'transfer reconcile failed',
      )
    }
  }

  return { checked: stale.length, settled, failed }
}

export async function listTransfers(
  user: SessionUser,
  query: TransferListQuery,
): Promise<TransferListResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const filters: TransferListFilters = {
    supplierId: query.supplierId ?? null,
    branchId,
    status: query.status ?? null,
    from: query.from ? new Date(`${query.from}T00:00:00.000Z`) : null,
    to: query.to ? new Date(`${addDaysToIsoDate(query.to, 1)}T00:00:00.000Z`) : null,
    limit: query.limit,
    offset: query.offset,
  }
  const [rows, total] = await Promise.all([selectTransferPage(filters), countTransfers(filters)])
  return { transfers: rows.map(toTransferView), total, branchId }
}

export async function getTransfer(user: SessionUser, transferId: string): Promise<TransferDetail> {
  const detail = await loadTransferDetail(transferId)
  assertBranchAccess(user, detail.transfer.branchId)
  return detail
}

export interface ProviderBalanceView {
  currency: 'GHS'
  /** Null when the provider could not be asked: the console shows "unavailable". */
  balanceMinor: number | null
}

/** Thirty seconds: opening a dialog must not be a provider call per keystroke. */
const PROVIDER_BALANCE_CACHE_MS = 30_000
let providerBalanceCache: { at: number; value: ProviderBalanceView } | null = null

/** A test resets the cache between cases; nothing else calls this. */
export function resetProviderBalanceCache(): void {
  providerBalanceCache = null
}

/**
 * The balance the console reads before offering a transfer. A failure is
 * reported as "unknown" rather than as a number, and cached for the same window
 * so a provider outage does not become a request storm. The create path asks
 * again and refuses on a real figure (P14-D29).
 */
export async function getProviderBalance(): Promise<ProviderBalanceView> {
  const now = Date.now()
  if (providerBalanceCache && now - providerBalanceCache.at < PROVIDER_BALANCE_CACHE_MS) {
    return providerBalanceCache.value
  }

  let value: ProviderBalanceView
  try {
    const balance = await getPaymentProvider().getBalance()
    value = { currency: 'GHS', balanceMinor: balance?.balanceMinor ?? null }
  } catch (error) {
    if (!(error instanceof ProviderUnavailableError)) throw error
    value = { currency: 'GHS', balanceMinor: null }
  }

  providerBalanceCache = { at: now, value }
  return value
}

/**
 * Manual payments, settled transfers and unposted money in one list (Plan §7).
 *
 * `settled` compares the transfer's own `amount_minor` with the posted payment's
 * `amount_minor` — equal by construction, because the settlement writes the
 * transfer's amount. The fee is Paystack's and is reported beside the figure,
 * never netted into it (P14-D29).
 */
export async function getTransferReconciliation(
  user: SessionUser,
  query: TransferReconciliationQuery,
): Promise<TransferReconciliationResult> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const from = query.from ? new Date(`${query.from}T00:00:00.000Z`) : null
  const to = query.to ? new Date(`${addDaysToIsoDate(query.to, 1)}T00:00:00.000Z`) : null

  const [transferRows, manualRows] = await Promise.all([
    selectTransferReconciliationRows({ branchId, from, to }),
    selectManualPaymentsForReconciliation({ branchId, from, to }),
  ])

  const rows: TransferReconciliationRow[] = []
  const totals = {
    settledMinor: 0,
    manualMinor: 0,
    unpostedMinor: 0,
    failedCount: 0,
    reversedCount: 0,
  }

  for (const row of transferRows) {
    const settled = row.status === 'SUCCESS' && row.paymentId !== null
    const attention =
      (row.status === 'SUCCESS' && row.paymentId === null) ||
      (row.status === 'REVERSED' && row.paymentId !== null)

    rows.push({
      state: settled ? 'settled' : 'unposted',
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      branchId: row.branchId,
      transferId: row.id,
      paymentId: row.paymentId,
      reference: row.reference,
      status: row.status,
      amountMinor: row.amountMinor,
      paymentAmountMinor: row.paymentAmountMinor,
      unallocatedMinor: row.unallocatedMinor,
      feeMinor: null,
      failureCode: row.failureCode,
      failureMessage: row.failureMessage,
      occurredAt: row.createdAt.toISOString(),
      attention,
    })

    if (settled) totals.settledMinor += row.amountMinor
    else if (row.status === 'SUCCESS') totals.unpostedMinor += row.amountMinor
    if (row.status === 'FAILED' || row.status === 'BLOCKED' || row.status === 'REJECTED') {
      totals.failedCount += 1
    }
    if (row.status === 'REVERSED') totals.reversedCount += 1
  }

  for (const row of manualRows) {
    rows.push({
      state: 'manual',
      supplierId: row.supplierId,
      supplierCode: row.supplierCode,
      supplierName: row.supplierName,
      branchId: row.branchId,
      transferId: null,
      paymentId: row.id,
      reference: row.number,
      status: null,
      amountMinor: row.amountMinor,
      paymentAmountMinor: row.amountMinor,
      unallocatedMinor: 0,
      feeMinor: null,
      failureCode: null,
      failureMessage: null,
      occurredAt: row.paidAt.toISOString(),
      attention: false,
    })
    totals.manualMinor += row.amountMinor
  }

  rows.sort((a, b) => b.occurredAt.localeCompare(a.occurredAt))

  return { from: query.from ?? null, to: query.to ?? null, branchId, rows, totals }
}
