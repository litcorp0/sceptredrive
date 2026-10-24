import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, desc, eq, gte, inArray, lt, lte, ne, type SQL, sql } from 'drizzle-orm'
import { stockReceipt } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from './payables.schema.ts'
import type {
  InvoiceAllocationRow,
  InvoiceDetailHeader,
  InvoiceLineView,
  InvoiceListFilters,
  InvoiceListRow,
  InvoiceReconciliationRow,
  InvoiceStatus,
  PayableAgingInvoiceSourceRow,
  PaymentAllocationView,
  PaymentDetailHeader,
  PaymentListFilters,
  PaymentListRow,
  SupplierInvoiceRow,
  SupplierOnAccountRow,
  SupplierOutstandingRow,
  SupplierPaymentAllocationRow,
  SupplierPaymentRow,
} from './payables.types.ts'

const paymentSelection = {
  id: supplierPayment.id,
  number: supplierPayment.number,
  supplierId: supplierPayment.supplierId,
  branchId: supplierPayment.branchId,
  method: supplierPayment.method,
  amountMinor: supplierPayment.amountMinor,
  reference: supplierPayment.reference,
  paidAt: supplierPayment.paidAt,
  paymentDetailId: supplierPayment.paymentDetailId,
  status: supplierPayment.status,
  voidReason: supplierPayment.voidReason,
  voidedBy: supplierPayment.voidedBy,
  voidedAt: supplierPayment.voidedAt,
  note: supplierPayment.note,
  idempotencyKey: supplierPayment.idempotencyKey,
  createdBy: supplierPayment.createdBy,
  createdAt: supplierPayment.createdAt,
  updatedAt: supplierPayment.updatedAt,
}

export async function insertInvoice(
  values: typeof supplierInvoice.$inferInsert,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor.insert(supplierInvoice).values(values).returning()
  return rows[0] ?? null
}

export async function insertInvoiceLines(
  values: (typeof supplierInvoiceLine.$inferInsert)[],
  executor: DbExecutor = db,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(supplierInvoiceLine).values(values)
}

export async function findInvoiceById(
  id: string,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .select()
    .from(supplierInvoice)
    .where(eq(supplierInvoice.id, id))
    .limit(1)
  return rows[0] ?? null
}

/** Invoice header joined with supplier and linked receipt summaries (detail view). */
export async function selectInvoiceDetailHeader(
  id: string,
  executor: DbExecutor = db,
): Promise<InvoiceDetailHeader | null> {
  const rows = await executor
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierId: supplierInvoice.supplierId,
      branchId: supplierInvoice.branchId,
      supplierInvoiceNumber: supplierInvoice.supplierInvoiceNumber,
      invoiceDate: supplierInvoice.invoiceDate,
      dueDate: supplierInvoice.dueDate,
      receiptId: supplierInvoice.receiptId,
      subtotalMinor: supplierInvoice.subtotalMinor,
      vatMinor: supplierInvoice.vatMinor,
      nhilMinor: supplierInvoice.nhilMinor,
      getfundMinor: supplierInvoice.getfundMinor,
      totalMinor: supplierInvoice.totalMinor,
      amountPaidMinor: supplierInvoice.amountPaidMinor,
      status: supplierInvoice.status,
      voidReason: supplierInvoice.voidReason,
      voidedBy: supplierInvoice.voidedBy,
      voidedAt: supplierInvoice.voidedAt,
      note: supplierInvoice.note,
      idempotencyKey: supplierInvoice.idempotencyKey,
      createdBy: supplierInvoice.createdBy,
      createdAt: supplierInvoice.createdAt,
      updatedAt: supplierInvoice.updatedAt,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      receiptNumber: stockReceipt.number,
      receiptBranchId: stockReceipt.branchId,
    })
    .from(supplierInvoice)
    .innerJoin(supplier, eq(supplier.id, supplierInvoice.supplierId))
    .leftJoin(stockReceipt, eq(stockReceipt.id, supplierInvoice.receiptId))
    .where(eq(supplierInvoice.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null

  const { supplierCode, supplierName, receiptNumber, receiptBranchId, ...invoice } = row
  return {
    invoice,
    supplier: { id: invoice.supplierId, code: supplierCode, name: supplierName },
    receipt:
      receiptNumber && receiptBranchId && invoice.receiptId
        ? { id: invoice.receiptId, number: receiptNumber, branchId: receiptBranchId }
        : null,
  }
}

export async function findInvoiceByReceipt(
  receiptId: string,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .select()
    .from(supplierInvoice)
    .where(eq(supplierInvoice.receiptId, receiptId))
    .limit(1)
  return rows[0] ?? null
}

export async function findInvoiceBySupplierNumber(
  supplierId: string,
  branchId: string,
  supplierInvoiceNumber: string,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .select()
    .from(supplierInvoice)
    .where(
      and(
        eq(supplierInvoice.supplierId, supplierId),
        eq(supplierInvoice.branchId, branchId),
        eq(supplierInvoice.supplierInvoiceNumber, supplierInvoiceNumber),
        sql`${supplierInvoice.status} <> 'VOID'`,
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function findInvoiceByIdempotency(
  branchId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .select()
    .from(supplierInvoice)
    .where(
      and(
        eq(supplierInvoice.branchId, branchId),
        eq(supplierInvoice.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function lockInvoiceForUpdate(
  id: string,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .select()
    .from(supplierInvoice)
    .where(eq(supplierInvoice.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

/** Locks many invoices in a stable sorted order (deadlock-safe, D12). */
export async function lockInvoicesForUpdate(
  ids: readonly string[],
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow[]> {
  if (ids.length === 0) return []
  const sorted = [...new Set(ids)].sort()
  return executor
    .select()
    .from(supplierInvoice)
    .where(inArray(supplierInvoice.id, sorted))
    .orderBy(asc(supplierInvoice.id))
    .for('update')
}

export async function setInvoiceAmountPaid(
  id: string,
  amountPaidMinor: number,
  status: InvoiceStatus,
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .update(supplierInvoice)
    .set({ amountPaidMinor, status })
    .where(eq(supplierInvoice.id, id))
    .returning()
  return rows[0] ?? null
}

export async function voidInvoiceRow(
  id: string,
  values: { voidReason: SupplierInvoiceRow['voidReason']; voidedBy: string | null; voidedAt: Date },
  executor: DbExecutor = db,
): Promise<SupplierInvoiceRow | null> {
  const rows = await executor
    .update(supplierInvoice)
    .set({ status: 'VOID', ...values })
    .where(eq(supplierInvoice.id, id))
    .returning()
  return rows[0] ?? null
}

function invoiceConditions(filters: InvoiceListFilters): SQL | undefined {
  const conditions: SQL[] = []
  if (filters.supplierId) conditions.push(eq(supplierInvoice.supplierId, filters.supplierId))
  if (filters.branchId) conditions.push(eq(supplierInvoice.branchId, filters.branchId))
  if (filters.receiptId) conditions.push(eq(supplierInvoice.receiptId, filters.receiptId))
  if (filters.status) conditions.push(eq(supplierInvoice.status, filters.status))
  if (filters.overdue) {
    conditions.push(inArray(supplierInvoice.status, ['OPEN', 'PARTIAL']))
    conditions.push(lt(supplierInvoice.dueDate, filters.asOfDate))
  }
  if (filters.from) conditions.push(gte(supplierInvoice.invoiceDate, filters.from))
  if (filters.to) conditions.push(lte(supplierInvoice.invoiceDate, filters.to))
  return and(...conditions)
}

export async function selectInvoicePage(filters: InvoiceListFilters): Promise<InvoiceListRow[]> {
  const rows = await db
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierId: supplierInvoice.supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      branchId: supplierInvoice.branchId,
      branchCode: branch.code,
      branchName: branch.name,
      supplierInvoiceNumber: supplierInvoice.supplierInvoiceNumber,
      invoiceDate: supplierInvoice.invoiceDate,
      dueDate: supplierInvoice.dueDate,
      receiptId: supplierInvoice.receiptId,
      subtotalMinor: supplierInvoice.subtotalMinor,
      vatMinor: supplierInvoice.vatMinor,
      nhilMinor: supplierInvoice.nhilMinor,
      getfundMinor: supplierInvoice.getfundMinor,
      totalMinor: supplierInvoice.totalMinor,
      amountPaidMinor: supplierInvoice.amountPaidMinor,
      status: supplierInvoice.status,
      createdAt: supplierInvoice.createdAt,
    })
    .from(supplierInvoice)
    .innerJoin(supplier, eq(supplier.id, supplierInvoice.supplierId))
    .innerJoin(branch, eq(branch.id, supplierInvoice.branchId))
    .where(invoiceConditions(filters))
    .orderBy(desc(supplierInvoice.invoiceDate), desc(supplierInvoice.number))
    .limit(filters.limit)
    .offset(filters.offset)

  return rows.map((row) => ({
    ...row,
    outstandingMinor: row.totalMinor - row.amountPaidMinor,
  }))
}

export async function countInvoices(filters: InvoiceListFilters): Promise<number> {
  const rows = await db
    .select({ total: count() })
    .from(supplierInvoice)
    .where(invoiceConditions(filters))
  return rows[0]?.total ?? 0
}

export async function selectInvoiceLines(
  invoiceId: string,
  executor: DbExecutor = db,
): Promise<InvoiceLineView[]> {
  return executor
    .select({
      id: supplierInvoiceLine.id,
      productId: supplierInvoiceLine.productId,
      sku: product.sku,
      productName: product.name,
      description: supplierInvoiceLine.description,
      quantity: supplierInvoiceLine.quantity,
      unitCostMinor: supplierInvoiceLine.unitCostMinor,
      lineTotalMinor: supplierInvoiceLine.lineTotalMinor,
    })
    .from(supplierInvoiceLine)
    .leftJoin(product, eq(product.id, supplierInvoiceLine.productId))
    .where(eq(supplierInvoiceLine.invoiceId, invoiceId))
    .orderBy(asc(supplierInvoiceLine.createdAt), asc(supplierInvoiceLine.id))
}

export async function selectAllocationsByInvoice(
  invoiceId: string,
  executor: DbExecutor = db,
): Promise<InvoiceAllocationRow[]> {
  return executor
    .select({
      id: supplierPaymentAllocation.id,
      paymentId: supplierPaymentAllocation.paymentId,
      paymentNumber: supplierPayment.number,
      method: supplierPayment.method,
      paymentStatus: supplierPayment.status,
      paidAt: supplierPayment.paidAt,
      kind: supplierPaymentAllocation.kind,
      amountMinor: supplierPaymentAllocation.amountMinor,
      reversesAllocationId: supplierPaymentAllocation.reversesAllocationId,
      note: supplierPaymentAllocation.note,
      createdAt: supplierPaymentAllocation.createdAt,
    })
    .from(supplierPaymentAllocation)
    .innerJoin(supplierPayment, eq(supplierPayment.id, supplierPaymentAllocation.paymentId))
    .where(eq(supplierPaymentAllocation.invoiceId, invoiceId))
    .orderBy(asc(supplierPaymentAllocation.createdAt), asc(supplierPaymentAllocation.id))
}

/** Signed sum: APPLY rows are positive, RELEASE rows negative. */
export async function sumAllocationsForInvoice(
  invoiceId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(
        Number,
      ),
    })
    .from(supplierPaymentAllocation)
    .where(eq(supplierPaymentAllocation.invoiceId, invoiceId))
  return rows[0]?.total ?? 0
}

export async function insertPayment(
  values: typeof supplierPayment.$inferInsert,
  executor: DbExecutor = db,
): Promise<SupplierPaymentRow | null> {
  const rows = await executor.insert(supplierPayment).values(values).returning()
  return rows[0] ?? null
}

export async function findPaymentById(
  id: string,
  executor: DbExecutor = db,
): Promise<SupplierPaymentRow | null> {
  const rows = await executor
    .select()
    .from(supplierPayment)
    .where(eq(supplierPayment.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findPaymentByIdempotency(
  branchId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
): Promise<SupplierPaymentRow | null> {
  const rows = await executor
    .select()
    .from(supplierPayment)
    .where(
      and(
        eq(supplierPayment.branchId, branchId),
        eq(supplierPayment.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1)
  return rows[0] ?? null
}

/** Payment header joined with the supplier summary (detail view). */
export async function selectPaymentDetailHeader(
  id: string,
  executor: DbExecutor = db,
): Promise<PaymentDetailHeader | null> {
  const rows = await executor
    .select({ ...paymentSelection, supplierCode: supplier.code, supplierName: supplier.name })
    .from(supplierPayment)
    .innerJoin(supplier, eq(supplier.id, supplierPayment.supplierId))
    .where(eq(supplierPayment.id, id))
    .limit(1)

  const row = rows[0]
  if (!row) return null
  const { supplierCode, supplierName, ...payment } = row
  return {
    payment,
    supplier: { id: payment.supplierId, code: supplierCode, name: supplierName },
  }
}

/** Allocation ledger rows with their invoice references, oldest first. */
export async function selectAllocationsByPayment(
  paymentId: string,
  executor: DbExecutor = db,
): Promise<PaymentAllocationView[]> {
  return executor
    .select({
      id: supplierPaymentAllocation.id,
      invoiceId: supplierPaymentAllocation.invoiceId,
      invoiceNumber: supplierInvoice.number,
      supplierInvoiceNumber: supplierInvoice.supplierInvoiceNumber,
      invoiceBranchId: supplierInvoice.branchId,
      kind: supplierPaymentAllocation.kind,
      amountMinor: supplierPaymentAllocation.amountMinor,
      reversesAllocationId: supplierPaymentAllocation.reversesAllocationId,
      createdAt: supplierPaymentAllocation.createdAt,
    })
    .from(supplierPaymentAllocation)
    .innerJoin(supplierInvoice, eq(supplierInvoice.id, supplierPaymentAllocation.invoiceId))
    .where(eq(supplierPaymentAllocation.paymentId, paymentId))
    .orderBy(asc(supplierPaymentAllocation.createdAt), asc(supplierPaymentAllocation.id))
}

/** Signed sum: APPLY rows are positive, RELEASE rows negative. */
export async function sumAllocationsForPayment(
  paymentId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(
        Number,
      ),
    })
    .from(supplierPaymentAllocation)
    .where(eq(supplierPaymentAllocation.paymentId, paymentId))
  return rows[0]?.total ?? 0
}

export async function insertAllocation(
  values: typeof supplierPaymentAllocation.$inferInsert,
  executor: DbExecutor = db,
): Promise<SupplierPaymentAllocationRow | null> {
  const rows = await executor.insert(supplierPaymentAllocation).values(values).returning()
  return rows[0] ?? null
}

/** Payments that have at least one allocation against the invoice, with totals. */
export async function selectPaymentsByInvoice(
  invoiceId: string,
  executor: DbExecutor = db,
): Promise<PaymentListRow[]> {
  const allocatedMinor =
    sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(Number)

  const rows = await executor
    .select({
      ...paymentSelection,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      branchCode: branch.code,
      branchName: branch.name,
      allocatedMinor,
    })
    .from(supplierPayment)
    .innerJoin(supplier, eq(supplier.id, supplierPayment.supplierId))
    .innerJoin(branch, eq(branch.id, supplierPayment.branchId))
    .leftJoin(
      supplierPaymentAllocation,
      eq(supplierPaymentAllocation.paymentId, supplierPayment.id),
    )
    .where(
      inArray(
        supplierPayment.id,
        db
          .select({ paymentId: supplierPaymentAllocation.paymentId })
          .from(supplierPaymentAllocation)
          .where(eq(supplierPaymentAllocation.invoiceId, invoiceId)),
      ),
    )
    .groupBy(supplierPayment.id, supplier.code, supplier.name, branch.code, branch.name)
    .orderBy(asc(supplierPayment.paidAt), asc(supplierPayment.number))

  return rows.map((row) => ({
    ...row,
    unallocatedMinor: row.amountMinor - row.allocatedMinor,
  }))
}

/** Locks a payment row for the void transaction. */
export async function lockPaymentForUpdate(
  id: string,
  executor: DbExecutor = db,
): Promise<SupplierPaymentRow | null> {
  const rows = await executor
    .select()
    .from(supplierPayment)
    .where(eq(supplierPayment.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function voidPaymentRow(
  id: string,
  values: Pick<typeof supplierPayment.$inferInsert, 'voidReason' | 'voidedBy' | 'voidedAt'>,
  executor: DbExecutor = db,
): Promise<SupplierPaymentRow | null> {
  const rows = await executor
    .update(supplierPayment)
    .set({ status: 'VOID', ...values })
    .where(eq(supplierPayment.id, id))
    .returning()
  return rows[0] ?? null
}

function paymentConditions(filters: PaymentListFilters): SQL[] {
  const conditions: SQL[] = []
  if (filters.supplierId) conditions.push(eq(supplierPayment.supplierId, filters.supplierId))
  if (filters.branchId) conditions.push(eq(supplierPayment.branchId, filters.branchId))
  if (filters.method) conditions.push(eq(supplierPayment.method, filters.method))
  if (filters.status) conditions.push(eq(supplierPayment.status, filters.status))
  if (filters.from) conditions.push(gte(supplierPayment.paidAt, filters.from))
  // `to` is exclusive (the day after the requested range end).
  if (filters.to) conditions.push(lt(supplierPayment.paidAt, filters.to))
  return conditions
}

export async function selectPaymentPage(filters: PaymentListFilters): Promise<PaymentListRow[]> {
  const allocatedMinor =
    sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(Number)

  const rows = await db
    .select({
      ...paymentSelection,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      branchCode: branch.code,
      branchName: branch.name,
      allocatedMinor,
    })
    .from(supplierPayment)
    .innerJoin(supplier, eq(supplier.id, supplierPayment.supplierId))
    .innerJoin(branch, eq(branch.id, supplierPayment.branchId))
    .leftJoin(
      supplierPaymentAllocation,
      eq(supplierPaymentAllocation.paymentId, supplierPayment.id),
    )
    .where(and(...paymentConditions(filters)))
    .groupBy(supplierPayment.id, supplier.code, supplier.name, branch.code, branch.name)
    .orderBy(desc(supplierPayment.paidAt), desc(supplierPayment.number))
    .limit(filters.limit)
    .offset(filters.offset)

  return rows.map((row) => ({
    ...row,
    unallocatedMinor: row.amountMinor - row.allocatedMinor,
  }))
}

export async function countPayments(filters: PaymentListFilters): Promise<number> {
  const rows = await db
    .select({ value: count() })
    .from(supplierPayment)
    .where(and(...paymentConditions(filters)))
  return rows[0]?.value ?? 0
}

/** Per-supplier invoice aggregates for the balances view (branch optional). */
export async function selectOutstandingBySupplier(
  branchId: string | null,
  todayIso: string,
  executor: DbExecutor = db,
): Promise<SupplierOutstandingRow[]> {
  const outstandingMinor =
    sql<number>`coalesce(sum(${supplierInvoice.totalMinor} - ${supplierInvoice.amountPaidMinor}), 0)`.mapWith(
      Number,
    )
  const overdueMinor =
    sql<number>`coalesce(sum(case when ${supplierInvoice.dueDate} < ${todayIso} then ${supplierInvoice.totalMinor} - ${supplierInvoice.amountPaidMinor} else 0 end), 0)`.mapWith(
      Number,
    )

  const conditions: SQL[] = [
    ne(supplierInvoice.status, 'VOID'),
    sql`${supplierInvoice.totalMinor} - ${supplierInvoice.amountPaidMinor} > 0`,
  ]
  if (branchId) conditions.push(eq(supplierInvoice.branchId, branchId))

  return executor
    .select({
      supplierId: supplierInvoice.supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      outstandingMinor,
      overdueMinor,
      invoiceCount: count(),
    })
    .from(supplierInvoice)
    .innerJoin(supplier, eq(supplier.id, supplierInvoice.supplierId))
    .where(and(...conditions))
    .groupBy(supplierInvoice.supplierId, supplier.code, supplier.name)
    .orderBy(asc(supplier.name))
}

/**
 * Per-supplier on-account position: completed payment totals minus the signed
 * sum of their allocations (RELEASE rows are negative). Bulk mirror of the
 * suppliers module `sumSupplierOwed` formula.
 */
export async function selectOnAccountBySupplier(
  branchId: string | null,
  supplierId: string | null,
  executor: DbExecutor = db,
): Promise<SupplierOnAccountRow[]> {
  const conditions: SQL[] = [eq(supplierPayment.status, 'COMPLETED')]
  if (branchId) conditions.push(eq(supplierPayment.branchId, branchId))
  if (supplierId) conditions.push(eq(supplierPayment.supplierId, supplierId))

  const [payments, allocations] = await Promise.all([
    executor
      .select({
        supplierId: supplierPayment.supplierId,
        supplierCode: supplier.code,
        supplierName: supplier.name,
        total: sql<number>`coalesce(sum(${supplierPayment.amountMinor}), 0)`.mapWith(Number),
      })
      .from(supplierPayment)
      .innerJoin(supplier, eq(supplier.id, supplierPayment.supplierId))
      .where(and(...conditions))
      .groupBy(supplierPayment.supplierId, supplier.code, supplier.name),
    executor
      .select({
        supplierId: supplierPayment.supplierId,
        total: sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(
          Number,
        ),
      })
      .from(supplierPaymentAllocation)
      .innerJoin(supplierPayment, eq(supplierPayment.id, supplierPaymentAllocation.paymentId))
      .where(and(...conditions))
      .groupBy(supplierPayment.supplierId),
  ])

  const allocatedBySupplier = new Map(allocations.map((row) => [row.supplierId, row.total]))
  return payments.map((row) => ({
    supplierId: row.supplierId,
    supplierCode: row.supplierCode,
    supplierName: row.supplierName,
    onAccountMinor: row.total - (allocatedBySupplier.get(row.supplierId) ?? 0),
  }))
}

/** Outstanding invoices joined to their supplier, for the aging report. */
export async function selectAgingInvoiceRows(
  filters: { branchId: string | null; supplierId: string | null },
  executor: DbExecutor = db,
): Promise<PayableAgingInvoiceSourceRow[]> {
  const conditions: SQL[] = [
    inArray(supplierInvoice.status, ['OPEN', 'PARTIAL']),
    sql`${supplierInvoice.totalMinor} - ${supplierInvoice.amountPaidMinor} > 0`,
  ]
  if (filters.branchId) conditions.push(eq(supplierInvoice.branchId, filters.branchId))
  if (filters.supplierId) conditions.push(eq(supplierInvoice.supplierId, filters.supplierId))

  return executor
    .select({
      invoiceId: supplierInvoice.id,
      number: supplierInvoice.number,
      supplierInvoiceNumber: supplierInvoice.supplierInvoiceNumber,
      dueDate: supplierInvoice.dueDate,
      outstandingMinor:
        sql<number>`${supplierInvoice.totalMinor} - ${supplierInvoice.amountPaidMinor}`.mapWith(
          Number,
        ),
      supplierId: supplierInvoice.supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
    })
    .from(supplierInvoice)
    .innerJoin(supplier, eq(supplier.id, supplierInvoice.supplierId))
    .where(and(...conditions))
    .orderBy(asc(supplier.name), asc(supplierInvoice.dueDate), asc(supplierInvoice.number))
}

/** Every invoice with its signed allocation sum, for reconciliation. */
export async function selectInvoiceReconciliationRows(
  executor: DbExecutor = db,
): Promise<InvoiceReconciliationRow[]> {
  return executor
    .select({
      id: supplierInvoice.id,
      number: supplierInvoice.number,
      status: supplierInvoice.status,
      totalMinor: supplierInvoice.totalMinor,
      amountPaidMinor: supplierInvoice.amountPaidMinor,
      netAllocatedMinor:
        sql<number>`coalesce(sum(${supplierPaymentAllocation.amountMinor}), 0)`.mapWith(Number),
    })
    .from(supplierInvoice)
    .leftJoin(
      supplierPaymentAllocation,
      eq(supplierPaymentAllocation.invoiceId, supplierInvoice.id),
    )
    .groupBy(supplierInvoice.id)
    .orderBy(asc(supplierInvoice.number))
}

/** Suppliers that own at least one invoice or payment. */
export async function selectSupplierIdsWithActivity(executor: DbExecutor = db): Promise<string[]> {
  const [invoiceRows, paymentRows] = await Promise.all([
    executor.selectDistinct({ supplierId: supplierInvoice.supplierId }).from(supplierInvoice),
    executor.selectDistinct({ supplierId: supplierPayment.supplierId }).from(supplierPayment),
  ])
  return [...new Set([...invoiceRows, ...paymentRows].map((row) => row.supplierId))].sort()
}
