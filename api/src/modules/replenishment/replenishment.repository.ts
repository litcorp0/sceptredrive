/**
 * Replenishment data access — aggregates only.
 *
 * **Read-model boundary (P9-D10).** This module spans domains by definition, so
 * it reads sibling `*.schema.ts` tables directly and never imports another
 * module's repository. It re-implements no rule: the suggestion itself is
 * `suggestReplenishment` in `@sceptre/shared`, and the service below it does no
 * arithmetic of its own.
 *
 * Every statement is read-only and parameterised. `SUM(integer)` comes back from
 * node-postgres as a string, so every aggregate maps with `Number` — the
 * convention `inventory.repository.ts` already uses.
 */
import { type DbExecutor, db } from '@sceptre/db'
import {
  and,
  asc,
  desc,
  eq,
  gte,
  ilike,
  inArray,
  isNotNull,
  lt,
  lte,
  or,
  type SQL,
  sql,
  sum,
} from 'drizzle-orm'
import {
  stockLevel,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from '../inventory/inventory.schema.ts'
import { effectiveThresholdSql } from '../inventory/stock-threshold.sql.ts'
import { sale, saleLine } from '../pos/pos.schema.ts'
import { purchaseOrder, purchaseOrderLine } from '../procurement/procurement.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierProduct } from '../suppliers/suppliers.schema.ts'
import type {
  PerformanceLineFact,
  ReceiptCostFact,
  ReplenishmentFactRow,
} from './replenishment.types.ts'

/**
 * Every product this branch carries, plus the facts the suggestion needs.
 *
 * "Carries" is the same pair the stock screen uses (P20-D3): a min/max row at
 * this branch, or a stock level here. A part with an explicit row is one the
 * manager wants even before it is stocked; a part with a level is one the branch
 * actually holds. Reading only the first is what made a branch that relies on
 * the configured default see an empty replenishment screen and be told to go
 * and set thresholds it had already configured.
 *
 * `minLevel` is therefore the **effective** threshold — the product's row, else
 * the branch default, else the company default, else the built-in 5 — through
 * `effectiveThresholdSql`, the one definition the stock list and the dashboard's
 * attention counts already read. Two definitions is how a badge and a report
 * start disagreeing.
 *
 * The preferred supplier is joined rather than queried per product: it is
 * unique per product (partial unique index), so it cannot multiply rows.
 */
export async function selectReplenishmentRows(
  branchId: string,
  filters: { supplierId?: string; q?: string },
  executor: DbExecutor = db,
): Promise<ReplenishmentFactRow[]> {
  const conditions = [
    // The branch carries this product: it has a level row here, or it stocks it.
    or(isNotNull(stockThreshold.productId), isNotNull(stockLevel.productId)) as SQL<unknown>,
  ]
  if (filters.supplierId) conditions.push(eq(supplierProduct.supplierId, filters.supplierId))
  if (filters.q) {
    const pattern = `%${filters.q}%`
    const search = or(ilike(product.sku, `%${filters.q}%`), ilike(product.name, pattern))
    if (search) conditions.push(search)
  }

  return executor
    .select({
      productId: product.id,
      sku: product.sku,
      name: product.name,
      supplierId: supplierProduct.supplierId,
      supplierName: supplier.name,
      leadTimeDays: supplierProduct.leadTimeDays,
      linkLastCostMinor: supplierProduct.lastCostMinor,
      catalogueCostMinor: product.costPriceMinor,
      minLevel: effectiveThresholdSql(sql`${branchId}`, sql`${stockThreshold.threshold}`).mapWith(
        Number,
      ),
      maxLevel: stockThreshold.maxQuantity,
      minOrderQuantity: sql<number>`coalesce(${stockThreshold.minOrderQuantity}, 0)`,
      onHand: stockLevel.quantityOnHand,
    })
    .from(product)
    .leftJoin(
      stockThreshold,
      and(eq(stockThreshold.productId, product.id), eq(stockThreshold.branchId, branchId)),
    )
    .leftJoin(
      stockLevel,
      and(eq(stockLevel.productId, product.id), eq(stockLevel.branchId, branchId)),
    )
    .leftJoin(
      supplierProduct,
      and(eq(supplierProduct.productId, product.id), eq(supplierProduct.isPreferred, true)),
    )
    .leftJoin(supplier, eq(supplier.id, supplierProduct.supplierId))
    .where(and(...conditions))
    .orderBy(asc(product.sku))
}

/** Σ units sold at this branch in the trailing window, per product. */
export async function selectUnitsSold(
  branchId: string,
  days: number,
  executor: DbExecutor = db,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({
      productId: saleLine.productId,
      units: sql<number>`coalesce(sum(${saleLine.quantity}), 0)`.mapWith(Number),
    })
    .from(saleLine)
    .innerJoin(sale, eq(sale.id, saleLine.saleId))
    .where(
      and(
        eq(sale.branchId, branchId),
        gte(sale.occurredAt, sql`now() - make_interval(days => ${days})`),
      ),
    )
    .groupBy(saleLine.productId)

  return new Map(rows.map((row) => [row.productId, row.units]))
}

/**
 * Σ(ordered − received) over open order lines, per product — the on-order
 * quantity that stops the same part being ordered twice (P11-D9).
 */
export async function selectOnOrderByProduct(
  branchId: string,
  executor: DbExecutor = db,
): Promise<Map<string, number>> {
  const rows = await executor
    .select({
      productId: purchaseOrderLine.productId,
      ordered: sum(purchaseOrderLine.quantity).mapWith(Number),
      received: sql<number>`coalesce(sum(${stockReceiptLine.quantity}), 0)`.mapWith(Number),
    })
    .from(purchaseOrderLine)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
    .leftJoin(stockReceiptLine, eq(stockReceiptLine.purchaseOrderLineId, purchaseOrderLine.id))
    .where(
      and(
        eq(purchaseOrder.branchId, branchId),
        or(
          eq(purchaseOrder.status, 'APPROVED'),
          eq(purchaseOrder.status, 'SENT'),
          eq(purchaseOrder.status, 'PARTIALLY_RECEIVED'),
        ),
      ),
    )
    .groupBy(purchaseOrderLine.id)

  const onOrder = new Map<string, number>()
  for (const row of rows) {
    const outstanding = Math.max(row.ordered - row.received, 0)
    if (outstanding === 0) continue
    onOrder.set(row.productId, (onOrder.get(row.productId) ?? 0) + outstanding)
  }
  return onOrder
}

/**
 * Purchase-order lines in the performance window, one row per line, with the
 * three dates P11-D11 names. The window is over `submitted_at` — the day the
 * order entered the world — and `to` is exclusive.
 */
export async function selectPerformanceLines(
  filters: { branchId: string; supplierId?: string; from: Date; toExclusive: Date },
  executor: DbExecutor = db,
): Promise<PerformanceLineFact[]> {
  const conditions = [
    eq(purchaseOrder.branchId, filters.branchId),
    gte(purchaseOrder.submittedAt, filters.from),
    lt(purchaseOrder.submittedAt, filters.toExclusive),
  ]
  if (filters.supplierId) conditions.push(eq(purchaseOrder.supplierId, filters.supplierId))

  return executor
    .select({
      orderId: purchaseOrder.id,
      status: purchaseOrder.status,
      supplierId: purchaseOrder.supplierId,
      supplierCode: supplier.code,
      supplierName: supplier.name,
      lineId: purchaseOrderLine.id,
      orderedQuantity: purchaseOrderLine.quantity,
      receivedQuantity: sql<number>`coalesce(sum(${stockReceiptLine.quantity}), 0)`.mapWith(Number),
      expectedDate: purchaseOrder.expectedDate,
      sentDate: sql<
        string | null
      >`to_char(min(${purchaseOrder.sentAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
      firstReceiptDate: sql<
        string | null
      >`to_char(min(${stockReceipt.createdAt}) AT TIME ZONE 'UTC', 'YYYY-MM-DD')`,
    })
    .from(purchaseOrderLine)
    .innerJoin(purchaseOrder, eq(purchaseOrder.id, purchaseOrderLine.orderId))
    .innerJoin(supplier, eq(supplier.id, purchaseOrder.supplierId))
    .leftJoin(stockReceiptLine, eq(stockReceiptLine.purchaseOrderLineId, purchaseOrderLine.id))
    .leftJoin(stockReceipt, eq(stockReceipt.id, stockReceiptLine.receiptId))
    .where(and(...conditions))
    .groupBy(
      purchaseOrder.id,
      purchaseOrder.status,
      purchaseOrder.supplierId,
      supplier.code,
      supplier.name,
      purchaseOrderLine.id,
      purchaseOrderLine.quantity,
      purchaseOrder.expectedDate,
      purchaseOrder.sentAt,
    )
    .orderBy(asc(purchaseOrder.id), asc(purchaseOrderLine.lineNumber))
}

/**
 * The two newest receipt lines per `(supplier, product)` at one branch, for
 * last-cost drift.
 *
 * One query for every supplier on the screen rather than two per supplier: a
 * window function ranks the receipts, and only ranks 1 and 2 come back, so the
 * result is bounded by the number of comparable products instead of by the
 * branch's whole receipt history.
 */
export async function selectReceiptHistory(
  branchId: string,
  supplierIds: readonly string[],
  executor: DbExecutor = db,
): Promise<ReceiptCostFact[]> {
  if (supplierIds.length === 0) return []

  const rowNumber = sql<number>`row_number() over (
    partition by ${stockReceipt.supplierId}, ${stockReceiptLine.productId}
    order by ${stockReceipt.createdAt} desc, ${stockReceiptLine.id} desc
  )`
    .mapWith(Number)
    .as('receipt_rank')

  const ranked = executor
    .select({
      supplierId: stockReceipt.supplierId,
      productId: stockReceiptLine.productId,
      unitCostMinor: stockReceiptLine.unitCostMinor,
      receivedAt: stockReceipt.createdAt,
      rowNumber,
    })
    .from(stockReceiptLine)
    .innerJoin(stockReceipt, eq(stockReceipt.id, stockReceiptLine.receiptId))
    .where(
      and(eq(stockReceipt.branchId, branchId), inArray(stockReceipt.supplierId, [...supplierIds])),
    )
    .as('ranked_receipts')

  return executor
    .select({
      supplierId: ranked.supplierId,
      productId: ranked.productId,
      unitCostMinor: ranked.unitCostMinor,
      receivedAt: ranked.receivedAt,
    })
    .from(ranked)
    .where(lte(ranked.rowNumber, 2))
    .orderBy(desc(ranked.receivedAt))
}

/** Supplier links for the products in one order-from-suggestions request. */
export async function selectSupplierProductCosts(
  supplierId: string,
  productIds: readonly string[],
  executor: DbExecutor = db,
): Promise<Map<string, number>> {
  if (productIds.length === 0) return new Map()
  const rows = await executor
    .select({
      productId: supplierProduct.productId,
      lastCostMinor: supplierProduct.lastCostMinor,
    })
    .from(supplierProduct)
    .where(
      and(
        eq(supplierProduct.supplierId, supplierId),
        inArray(supplierProduct.productId, [...productIds]),
      ),
    )
  return new Map(rows.map((row) => [row.productId, row.lastCostMinor]))
}
