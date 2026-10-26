import { type DbExecutor, db } from '@sceptre/db'
import { abcClassFromShare, countAccuracyBp, ratioBp } from '@sceptre/shared'
import { and, asc, count, desc, eq, gt, inArray, lte, sql } from 'drizzle-orm'
import { category } from '../catalog/catalog.schema.ts'
import { stockLevel } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { sale, saleLine, syncConflict } from '../pos/pos.schema.ts'
import { product } from '../products/products.schema.ts'
import { countSchedule, stockAbcClass, stockCount, stockCountLine } from './counts.schema.ts'
import type {
  AbcClass,
  AbcRecomputeResult,
  AbcRow,
  AbcThresholds,
  CountAccuracy,
  CountLineDetail,
  CountListFilters,
  CountListRow,
  CountScheduleFilters,
  CountScheduleRow,
  SnapshotRow,
  StockAbcClassRow,
  StockCountLineRow,
  StockCountRow,
} from './counts.types.ts'

// --- Counts ------------------------------------------------------------------

export async function insertCount(
  values: typeof stockCount.$inferInsert,
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

/**
 * The on-hand snapshot for a resolved product set (P12-D31).
 *
 * `LEFT JOIN stock_level` with `COALESCE(…, 0)` is the whole point: a part the
 * branch has never stocked has no level row, and an inner join would hide it
 * from the count that is supposed to find it. Posting a positive variance
 * creates the projection row through `postMovements`.
 */
export async function selectProductsWithLevels(
  branchId: string,
  productIds: readonly string[],
  executor: DbExecutor = db,
): Promise<SnapshotRow[]> {
  if (productIds.length === 0) return []

  return executor
    .select({
      productId: product.id,
      snapshotQty: sql<number>`coalesce(${stockLevel.quantityOnHand}, 0)`.mapWith(Number),
    })
    .from(product)
    .leftJoin(
      stockLevel,
      and(eq(stockLevel.productId, product.id), eq(stockLevel.branchId, branchId)),
    )
    .where(inArray(product.id, [...productIds]))
    .orderBy(product.name)
}

/** Active products that have a projection row in this branch. */
export async function selectStockedProductIds(
  branchId: string,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ productId: stockLevel.productId })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(eq(stockLevel.branchId, branchId), eq(product.isActive, true)))
    .orderBy(product.name)
  return rows.map((row) => row.productId)
}

/** Active products in a category set, whether or not the branch stocks them. */
export async function selectActiveProductIdsByCategory(
  categoryIds: readonly string[],
  executor: DbExecutor = db,
): Promise<string[]> {
  if (categoryIds.length === 0) return []
  const rows = await executor
    .select({ productId: product.id })
    .from(product)
    .where(and(eq(product.isActive, true), inArray(product.categoryId, [...categoryIds])))
    .orderBy(product.name)
  return rows.map((row) => row.productId)
}

export async function selectActiveProductIdsByBrand(
  brandId: string,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ productId: product.id })
    .from(product)
    .where(and(eq(product.isActive, true), eq(product.brandId, brandId)))
    .orderBy(product.name)
  return rows.map((row) => row.productId)
}

export async function selectAbcProductIdsByClass(
  branchId: string,
  abcClass: AbcClass,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ productId: stockAbcClass.productId })
    .from(stockAbcClass)
    .innerJoin(product, eq(product.id, stockAbcClass.productId))
    .where(
      and(
        eq(stockAbcClass.branchId, branchId),
        eq(stockAbcClass.class, abcClass),
        eq(product.isActive, true),
      ),
    )
    .orderBy(product.name)
  return rows.map((row) => row.productId)
}

/** How many active products the branch carries: the rotation denominator. */
export async function countBranchActiveProducts(
  branchId: string,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(stockLevel)
    .innerJoin(product, eq(product.id, stockLevel.productId))
    .where(and(eq(stockLevel.branchId, branchId), eq(product.isActive, true)))
  return rows[0]?.total ?? 0
}

/**
 * Least-recently-counted first, never-counted first of all (P12-D28).
 *
 * A count of another branch must not reset this branch's rotation, so the join
 * to `stock_count` carries the branch and `POSTED` predicates in its `ON`
 * clause. `NULLS FIRST` on ascending `max(posted_at)` is the never-counted
 * group; the product id is the deterministic tie-break.
 */
export async function selectRotationProductIds(
  branchId: string,
  limit: number,
  executor: DbExecutor = db,
): Promise<string[]> {
  if (limit <= 0) return []
  const rows = await executor
    .select({
      productId: product.id,
      lastCountedAt: sql<Date | null>`max(${stockCount.postedAt})`,
    })
    .from(product)
    .innerJoin(
      stockLevel,
      and(eq(stockLevel.productId, product.id), eq(stockLevel.branchId, branchId)),
    )
    .leftJoin(stockCountLine, eq(stockCountLine.productId, product.id))
    .leftJoin(
      stockCount,
      and(
        eq(stockCount.id, stockCountLine.countId),
        eq(stockCount.status, 'POSTED'),
        eq(stockCount.branchId, branchId),
      ),
    )
    .where(eq(product.isActive, true))
    .groupBy(product.id)
    .orderBy(sql`max(${stockCount.postedAt}) asc nulls first`, asc(product.id))
    .limit(limit)
  return rows.map((row) => row.productId)
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
  countType: stockCount.countType,
  scope: stockCount.scope,
  scopeKey: stockCount.scopeKey,
  dueAt: stockCount.dueAt,
  assignedTo: stockCount.assignedTo,
  scheduleId: stockCount.scheduleId,
  triggerReason: stockCount.triggerReason,
  triggerProductId: stockCount.triggerProductId,
  triggerSourceId: stockCount.triggerSourceId,
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

// --- Schedules ---------------------------------------------------------------

export async function insertSchedule(
  values: typeof countSchedule.$inferInsert,
  executor: DbExecutor = db,
): Promise<CountScheduleRow | null> {
  const rows = await executor.insert(countSchedule).values(values).returning()
  return rows[0] ?? null
}

export async function findScheduleById(
  id: string,
  executor: DbExecutor = db,
): Promise<CountScheduleRow | null> {
  const rows = await executor.select().from(countSchedule).where(eq(countSchedule.id, id)).limit(1)
  return rows[0] ?? null
}

export async function findScheduleByIdForUpdate(
  id: string,
  executor: DbExecutor,
): Promise<CountScheduleRow | null> {
  const rows = await executor
    .select()
    .from(countSchedule)
    .where(eq(countSchedule.id, id))
    .limit(1)
    .for('update')
  return rows[0] ?? null
}

export async function findScheduleByScopeKey(
  branchId: string,
  scopeKey: string,
  executor: DbExecutor = db,
): Promise<CountScheduleRow | null> {
  const rows = await executor
    .select()
    .from(countSchedule)
    .where(and(eq(countSchedule.branchId, branchId), eq(countSchedule.scopeKey, scopeKey)))
    .limit(1)
  return rows[0] ?? null
}

function scheduleConditions(filters: CountScheduleFilters) {
  const conditions = []
  if (filters.branchId) conditions.push(eq(countSchedule.branchId, filters.branchId))
  if (filters.active !== undefined) conditions.push(eq(countSchedule.isActive, filters.active))
  return conditions
}

export async function selectSchedulePage(
  filters: CountScheduleFilters,
  executor: DbExecutor = db,
): Promise<CountScheduleRow[]> {
  return executor
    .select()
    .from(countSchedule)
    .where(and(...scheduleConditions(filters)))
    .orderBy(asc(countSchedule.nextDueAt), asc(countSchedule.id))
    .limit(filters.limit)
    .offset(filters.offset)
}

export async function countSchedules(
  filters: CountScheduleFilters,
  executor: DbExecutor = db,
): Promise<number> {
  const rows = await executor
    .select({ total: count() })
    .from(countSchedule)
    .where(and(...scheduleConditions(filters)))
  return rows[0]?.total ?? 0
}

export async function updateScheduleRow(
  id: string,
  patch: Partial<typeof countSchedule.$inferInsert>,
  executor: DbExecutor,
): Promise<CountScheduleRow | null> {
  const rows = await executor
    .update(countSchedule)
    .set(patch)
    .where(eq(countSchedule.id, id))
    .returning()
  return rows[0] ?? null
}

/** Active schedules whose due day has arrived (the nightly worker's input). */
export async function selectDueSchedules(
  todayIsoDay: string,
  executor: DbExecutor = db,
): Promise<CountScheduleRow[]> {
  return executor
    .select()
    .from(countSchedule)
    .where(and(eq(countSchedule.isActive, true), lte(countSchedule.nextDueAt, todayIsoDay)))
    .orderBy(asc(countSchedule.nextDueAt), asc(countSchedule.id))
}

export async function selectActiveBranchIds(executor: DbExecutor = db): Promise<string[]> {
  const rows = await executor
    .select({ id: branch.id })
    .from(branch)
    .where(eq(branch.isActive, true))
    .orderBy(asc(branch.code))
  return rows.map((row) => row.id)
}

// --- ABC classes -------------------------------------------------------------

export async function selectAbcRows(
  branchId: string | null,
  abcClass: AbcClass | undefined,
  executor: DbExecutor = db,
): Promise<AbcRow[]> {
  const conditions = []
  if (branchId) conditions.push(eq(stockAbcClass.branchId, branchId))
  if (abcClass) conditions.push(eq(stockAbcClass.class, abcClass))

  return executor
    .select({
      productId: stockAbcClass.productId,
      branchId: stockAbcClass.branchId,
      sku: product.sku,
      productName: product.name,
      class: stockAbcClass.class,
      valueMinor: stockAbcClass.valueMinor,
      soldMinor: stockAbcClass.soldMinor,
      score: stockAbcClass.score,
      isManual: stockAbcClass.isManual,
      computedAt: stockAbcClass.computedAt,
      updatedBy: stockAbcClass.updatedBy,
      updatedAt: stockAbcClass.updatedAt,
    })
    .from(stockAbcClass)
    .innerJoin(product, eq(product.id, stockAbcClass.productId))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(asc(stockAbcClass.class), desc(stockAbcClass.score), asc(product.sku))
}

export async function findAbcRow(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<StockAbcClassRow | null> {
  const rows = await executor
    .select()
    .from(stockAbcClass)
    .where(and(eq(stockAbcClass.productId, productId), eq(stockAbcClass.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

export async function findLevelValue(
  productId: string,
  branchId: string,
  executor: DbExecutor = db,
): Promise<{ quantityOnHand: number; avgCostMinor: number } | null> {
  const rows = await executor
    .select({
      quantityOnHand: stockLevel.quantityOnHand,
      avgCostMinor: stockLevel.avgCostMinor,
    })
    .from(stockLevel)
    .where(and(eq(stockLevel.productId, productId), eq(stockLevel.branchId, branchId)))
    .limit(1)
  return rows[0] ?? null
}

export async function upsertAbcRow(
  values: typeof stockAbcClass.$inferInsert,
  executor: DbExecutor,
): Promise<StockAbcClassRow | null> {
  const rows = await executor
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
        isManual: sql`excluded."is_manual"`,
        updatedBy: sql`excluded."updated_by"`,
      },
    })
    .returning()
  return rows[0] ?? null
}

export async function updateAbcClassRow(
  productId: string,
  branchId: string,
  patch: { class: AbcClass; isManual: boolean; updatedBy: string | null },
  executor: DbExecutor,
): Promise<void> {
  await executor
    .update(stockAbcClass)
    .set(patch)
    .where(and(eq(stockAbcClass.productId, productId), eq(stockAbcClass.branchId, branchId)))
}

export async function findManualAbcProductIds(
  branchId: string,
  executor: DbExecutor = db,
): Promise<string[]> {
  const rows = await executor
    .select({ productId: stockAbcClass.productId })
    .from(stockAbcClass)
    .where(and(eq(stockAbcClass.branchId, branchId), eq(stockAbcClass.isManual, true)))
  return rows.map((row) => row.productId)
}

/** The window the ABC ranking treats as "what moves" (P12-D29). */
const ABC_SOLD_WINDOW_DAYS = 90

/**
 * Ranks one branch's stocked products by `value_minor + sold_minor` and upserts
 * their ABC class, leaving `is_manual` rows untouched (P12-D29).
 *
 * The thresholds and the sold map are passed in rather than resolved here: a
 * repository does not read settings and does not call a sibling module's
 * service. `counts.service.recomputeAbcClasses` supplies both, so the whole
 * write happens in the caller's transaction.
 *
 * A branch whose products all score zero classifies them as `C`: there is no
 * value to protect, and `A` would schedule monthly counts of nothing.
 */
export async function recomputeAbcRows(
  branchId: string,
  thresholds: AbcThresholds,
  soldByProduct: ReadonlyMap<string, number>,
  executor: DbExecutor = db,
): Promise<AbcRecomputeResult> {
  const levelRows = await executor
    .select({
      productId: stockLevel.productId,
      quantityOnHand: stockLevel.quantityOnHand,
      avgCostMinor: stockLevel.avgCostMinor,
    })
    .from(stockLevel)
    .where(eq(stockLevel.branchId, branchId))

  const ranked = levelRows
    .map((row) => {
      const valueMinor = row.quantityOnHand * row.avgCostMinor
      const soldMinor = soldByProduct.get(row.productId) ?? 0
      return { productId: row.productId, valueMinor, soldMinor, score: valueMinor + soldMinor }
    })
    .sort(
      (left, right) => right.score - left.score || left.productId.localeCompare(right.productId),
    )

  if (ranked.length === 0) return { updated: 0, skipped: 0 }

  const manualProductIds = new Set(await findManualAbcProductIds(branchId, executor))
  const skipped = ranked.filter((row) => manualProductIds.has(row.productId)).length

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

  return { updated: values.length - skipped, skipped }
}

/**
 * The seed's entry point: resolves the 90-day sold map itself because a seed
 * helper must not depend on the POS service. Kept as `Promise<number>` so the
 * existing seed keeps its contract.
 */
export async function computeAbcClasses(
  branchId: string,
  thresholds: AbcThresholds,
  executor: DbExecutor = db,
): Promise<number> {
  const since = new Date(Date.now() - ABC_SOLD_WINDOW_DAYS * 24 * 60 * 60 * 1000)
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
  return (await recomputeAbcRows(branchId, thresholds, soldByProduct, executor)).updated
}

// --- Triggers ----------------------------------------------------------------

/**
 * `STOCK_OVERSELL` conflicts grouped by branch and product inside the window
 * (P12-D32). The UUID shape filter keeps a malformed `details` payload from
 * aborting the whole nightly scan on a foreign-key violation.
 */
export async function selectOversellConflicts(
  since: Date,
  minimum: number,
  executor: DbExecutor = db,
): Promise<Array<{ branchId: string; productId: string; conflicts: number }>> {
  const productId = sql<string>`${syncConflict.details} ->> 'productId'`
  const rows = await executor
    .select({
      branchId: syncConflict.branchId,
      productId,
      conflicts: sql<number>`count(*)`.mapWith(Number),
    })
    .from(syncConflict)
    .where(
      and(
        eq(syncConflict.type, 'STOCK_OVERSELL'),
        gt(syncConflict.createdAt, since),
        sql`${productId} ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'`,
      ),
    )
    .groupBy(syncConflict.branchId, productId)
    .having(sql`count(*) >= ${minimum}`)
  return rows
}

// --- Accuracy ----------------------------------------------------------------

/**
 * The six accuracy figures, all from posted counts and the ledger (P12-D33).
 *
 * The variance value is `Σ ABS(quantity_delta) × unit_cost_minor` over the
 * `COUNT`-referenced movements of the same counts, so it cannot disagree with
 * the ledger by construction. `counted_qty IS NOT NULL` is the denominator;
 * `counted_qty = snapshot_qty` is the match.
 */
export async function selectCountAccuracy(
  branchId: string | null,
  from: Date,
  toExclusive: Date,
  executor: DbExecutor = db,
): Promise<CountAccuracy> {
  const scope = branchId ? sql`AND sc.branch_id = ${branchId}` : sql``

  const result = await executor.execute<{
    counts_posted: string | number
    counts_on_time: string | number
    counted_lines: string | number
    matched_lines: string | number
    variance_value_minor: string | number
  }>(sql`
    WITH posted AS (
      SELECT sc.id, sc.due_at, sc.posted_at
      FROM stock_count sc
      WHERE sc.status = 'POSTED'
        AND sc.posted_at >= ${from}
        AND sc.posted_at < ${toExclusive}
        ${scope}
    ),
    counted AS (
      SELECT l.counted_qty, l.snapshot_qty
      FROM stock_count_line l
      JOIN posted p ON p.id = l.count_id
      WHERE l.counted_qty IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*) FROM posted)::bigint AS counts_posted,
      (SELECT COUNT(*) FROM posted WHERE due_at IS NOT NULL AND posted_at::date <= due_at)::bigint
        AS counts_on_time,
      (SELECT COUNT(*) FROM counted)::bigint AS counted_lines,
      (SELECT COUNT(*) FROM counted WHERE counted_qty = snapshot_qty)::bigint AS matched_lines,
      (SELECT COALESCE(SUM(ABS(sm.quantity_delta)::bigint * sm.unit_cost_minor), 0)
        FROM stock_movement sm
        JOIN posted p ON p.id = sm.reference_id
        WHERE sm.reference_type = 'COUNT')::bigint AS variance_value_minor
  `)

  const row = result.rows[0]
  const countedLines = Number(row?.counted_lines ?? 0)
  const matchedLines = Number(row?.matched_lines ?? 0)
  return {
    // The shared rule, not a second arithmetic: `null` when nothing was counted.
    accuracyBp: countAccuracyBp(matchedLines, countedLines),
    countedLines,
    matchedLines,
    countsPosted: Number(row?.counts_posted ?? 0),
    countsOnTime: Number(row?.counts_on_time ?? 0),
    varianceValueMinor: Number(row?.variance_value_minor ?? 0),
  }
}
