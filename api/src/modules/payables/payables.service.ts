import { db } from '@gikautos/db'
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
import {
  lockSupplier,
  recordInvoiceCosts,
  requireSupplier,
} from '../suppliers/suppliers.service.ts'
import {
  countInvoices,
  findInvoiceByIdempotency,
  findInvoiceByReceipt,
  findInvoiceBySupplierNumber,
  insertInvoice,
  insertInvoiceLines,
  lockInvoiceForUpdate,
  selectAllocationsByInvoice,
  selectInvoiceDetailHeader,
  selectInvoiceLines,
  selectInvoicePage,
  sumAllocationsForInvoice,
  voidInvoiceRow,
} from './payables.repository.ts'
import type {
  InvoiceCreateBody,
  InvoiceCreateResult,
  InvoiceDetail,
  InvoiceListFilters,
  InvoiceListQuery,
  InvoiceListResult,
  InvoiceVoidReason,
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
