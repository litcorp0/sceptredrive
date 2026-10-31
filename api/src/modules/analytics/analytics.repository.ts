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
import { countAccuracyBp } from '@sceptre/shared'
import { type SQL, sql } from 'drizzle-orm'
import { effectiveThresholdSql } from '../inventory/stock-threshold.sql.ts'
import type {
  AnalyticsBranchScope,
  AnalyticsWindow,
  BranchRank,
  CategorySlice,
  CreditBranchRow,
  CreditBucket,
  CreditSeriesPoint,
  CreditUtilisationBucket,
  Granularity,
  InventoryBranchRow,
  InventoryCountAccuracy,
  InventoryFlowPoint,
  InventoryMover,
  InventoryTotals,
  LoyaltySeriesPoint,
  LoyaltyTotals,
  PayablesSeriesPoint,
  PayablesSupplierRow,
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

/**
 * Low stock, exactly as `inventory.service.toStockRow` defines it: a configured threshold
 * at or above the quantity on hand. A zero threshold therefore alerts only at zero, which
 * is the owning service's semantics — do not "improve" the comparison here.
 */

/**
 * Loyalty postings are branch-scoped except for expiry, which the daily job writes once
 * for the whole organisation with a null branch. This mirrors `branchActivity` in
 * `loyalty.repository.ts`, so the analytics tab and `/api/loyalty/liability` agree.
 */
function loyaltyScopeClause(column: SQL, kind: SQL, scope: AnalyticsBranchScope): SQL {
  return scope
    ? sql`(${column} = ${scope} OR (${column} IS NULL AND ${kind} = 'EXPIRE'))`
    : sql`true`
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
  /** Revenue whose sold units carried no cost at all (17-04). */
  uncostedRevenueBaseMinor: number
  /** How many sale lines that revenue came from. */
  uncostedLines: number
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
        COALESCE(SUM(l.tax_total_minor), 0)::bigint AS tax_total_minor,
        COALESCE(SUM(l.base_minor) FILTER (WHERE l.unit_cost_minor = 0), 0)::bigint
          AS uncosted_revenue_base_minor,
        COUNT(*) FILTER (WHERE l.unit_cost_minor = 0)::bigint AS uncosted_lines
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
    uncostedRevenueBaseMinor: toInt(row?.uncosted_revenue_base_minor),
    uncostedLines: toInt(row?.uncosted_lines),
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
      // With no cost there is no margin to state. Reporting 100% would flatter a
      // sale of goods nobody has priced (17-04).
      marginBp:
        revenueBaseMinor === 0 || costMinor === 0
          ? null
          : Math.round((grossProfitMinor * 10_000) / revenueBaseMinor),
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
  outOfStockCount: number
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
  // Two disjoint buckets from one scan (18-02/D3). A `stock_threshold` row is no
  // longer a prerequisite: without one the branch default applies.
  const threshold = effectiveThresholdSql(sql`b.id`, sql`st.threshold`)
  const onHand = sql`coalesce(sl.quantity_on_hand, 0)`
  const [stockAttention] = await rows(
    executor,
    sql`
      SELECT
        count(*) FILTER (WHERE ${onHand} BETWEEN 1 AND ${threshold})::bigint AS low,
        count(*) FILTER (WHERE ${onHand} <= 0)::bigint AS out
      FROM product p
      JOIN branch b ON b.is_active = true AND ${scopeClause(sql`b.id`, scope)}
      LEFT JOIN stock_level sl ON sl.product_id = p.id AND sl.branch_id = b.id
      LEFT JOIN stock_threshold st ON st.product_id = p.id AND st.branch_id = b.id
      WHERE p.is_active = true`,
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
    lowStockCount: toInt(stockAttention?.low),
    outOfStockCount: toInt(stockAttention?.out),
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
  saleId: string
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
      SELECT s.id,
        s.receipt_number,
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
      saleId: toText(row.id),
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
  uncostedRevenueBaseMinor: number
  uncostedLines: number
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
        COUNT(DISTINCT l.product_id)::bigint AS distinct_products,
        COALESCE(SUM(l.base_minor) FILTER (WHERE l.unit_cost_minor = 0), 0)::bigint
          AS uncosted_revenue_base_minor,
        COUNT(*) FILTER (WHERE l.unit_cost_minor = 0)::bigint AS uncosted_lines
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
    uncostedRevenueBaseMinor: toInt(row?.uncosted_revenue_base_minor),
    uncostedLines: toInt(row?.uncosted_lines),
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
          revenueBaseMinor === 0 || costMinor === 0
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

// --- Inventory ---------------------------------------------------------------

export async function selectStockTotals(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<InventoryTotals> {
  // Every active product at the branch, level or no level (18-01). Counting
  // `stock_level` rows made a product that had never been received invisible, so
  // the out-of-stock figure read 0 while the shelf was empty.
  const threshold = effectiveThresholdSql(sql`b.id`, sql`st.threshold`)
  const onHand = sql`coalesce(sl.quantity_on_hand, 0)`
  const [row] = await rows(
    executor,
    sql`
      SELECT
        coalesce(sum(${onHand}::bigint * coalesce(sl.avg_cost_minor, 0)), 0)::bigint
          AS stock_value_minor,
        coalesce(sum(${onHand}), 0)::bigint AS units_on_hand,
        count(*)::bigint AS distinct_products,
        count(*) FILTER (WHERE ${onHand} BETWEEN 1 AND ${threshold})::bigint
          AS low_stock_count,
        count(*) FILTER (WHERE ${onHand} <= 0)::bigint AS out_of_stock_count,
        count(st.threshold)::bigint AS threshold_count
      FROM product p
      JOIN branch b ON b.is_active = true AND ${scopeClause(sql`b.id`, scope)}
      LEFT JOIN stock_level sl ON sl.product_id = p.id AND sl.branch_id = b.id
      LEFT JOIN stock_threshold st ON st.product_id = p.id AND st.branch_id = b.id
      WHERE p.is_active = true`,
  )

  return {
    stockValueMinor: toInt(row?.stock_value_minor),
    unitsOnHand: toInt(row?.units_on_hand),
    distinctProducts: toInt(row?.distinct_products),
    lowStockCount: toInt(row?.low_stock_count),
    outOfStockCount: toInt(row?.out_of_stock_count),
    thresholdCount: toInt(row?.threshold_count),
  }
}

/** Per-branch valuation and low-stock count, on the same basis as the totals (18-01). */
export async function selectStockByBranch(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<InventoryBranchRow[]> {
  const threshold = effectiveThresholdSql(sql`b.id`, sql`st.threshold`)
  const onHand = sql`coalesce(sl.quantity_on_hand, 0)`
  const result = await rows(
    executor,
    sql`
      SELECT b.id, b.code, b.name,
        coalesce(sum(${onHand}::bigint * coalesce(sl.avg_cost_minor, 0)), 0)::bigint
          AS stock_value_minor,
        coalesce(sum(${onHand}), 0)::bigint AS units_on_hand,
        count(*) FILTER (WHERE ${onHand} BETWEEN 1 AND ${threshold})::bigint
          AS low_stock_count
      FROM branch b
      JOIN product p ON p.is_active = true
      LEFT JOIN stock_level sl ON sl.product_id = p.id AND sl.branch_id = b.id
      LEFT JOIN stock_threshold st ON st.product_id = p.id AND st.branch_id = b.id
      WHERE b.is_active = true AND ${scopeClause(sql`b.id`, scope)}
      GROUP BY b.id, b.code, b.name
      ORDER BY stock_value_minor DESC, b.code`,
  )

  return result.map((row) => ({
    branchId: toText(row.id),
    code: toText(row.code),
    name: toText(row.name),
    stockValueMinor: toInt(row.stock_value_minor),
    unitsOnHand: toInt(row.units_on_hand),
    lowStockCount: toInt(row.low_stock_count),
  }))
}

/**
 * Movement trend, gap-filled. Bucketed on `created_at` because `stock_movement` stores no
 * business date — a sale synced a day late belongs to the day it was posted.
 */
export async function selectStockFlow(
  executor: DbExecutor,
  window: AnalyticsWindow,
  granularity: Granularity,
  scope: AnalyticsBranchScope,
): Promise<InventoryFlowPoint[]> {
  const lastInstant = new Date(window.toExclusive.getTime() - 1)
  const step = bucketStep(granularity)
  const result = await rows(
    executor,
    sql`
      SELECT to_char(b.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket_start,
        COALESCE(SUM(sm.quantity_delta) FILTER (WHERE sm.type = 'RECEIPT'), 0)::bigint
          AS received_units,
        COALESCE(-SUM(sm.quantity_delta) FILTER (WHERE sm.type = 'SALE'), 0)::bigint
          AS sold_units,
        COALESCE(
          SUM(sm.quantity_delta) FILTER (WHERE sm.type IN ('ADJUSTMENT', 'COUNT_VARIANCE')),
          0
        )::bigint AS adjusted_units,
        COALESCE(SUM(sm.quantity_delta) FILTER (WHERE sm.type = 'TRANSFER_IN'), 0)::bigint
          AS transferred_in_units,
        COALESCE(-SUM(sm.quantity_delta) FILTER (WHERE sm.type = 'TRANSFER_OUT'), 0)::bigint
          AS transferred_out_units,
        COALESCE(
          SUM(sm.quantity_delta::bigint * sm.unit_cost_minor) FILTER (WHERE sm.type = 'RECEIPT'),
          0
        )::bigint AS received_value_minor
      FROM generate_series(
        date_trunc(${granularity}, ${window.from}::timestamptz, 'UTC'),
        date_trunc(${granularity}, ${lastInstant}::timestamptz, 'UTC'),
        ${step}
      ) AS b(bucket)
      LEFT JOIN stock_movement sm
        ON sm.created_at >= b.bucket
        AND sm.created_at < b.bucket + ${step}
        AND ${scopeClause(sql`sm.branch_id`, scope)}
      GROUP BY b.bucket
      ORDER BY b.bucket`,
  )

  return result.map((row) => ({
    bucketStart: toText(row.bucket_start),
    receivedUnits: toInt(row.received_units),
    soldUnits: toInt(row.sold_units),
    adjustedUnits: toInt(row.adjusted_units),
    transferredInUnits: toInt(row.transferred_in_units),
    transferredOutUnits: toInt(row.transferred_out_units),
    receivedValueMinor: toInt(row.received_value_minor),
  }))
}

export async function selectTopMovers(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
  limit: number,
): Promise<InventoryMover[]> {
  const result = await rows(
    executor,
    sql`
      SELECT sm.product_id, p.sku, p.name,
        COALESCE(-SUM(sm.quantity_delta), 0)::bigint AS units_sold
      FROM stock_movement sm
      JOIN product p ON p.id = sm.product_id
      WHERE sm.type = 'SALE'
        AND ${windowClause(sql`sm.created_at`, window)}
        AND ${scopeClause(sql`sm.branch_id`, scope)}
      GROUP BY sm.product_id, p.sku, p.name
      ORDER BY units_sold DESC, p.name
      LIMIT ${limit}`,
  )

  return result.map((row) => ({
    productId: toText(row.product_id),
    sku: toText(row.sku),
    name: toText(row.name),
    unitsSold: toInt(row.units_sold),
  }))
}

/** Rows holding stock that did not move in the window. A count only (RPT-04 owns the list). */
export async function selectDeadStockCount(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<number> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COUNT(*)::bigint AS count
      FROM stock_level sl
      WHERE sl.quantity_on_hand > 0
        AND ${scopeClause(sql`sl.branch_id`, scope)}
        AND NOT EXISTS (
          SELECT 1
          FROM stock_movement sm
          WHERE sm.product_id = sl.product_id
            AND sm.branch_id = sl.branch_id
            AND ${windowClause(sql`sm.created_at`, window)}
        )`,
  )
  return toInt(row?.count)
}

/**
 * Cycle-count accuracy (P12-D33), the same six figures `counts.repository`
 * computes for `GET /api/counts/accuracy`. This module reads sibling tables
 * directly rather than importing the counts repository, so the SQL is repeated
 * here on purpose; the parity test keeps the two in step.
 *
 * Variance value comes from the `COUNT`-referenced movements, not a second
 * arithmetic over count lines: it reconciles to the ledger by construction.
 */
export async function selectCountAccuracy(
  executor: DbExecutor,
  branchId: string | null,
  window: AnalyticsWindow,
): Promise<InventoryCountAccuracy> {
  const scope = branchId ? sql`AND sc.branch_id = ${branchId}` : sql``
  const [row] = await rows(
    executor,
    sql`
      WITH posted AS (
        SELECT sc.id, sc.due_at, sc.posted_at
        FROM stock_count sc
        WHERE sc.status = 'POSTED'
          AND sc.posted_at >= ${window.from}
          AND sc.posted_at < ${window.toExclusive}
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
        (SELECT COUNT(*) FROM posted
          WHERE due_at IS NOT NULL AND posted_at::date <= due_at)::bigint AS counts_on_time,
        (SELECT COUNT(*) FROM counted)::bigint AS counted_lines,
        (SELECT COUNT(*) FROM counted WHERE counted_qty = snapshot_qty)::bigint AS matched_lines,
        (SELECT COALESCE(SUM(ABS(sm.quantity_delta)::bigint * sm.unit_cost_minor), 0)
          FROM stock_movement sm
          JOIN posted p ON p.id = sm.reference_id
          WHERE sm.reference_type = 'COUNT')::bigint AS variance_value_minor`,
  )

  const countedLines = toInt(row?.counted_lines)
  const matchedLines = toInt(row?.matched_lines)
  return {
    accuracyBp: countAccuracyBp(matchedLines, countedLines),
    countedLines,
    matchedLines,
    countsPosted: toInt(row?.counts_posted),
    countsOnTime: toInt(row?.counts_on_time),
    varianceValueMinor: toInt(row?.variance_value_minor),
  }
}

// --- Credit ------------------------------------------------------------------

export interface CreditPosition {
  outstandingMinor: number
  limitMinor: number
  customersWithBalance: number
  overLimitCount: number
  onHoldCount: number
  overLimitExposureMinor: number
}

export async function selectCreditPosition(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<CreditPosition> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(cp.balance_minor), 0)::bigint AS outstanding_minor,
        COALESCE(SUM(cp.limit_minor), 0)::bigint AS limit_minor,
        COUNT(*) FILTER (WHERE cp.balance_minor > 0)::bigint AS customers_with_balance,
        COUNT(*) FILTER (
          WHERE cp.limit_minor > 0 AND cp.balance_minor > cp.limit_minor
        )::bigint AS over_limit_count,
        COUNT(*) FILTER (WHERE cp.hold)::bigint AS on_hold_count,
        COALESCE(SUM(GREATEST(cp.balance_minor - cp.limit_minor, 0)), 0)::bigint
          AS over_limit_exposure_minor
      FROM credit_profile cp
      WHERE ${scopeClause(sql`cp.branch_id`, scope)}`,
  )

  return {
    outstandingMinor: toInt(row?.outstanding_minor),
    limitMinor: toInt(row?.limit_minor),
    customersWithBalance: toInt(row?.customers_with_balance),
    overLimitCount: toInt(row?.over_limit_count),
    onHoldCount: toInt(row?.on_hold_count),
    overLimitExposureMinor: toInt(row?.over_limit_exposure_minor),
  }
}

/** The append-only cross-check: the whole ledger for the same scope, signed as stored. */
export async function selectCreditLedgerBalance(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<number> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(e.amount_minor), 0)::bigint AS ledger_balance_minor
      FROM credit_ledger_entry e
      WHERE ${scopeClause(sql`e.branch_id`, scope)}`,
  )
  return toInt(row?.ledger_balance_minor)
}

export async function selectCreditSeries(
  executor: DbExecutor,
  window: AnalyticsWindow,
  granularity: Granularity,
  scope: AnalyticsBranchScope,
): Promise<CreditSeriesPoint[]> {
  const lastInstant = new Date(window.toExclusive.getTime() - 1)
  const step = bucketStep(granularity)
  const result = await rows(
    executor,
    sql`
      SELECT to_char(b.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket_start,
        COALESCE(SUM(e.amount_minor) FILTER (WHERE e.kind = 'CHARGE'), 0)::bigint
          AS charges_minor,
        COALESCE(-SUM(e.amount_minor) FILTER (WHERE e.kind IN ('REPAYMENT', 'REFUND')), 0)::bigint
          AS repayments_minor,
        COALESCE(SUM(e.amount_minor), 0)::bigint AS net_minor
      FROM generate_series(
        date_trunc(${granularity}, ${window.from}::timestamptz, 'UTC'),
        date_trunc(${granularity}, ${lastInstant}::timestamptz, 'UTC'),
        ${step}
      ) AS b(bucket)
      LEFT JOIN credit_ledger_entry e
        ON e.occurred_at >= b.bucket
        AND e.occurred_at < b.bucket + ${step}
        AND ${scopeClause(sql`e.branch_id`, scope)}
      GROUP BY b.bucket
      ORDER BY b.bucket`,
  )

  return result.map((row) => ({
    bucketStart: toText(row.bucket_start),
    chargesMinor: toInt(row.charges_minor),
    repaymentsMinor: toInt(row.repayments_minor),
    netMinor: toInt(row.net_minor),
  }))
}

/**
 * Utilisation distribution in integer arithmetic: a boundary compares `balance × 10000`
 * with `limit × boundaryBp`, so 100% is exact and no float appears anywhere.
 */
export async function selectCreditDistribution(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<CreditBucket[]> {
  const result = await rows(
    executor,
    sql`
      SELECT CASE
          WHEN cp.limit_minor = 0 THEN 'No limit'
          WHEN cp.balance_minor::bigint * 10000 <= cp.limit_minor::bigint * 5000 THEN '0-50%'
          WHEN cp.balance_minor::bigint * 10000 <= cp.limit_minor::bigint * 8000 THEN '50-80%'
          WHEN cp.balance_minor::bigint * 10000 <= cp.limit_minor::bigint * 10000 THEN '80-100%'
          ELSE '>100%'
        END AS bucket,
        COUNT(*)::bigint AS count,
        COALESCE(SUM(cp.balance_minor), 0)::bigint AS balance_minor
      FROM credit_profile cp
      WHERE cp.balance_minor > 0
        AND ${scopeClause(sql`cp.branch_id`, scope)}
      GROUP BY 1`,
  )

  const order: CreditUtilisationBucket[] = ['0-50%', '50-80%', '80-100%', '>100%', 'No limit']
  const found = new Map(result.map((row) => [toText(row.bucket), row]))
  return order.map((label) => {
    const row = found.get(label)
    return { label, count: toInt(row?.count), balanceMinor: toInt(row?.balance_minor) }
  })
}

export async function selectCreditByBranch(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<CreditBranchRow[]> {
  const result = await rows(
    executor,
    sql`
      SELECT b.id, b.code, b.name,
        COALESCE(SUM(cp.balance_minor), 0)::bigint AS outstanding_minor,
        COALESCE(SUM(cp.limit_minor), 0)::bigint AS limit_minor,
        COUNT(*) FILTER (
          WHERE cp.limit_minor > 0 AND cp.balance_minor > cp.limit_minor
        )::bigint AS over_limit_count
      FROM credit_profile cp
      JOIN branch b ON b.id = cp.branch_id
      WHERE ${scopeClause(sql`cp.branch_id`, scope)}
      GROUP BY b.id, b.code, b.name
      ORDER BY outstanding_minor DESC, b.code`,
  )

  return result.map((row) => ({
    branchId: toText(row.id),
    code: toText(row.code),
    name: toText(row.name),
    outstandingMinor: toInt(row.outstanding_minor),
    limitMinor: toInt(row.limit_minor),
    overLimitCount: toInt(row.over_limit_count),
  }))
}

// --- Loyalty -----------------------------------------------------------------

export async function selectLoyaltyTotals(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<Omit<LoyaltyTotals, 'outstandingPoints' | 'outstandingValueMinor'>> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(e.points_delta) FILTER (WHERE e.kind = 'EARN'), 0)::bigint
          AS issued_points,
        COALESCE(-SUM(e.points_delta) FILTER (WHERE e.kind = 'REDEEM'), 0)::bigint
          AS redeemed_points,
        COALESCE(-SUM(e.points_delta) FILTER (WHERE e.kind = 'EXPIRE'), 0)::bigint
          AS expired_points,
        COALESCE(SUM(e.points_delta) FILTER (WHERE e.kind = 'ADJUST'), 0)::bigint
          AS adjusted_points,
        COALESCE(-SUM(e.points_delta) FILTER (WHERE e.kind = 'CLAWBACK'), 0)::bigint
          AS clawed_back_points
      FROM loyalty_ledger_entry e
      WHERE ${windowClause(sql`e.occurred_at`, window)}
        AND ${loyaltyScopeClause(sql`e.branch_id`, sql`e.kind`, scope)}`,
  )

  return {
    issuedPoints: toInt(row?.issued_points),
    redeemedPoints: toInt(row?.redeemed_points),
    expiredPoints: toInt(row?.expired_points),
    adjustedPoints: toInt(row?.adjusted_points),
    clawedBackPoints: toInt(row?.clawed_back_points),
  }
}

export async function selectLoyaltySeries(
  executor: DbExecutor,
  window: AnalyticsWindow,
  granularity: Granularity,
  scope: AnalyticsBranchScope,
): Promise<LoyaltySeriesPoint[]> {
  const lastInstant = new Date(window.toExclusive.getTime() - 1)
  const step = bucketStep(granularity)
  const result = await rows(
    executor,
    sql`
      SELECT to_char(b.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket_start,
        COALESCE(SUM(e.points_delta) FILTER (WHERE e.kind = 'EARN'), 0)::bigint
          AS issued_points,
        COALESCE(-SUM(e.points_delta) FILTER (WHERE e.kind = 'REDEEM'), 0)::bigint
          AS redeemed_points,
        COALESCE(-SUM(e.points_delta) FILTER (WHERE e.kind = 'EXPIRE'), 0)::bigint
          AS expired_points
      FROM generate_series(
        date_trunc(${granularity}, ${window.from}::timestamptz, 'UTC'),
        date_trunc(${granularity}, ${lastInstant}::timestamptz, 'UTC'),
        ${step}
      ) AS b(bucket)
      LEFT JOIN loyalty_ledger_entry e
        ON e.occurred_at >= b.bucket
        AND e.occurred_at < b.bucket + ${step}
        AND ${loyaltyScopeClause(sql`e.branch_id`, sql`e.kind`, scope)}
      GROUP BY b.bucket
      ORDER BY b.bucket`,
  )

  return result.map((row) => ({
    bucketStart: toText(row.bucket_start),
    issuedPoints: toInt(row.issued_points),
    redeemedPoints: toInt(row.redeemed_points),
    expiredPoints: toInt(row.expired_points),
  }))
}

// --- Payables ----------------------------------------------------------------

export async function selectPayablesPosition(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
  todayIso: string,
): Promise<{ outstandingMinor: number; overdueMinor: number }> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(i.total_minor - i.amount_paid_minor), 0)::bigint AS outstanding_minor,
        COALESCE(
          SUM(
            CASE WHEN i.due_date < ${todayIso}
              THEN i.total_minor - i.amount_paid_minor ELSE 0 END
          ),
          0
        )::bigint AS overdue_minor
      FROM supplier_invoice i
      WHERE i.status IN ('OPEN', 'PARTIAL')
        AND i.total_minor - i.amount_paid_minor > 0
        AND ${scopeClause(sql`i.branch_id`, scope)}`,
  )

  return {
    outstandingMinor: toInt(row?.outstanding_minor),
    overdueMinor: toInt(row?.overdue_minor),
  }
}

export async function selectInvoicedInWindow(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<number> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(i.total_minor), 0)::bigint AS invoiced_minor
      FROM supplier_invoice i
      WHERE i.status <> 'VOID'
        AND i.invoice_date >= ${window.from}::date
        AND i.invoice_date < ${window.toExclusive}::date
        AND ${scopeClause(sql`i.branch_id`, scope)}`,
  )
  return toInt(row?.invoiced_minor)
}

export async function selectPaidInWindow(
  executor: DbExecutor,
  window: AnalyticsWindow,
  scope: AnalyticsBranchScope,
): Promise<number> {
  const [row] = await rows(
    executor,
    sql`
      SELECT COALESCE(SUM(p.amount_minor), 0)::bigint AS paid_minor
      FROM supplier_payment p
      WHERE p.status = 'COMPLETED'
        AND ${windowClause(sql`p.paid_at`, window)}
        AND ${scopeClause(sql`p.branch_id`, scope)}`,
  )
  return toInt(row?.paid_minor)
}

/**
 * Deposit held on suppliers' account: completed payments minus the signed allocation
 * ledger, the aggregate form of `payables.repository.selectOnAccountBySupplier`.
 */
export async function selectOnAccountTotal(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
): Promise<number> {
  const [row] = await rows(
    executor,
    sql`
      SELECT (
        SELECT COALESCE(SUM(p.amount_minor), 0)::bigint
        FROM supplier_payment p
        WHERE p.status = 'COMPLETED'
          AND ${scopeClause(sql`p.branch_id`, scope)}
      ) - (
        SELECT COALESCE(SUM(a.amount_minor), 0)::bigint
        FROM supplier_payment_allocation a
        JOIN supplier_payment p ON p.id = a.payment_id
        WHERE p.status = 'COMPLETED'
          AND ${scopeClause(sql`p.branch_id`, scope)}
      ) AS on_account_minor`,
  )
  return toInt(row?.on_account_minor)
}

export async function selectPayablesSeries(
  executor: DbExecutor,
  window: AnalyticsWindow,
  granularity: Granularity,
  scope: AnalyticsBranchScope,
): Promise<PayablesSeriesPoint[]> {
  const lastInstant = new Date(window.toExclusive.getTime() - 1)
  const step = bucketStep(granularity)
  const result = await rows(
    executor,
    sql`
      SELECT to_char(b.bucket AT TIME ZONE 'UTC', 'YYYY-MM-DD') AS bucket_start,
        COALESCE((
          SELECT SUM(i.total_minor)
          FROM supplier_invoice i
          WHERE i.status <> 'VOID'
            AND i.invoice_date >= b.bucket::date
            AND i.invoice_date < (b.bucket + ${step})::date
            AND ${scopeClause(sql`i.branch_id`, scope)}
        ), 0)::bigint AS invoiced_minor,
        COALESCE((
          SELECT SUM(p.amount_minor)
          FROM supplier_payment p
          WHERE p.status = 'COMPLETED'
            AND p.paid_at >= b.bucket
            AND p.paid_at < b.bucket + ${step}
            AND ${scopeClause(sql`p.branch_id`, scope)}
        ), 0)::bigint AS paid_minor
      FROM generate_series(
        date_trunc(${granularity}, ${window.from}::timestamptz, 'UTC'),
        date_trunc(${granularity}, ${lastInstant}::timestamptz, 'UTC'),
        ${step}
      ) AS b(bucket)
      ORDER BY b.bucket`,
  )

  return result.map((row) => ({
    bucketStart: toText(row.bucket_start),
    invoicedMinor: toInt(row.invoiced_minor),
    paidMinor: toInt(row.paid_minor),
  }))
}

export async function selectTopSuppliersByOutstanding(
  executor: DbExecutor,
  scope: AnalyticsBranchScope,
  todayIso: string,
  limit: number,
): Promise<PayablesSupplierRow[]> {
  const result = await rows(
    executor,
    sql`
      SELECT i.supplier_id, s.code, s.name,
        COALESCE(SUM(i.total_minor - i.amount_paid_minor), 0)::bigint AS outstanding_minor,
        COALESCE(
          SUM(
            CASE WHEN i.due_date < ${todayIso}
              THEN i.total_minor - i.amount_paid_minor ELSE 0 END
          ),
          0
        )::bigint AS overdue_minor
      FROM supplier_invoice i
      JOIN supplier s ON s.id = i.supplier_id
      WHERE i.status IN ('OPEN', 'PARTIAL')
        AND i.total_minor - i.amount_paid_minor > 0
        AND ${scopeClause(sql`i.branch_id`, scope)}
      GROUP BY i.supplier_id, s.code, s.name
      ORDER BY outstanding_minor DESC, s.name
      LIMIT ${limit}`,
  )

  return result.map((row) => ({
    supplierId: toText(row.supplier_id),
    code: toText(row.code),
    name: toText(row.name),
    outstandingMinor: toInt(row.outstanding_minor),
    overdueMinor: toInt(row.overdue_minor),
  }))
}

/** Branch labels for read models that aggregate outside `branch` (loyalty activity). */
export async function selectBranchLabels(
  executor: DbExecutor,
): Promise<Array<{ branchId: string; code: string; name: string }>> {
  const result = await rows(
    executor,
    sql`SELECT b.id, b.code, b.name FROM branch b ORDER BY b.code`,
  )
  return result.map((row) => ({
    branchId: toText(row.id),
    code: toText(row.code),
    name: toText(row.name),
  }))
}
