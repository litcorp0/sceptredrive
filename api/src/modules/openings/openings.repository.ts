import { type DbExecutor, db } from '@sceptre/db'
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm'
import { uom } from '../catalog/catalog.schema.ts'
import { stockLevel } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { stockOpening, stockOpeningLine } from './openings.schema.ts'
import type {
  OpeningLevel,
  OpeningLineDetail,
  OpeningLineRow,
  OpeningListFilters,
  OpeningListRow,
  OpeningRow,
  OpeningTaxCategory,
} from './openings.types.ts'

const openingSelection = {
  id: stockOpening.id,
  number: stockOpening.number,
  branchId: stockOpening.branchId,
  branchCode: branch.code,
  branchName: branch.name,
  status: stockOpening.status,
  countedAt: stockOpening.countedAt,
  note: stockOpening.note,
  lineCount: stockOpening.lineCount,
  newProductCount: stockOpening.newProductCount,
  totalUnits: stockOpening.totalUnits,
  countedValueMinor: stockOpening.countedValueMinor,
  postedValueMinor: stockOpening.postedValueMinor,
  uncostedLineCount: stockOpening.uncostedLineCount,
  createdBy: stockOpening.createdBy,
  createdAt: stockOpening.createdAt,
  updatedAt: stockOpening.updatedAt,
  postedBy: stockOpening.postedBy,
  postedAt: stockOpening.postedAt,
}

export async function insertOpening(
  values: typeof stockOpening.$inferInsert,
  executor: DbExecutor,
): Promise<OpeningRow | null> {
  const rows = await executor.insert(stockOpening).values(values).returning()
  return rows[0] ?? null
}

export async function insertOpeningLines(
  values: (typeof stockOpeningLine.$inferInsert)[],
  executor: DbExecutor,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(stockOpeningLine).values(values)
}

export async function findOpeningById(
  id: string,
  executor: DbExecutor = db,
): Promise<OpeningRow | null> {
  const rows = await executor.select().from(stockOpening).where(eq(stockOpening.id, id)).limit(1)
  return rows[0] ?? null
}

export async function lockOpeningForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<OpeningRow | null> {
  const rows = await executor
    .select()
    .from(stockOpening)
    .where(eq(stockOpening.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function findOpeningByIdempotencyKey(
  branchId: string,
  idempotencyKey: string,
  executor: DbExecutor = db,
): Promise<OpeningRow | null> {
  const rows = await executor
    .select()
    .from(stockOpening)
    .where(
      and(eq(stockOpening.branchId, branchId), eq(stockOpening.idempotencyKey, idempotencyKey)),
    )
    .limit(1)
  return rows[0] ?? null
}

export async function updateOpeningRow(
  id: string,
  patch: Partial<typeof stockOpening.$inferInsert>,
  executor: DbExecutor,
): Promise<OpeningRow | null> {
  const rows = await executor
    .update(stockOpening)
    .set(patch)
    .where(eq(stockOpening.id, id))
    .returning()
  return rows[0] ?? null
}

export async function deleteOpeningRow(id: string, executor: DbExecutor): Promise<void> {
  await executor.delete(stockOpening).where(eq(stockOpening.id, id))
}

export async function selectOpeningLines(
  openingId: string,
  executor: DbExecutor = db,
): Promise<OpeningLineDetail[]> {
  return executor
    .select({
      id: stockOpeningLine.id,
      lineNo: stockOpeningLine.lineNo,
      productId: stockOpeningLine.productId,
      productSku: product.sku,
      productName: product.name,
      isNew: stockOpeningLine.isNew,
      name: stockOpeningLine.name,
      categoryId: stockOpeningLine.categoryId,
      unit: uom.code,
      uomId: stockOpeningLine.uomId,
      brandId: stockOpeningLine.brandId,
      barcode: stockOpeningLine.barcode,
      basePriceMinor: stockOpeningLine.basePriceMinor,
      taxCategory: stockOpeningLine.taxCategory,
      quantity: stockOpeningLine.quantity,
      unitCostMinor: stockOpeningLine.unitCostMinor,
      onHandAtDraft: stockOpeningLine.onHandAtDraft,
      deltaAtDraft: stockOpeningLine.deltaAtDraft,
      warning: stockOpeningLine.warning,
      movementId: stockOpeningLine.movementId,
    })
    .from(stockOpeningLine)
    .leftJoin(product, eq(product.id, stockOpeningLine.productId))
    .leftJoin(uom, eq(uom.id, stockOpeningLine.uomId))
    .where(eq(stockOpeningLine.openingId, openingId))
    .orderBy(asc(stockOpeningLine.lineNo))
}

export async function selectOpeningLineRows(
  openingId: string,
  executor: DbExecutor = db,
): Promise<OpeningLineRow[]> {
  return executor
    .select()
    .from(stockOpeningLine)
    .where(eq(stockOpeningLine.openingId, openingId))
    .orderBy(asc(stockOpeningLine.lineNo))
}

export async function updateOpeningLineProduct(
  lineId: string,
  values: {
    productId: string
    sku: string
    movementId: string | null
    onHandAtDraft?: number
    deltaAtDraft?: number
  },
  executor: DbExecutor,
): Promise<void> {
  await executor
    .update(stockOpeningLine)
    .set({
      productId: values.productId,
      sku: values.sku,
      movementId: values.movementId,
      ...(values.onHandAtDraft !== undefined ? { onHandAtDraft: values.onHandAtDraft } : {}),
      ...(values.deltaAtDraft !== undefined ? { deltaAtDraft: values.deltaAtDraft } : {}),
    })
    .where(eq(stockOpeningLine.id, lineId))
}

function openingConditions(filters: OpeningListFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(stockOpening.branchId, filters.branchId))
  if (filters.status) conditions.push(eq(stockOpening.status, filters.status))
  return conditions
}

export async function selectOpeningPage(
  filters: OpeningListFilters,
  executor: DbExecutor = db,
): Promise<OpeningListRow[]> {
  return executor
    .select(openingSelection)
    .from(stockOpening)
    .innerJoin(branch, eq(branch.id, stockOpening.branchId))
    .where(and(...openingConditions(filters)))
    .orderBy(desc(stockOpening.createdAt), desc(stockOpening.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countOpenings(
  filters: OpeningListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(stockOpening)
    .where(and(...openingConditions(filters)))
  return Number(rows[0]?.total ?? 0)
}

export async function selectOpeningBase(
  id: string,
  executor: DbExecutor = db,
): Promise<OpeningListRow | null> {
  const rows = await executor
    .select(openingSelection)
    .from(stockOpening)
    .innerJoin(branch, eq(branch.id, stockOpening.branchId))
    .where(eq(stockOpening.id, id))
    .limit(1)
  return rows[0] ?? null
}

/**
 * The branch projection for the products in the file. A missing row means zero on
 * hand, exactly as the stock list reads it (Phase 18 D1). `lock` is used by the
 * post so a concurrent sale cannot move the level between the delta and the write.
 */
export async function selectOpeningLevels(
  branchId: string,
  productIds: string[],
  executor: DbExecutor = db,
  options: { lock?: boolean } = {},
): Promise<Map<string, OpeningLevel>> {
  if (productIds.length === 0) return new Map()
  const base = executor
    .select({
      productId: stockLevel.productId,
      quantityOnHand: stockLevel.quantityOnHand,
      avgCostMinor: stockLevel.avgCostMinor,
    })
    .from(stockLevel)
    .where(and(eq(stockLevel.branchId, branchId), inArray(stockLevel.productId, productIds)))
  const rows = options.lock ? await base.for('update') : await base
  return new Map(
    rows.map((row) => [
      row.productId,
      { quantityOnHand: row.quantityOnHand, avgCostMinor: row.avgCostMinor },
    ]),
  )
}

/** A small read used by the list to show the newest drafts first; kept for symmetry. */
export async function selectOpeningStatusCount(
  branchId: string,
  executor: DbExecutor = db,
): Promise<{ draft: number; posted: number }> {
  const rows = await executor
    .select({ status: stockOpening.status, total: count() })
    .from(stockOpening)
    .where(eq(stockOpening.branchId, branchId))
    .groupBy(stockOpening.status)
  const result = { draft: 0, posted: 0 }
  for (const row of rows) {
    if (row.status === 'DRAFT') result.draft = Number(row.total)
    if (row.status === 'POSTED') result.posted = Number(row.total)
  }
  return result
}

export function castTaxCategory(value: string | null): OpeningTaxCategory | null {
  if (value === 'STANDARD' || value === 'ZERO_RATED' || value === 'EXEMPT') return value
  return null
}
