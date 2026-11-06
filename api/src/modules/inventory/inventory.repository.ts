import { type DbExecutor, db } from '@sceptre/db'
import { and, count, desc, eq, gte, ilike, lte, or, sql } from 'drizzle-orm'
import { category } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from './inventory.schema.ts'
import type {
  MovementHistoryRow,
  MovementListFilters,
  ReceiptLineRow,
  ReceiptListFilters,
  StockLevelRow,
  StockListFilters,
  StockMovementRow,
  StockReceiptRow,
  ThresholdRow,
} from './inventory.types.ts'
import { effectiveThresholdSql } from './stock-threshold.sql.ts'

export interface MovementInsert {
  productId: string
  branchId: string
  type: StockMovementRow['type']
  quantityDelta: number
  unitCostMinor: number
  referenceType: StockMovementRow['referenceType']
  referenceId: string | null
  referenceNumber: string | null
  reasonCode: StockMovementRow['reasonCode']
  note: string | null
  createdBy: string | null
}

/**
 * Appends one movement. There is deliberately no update or delete helper for
 * this table anywhere in the module: the ledger is append-only.
 */
export async function insertMovement(
  input: MovementInsert,
  executor: DbExecutor,
): Promise<StockMovementRow | null> {
  const rows = await executor.insert(stockMovement).values(input).returning()
  return rows[0] ?? null
}

/**
 * Ensures the projection row exists, then locks it for update. Concurrent
 * writers serialize here; the caller reads a true balance after the lock.
 */
export async function lockOrCreateLevel(
  productId: string,
  branchId: string,
  executor: DbExecutor,
): Promise<StockLevelRow | null> {
  await executor
    .insert(stockLevel)
    .values({ productId, branchId })
    .onConflictDoNothing({ target: [stockLevel.productId, stockLevel.branchId] })

  const rows = await executor
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.branchId, branchId)))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function updateLevel(
  id: string,
  patch: { quantityOnHand: number; avgCostMinor: number },
  executor: DbExecutor,
): Promise<StockLevelRow | null> {
  const rows = await executor.update(stockLevel).set(patch).where(eq(stockLevel.id, id)).returning()
  return rows[0] ?? null
}

export async function findLevel(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<StockLevelRow | null> {
  const rows = await executor
    .select()
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

export async function selectBranchLevels(
  branchId: string,
  executor: DbExecutor = db,
): Promise<StockLevelRow[]> {
  return executor.select().from(stockLevel).where(eq(stockLevel.branchId, branchId))
}

export async function sumMovementsByProduct(
  branchId: string,
  executor: DbExecutor = db,
): Promise<{ productId: string; total: number }[]> {
  return executor
    .select({
      productId: stockMovement.productId,
      total: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)`.mapWith(Number),
    })
    .from(stockMovement)
    .where(eq(stockMovement.branchId, branchId))
    .groupBy(stockMovement.productId)
}

export async function sumMovementsForProduct(
  productId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({
      total: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)`.mapWith(Number),
    })
    .from(stockMovement)
    .where(eq(stockMovement.productId, productId))
  return rows[0]?.total ?? 0
}

export async function insertReceipt(
  values: {
    number: string
    branchId: string
    supplierId: string | null
    supplierName: string | null
    supplierInvoiceNumber: string | null
    note: string | null
    purchaseOrderId: string | null
    idempotencyKey: string | null
    createdBy: string | null
  },
  executor: DbExecutor,
): Promise<{ id: string } | null> {
  const rows = await executor.insert(stockReceipt).values(values).returning({ id: stockReceipt.id })
  return rows[0] ?? null
}

export async function insertReceiptLine(
  values: {
    receiptId: string
    productId: string
    quantity: number
    unitCostMinor: number
    movementId: string
    purchaseOrderLineId: string | null
    overReceiptReason: 'SUPPLIER_SENT_MORE' | 'ORDER_ROUNDING' | 'SUBSTITUTE' | 'OTHER' | null
    overReceiptNote: string | null
  },
  executor: DbExecutor,
): Promise<void> {
  await executor.insert(stockReceiptLine).values(values)
}

/**
 * Catalogue cost follows the latest goods receipt (P11-D13).
 *
 * This is the one deliberate cross-module **write** in the codebase:
 * `products.service` already imports `inventory.service`, so the reverse import
 * would be a module cycle. The column is derived — no screen writes it, and a
 * transfer-in must not touch it (a transfer says nothing about what the business
 * pays for the part).
 */
export async function updateDerivedCost(
  productId: string,
  costMinor: number,
  executor: DbExecutor,
): Promise<void> {
  await executor
    .update(product)
    .set({ costPriceMinor: costMinor, updatedAt: sql`now()` })
    .where(eq(product.id, productId))
}

/** Replay lookup for a purchase-order receipt (P11-D20). */
export async function findReceiptByIdempotency(
  branchId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
): Promise<{ id: string } | null> {
  const rows = await executor
    .select({ id: stockReceipt.id })
    .from(stockReceipt)
    .where(
      and(eq(stockReceipt.branchId, branchId), eq(stockReceipt.idempotencyKey, idempotencyKey)),
    )
    .limit(1)
  return rows[0] ?? null
}

function receiptConditions(filters: ReceiptListFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(stockReceipt.branchId, filters.branchId))
  if (filters.purchaseOrderId) {
    conditions.push(eq(stockReceipt.purchaseOrderId, filters.purchaseOrderId))
  }
  if (filters.from) conditions.push(gte(stockReceipt.createdAt, filters.from))
  if (filters.to) conditions.push(lte(stockReceipt.createdAt, filters.to))
  return conditions
}

export async function selectReceiptPage(
  filters: ReceiptListFilters,
  executor: DbExecutor = db,
): Promise<StockReceiptRow[]> {
  return executor
    .select({
      id: stockReceipt.id,
      number: stockReceipt.number,
      branchId: stockReceipt.branchId,
      branchCode: branch.code,
      branchName: branch.name,
      purchaseOrderId: stockReceipt.purchaseOrderId,
      supplierId: stockReceipt.supplierId,
      supplierName: sql<string | null>`coalesce(${supplier.name}, ${stockReceipt.supplierName})`,
      supplierInvoiceNumber: stockReceipt.supplierInvoiceNumber,
      note: stockReceipt.note,
      createdBy: stockReceipt.createdBy,
      createdAt: stockReceipt.createdAt,
      lineCount: sql<number>`count(${stockReceiptLine.id})`.mapWith(Number),
      totalCostMinor:
        sql<number>`coalesce(sum(${stockReceiptLine.quantity} * ${stockReceiptLine.unitCostMinor}), 0)`.mapWith(
          Number,
        ),
    })
    .from(stockReceipt)
    .innerJoin(branch, eq(branch.id, stockReceipt.branchId))
    .leftJoin(supplier, eq(supplier.id, stockReceipt.supplierId))
    .leftJoin(stockReceiptLine, eq(stockReceiptLine.receiptId, stockReceipt.id))
    .where(and(...receiptConditions(filters)))
    .groupBy(stockReceipt.id, branch.code, branch.name, supplier.name)
    .orderBy(desc(stockReceipt.createdAt))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countReceipts(
  filters: ReceiptListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(stockReceipt)
    .where(and(...receiptConditions(filters)))
  return rows[0]?.total ?? 0
}

export async function findReceiptBase(
  id: string,
  executor: DbExecutor = db,
): Promise<Omit<StockReceiptRow, 'lineCount' | 'totalCostMinor'> | null> {
  const rows = await executor
    .select({
      id: stockReceipt.id,
      number: stockReceipt.number,
      branchId: stockReceipt.branchId,
      branchCode: branch.code,
      branchName: branch.name,
      purchaseOrderId: stockReceipt.purchaseOrderId,
      supplierId: stockReceipt.supplierId,
      supplierName: sql<string | null>`coalesce(${supplier.name}, ${stockReceipt.supplierName})`,
      supplierInvoiceNumber: stockReceipt.supplierInvoiceNumber,
      note: stockReceipt.note,
      createdBy: stockReceipt.createdBy,
      createdAt: stockReceipt.createdAt,
    })
    .from(stockReceipt)
    .innerJoin(branch, eq(branch.id, stockReceipt.branchId))
    .leftJoin(supplier, eq(supplier.id, stockReceipt.supplierId))
    .where(eq(stockReceipt.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function selectReceiptLines(
  receiptId: string,
  executor: DbExecutor = db,
): Promise<ReceiptLineRow[]> {
  return executor
    .select({
      id: stockReceiptLine.id,
      productId: stockReceiptLine.productId,
      sku: product.sku,
      productName: product.name,
      quantity: stockReceiptLine.quantity,
      unitCostMinor: stockReceiptLine.unitCostMinor,
      movementId: stockReceiptLine.movementId,
    })
    .from(stockReceiptLine)
    .innerJoin(product, eq(product.id, stockReceiptLine.productId))
    .where(eq(stockReceiptLine.receiptId, receiptId))
    .orderBy(product.name)
}

function movementConditions(filters: MovementListFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(stockMovement.branchId, filters.branchId))
  if (filters.productId) conditions.push(eq(stockMovement.productId, filters.productId))
  if (filters.type) conditions.push(eq(stockMovement.type, filters.type))
  if (filters.from) conditions.push(gte(stockMovement.createdAt, filters.from))
  if (filters.to) conditions.push(lte(stockMovement.createdAt, filters.to))
  return conditions
}

export async function selectMovementPage(
  filters: MovementListFilters,
  executor: DbExecutor = db,
): Promise<MovementHistoryRow[]> {
  return executor
    .select({
      id: stockMovement.id,
      productId: stockMovement.productId,
      branchId: stockMovement.branchId,
      type: stockMovement.type,
      quantityDelta: stockMovement.quantityDelta,
      unitCostMinor: stockMovement.unitCostMinor,
      referenceType: stockMovement.referenceType,
      referenceId: stockMovement.referenceId,
      referenceNumber: stockMovement.referenceNumber,
      reasonCode: stockMovement.reasonCode,
      note: stockMovement.note,
      createdBy: stockMovement.createdBy,
      createdAt: stockMovement.createdAt,
      sku: product.sku,
      productName: product.name,
      branchCode: branch.code,
    })
    .from(stockMovement)
    .innerJoin(product, eq(product.id, stockMovement.productId))
    .innerJoin(branch, eq(branch.id, stockMovement.branchId))
    .where(and(...movementConditions(filters)))
    .orderBy(desc(stockMovement.createdAt), desc(stockMovement.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countMovements(
  filters: MovementListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(stockMovement)
    .where(and(...movementConditions(filters)))
  return rows[0]?.total ?? 0
}

function stockConditions(filters: StockListFilters) {
  const conditions = [eq(product.isActive, true)]
  // The branch join already applies the scope; a product with no level at that
  // branch is a row with a null level, not a missing row (18-01).
  if (filters.q) {
    const pattern = `%${filters.q}%`
    const prefix = `${filters.q}%`
    const search = or(ilike(product.name, pattern), ilike(product.sku, prefix))
    if (search) conditions.push(search)
  }
  const onHand = sql`coalesce(${stockLevel.quantityOnHand}, 0)`
  const threshold = effectiveThresholdSql(sql`${branch.id}`, sql`${stockThreshold.threshold}`)
  if (filters.lowStock) {
    conditions.push(sql`${onHand} between 1 and ${threshold}`)
  }
  if (filters.outOfStock) {
    conditions.push(sql`${onHand} <= 0`)
  }
  // A null level is a product the branch never carried: it belongs to the catalogue,
  // not to this branch's stock list (P20-D17).
  if (filters.carried) {
    conditions.push(sql`${stockLevel.id} is not null`)
  }
  return conditions
}

/** One active product at this branch, whether or not it has a stock level. */
const branchScope = (filters: StockListFilters) =>
  filters.branchId
    ? and(eq(branch.isActive, true), eq(branch.id, filters.branchId))
    : eq(branch.isActive, true)

export async function selectStockPage(
  filters: StockListFilters,
  executor: DbExecutor = db,
): Promise<
  {
    productId: string
    sku: string
    productName: string
    categoryName: string
    branchId: string
    branchCode: string
    branchName: string
    quantityOnHand: number
    avgCostMinor: number
    threshold: number
    neverStocked: boolean
    updatedAt: Date
  }[]
> {
  const scope = branchScope(filters)
  if (!scope) throw new Error('Unreachable: branch scope has no condition')
  return executor
    .select({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      categoryName: category.name,
      branchId: branch.id,
      branchCode: branch.code,
      branchName: branch.name,
      quantityOnHand: sql<number>`coalesce(${stockLevel.quantityOnHand}, 0)`.mapWith(Number),
      avgCostMinor: sql<number>`coalesce(${stockLevel.avgCostMinor}, 0)`.mapWith(Number),
      threshold: effectiveThresholdSql(sql`${branch.id}`, sql`${stockThreshold.threshold}`).mapWith(
        Number,
      ),
      neverStocked: sql<boolean>`${stockLevel.id} is null`,
      updatedAt: sql<Date>`coalesce(${stockLevel.updatedAt}, ${product.updatedAt})`,
    })
    .from(product)
    .innerJoin(branch, scope)
    .innerJoin(category, eq(category.id, product.categoryId))
    .leftJoin(
      stockLevel,
      and(eq(stockLevel.productId, product.id), eq(stockLevel.branchId, branch.id)),
    )
    .leftJoin(
      stockThreshold,
      and(eq(stockThreshold.productId, product.id), eq(stockThreshold.branchId, branch.id)),
    )
    .where(and(...stockConditions(filters)))
    .orderBy(product.name)
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countStockRows(
  filters: StockListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const scope = branchScope(filters)
  if (!scope) throw new Error('Unreachable: branch scope has no condition')
  const rows = await executor
    .select({ total: count() })
    .from(product)
    .innerJoin(branch, scope)
    .leftJoin(
      stockLevel,
      and(eq(stockLevel.productId, product.id), eq(stockLevel.branchId, branch.id)),
    )
    .leftJoin(
      stockThreshold,
      and(eq(stockThreshold.productId, product.id), eq(stockThreshold.branchId, branch.id)),
    )
    .where(and(...stockConditions(filters)))
  return rows[0]?.total ?? 0
}

export async function findThreshold(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<{
  id: string
  threshold: number
  maxQuantity: number | null
  minOrderQuantity: number
} | null> {
  const rows = await executor
    .select({
      id: stockThreshold.id,
      threshold: stockThreshold.threshold,
      maxQuantity: stockThreshold.maxQuantity,
      minOrderQuantity: stockThreshold.minOrderQuantity,
    })
    .from(stockThreshold)
    .where(and(eq(stockThreshold.productId, productId), eq(stockThreshold.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

export async function selectThresholdRows(
  branchId: string,
  executor: DbExecutor = db,
): Promise<ThresholdRow[]> {
  return executor
    .select({
      id: stockThreshold.id,
      productId: stockThreshold.productId,
      sku: product.sku,
      productName: product.name,
      branchId: stockThreshold.branchId,
      threshold: stockThreshold.threshold,
      maxQuantity: stockThreshold.maxQuantity,
      minOrderQuantity: stockThreshold.minOrderQuantity,
      updatedBy: stockThreshold.updatedBy,
      updatedAt: stockThreshold.updatedAt,
    })
    .from(stockThreshold)
    .innerJoin(product, eq(product.id, stockThreshold.productId))
    .where(eq(stockThreshold.branchId, branchId))
    .orderBy(product.name)
}

export async function upsertThresholdRow(
  input: {
    productId: string
    branchId: string
    threshold: number
    maxQuantity: number | null
    minOrderQuantity: number
    updatedBy: string | null
  },
  executor: DbExecutor,
): Promise<{
  id: string
  threshold: number
  maxQuantity: number | null
  minOrderQuantity: number
} | null> {
  const rows = await executor
    .insert(stockThreshold)
    .values(input)
    .onConflictDoUpdate({
      target: [stockThreshold.productId, stockThreshold.branchId],
      set: {
        threshold: input.threshold,
        maxQuantity: input.maxQuantity,
        minOrderQuantity: input.minOrderQuantity,
        updatedBy: input.updatedBy,
      },
    })
    .returning({
      id: stockThreshold.id,
      threshold: stockThreshold.threshold,
      maxQuantity: stockThreshold.maxQuantity,
      minOrderQuantity: stockThreshold.minOrderQuantity,
    })
  return rows[0] ?? null
}

export async function deleteThresholdRow(id: string, executor: DbExecutor): Promise<void> {
  await executor.delete(stockThreshold).where(eq(stockThreshold.id, id))
}

export async function findStockProduct(
  productId: string,
  executor: DbExecutor = db,
): Promise<{
  productId: string
  sku: string
  productName: string
  categoryName: string
  taxCategory: string
  basePriceMinor: number
  costPriceMinor: number
  isActive: boolean
} | null> {
  const rows = await executor
    .select({
      productId: product.id,
      sku: product.sku,
      productName: product.name,
      categoryName: category.name,
      taxCategory: product.taxCategory,
      basePriceMinor: product.basePriceMinor,
      costPriceMinor: product.costPriceMinor,
      isActive: product.isActive,
    })
    .from(product)
    .innerJoin(category, eq(category.id, product.categoryId))
    .where(eq(product.id, productId))
    .limit(1)
  return rows[0] ?? null
}
