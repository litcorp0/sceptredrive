import { type DbExecutor, db } from '@gikautos/db'
import { taxBreakdown } from '@gikautos/shared'
import { assertBranchAccess, resolveBranchFilter } from '../../auth/scope.ts'
import { actorLabel } from '../../http/audit-context.ts'
import { AppError, ConflictError, NotFoundError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { attachReceiptSupplier, loadReceiptForPayables } from '../inventory/inventory.service.ts'
import type { ReceiptForPayables } from '../inventory/inventory.types.ts'
import * as branchesService from '../org/branches.service.ts'
import { writeAudit } from '../platform/audit.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { isUniqueViolation, uniqueViolationConstraint } from '../platform/db-errors.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { findProductById } from '../products/products.repository.ts'
import { sumSupplierOwed } from '../suppliers/suppliers.repository.ts'
import {
  lockSupplier,
  recordInvoiceCosts,
  requirePaymentDetail,
  requireSupplier,
} from '../suppliers/suppliers.service.ts'
import {
  countInvoices,
  countPayments,
  findInvoiceByIdempotency,
  findInvoiceByReceipt,
  findInvoiceBySupplierNumber,
  findPaymentByIdempotency,
  insertAllocation,
  insertInvoice,
  insertInvoiceLines,
  insertPayment,
  lockInvoiceForUpdate,
  lockInvoicesForUpdate,
  lockPaymentForUpdate,
  selectAgingInvoiceRows,
  selectAllocationsByInvoice,
  selectAllocationsByPayment,
  selectInvoiceDetailHeader,
  selectInvoiceLines,
  selectInvoicePage,
  selectInvoiceReconciliationRows,
  selectOnAccountBySupplier,
  selectOutstandingBySupplier,
  selectPaymentDetailHeader,
  selectPaymentPage,
  selectSupplierIdsWithActivity,
  setInvoiceAmountPaid,
  sumAllocationsForInvoice,
  voidInvoiceRow,
  voidPaymentRow,
} from './payables.repository.ts'
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
  SupplierBalanceResult,
  SupplierBalanceRow,
  SupplierInvoiceRow,
} from './payables.types.ts'

/** Effective invoice line after receipt copy or operator input. */
interface EffectiveLine {
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

async function loadInvoice(invoiceId: string): Promise<InvoiceDetail> {
  const header = await selectInvoiceDetailHeader(invoiceId)
  if (!header) throw new NotFoundError('Supplier invoice not found')
  const [lines, allocations] = await Promise.all([
    selectInvoiceLines(invoiceId),
    selectAllocationsByInvoice(invoiceId),
  ])
  return {
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

      await insertInvoiceLines(
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

/**
 * Records a payment to a supplier with explicit allocations (D7). The
 * unallocated remainder is held on account. Allocations lock their invoices
 * FOR UPDATE in id order so two concurrent payments can never over-apply an
 * invoice; the status projection is recomputed from the allocation ledger.
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

  const allocations = input.allocations ?? []
  const seenInvoices = new Set<string>()
  for (const allocation of allocations) {
    if (!Number.isSafeInteger(allocation.amountMinor) || allocation.amountMinor < 1) {
      throw new ValidationError('Allocation amounts must be positive whole numbers')
    }
    if (seenInvoices.has(allocation.invoiceId)) {
      throw new ValidationError('Each invoice may appear only once in a payment')
    }
    seenInvoices.add(allocation.invoiceId)
  }
  const allocatedTotal = allocations.reduce((sum, row) => sum + row.amountMinor, 0)
  if (allocatedTotal > input.amountMinor) {
    throw new ValidationError('Allocations cannot exceed the payment amount')
  }

  if (input.idempotencyKey) {
    const replay = await findPaymentByIdempotency(branchId, input.idempotencyKey)
    if (replay) return { payment: await loadPayment(replay.id), replayed: true }
  }

  let outcome: { id: string; replayed: boolean }
  try {
    outcome = await db.transaction(async (tx) => {
      if (input.idempotencyKey) {
        const raced = await findPaymentByIdempotency(branchId, input.idempotencyKey, tx)
        if (raced) return { id: raced.id, replayed: true }
      }

      await lockSupplier(supplier.id, tx)
      const number = await allocateFromSequence('payable.paymentSequence', tx)

      const lockedInvoices = await lockInvoicesForUpdate(
        allocations.map((allocation) => allocation.invoiceId),
        tx,
      )
      const invoicesById = new Map(lockedInvoices.map((row) => [row.id, row]))

      // Validate in sorted id order (matches the lock order above).
      const sortedAllocations = [...allocations].sort((a, b) =>
        a.invoiceId.localeCompare(b.invoiceId),
      )
      for (const allocation of sortedAllocations) {
        const invoice = invoicesById.get(allocation.invoiceId)
        if (!invoice) throw new NotFoundError('Supplier invoice not found')
        if (invoice.supplierId !== supplier.id) {
          throw new ConflictError('The invoice belongs to another supplier')
        }
        if (invoice.status === 'VOID') {
          throw new ConflictError(`Invoice ${invoice.number} is void and cannot receive payments`)
        }
        assertBranchAccess(user, invoice.branchId)
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
          supplierId: supplier.id,
          branchId,
          method: input.method,
          amountMinor: input.amountMinor,
          reference: input.reference ?? null,
          paidAt,
          paymentDetailId: input.paymentDetailId ?? null,
          note: input.note ?? null,
          idempotencyKey: input.idempotencyKey ?? null,
          createdBy: actorLabel(actor),
        },
        tx,
      )
      if (!payment)
        throw new AppError(500, 'INTERNAL_ERROR', 'Failed to create the supplier payment')

      for (const allocation of sortedAllocations) {
        await insertAllocation(
          {
            paymentId: payment.id,
            invoiceId: allocation.invoiceId,
            kind: 'APPLY',
            amountMinor: allocation.amountMinor,
            createdBy: actorLabel(actor),
          },
          tx,
        )
        const invoice = invoicesById.get(allocation.invoiceId)
        if (!invoice) continue
        const paid = invoice.amountPaidMinor + allocation.amountMinor
        const status: InvoiceStatus =
          paid >= invoice.totalMinor ? 'PAID' : paid > 0 ? 'PARTIAL' : 'OPEN'
        await setInvoiceAmountPaid(invoice.id, paid, status, tx)
      }

      await writeAudit(
        {
          ...actor,
          action: 'supplier_payment.created',
          entity: 'supplier_payment',
          entityId: payment.id,
          branchId,
          after: {
            number,
            supplierId: supplier.id,
            method: input.method,
            amountMinor: input.amountMinor,
            allocations: sortedAllocations,
            onAccountMinor: input.amountMinor - allocatedTotal,
          },
        },
        tx,
      )

      return { id: payment.id, replayed: false }
    })
  } catch (error) {
    if (isUniqueViolation(error) && input.idempotencyKey) {
      const replay = await findPaymentByIdempotency(branchId, input.idempotencyKey)
      if (replay) return { payment: await loadPayment(replay.id), replayed: true }
    }
    throw error
  }

  return { payment: await loadPayment(outcome.id), replayed: outcome.replayed }
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
    status: query.status ?? null,
    overdue: query.overdue,
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
  const [outstandingRows, onAccountRows] = await Promise.all([
    selectOutstandingBySupplier(branchId, isoDay(new Date())),
    selectOnAccountBySupplier(branchId, null),
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
      owedMinor: 0,
      overdueMinor: 0,
      invoiceCount: 0,
    }
    balance.onAccountMinor = row.onAccountMinor
    balance.owedMinor = balance.invoiceOutstandingMinor - row.onAccountMinor
    bySupplier.set(row.supplierId, balance)
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

  const [invoiceRows, onAccountRows] = await Promise.all([
    selectAgingInvoiceRows({ branchId, supplierId }),
    selectOnAccountBySupplier(branchId, supplierId),
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

  return { asOf, branchId, suppliers, totals, totalOutstandingMinor, totalOnAccountMinor }
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
