import { type DbExecutor, db } from '@gikautos/db'
import { and, count, desc, eq, gte, ilike, isNotNull, lte, or, sql } from 'drizzle-orm'
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
  },
  executor: DbExecutor,
): Promise<void> {
  await executor.insert(stockReceiptLine).values(values)
}

function receiptConditions(filters: ReceiptListFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(stockReceipt.branchId, filters.branchId))
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
  const conditions = [eq(stockLevel.branchId, filters.branchId), eq(product.isActive, true)]
  if (filters.q) {
    const pattern = `%${filters.q}%`
    const prefix = `${filters.q}%`
    const search = or(ilike(product.name, pattern), ilike(product.sku, prefix))
    if (search) conditions.push(search)
  }
  if (filters.lowStock) {
    const low = and(
      isNotNull(stockThreshold.threshold),
      lte(stockLevel.quantityOnHand, stockThreshold.threshold),
    )
    if (low) conditions.push(low)
  }
  return conditions
}

export async function selectStockPage(
  filters: StockListFilters,
  executor: DbExecutor = db,
): Promise<
  {
    productId: string
    sku: string
    productName: string
    categoryName: string
    quantityOnHand: number
    avgCostMinor: number
    threshold: number | null
    updatedAt: Date
  }[]
> {
  return executor
    .select({
      productId: stockLevel.productId,
      sku: product.sku,
      productName: product.name,
      categoryName: category.name,
      quantityOnHand: stockLevel.quantityOnHand,
      avgCostMinor: stockLevel.avgCostMinor,
      threshold: stockThreshold.threshold,
      updatedAt: stockLevel.updatedAt,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .innerJoin(category, eq(category.id, product.categoryId))
    .leftJoin(
      stockThreshold,
      and(
        eq(stockThreshold.productId, stockLevel.productId),
        eq(stockThreshold.branchId, stockLevel.branchId),
      ),
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
  const rows = await executor
    .select({ total: count() })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .leftJoin(
      stockThreshold,
      and(
        eq(stockThreshold.productId, stockLevel.productId),
        eq(stockThreshold.branchId, stockLevel.branchId),
      ),
    )
    .where(and(...stockConditions(filters)))
  return rows[0]?.total ?? 0
}

export async function findThreshold(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<{ id: string; threshold: number } | null> {
  const rows = await executor
    .select({ id: stockThreshold.id, threshold: stockThreshold.threshold })
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
      updatedBy: stockThreshold.updatedBy,
      updatedAt: stockThreshold.updatedAt,
    })
    .from(stockThreshold)
    .innerJoin(product, eq(product.id, stockThreshold.productId))
    .where(eq(stockThreshold.branchId, branchId))
    .orderBy(product.name)
}

export async function upsertThresholdRow(
  input: { productId: string; branchId: string; threshold: number; updatedBy: string | null },
  executor: DbExecutor,
): Promise<{ id: string; threshold: number } | null> {
  const rows = await executor
    .insert(stockThreshold)
    .values(input)
    .onConflictDoUpdate({
      target: [stockThreshold.productId, stockThreshold.branchId],
      set: { threshold: input.threshold, updatedBy: input.updatedBy },
    })
    .returning({ id: stockThreshold.id, threshold: stockThreshold.threshold })
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
