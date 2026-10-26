import { type DbExecutor, db } from '@sceptre/db'
import { abcClassFromShare, ratioBp } from '@sceptre/shared'
import { and, count, desc, eq, gt, inArray, sql } from 'drizzle-orm'
import { category } from '../catalog/catalog.schema.ts'
import { stockLevel } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { sale, saleLine } from '../pos/pos.schema.ts'
import { product } from '../products/products.schema.ts'
import { stockAbcClass, stockCount, stockCountLine } from './counts.schema.ts'
import type {
  CountLineDetail,
  CountListFilters,
  CountListRow,
  SnapshotRow,
  StockCountLineRow,
  StockCountRow,
} from './counts.types.ts'

export async function insertCount(
  values: {
    number: string
    branchId: string
    categoryId: string | null
    note: string | null
    createdBy: string | null
  },
  executor: DbExecutor,
): Promise<StockCountRow | null> {
  const rows = await executor.insert(stockCount).values(values).returning()
  return rows[0] ?? null
}

export async function insertCountLines(
  values: { countId: string; productId: string; snapshotQty: number }[],
  executor: DbExecutor,
): Promise<void> {
  if (values.length === 0) return
  await executor.insert(stockCountLine).values(values)
}

export async function findCountById(
  id: string,
  executor: DbExecutor = db,
): Promise<StockCountRow | null> {
  const rows = await executor.select().from(stockCount).where(eq(stockCount.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findCountByIdForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<StockCountRow | null> {
  const rows = await executor
    .select()
    .from(stockCount)
    .where(eq(stockCount.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function updateCountRow(
  id: string,
  patch: Partial<typeof stockCount.$inferInsert>,
  executor: DbExecutor,
): Promise<StockCountRow | null> {
  const rows = await executor.update(stockCount).set(patch).where(eq(stockCount.id, id)).returning()
  return rows[0] ?? null
}

export async function selectCountLines(
  countId: string,
  executor: DbExecutor = db,
): Promise<CountLineDetail[]> {
  const rows = await executor
    .select({
      id: stockCountLine.id,
      countId: stockCountLine.countId,
      productId: stockCountLine.productId,
      snapshotQty: stockCountLine.snapshotQty,
      countedQty: stockCountLine.countedQty,
      sku: product.sku,
      productName: product.name,
    })
    .from(stockCountLine)
    .innerJoin(product, eq(product.id, stockCountLine.productId))
    .where(eq(stockCountLine.countId, countId))
    .orderBy(product.name)

  return rows.map((row) => ({
    ...row,
    variance: row.countedQty === null ? null : row.countedQty - row.snapshotQty,
  }))
}

export async function findCountLine(
  countId: string,
  productId: string,
  executor: DbExecutor = db,
): Promise<StockCountLineRow | null> {
  const rows = await executor
    .select()
    .from(stockCountLine)
    .where(and(eq(stockCountLine.countId, countId), eq(stockCountLine.productId, productId)))
    .limit(1)
  return rows[0] ?? null
}

export async function updateCountLine(
  id: string,
  countedQty: number | null,
  executor: DbExecutor,
): Promise<void> {
  await executor.update(stockCountLine).set({ countedQty }).where(eq(stockCountLine.id, id))
}

export async function selectSnapshotRows(
  branchId: string,
  categoryIds: string[] | null,
  executor: DbExecutor = db,
): Promise<SnapshotRow[]> {
  const conditions = [eq(stockLevel.branchId, branchId), eq(product.isActive, true)]
  if (categoryIds && categoryIds.length > 0) {
    conditions.push(inArray(product.categoryId, categoryIds))
  }

  return executor
    .select({
      productId: stockLevel.productId,
      quantityOnHand: stockLevel.quantityOnHand,
    })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(...conditions))
    .orderBy(product.name)
}

function countConditions(filters: CountListFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(stockCount.branchId, filters.branchId))
  if (filters.status) conditions.push(eq(stockCount.status, filters.status))
  return conditions
}

const countSelection = {
  id: stockCount.id,
  number: stockCount.number,
  branchId: stockCount.branchId,
  branchCode: branch.code,
  branchName: branch.name,
  categoryId: stockCount.categoryId,
  status: stockCount.status,
  note: stockCount.note,
  createdBy: stockCount.createdBy,
  postedBy: stockCount.postedBy,
  postedAt: stockCount.postedAt,
  cancelledBy: stockCount.cancelledBy,
  cancelledAt: stockCount.cancelledAt,
  createdAt: stockCount.createdAt,
  updatedAt: stockCount.updatedAt,
}

const lineAggregates = {
  lineCount: sql<number>`count(${stockCountLine.id})`.mapWith(Number),
  countedCount: sql<number>`count(${stockCountLine.countedQty})`.mapWith(Number),
  varianceUnits:
    sql<number>`coalesce(sum(case when ${stockCountLine.countedQty} is not null then ${stockCountLine.countedQty} - ${stockCountLine.snapshotQty} else 0 end), 0)`.mapWith(
      Number,
    ),
}

export async function selectCountPage(
  filters: CountListFilters,
  executor: DbExecutor = db,
): Promise<CountListRow[]> {
  return executor
    .select({ ...countSelection, ...lineAggregates })
    .from(stockCount)
    .innerJoin(branch, eq(branch.id, stockCount.branchId))
    .leftJoin(stockCountLine, eq(stockCountLine.countId, stockCount.id))
    .where(and(...countConditions(filters)))
    .groupBy(stockCount.id, branch.code, branch.name)
    .orderBy(desc(stockCount.createdAt))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countCounts(
  filters: CountListFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(stockCount)
    .where(and(...countConditions(filters)))
  return rows[0]?.total ?? 0
}

export async function selectCountBase(
  id: string,
  executor: DbExecutor = db,
): Promise<CountListRow | null> {
  const rows = await executor
    .select({
      ...countSelection,
      lineCount: sql<number>`0`.mapWith(Number),
      countedCount: sql<number>`0`.mapWith(Number),
      varianceUnits: sql<number>`0`.mapWith(Number),
    })
    .from(stockCount)
    .innerJoin(branch, eq(branch.id, stockCount.branchId))
    .where(eq(stockCount.id, id))
    .limit(1)
  return rows[0] ?? null
}

export async function findCategoryName(
  categoryId: string,
  executor: DbExecutor = db,
): Promise<string | null> {
  const rows = await executor
    .select({ name: category.name })
    .from(category)
    .where(eq(category.id, categoryId))
    .limit(1)
  return rows[0]?.name ?? null
}

/** The window the ABC ranking treats as "what moves" (P12-D29). */
const ABC_SOLD_WINDOW_DAYS = 90

export interface AbcThresholds {
  aThresholdBp: number
  bThresholdBp: number
}

/**
 * Ranks one branch's stocked products by `value_minor + sold_minor` and upserts
 * their ABC class (P12-D29). This is the single implementation the nightly job
 * and the demo seed share.
 *
 * The thresholds are passed in rather than read here: a repository does not
 * resolve settings, and Plan 09's job may want to resolve them once for a whole
 * run. `stock_abc_class.is_manual` rows are left untouched — an admin override
 * outranks the derivation.
 *
 * A branch whose products all score zero classifies them as `C`: there is no
 * value to protect, and `A` would schedule monthly counts of nothing.
 */
export async function computeAbcClasses(
  branchId: string,
  thresholds: AbcThresholds,
  executor: DbExecutor = db,
): Promise<number> {
  const since = new Date(Date.now() - ABC_SOLD_WINDOW_DAYS * 24 * 60 * 60 * 1000)

  const levelRows = await executor
    .select({
      productId: stockLevel.productId,
      quantityOnHand: stockLevel.quantityOnHand,
      avgCostMinor: stockLevel.avgCostMinor,
    })
    .from(stockLevel)
    .where(eq(stockLevel.branchId, branchId))

  const soldRows = await executor
    .select({
      productId: saleLine.productId,
      soldMinor: sql<number>`coalesce(sum(${saleLine.baseMinor}), 0)`.mapWith(Number),
    })
    .from(saleLine)
    .innerJoin(sale, eq(sale.id, saleLine.saleId))
    .where(and(eq(sale.branchId, branchId), gt(sale.occurredAt, since)))
    .groupBy(saleLine.productId)

  const soldByProduct = new Map(soldRows.map((row) => [row.productId, row.soldMinor]))
  const ranked = levelRows
    .map((row) => {
      const valueMinor = row.quantityOnHand * row.avgCostMinor
      const soldMinor = soldByProduct.get(row.productId) ?? 0
      return { productId: row.productId, valueMinor, soldMinor, score: valueMinor + soldMinor }
    })
    .sort(
      (left, right) => right.score - left.score || left.productId.localeCompare(right.productId),
    )

  const totalScore = ranked.reduce((sum, row) => sum + row.score, 0)
  const computedAt = new Date()
  let cumulative = 0

  const values = ranked.map((row) => {
    cumulative += row.score
    const classValue =
      totalScore === 0
        ? ('C' as const)
        : abcClassFromShare(
            ratioBp(cumulative, totalScore) ?? 0,
            thresholds.aThresholdBp,
            thresholds.bThresholdBp,
          )
    return {
      productId: row.productId,
      branchId,
      class: classValue,
      valueMinor: row.valueMinor,
      soldMinor: row.soldMinor,
      score: row.score,
      computedAt,
      isManual: false,
      updatedBy: null,
    }
  })

  if (values.length === 0) return 0

  await executor
    .insert(stockAbcClass)
    .values(values)
    .onConflictDoUpdate({
      target: [stockAbcClass.productId, stockAbcClass.branchId],
      set: {
        class: sql`excluded."class"`,
        valueMinor: sql`excluded."value_minor"`,
        soldMinor: sql`excluded."sold_minor"`,
        score: sql`excluded."score"`,
        computedAt: sql`excluded."computed_at"`,
        updatedBy: sql`excluded."updated_by"`,
      },
      setWhere: eq(stockAbcClass.isManual, false),
    })

  return values.length
}
