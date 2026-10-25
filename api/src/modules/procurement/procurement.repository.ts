import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, desc, eq, ilike, inArray, or, sql, sum } from 'drizzle-orm'
import { stockReceiptLine } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import { purchaseOrder, purchaseOrderLine } from './procurement.schema.ts'
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
