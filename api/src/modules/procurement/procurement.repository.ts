import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, desc, eq, ilike, inArray, ne, or, sql, sum } from 'drizzle-orm'
import { stockReceipt, stockReceiptLine } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import {
  purchaseOrder,
  purchaseOrderLine,
  supplierCreditNote,
  supplierReturn,
  supplierReturnLine,
} from './procurement.schema.ts'
import type { OrderLineInput, OrderListQuery } from './procurement.types.ts'

/**
 * Data access for purchase orders. No lifecycle rules live here: a status change
 * is always the service's decision, and every write takes an executor so it can
 * enlist in that decision's transaction.
 */

export async function insertOrder(
  values: typeof purchaseOrder.$inferInsert,
  executor: DbExecutor,
): Promise<typeof purchaseOrder.$inferSelect> {
  const rows = await executor.insert(purchaseOrder).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert purchase order')
  return row
}

export async function insertOrderLines(
  orderId: string,
  lines: readonly OrderLineInput[],
  executor: DbExecutor,
): Promise<void> {
  if (lines.length === 0) return
  await executor.insert(purchaseOrderLine).values(
    lines.map((line, index) => ({
      orderId,
      lineNumber: index + 1,
      productId: line.productId,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
    })),
  )
}

/** DRAFT orders only; the service is what keeps that promise. */
export async function deleteOrderLines(orderId: string, executor: DbExecutor): Promise<void> {
  await executor.delete(purchaseOrderLine).where(eq(purchaseOrderLine.orderId, orderId))
}

export async function findOrderById(
  id: string,
  executor: DbExecutor = db,
): Promise<typeof purchaseOrder.$inferSelect | null> {
  const rows = await executor.select().from(purchaseOrder).where(eq(purchaseOrder.id, id)).limit(1)
  return rows[0] ?? null
}

export async function lockOrderForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<typeof purchaseOrder.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(purchaseOrder)
    .where(eq(purchaseOrder.id, id))
    .for('update')
  return rows[0] ?? null
}

export async function findOrderByIdempotency(
  branchId: string,
  key: string,
  executor: DbExecutor = db,
): Promise<typeof purchaseOrder.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(purchaseOrder)
    .where(and(eq(purchaseOrder.branchId, branchId), eq(purchaseOrder.idempotencyKey, key)))
    .limit(1)
  return rows[0] ?? null
}

export async function updateOrderRow(
  id: string,
  patch: Partial<typeof purchaseOrder.$inferInsert>,
  executor: DbExecutor,
): Promise<typeof purchaseOrder.$inferSelect | null> {
  const rows = await executor
    .update(purchaseOrder)
    .set(patch)
    .where(eq(purchaseOrder.id, id))
    .returning()
  return rows[0] ?? null
}

export async function selectOrderLines(
  orderId: string,
  executor: DbExecutor = db,
): Promise<
  {
    id: string
    lineNumber: number
    productId: string
    sku: string
    name: string
    quantity: number
    unitCostMinor: number
  }[]
> {
  return executor
    .select({
      id: purchaseOrderLine.id,
      lineNumber: purchaseOrderLine.lineNumber,
      productId: purchaseOrderLine.productId,
      sku: product.sku,
      name: product.name,
      quantity: purchaseOrderLine.quantity,
      unitCostMinor: purchaseOrderLine.unitCostMinor,
    })
    .from(purchaseOrderLine)
    .innerJoin(product, eq(product.id, purchaseOrderLine.productId))
    .where(eq(purchaseOrderLine.orderId, orderId))
    .orderBy(asc(purchaseOrderLine.lineNumber))
}

/** The one definition of "received": Σ receipt lines pointing at this order's lines. */
export async function selectReceivedByOrderLine(
  orderId: string,
  executor: DbExecutor = db,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({
      lineId: stockReceiptLine.purchaseOrderLineId,
      received: sum(stockReceiptLine.quantity).mapWith(Number),
    })
    .from(stockReceiptLine)
    .innerJoin(purchaseOrderLine, eq(purchaseOrderLine.id, stockReceiptLine.purchaseOrderLineId))
    .where(eq(purchaseOrderLine.orderId, orderId))
    .groupBy(stockReceiptLine.purchaseOrderLineId)

  const map = new Map<string, number>()
  for (const row of rows) {
    if (row.lineId) map.set(row.lineId, row.received)
  }
  return map
}

/** Σ(ordered − received) over open orders for one product — the on-order quantity (D9). */
export async function selectOpenOrderLineQuantity(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const received = sql<number>`coalesce(sum(${stockReceiptLine.quantity}), 0)`.mapWith(Number)
  const rows = await executor
    .select({
      ordered: sum(purchaseOrderLine.quantity).mapWith(Number),
      received,
    })
    .from(purchaseOrderLine)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
    .leftJoin(stockReceiptLine, eq(stockReceiptLine.purchaseOrderLineId, purchaseOrderLine.id))
    .where(
      and(
        eq(purchaseOrderLine.productId, productId),
        eq(purchaseOrder.branchId, branchId),
        or(
          eq(purchaseOrder.status, 'APPROVED'),
          eq(purchaseOrder.status, 'SENT'),
          eq(purchaseOrder.status, 'PARTIALLY_RECEIVED'),
        ),
      ),
    )
    .groupBy(purchaseOrderLine.id)

  const outstanding = rows.reduce(
    (total, row) => total + Math.max(row.ordered - row.received, 0),
    0,
  )
  return outstanding
}

export async function selectOrderPage(
  filters: OrderListQuery,
  executor: DbExecutor = db,
): Promise<
  {
    order: typeof purchaseOrder.$inferSelect
    supplierName: string
    branchCode: string
    goodsValueMinor: number
    orderedQuantity: number
    receivedQuantity: number
  }[]
> {
  const conditions = buildOrderConditions(filters)
  const goodsValueMinor =
    sql<number>`coalesce(sum(${purchaseOrderLine.quantity} * ${purchaseOrderLine.unitCostMinor}), 0)`.mapWith(
      Number,
    )
  const orderedQuantity = sql<number>`coalesce(sum(${purchaseOrderLine.quantity}), 0)`.mapWith(
    Number,
  )

  const rows = await executor
    .select({
      order: purchaseOrder,
      supplierName: supplier.name,
      branchCode: branch.code,
      goodsValueMinor,
      orderedQuantity,
    })
    .from(purchaseOrder)
    .innerJoin(supplier, eq(supplier.id, purchaseOrder.supplierId))
    .innerJoin(branch, eq(branch.id, purchaseOrder.branchId))
    .leftJoin(purchaseOrderLine, eq(purchaseOrderLine.orderId, purchaseOrder.id))
    .where(conditions)
    .groupBy(purchaseOrder.id, supplier.name, branch.code)
    .orderBy(desc(purchaseOrder.createdAt))
    .limit(filters.limit)
    .offset(filters.offset)

  // Received quantity is per order, so one grouped query covers the page.
  const receivedRows = await executor
    .select({
      orderId: purchaseOrderLine.orderId,
      received: sql<number>`coalesce(sum(${stockReceiptLine.quantity}), 0)`.mapWith(Number),
    })
    .from(purchaseOrderLine)
    .leftJoin(stockReceiptLine, eq(stockReceiptLine.purchaseOrderLineId, purchaseOrderLine.id))
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
    .where(conditions)
    .groupBy(purchaseOrderLine.orderId)
  const receivedByOrder = new Map(receivedRows.map((row) => [row.orderId, row.received]))

  return rows.map((row) => ({
    ...row,
    receivedQuantity: receivedByOrder.get(row.order.id) ?? 0,
  }))
}

export async function countOrders(
  filters: OrderListQuery,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(purchaseOrder)
    .innerJoin(supplier, eq(supplier.id, purchaseOrder.supplierId))
    .where(buildOrderConditions(filters))
  return Number(rows[0]?.total ?? 0)
}

export async function selectOrderWithSupplier(
  id: string,
  executor: DbExecutor = db,
): Promise<{
  order: typeof purchaseOrder.$inferSelect
  supplierName: string
  supplierCode: string
} | null> {
  const rows = await executor
    .select({
      order: purchaseOrder,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(purchaseOrder)
    .innerJoin(supplier, eq(supplier.id, purchaseOrder.supplierId))
    .where(eq(purchaseOrder.id, id))
    .limit(1)
  return rows[0] ?? null
}

function buildOrderConditions(filters: OrderListQuery) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(purchaseOrder.branchId, filters.branchId))
  if (filters.supplierId) conditions.push(eq(purchaseOrder.supplierId, filters.supplierId))
  if (filters.status) conditions.push(eq(purchaseOrder.status, filters.status))
  if (filters.q) {
    const pattern = `%${filters.q}%`
    conditions.push(or(ilike(purchaseOrder.number, pattern), ilike(supplier.name, pattern)))
  }
  if (conditions.length === 0) return sql`true`
  return and(...conditions)
}

/** Orders an invoice may cite: approved, sent, or partly received. */
export async function selectMatchableOrders(
  branchId: string,
  supplierId: string,
  limit = 20,
  executor: DbExecutor = db,
): Promise<
  {
    id: string
    number: string
    status: string
    expectedDate: string | null
    goodsValueMinor: number
  }[]
> {
  const goodsValueMinor =
    sql<number>`coalesce(sum(${purchaseOrderLine.quantity} * ${purchaseOrderLine.unitCostMinor}), 0)`.mapWith(
      Number,
    )

  return executor
    .select({
      id: purchaseOrder.id,
      number: purchaseOrder.number,
      status: purchaseOrder.status,
      expectedDate: purchaseOrder.expectedDate,
      goodsValueMinor,
    })
    .from(purchaseOrder)
    .leftJoin(purchaseOrderLine, eq(purchaseOrderLine.orderId, purchaseOrder.id))
    .where(
      and(
        eq(purchaseOrder.branchId, branchId),
        eq(purchaseOrder.supplierId, supplierId),
        inArray(purchaseOrder.status, ['APPROVED', 'SENT', 'PARTIALLY_RECEIVED']),
      ),
    )
    .groupBy(purchaseOrder.id)
    .orderBy(desc(purchaseOrder.createdAt))
    .limit(limit)
}

// ---------------------------------------------------------------- returns

export async function insertReturn(
  values: typeof supplierReturn.$inferInsert,
  executor: DbExecutor,
): Promise<typeof supplierReturn.$inferSelect> {
  const rows = await executor.insert(supplierReturn).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert supplier return')
  return row
}

export async function insertReturnLines(
  values: (typeof supplierReturnLine.$inferInsert)[],
  executor: DbExecutor,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(supplierReturnLine).values(values)
}

export async function findReturnById(
  id: string,
  executor: DbExecutor = db,
): Promise<typeof supplierReturn.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(supplierReturn)
    .where(eq(supplierReturn.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function lockReturnForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<typeof supplierReturn.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(supplierReturn)
    .where(eq(supplierReturn.id, id))
    .for('update')
  return rows[0] ?? null
}

export async function findReturnByIdempotency(
  branchId: string,
  key: string,
  executor: DbExecutor = db,
): Promise<typeof supplierReturn.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(supplierReturn)
    .where(and(eq(supplierReturn.branchId, branchId), eq(supplierReturn.idempotencyKey, key)))
    .limit(1)
  return rows[0] ?? null
}

export async function updateReturnRow(
  id: string,
  patch: Partial<typeof supplierReturn.$inferInsert>,
  executor: DbExecutor,
): Promise<typeof supplierReturn.$inferSelect | null> {
  const rows = await executor
    .update(supplierReturn)
    .set(patch)
    .where(eq(supplierReturn.id, id))
    .returning()
  return rows[0] ?? null
}

export async function selectReturnLines(
  returnId: string,
  executor: DbExecutor = db,
): Promise<
  {
    id: string
    receiptLineId: string
    receiptNumber: string
    productId: string
    sku: string
    name: string
    quantity: number
    unitCostMinor: number
    receivedQuantity: number
  }[]
> {
  return executor
    .select({
      id: supplierReturnLine.id,
      receiptLineId: supplierReturnLine.receiptLineId,
      receiptNumber: stockReceipt.number,
      productId: supplierReturnLine.productId,
      sku: product.sku,
      name: product.name,
      quantity: supplierReturnLine.quantity,
      unitCostMinor: supplierReturnLine.unitCostMinor,
      receivedQuantity: stockReceiptLine.quantity,
    })
    .from(supplierReturnLine)
    .innerJoin(stockReceiptLine, eq(stockReceiptLine.id, supplierReturnLine.receiptLineId))
    .innerJoin(stockReceipt, eq(stockReceipt.id, stockReceiptLine.receiptId))
    .innerJoin(product, eq(product.id, supplierReturnLine.productId))
    .where(eq(supplierReturnLine.returnId, returnId))
    .orderBy(asc(supplierReturnLine.createdAt))
}

/** Quantity already returned against a receipt line, across POSTED returns. */
export async function selectReturnedQuantityByReceiptLine(
  receiptLineId: string,
  excludeReturnId: string | null,
  executor: DbExecutor = db,
): Promise<number> {
  const conditions = [
    eq(supplierReturnLine.receiptLineId, receiptLineId),
    eq(supplierReturn.status, 'POSTED'),
  ]
  if (excludeReturnId) conditions.push(ne(supplierReturn.id, excludeReturnId))

  const rows = await executor
    .select({
      quantity: sql<number>`coalesce(sum(${supplierReturnLine.quantity}), 0)`.mapWith(Number),
    })
    .from(supplierReturnLine)
    .innerJoin(supplierReturn, eq(supplierReturn.id, supplierReturnLine.returnId))
    .where(and(...conditions))
  return rows[0]?.quantity ?? 0
}

export async function selectReceiptLineForReturn(
  receiptLineId: string,
  executor: DbExecutor = db,
): Promise<{
  id: string
  receiptId: string
  receiptNumber: string
  branchId: string
  supplierId: string | null
  purchaseOrderId: string | null
  productId: string
  quantity: number
  unitCostMinor: number
  purchaseOrderLineId: string | null
} | null> {
  const rows = await executor
    .select({
      id: stockReceiptLine.id,
      receiptId: stockReceipt.id,
      receiptNumber: stockReceipt.number,
      branchId: stockReceipt.branchId,
      supplierId: stockReceipt.supplierId,
      purchaseOrderId: stockReceipt.purchaseOrderId,
      productId: stockReceiptLine.productId,
      quantity: stockReceiptLine.quantity,
      unitCostMinor: stockReceiptLine.unitCostMinor,
      purchaseOrderLineId: stockReceiptLine.purchaseOrderLineId,
    })
    .from(stockReceiptLine)
    .innerJoin(stockReceipt, eq(stockReceipt.id, stockReceiptLine.receiptId))
    .where(eq(stockReceiptLine.id, receiptLineId))
    .limit(1)
  return rows[0] ?? null
}

export async function selectReturnPage(
  filters: {
    branchId: string | null
    supplierId?: string
    status?: string
    limit: number
    offset: number
  },
  executor: DbExecutor = db,
): Promise<
  {
    ret: typeof supplierReturn.$inferSelect
    supplierName: string
    creditMinor: number | null
  }[]
> {
  const conditions = []
  if (filters.branchId) conditions.push(eq(supplierReturn.branchId, filters.branchId))
  if (filters.supplierId) conditions.push(eq(supplierReturn.supplierId, filters.supplierId))
  if (filters.status) conditions.push(eq(supplierReturn.status, filters.status as 'DRAFT'))

  return executor
    .select({
      ret: supplierReturn,
      supplierName: supplier.name,
      creditMinor: supplierCreditNote.amountMinor,
    })
    .from(supplierReturn)
    .innerJoin(supplier, eq(supplier.id, supplierReturn.supplierId))
    .leftJoin(supplierCreditNote, eq(supplierCreditNote.returnId, supplierReturn.id))
    .where(conditions.length === 0 ? sql`true` : and(...conditions))
    .orderBy(desc(supplierReturn.createdAt))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countReturns(
  filters: { branchId: string | null; supplierId?: string; status?: string },
  executor: DbExecutor = db,
): Promise<number> {
  const conditions = []
  if (filters.branchId) conditions.push(eq(supplierReturn.branchId, filters.branchId))
  if (filters.supplierId) conditions.push(eq(supplierReturn.supplierId, filters.supplierId))
  if (filters.status) conditions.push(eq(supplierReturn.status, filters.status as 'DRAFT'))
  const rows = await executor
    .select({ total: count() })
    .from(supplierReturn)
    .where(conditions.length === 0 ? sql`true` : and(...conditions))
  return Number(rows[0]?.total ?? 0)
}

export async function insertCreditNote(
  values: typeof supplierCreditNote.$inferInsert,
  executor: DbExecutor,
): Promise<typeof supplierCreditNote.$inferSelect> {
  const rows = await executor.insert(supplierCreditNote).values(values).returning()
  const row = rows[0]
  if (!row) throw new Error('Failed to insert supplier credit note')
  return row
}

export async function findCreditNoteByReturn(
  returnId: string,
  executor: DbExecutor = db,
): Promise<typeof supplierCreditNote.$inferSelect | null> {
  const rows = await executor
    .select()
    .from(supplierCreditNote)
    .where(eq(supplierCreditNote.returnId, returnId))
    .limit(1)
  return rows[0] ?? null
}

/** Total credit raised against a supplier, optionally for one branch. */
export async function sumCreditNotesBySupplier(
  branchId: string | null,
  supplierId?: string | null,
  executor: DbExecutor = db,
): Promise<Map<string, { totalMinor: number; code: string; name: string }>> {
  const conditions = []
  if (branchId) conditions.push(eq(supplierCreditNote.branchId, branchId))
  if (supplierId) conditions.push(eq(supplierCreditNote.supplierId, supplierId))

  const rows = await executor
    .select({
      supplierId: supplierCreditNote.supplierId,
      code: supplier.code,
      name: supplier.name,
      total: sql<number>`coalesce(sum(${supplierCreditNote.amountMinor}), 0)`.mapWith(Number),
    })
    .from(supplierCreditNote)
    .innerJoin(supplier, eq(supplier.id, supplierCreditNote.supplierId))
    .where(conditions.length === 0 ? sql`true` : and(...conditions))
    .groupBy(supplierCreditNote.supplierId, supplier.code, supplier.name)

  return new Map(
    rows.map((row) => [row.supplierId, { totalMinor: row.total, code: row.code, name: row.name }]),
  )
}
