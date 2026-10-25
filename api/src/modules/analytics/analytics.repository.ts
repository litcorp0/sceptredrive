/**
 * Analytics data access — aggregates only.
 *
 * **Read-model boundary (P9-D10).** This module spans domains by definition, so it reads
 * sibling `*.schema.ts` tables directly to aggregate. It never imports another module's
 * repository, and it does not re-implement a rule that module owns: the loyalty redemption
 * value comes from `loyalty.service.pointsToValueMinor`, and the ageing buckets used by the
 * payables tab come from `payables.service`. That exception is deliberate and narrow.
 *
 * Every statement here is read-only, parameterised, and run inside the caller's snapshot
 * (`analytics.service.withSnapshot`). Money sums are `::bigint` and converted with
 * `toInt`, because node-postgres hands bigint back as a string.
 */
import type { DbExecutor } from '@sceptre/db'
import { type SQL, sql } from 'drizzle-orm'
import type {
  AnalyticsBranchScope,
  AnalyticsWindow,
  BranchRank,
  CategorySlice,
  Granularity,
  SeriesPoint,
  SyncHealth,
  TopProduct,
} from './analytics.types.ts'

interface Row {
  [key: string]: unknown
}

function toInt(value: unknown): number {
  if (typeof value === 'number') return Number.isSafeInteger(value) ? value : Math.round(value)
  if (typeof value === 'string' && value.trim() !== '') {
    const parsed = Number(value)
    if (Number.isFinite(parsed)) return Math.round(parsed)
  }
  return 0
}

function toOptionalInt(value: unknown): number | null {
  if (value === null || value === undefined) return null
  return toInt(value)
}

function toText(value: unknown): string {
  return typeof value === 'string' ? value : String(value ?? '')
}

/** `branch_id = $1`, or a constant true for the admin's whole organisation. */
function scopeClause(column: SQL, scope: AnalyticsBranchScope): SQL {
  return scope ? sql`${column} = ${scope}` : sql`true`
}

/** Half-open window, which keeps `sale_branch_occurred_idx` usable. */
function windowClause(column: SQL, window: AnalyticsWindow): SQL {
  return sql`${column} >= ${window.from} AND ${column} < ${window.toExclusive}`
}

function bucketStep(granularity: Granularity): SQL {
  if (granularity === 'week') return sql`interval '1 week'`
  if (granularity === 'month') return sql`interval '1 month'`
  return sql`interval '1 day'`
}

async function rows(executor: DbExecutor, query: SQL): Promise<Row[]> {
  const result = await executor.execute<Row>(query)
  return result.rows
}

export interface HeaderTotals {
  salesCount: number
  subtotalMinor: number
  takeMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  changeMinor: number
  creditMinor: number
  loyaltyDiscountMinor: number
}

export async function selectHeaderTotals(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<HeaderTotals> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS sales_count,
        COALESCE(SUM(s.subtotal_minor), 0)::bigint AS subtotal_minor,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COALESCE(SUM(s.vat_minor), 0)::bigint AS vat_minor,
        COALESCE(SUM(s.nhil_minor), 0)::bigint AS nhil_minor,
        COALESCE(SUM(s.getfund_minor), 0)::bigint AS getfund_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS tax_total_minor,
        COALESCE(SUM(s.change_minor), 0)::bigint AS change_minor,
        COALESCE(SUM(s.credit_amount_minor), 0)::bigint AS credit_minor,
        COALESCE(SUM(s.loyalty_discount_minor), 0)::bigint AS loyalty_discount_minor
      FROM sale s
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}`,
  )

  return {
    salesCount: toInt(row?.sales_count),
    subtotalMinor: toInt(row?.subtotal_minor),
    takeMinor: toInt(row?.take_minor),
    vatMinor: toInt(row?.vat_minor),
    nhilMinor: toInt(row?.nhil_minor),
    getfundMinor: toInt(row?.getfund_minor),
    taxTotalMinor: toInt(row?.tax_total_minor),
    changeMinor: toInt(row?.change_minor),
    creditMinor: toInt(row?.credit_minor),
    loyaltyDiscountMinor: toInt(row?.loyalty_discount_minor),
  }
}

export interface LineTotals {
  revenueBaseMinor: number
  costMinor: number
  itemsSold: number
  taxTotalMinor: number
}

export async function selectLineTotals(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<LineTotals> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_base_minor,
        COALESCE(SUM(l.unit_cost_minor::bigint * l.quantity), 0)::bigint AS cost_minor,
        COALESCE(SUM(l.quantity), 0)::bigint AS items_sold,
        COALESCE(SUM(l.tax_total_minor), 0)::bigint AS tax_total_minor
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}`,
  )

  return {
    revenueBaseMinor: toInt(row?.revenue_base_minor),
    costMinor: toInt(row?.cost_minor),
    itemsSold: toInt(row?.items_sold),
    taxTotalMinor: toInt(row?.tax_total_minor),
  }
}

/**
 * Gap-filled trend. `generate_series` supplies every bucket, so a day with no trade is a
 * zero rather than a missing point, and the chart cannot imply a straight line through a
 * closed Sunday.
 */
export async function selectSeries(
  executor: DbExecutor,
  window: AnalyticsWindow,
  granularity: Granularity,
  scope: AnalyticsBranchScope,
): Promise<SeriesPoint[]> {
  const lastInstant = new Date(window.toExclusive.getTime() - 1)
  const result = await rows(
    executor,
    sql`
      SELECT to_char(b.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket_start,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS tax_minor,
        COUNT(s.id)::bigint AS sales_count
      FROM generate_series(
        date_trunc(${granularity}, ${window.from}::timestamptz, 'UTC'),
        date_trunc(${granularity}, ${lastInstant}::timestamptz, 'UTC'),
        ${bucketStep(granularity)}
      ) AS b(bucket)
      LEFT JOIN sale s
        ON s.occurred_at >= b.bucket
        AND s.occurred_at < b.bucket + ${bucketStep(granularity)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY b.bucket
      ORDER BY b.bucket`,
  )

  return result.map((row) => ({
    bucketStart: toText(row.bucket_start),
    takeMinor: toInt(row.take_minor),
    taxTotalMinor: toInt(row.tax_minor),
    salesCount: toInt(row.sales_count),
  }))
}

export interface TenderBreakdown {
  takeMinor: number
  creditMinor: number
  electronic: Array<{ method: string; amountMinor: number }>
}

export async function selectTenderBreakdown(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<TenderBreakdown> {
  const [header] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COALESCE(SUM(s.credit_amount_minor), 0)::bigint AS credit_minor
      FROM sale s
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}`,
  )

  const electronicRows = await rows(
    executor,
    sql`
      SELECT t.method::text AS method, COALESCE(SUM(t.amount_minor), 0)::bigint AS amount_minor
      FROM sale_tender t
      JOIN sale s ON s.id = t.sale_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
        AND t.method NOT IN ('CASH', 'CREDIT')
      GROUP BY t.method
      ORDER BY amount_minor DESC`,
  )

  return {
    takeMinor: toInt(header?.take_minor),
    creditMinor: toInt(header?.credit_minor),
    electronic: electronicRows.map((row) => ({
      method: toText(row.method),
      amountMinor: toInt(row.amount_minor),
    })),
  }
}

export async function selectTopProducts(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
  limit: number,
): Promise<TopProduct[]> {
  const result = await rows(
    executor,
    sql`
      SELECT l.product_id,
        min(l.sku) AS sku,
        min(l.name) AS name,
        COALESCE(SUM(l.quantity), 0)::bigint AS quantity,
        COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_base_minor,
        COALESCE(SUM(l.unit_cost_minor::bigint * l.quantity), 0)::bigint AS cost_minor
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY l.product_id
      ORDER BY revenue_base_minor DESC, quantity DESC
      LIMIT ${limit}`,
  )

  return result.map((row) => {
    const revenueBaseMinor = toInt(row.revenue_base_minor)
    const costMinor = toInt(row.cost_minor)
    const grossProfitMinor = revenueBaseMinor - costMinor
    return {
      productId: toText(row.product_id),
      sku: toText(row.sku),
      name: toText(row.name),
      quantity: toInt(row.quantity),
      revenueBaseMinor,
      costMinor,
      grossProfitMinor,
      marginBp:
        revenueBaseMinor === 0 ? null : Math.round((grossProfitMinor * 10_000) / revenueBaseMinor),
    }
  })
}

export async function selectCategoryTotals(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<CategorySlice[]> {
  const result = await rows(
    executor,
    sql`
      SELECT p.category_id,
        COALESCE(c.name, 'Uncategorised') AS name,
        COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_base_minor,
        COALESCE(SUM(l.quantity), 0)::bigint AS quantity
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      JOIN product p ON p.id = l.product_id
      LEFT JOIN category c ON c.id = p.category_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY p.category_id, c.name
      ORDER BY revenue_base_minor DESC`,
  )

  return result.map((row) => ({
    categoryId: row.category_id ? toText(row.category_id) : null,
    name: toText(row.name),
    revenueBaseMinor: toInt(row.revenue_base_minor),
    quantity: toInt(row.quantity),
  }))
}

export async function selectBranchRanking(
  executor: DbExecutor,
  window: AnalyticsWindow,
  limit: number,
): Promise<BranchRank[]> {
  const result = await rows(
    executor,
    sql`
      SELECT b.id, b.code, b.name,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COUNT(s.id)::bigint AS sales_count
      FROM sale s
      JOIN branch b ON b.id = s.branch_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
      GROUP BY b.id, b.code, b.name
      ORDER BY take_minor DESC
      LIMIT ${limit}`,
  )

  return result.map((row) => ({
    branchId: toText(row.id),
    code: toText(row.code),
    name: toText(row.name),
    takeMinor: toInt(row.take_minor),
    salesCount: toInt(row.sales_count),
  }))
}

export interface AttentionCounts {
  lowStockCount: number
  openConflictCount: number
  conflictsBySeverity: { low: number; medium: number; high: number }
  openShiftCount: number
  overLimitCreditCount: number
  expiringPoints: number
}

export async function selectAttention(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<AttentionCounts> {
  const [lowStock] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS count
      FROM stock_level sl
      JOIN stock_threshold st
        ON st.product_id = sl.product_id AND st.branch_id = sl.branch_id
      WHERE sl.quantity_on_hand <= st.threshold
        AND st.threshold > 0
        AND ${scopeClause(sql`sl.branch_id`, scope)}`,
  )

  const conflictRows = await rows(
    executor,
    sql`
      SELECT c.severity::text AS severity, COUNT(*)::bigint AS count
      FROM sync_conflict c
      WHERE c.status = 'OPEN'
        AND ${scopeClause(sql`c.branch_id`, scope)}
      GROUP BY c.severity`,
  )

  const [openShifts] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS count
      FROM shift sh
      WHERE sh.status = 'OPEN'
        AND ${scopeClause(sql`sh.branch_id`, scope)}`,
  )

  const [overLimit] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS count
      FROM credit_profile cp
      WHERE cp.limit_minor > 0
        AND cp.balance_minor > cp.limit_minor
        AND ${scopeClause(sql`cp.branch_id`, scope)}`,
  )

  // Loyalty accounts are global: no branch scoping is possible or meaningful here.
  const [expiring] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(lot.remaining_points), 0)::bigint AS points
      FROM loyalty_lot lot
      WHERE lot.remaining_points > 0
        AND lot.expires_at < now() + interval '30 days'`,
  )

  const severity = { low: 0, medium: 0, high: 0 }
  let openConflictCount = 0
  for (const row of conflictRows) {
    const count = toInt(row.count)
    openConflictCount += count
    const key = toText(row.severity).toLowerCase()
    if (key === 'low') severity.low += count
    else if (key === 'medium') severity.medium += count
    else if (key === 'high') severity.high += count
  }

  return {
    lowStockCount: toInt(lowStock?.count),
    openConflictCount,
    conflictsBySeverity: severity,
    openShiftCount: toInt(openShifts?.count),
    overLimitCreditCount: toInt(overLimit?.count),
    expiringPoints: toInt(expiring?.points),
  }
}

export async function selectSyncHealth(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<SyncHealth> {
  const [terminals] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS active_terminals,
        COUNT(*) FILTER (
          WHERE t.last_seen_at >= date_trunc('day', now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'
        )::bigint AS seen_today
      FROM terminal t
      WHERE t.is_active = true
        AND ${scopeClause(sql`t.branch_id`, scope)}`,
  )

  const [revoked] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS count
      FROM device d
      JOIN terminal t ON t.id = d.terminal_id
      WHERE d.status = 'REVOKED'
        AND d.revoked_at >= now() - interval '30 days'
        AND ${scopeClause(sql`t.branch_id`, scope)}`,
  )

  const [lag] = await rows(
    executor,
    sql`
      SELECT ROUND(AVG(EXTRACT(EPOCH FROM (s.received_at - s.occurred_at)) / 60))::bigint AS avg_minutes,
        ROUND(MAX(EXTRACT(EPOCH FROM (s.received_at - s.occurred_at)) / 60))::bigint AS max_minutes
      FROM sale s
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}`,
  )

  return {
    activeTerminals: toInt(terminals?.active_terminals),
    terminalsSeenToday: toInt(terminals?.seen_today),
    revokedDevices30d: toInt(revoked?.count),
    avgUploadLagMinutes: toOptionalInt(lag?.avg_minutes),
    maxUploadLagMinutes: toOptionalInt(lag?.max_minutes),
  }
}

// --- Sales report (RPT-01) ---------------------------------------------------

export interface SalesRowResult {
  receiptNumber: string
  occurredAt: string
  branchCode: string
  terminalCode: string
  cashierStaffId: string
  cashierName: string
  itemsSold: number
  takeMinor: number
  taxTotalMinor: number
  changeMinor: number
}

const SALES_ORDER: Record<string, SQL> = {
  date: sql`s.occurred_at`,
  take: sql`s.total_minor`,
  count: sql`items_sold`,
}

export async function selectSalesRows(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
  options: { sort: string; direction: 'asc' | 'desc'; limit: number; offset: number },
): Promise<{ rows: SalesRowResult[]; total: number }> {
  const order = SALES_ORDER[options.sort] ?? SALES_ORDER.date
  const direction = options.direction === 'asc' ? sql`asc` : sql`desc`
  const conditions = sql`${windowClause(sql`s.occurred_at`, window)} AND ${scopeClause(sql`s.branch_id`, scope)}`

  const [countRow] = await rows(
    executor,
    sql`SELECT COUNT(*)::bigint AS total FROM sale s WHERE ${conditions}`,
  )

  const result = await rows(
    executor,
    sql`
      SELECT s.receipt_number,
        to_char(s.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS occurred_at,
        b.code AS branch_code,
        t.code AS terminal_code,
        s.cashier_staff_id,
        COALESCE(u.name, s.cashier_staff_id) AS cashier_name,
        s.total_minor,
        s.tax_total_minor,
        s.change_minor,
        COALESCE((
          SELECT SUM(l.quantity) FROM sale_line l WHERE l.sale_id = s.id
        ), 0)::bigint AS items_sold
      FROM sale s
      JOIN branch b ON b.id = s.branch_id
      JOIN terminal t ON t.id = s.terminal_id
      LEFT JOIN "user" u ON u.id = s.cashier_user_id
      WHERE ${conditions}
      ORDER BY ${order} ${direction}, s.id ${direction}
      LIMIT ${options.limit} OFFSET ${options.offset}`,
  )

  return {
    total: toInt(countRow?.total),
    rows: result.map((row) => ({
      receiptNumber: toText(row.receipt_number),
      occurredAt: toText(row.occurred_at),
      branchCode: toText(row.branch_code),
      terminalCode: toText(row.terminal_code),
      cashierStaffId: toText(row.cashier_staff_id),
      cashierName: toText(row.cashier_name),
      itemsSold: toInt(row.items_sold),
      takeMinor: toInt(row.total_minor),
      taxTotalMinor: toInt(row.tax_total_minor),
      changeMinor: toInt(row.change_minor),
    })),
  }
}

export async function selectByTerminal(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<
  Array<{ id: string; label: string; takeMinor: number; salesCount: number; taxTotalMinor: number }>
> {
  const result = await rows(
    executor,
    sql`
      SELECT t.id, t.code || ' · ' || t.name AS label,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS tax_minor,
        COUNT(*)::bigint AS sales_count
      FROM sale s
      JOIN terminal t ON t.id = s.terminal_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY t.id, t.code, t.name
      ORDER BY take_minor DESC
      LIMIT 50`,
  )

  return result.map((row) => ({
    id: toText(row.id),
    label: toText(row.label),
    takeMinor: toInt(row.take_minor),
    salesCount: toInt(row.sales_count),
    taxTotalMinor: toInt(row.tax_minor),
  }))
}

export async function selectByCashier(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<
  Array<{ id: string; label: string; takeMinor: number; salesCount: number; taxTotalMinor: number }>
> {
  const result = await rows(
    executor,
    sql`
      SELECT s.cashier_user_id AS id,
        COALESCE(max(u.name), max(s.cashier_staff_id)) AS label,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS tax_minor,
        COUNT(*)::bigint AS sales_count
      FROM sale s
      LEFT JOIN "user" u ON u.id = s.cashier_user_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY s.cashier_user_id
      ORDER BY take_minor DESC
      LIMIT 50`,
  )

  return result.map((row) => ({
    id: toText(row.id),
    label: toText(row.label),
    takeMinor: toInt(row.take_minor),
    salesCount: toInt(row.sales_count),
    taxTotalMinor: toInt(row.tax_minor),
  }))
}

export async function selectByBranch(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<
  Array<{ id: string; label: string; takeMinor: number; salesCount: number; taxTotalMinor: number }>
> {
  const result = await rows(
    executor,
    sql`
      SELECT b.id, b.code || ' · ' || b.name AS label,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS tax_minor,
        COUNT(*)::bigint AS sales_count
      FROM sale s
      JOIN branch b ON b.id = s.branch_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY b.id, b.code, b.name
      ORDER BY take_minor DESC
      LIMIT 50`,
  )

  return result.map((row) => ({
    id: toText(row.id),
    label: toText(row.label),
    takeMinor: toInt(row.take_minor),
    salesCount: toInt(row.sales_count),
    taxTotalMinor: toInt(row.tax_minor),
  }))
}

export async function selectHourlyTotals(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<Array<{ hour: number; takeMinor: number; salesCount: number }>> {
  const result = await rows(
    executor,
    sql`
      SELECT h.hour,
        COALESCE(SUM(s.total_minor), 0)::bigint AS take_minor,
        COUNT(s.id)::bigint AS sales_count
      FROM generate_series(0, 23) AS h(hour)
      LEFT JOIN sale s
        ON EXTRACT(HOUR FROM s.occurred_at AT TIME ZONE 'UTC') = h.hour
        AND ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY h.hour
      ORDER BY h.hour`,
  )

  return result.map((row) => ({
    hour: toInt(row.hour),
    takeMinor: toInt(row.take_minor),
    salesCount: toInt(row.sales_count),
  }))
}

// --- Product performance (RPT-03) --------------------------------------------

export interface ProductTotals {
  revenueBaseMinor: number
  costMinor: number
  unitsSold: number
  distinctProducts: number
}

export async function selectProductTotals(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
  categoryId?: string,
): Promise<ProductTotals> {
  const category = categoryId ? sql`AND p.category_id = ${categoryId}` : sql``
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_base_minor,
        COALESCE(SUM(l.unit_cost_minor::bigint * l.quantity), 0)::bigint AS cost_minor,
        COALESCE(SUM(l.quantity), 0)::bigint AS units_sold,
        COUNT(DISTINCT l.product_id)::bigint AS distinct_products
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      JOIN product p ON p.id = l.product_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
        ${category}`,
  )

  return {
    revenueBaseMinor: toInt(row?.revenue_base_minor),
    costMinor: toInt(row?.cost_minor),
    unitsSold: toInt(row?.units_sold),
    distinctProducts: toInt(row?.distinct_products),
  }
}

const PRODUCT_ORDER: Record<string, SQL> = {
  revenue: sql`revenue_base_minor`,
  units: sql`quantity`,
  margin: sql`(COALESCE(SUM(l.base_minor), 0)::numeric - COALESCE(SUM(l.unit_cost_minor::bigint * l.quantity), 0)) / NULLIF(COALESCE(SUM(l.base_minor), 0), 0)`,
}

export interface ProductRowResult {
  productId: string
  sku: string
  name: string
  quantity: number
  revenueBaseMinor: number
  costMinor: number
  grossProfitMinor: number
  marginBp: number | null
  salesCount: number
}

export async function selectProductRows(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
  options: {
    sort: string
    direction: 'asc' | 'desc'
    limit: number
    offset: number
    categoryId?: string
  },
): Promise<{ rows: ProductRowResult[]; total: number }> {
  const order = PRODUCT_ORDER[options.sort] ?? PRODUCT_ORDER.revenue
  const direction = options.direction === 'asc' ? sql`asc` : sql`desc`
  const category = options.categoryId ? sql`AND p.category_id = ${options.categoryId}` : sql``
  const conditions = sql`
    ${windowClause(sql`s.occurred_at`, window)}
    AND ${scopeClause(sql`s.branch_id`, scope)}
    ${category}`

  const [countRow] = await rows(
    executor,
    sql`
      SELECT COUNT(DISTINCT l.product_id)::bigint AS total
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      JOIN product p ON p.id = l.product_id
      WHERE ${conditions}`,
  )

  const result = await rows(
    executor,
    sql`
      SELECT l.product_id,
        min(l.sku) AS sku,
        min(l.name) AS name,
        COALESCE(SUM(l.quantity), 0)::bigint AS quantity,
        COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_base_minor,
        COALESCE(SUM(l.unit_cost_minor::bigint * l.quantity), 0)::bigint AS cost_minor,
        COUNT(DISTINCT l.sale_id)::bigint AS sales_count
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      JOIN product p ON p.id = l.product_id
      WHERE ${conditions}
      GROUP BY l.product_id
      ORDER BY ${order} ${direction}, revenue_base_minor DESC
      LIMIT ${options.limit} OFFSET ${options.offset}`,
  )

  return {
    total: toInt(countRow?.total),
    rows: result.map((row) => {
      const revenueBaseMinor = toInt(row.revenue_base_minor)
      const costMinor = toInt(row.cost_minor)
      const grossProfitMinor = revenueBaseMinor - costMinor
      return {
        productId: toText(row.product_id),
        sku: toText(row.sku),
        name: toText(row.name),
        quantity: toInt(row.quantity),
        revenueBaseMinor,
        costMinor,
        grossProfitMinor,
        marginBp:
          revenueBaseMinor === 0
            ? null
            : Math.round((grossProfitMinor * 10_000) / revenueBaseMinor),
        salesCount: toInt(row.sales_count),
      }
    }),
  }
}

/** Revenue held by the five best sellers, for the concentration line. */
export async function selectTopFiveRevenue(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<{ totalMinor: number; top5Minor: number }> {
  const [row] = await rows(
    executor,
    sql`
      WITH per_product AS (
        SELECT l.product_id, COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_minor
        FROM sale_line l
        JOIN sale s ON s.id = l.sale_id
        WHERE ${windowClause(sql`s.occurred_at`, window)}
          AND ${scopeClause(sql`s.branch_id`, scope)}
        GROUP BY l.product_id
      )
      SELECT COALESCE((SELECT SUM(revenue_minor) FROM per_product), 0)::bigint AS total_minor,
        COALESCE((
          SELECT SUM(revenue_minor)
          FROM (SELECT revenue_minor FROM per_product ORDER BY revenue_minor DESC LIMIT 5) top
        ), 0)::bigint AS top5_minor`,
  )

  return { totalMinor: toInt(row?.total_minor), top5Minor: toInt(row?.top5_minor) }
}

// --- Tax (RPT-02) ------------------------------------------------------------

export async function selectTaxByBranch(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<
  Array<{
    branchId: string
    code: string
    name: string
    baseMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    totalMinor: number
  }>
> {
  const result = await rows(
    executor,
    sql`
      SELECT b.id, b.code, b.name,
        COALESCE(SUM(s.total_minor - s.tax_total_minor), 0)::bigint AS base_minor,
        COALESCE(SUM(s.vat_minor), 0)::bigint AS vat_minor,
        COALESCE(SUM(s.nhil_minor), 0)::bigint AS nhil_minor,
        COALESCE(SUM(s.getfund_minor), 0)::bigint AS getfund_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS total_minor
      FROM sale s
      JOIN branch b ON b.id = s.branch_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY b.id, b.code, b.name
      ORDER BY total_minor DESC`,
  )

  return result.map((row) => ({
    branchId: toText(row.id),
    code: toText(row.code),
    name: toText(row.name),
    baseMinor: toInt(row.base_minor),
    vatMinor: toInt(row.vat_minor),
    nhilMinor: toInt(row.nhil_minor),
    getfundMinor: toInt(row.getfund_minor),
    totalMinor: toInt(row.total_minor),
  }))
}

export async function selectTaxByCategory(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<
  Array<{
    category: string
    baseMinor: number
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    totalMinor: number
    revenueBaseMinor: number
    lineTotalMinor: number
  }>
> {
  const result = await rows(
    executor,
    sql`
      SELECT l.tax_category::text AS category,
        COALESCE(SUM(l.base_minor), 0)::bigint AS base_minor,
        COALESCE(SUM(l.vat_minor), 0)::bigint AS vat_minor,
        COALESCE(SUM(l.nhil_minor), 0)::bigint AS nhil_minor,
        COALESCE(SUM(l.getfund_minor), 0)::bigint AS getfund_minor,
        COALESCE(SUM(l.tax_total_minor), 0)::bigint AS tax_minor,
        COALESCE(SUM(l.base_minor), 0)::bigint AS revenue_base_minor,
        COALESCE(SUM(l.total_minor), 0)::bigint AS line_total_minor
      FROM sale_line l
      JOIN sale s ON s.id = l.sale_id
      WHERE ${windowClause(sql`s.occurred_at`, window)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY l.tax_category
      ORDER BY base_minor DESC`,
  )

  return result.map((row) => ({
    category: toText(row.category),
    baseMinor: toInt(row.base_minor),
    vatMinor: toInt(row.vat_minor),
    nhilMinor: toInt(row.nhil_minor),
    getfundMinor: toInt(row.getfund_minor),
    totalMinor: toInt(row.tax_minor),
    revenueBaseMinor: toInt(row.revenue_base_minor),
    lineTotalMinor: toInt(row.line_total_minor),
  }))
}

export async function selectTaxSeries(
  executor: DbExecutor,
  window: AnalyticsWindow,
  granularity: Granularity,
  scope: AnalyticsBranchScope,
): Promise<
  Array<{
    bucketStart: string
    vatMinor: number
    nhilMinor: number
    getfundMinor: number
    totalMinor: number
  }>
> {
  const lastInstant = new Date(window.toExclusive.getTime() - 1)
  const result = await rows(
    executor,
    sql`
      SELECT to_char(b.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket_start,
        COALESCE(SUM(s.vat_minor), 0)::bigint AS vat_minor,
        COALESCE(SUM(s.nhil_minor), 0)::bigint AS nhil_minor,
        COALESCE(SUM(s.getfund_minor), 0)::bigint AS getfund_minor,
        COALESCE(SUM(s.tax_total_minor), 0)::bigint AS total_minor
      FROM generate_series(
        date_trunc(${granularity}, ${window.from}::timestamptz, 'UTC'),
        date_trunc(${granularity}, ${lastInstant}::timestamptz, 'UTC'),
        ${bucketStep(granularity)}
      ) AS b(bucket)
      LEFT JOIN sale s
        ON s.occurred_at >= b.bucket
        AND s.occurred_at < b.bucket + ${bucketStep(granularity)}
        AND ${scopeClause(sql`s.branch_id`, scope)}
      GROUP BY b.bucket
      ORDER BY b.bucket`,
  )

  return result.map((row) => ({
    bucketStart: toText(row.bucket_start),
    vatMinor: toInt(row.vat_minor),
    nhilMinor: toInt(row.nhil_minor),
    getfundMinor: toInt(row.getfund_minor),
    totalMinor: toInt(row.total_minor),
  }))
}

/** Branch code for an export filename. */
export async function selectBranchCode(
  executor: DbExecutor,
  branchId: string,
): Promise<string | null> {
  const [row] = await rows(executor, sql`SELECT code FROM branch WHERE id = ${branchId} LIMIT 1`)
  return row ? toText(row.code) : null
}
