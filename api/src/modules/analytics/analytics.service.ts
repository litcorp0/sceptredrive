import { db } from '@sceptre/db'
import {
  accraIsoDay,
  averageBasketMinor,
  deltaBp,
  GETFUND_RATE_BP,
  NHIL_RATE_BP,
  ratioBp,
  STANDARD_TAX_RATE_BP,
  toCsv,
  VAT_RATE_BP,
} from '@sceptre/shared'
import { sql } from 'drizzle-orm'
import { resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { AppError, ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import {
  EXPIRING_SOON_DAYS,
  getBranchActivityTotals,
  pointsToValueMinor,
  sumExpiringSoonPoints,
  sumOutstandingPoints,
} from '../loyalty/loyalty.service.ts'
import { getAgingTotals } from '../payables/payables.service.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import * as repository from './analytics.repository.ts'
import type {
  AnalyticsQuery,
  AnalyticsWindow,
  BranchRank,
  CategorySlice,
  MoneyDelta,
  OverviewResponse,
  Period,
  SeriesPoint,
  TenderSlice,
} from './analytics.types.ts'

const MAX_SPAN_DAYS = 366
const TOP_PRODUCT_LIMIT = 10
const CATEGORY_BREAKDOWN_SIZE = 5
const BRANCH_RANKING_LIMIT = 10
const DASHBOARD_STATEMENT_TIMEOUT_MS = 3_000
const DAY_MS = 86_400_000

function parseIsoDay(value: string): Date {
  return new Date(`${value}T00:00:00.000Z`)
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS)
}

/**
 * Turns `from`/`to` into a half-open UTC window plus the comparison window.
 *
 * `to` is inclusive for the caller and clamped to today: asking for the future is a UI
 * shortcut, not an error, and must not produce empty buckets. A reversed or over-long range
 * is a client bug and is refused with a sentence a user can act on.
 */
export function resolvePeriod(query: AnalyticsQuery): { period: Period; comparison: Period } {
  const from = parseIsoDay(query.from)
  const to = parseIsoDay(query.to)
  if (Number.isNaN(from.getTime()) || Number.isNaN(to.getTime())) {
    throw new ValidationError('from and to must be ISO dates')
  }

  const today = parseIsoDay(accraIsoDay())
  const clampedTo = to.getTime() > today.getTime() ? today : to
  if (from.getTime() > clampedTo.getTime()) {
    throw new ValidationError('from must be on or before to')
  }

  const days = Math.round((clampedTo.getTime() - from.getTime()) / DAY_MS) + 1
  if (days > MAX_SPAN_DAYS) {
    throw new ValidationError(`A report can cover at most ${MAX_SPAN_DAYS} days`)
  }

  const previousTo = addDays(from, -1)
  const previousFrom = addDays(previousTo, -(days - 1))

  return {
    period: {
      from: isoDay(from),
      to: isoDay(clampedTo),
      granularity: query.granularity,
      days,
    },
    comparison: {
      from: isoDay(previousFrom),
      to: isoDay(previousTo),
      granularity: query.granularity,
      days,
    },
  }
}

/** The half-open range the SQL sees. */
export function toWindow(period: { from: string; to: string }): AnalyticsWindow {
  return {
    from: parseIsoDay(period.from),
    toExclusive: addDays(parseIsoDay(period.to), 1),
  }
}

/**
 * One read-only snapshot per request.
 *
 * Every figure on a screen must come from the same instant, or a KPI tile and the series
 * beneath it can differ by one sale while both look right. `read only` also means a bug in
 * a read model cannot write. `statement_timeout` bounds an accidental full-table scan.
 */
export const SNAPSHOT_OPTIONS = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const

export const STATEMENT_TIMEOUT_SQL = sql.raw(
  `set local statement_timeout = '${DASHBOARD_STATEMENT_TIMEOUT_MS}ms'`,
)

export function moneyDelta(currentMinor: number, previousMinor: number): MoneyDelta {
  return { currentMinor, previousMinor, deltaBp: deltaBp(previousMinor, currentMinor) }
}

/**
 * Cash is derived, never summed from `sale_tender`: a CASH row stores what the customer
 * handed over, change included (P9-D2). Electronic tenders come from their own rows, credit
 * from the sale header, and the remainder is the cash the till actually kept.
 */
export function buildTenderMix(
  takeMinor: number,
  creditMinor: number,
  electronic: Array<{ method: string; amountMinor: number }>,
): TenderSlice[] {
  const electronicMinor = electronic.reduce((total, slice) => total + slice.amountMinor, 0)
  const cashMinor = takeMinor - electronicMinor - creditMinor
  if (cashMinor < 0) {
    throw new AppError(
      500,
      'ANALYTICS_INCONSISTENT',
      'The tender breakdown exceeds the sale total; a stored sale is inconsistent',
    )
  }

  const mix: TenderSlice[] = [{ method: 'CASH', amountMinor: cashMinor }]
  for (const slice of electronic) {
    if (slice.amountMinor > 0) mix.push({ method: slice.method, amountMinor: slice.amountMinor })
  }
  if (creditMinor > 0) mix.push({ method: 'CREDIT', amountMinor: creditMinor })
  return mix
}

/** Top four categories plus an exact "Other", so the stack still reconciles. */
export function foldCategories(slices: CategorySlice[]): CategorySlice[] {
  if (slices.length <= CATEGORY_BREAKDOWN_SIZE) return slices
  const head = slices.slice(0, CATEGORY_BREAKDOWN_SIZE - 1)
  const tail = slices.slice(CATEGORY_BREAKDOWN_SIZE - 1)
  const other: CategorySlice = {
    categoryId: null,
    name: 'Other',
    revenueBaseMinor: tail.reduce((total, slice) => total + slice.revenueBaseMinor, 0),
    quantity: tail.reduce((total, slice) => total + slice.quantity, 0),
  }
  return [...head, other]
}

function sumSeries(points: SeriesPoint[], field: 'takeMinor' | 'taxTotalMinor' | 'salesCount') {
  return points.reduce((total, point) => total + point[field], 0)
}

export interface OverviewContext {
  user: SessionUser
  query: AnalyticsQuery
}

/**
 * The dashboard read model.
 *
 * Deltas compare against the immediately preceding window of equal length, computed here so
 * every client sees the same comparison. `branchRanking` is empty for a manager: the figure
 * is an organisation-wide comparison and a manager has nothing to compare.
 */
/**
 * The margin a window may state (17-04).
 *
 * With revenue and no cost at all, the arithmetic answer is 100% — and it is
 * wrong: nobody has bought the goods yet. `null` is the honest answer, and the
 * overview carries `uncostedRevenueMinor` beside it so a reader can see how much
 * of the revenue the figure cannot explain. A mixed window keeps its real margin;
 * flattening that to `null` would throw away information.
 *
 * Pure and exported so the rule is tested without a database.
 */
export function marginWhenCosted(input: {
  revenueBaseMinor: number
  costMinor: number
  uncostedRevenueBaseMinor: number
}): number | null {
  const revenue = input.revenueBaseMinor
  if (revenue <= 0) return null
  if (input.uncostedRevenueBaseMinor >= revenue) return null
  return ratioBp(revenue - input.costMinor, revenue)
}

export async function getOverview({ user, query }: OverviewContext): Promise<OverviewResponse> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period, comparison } = resolvePeriod(query)
  const window = toWindow(period)
  const previousWindow = toWindow(comparison)
  const isAdmin = roleOf(user) === 'ADMIN'

  const snapshot = await db.transaction(
    async (tx) => {
      await tx.execute(STATEMENT_TIMEOUT_SQL)
      const pointsPerCedi = await getSettingValue('loyalty.pointsPerCedi', {}, tx)
      // Sequential on purpose: one connection, one snapshot. node-postgres warns (and will
      // refuse) concurrent queries on the same client, and eleven small aggregate queries do
      // not benefit from racing them.
      const header = await repository.selectHeaderTotals(tx, window, branchId)
      const lines = await repository.selectLineTotals(tx, window, branchId)
      const previousHeader = await repository.selectHeaderTotals(tx, previousWindow, branchId)
      const previousLines = await repository.selectLineTotals(tx, previousWindow, branchId)
      const series = await repository.selectSeries(tx, window, period.granularity, branchId)
      const tender = await repository.selectTenderBreakdown(tx, window, branchId)
      const topProducts = await repository.selectTopProducts(
        tx,
        window,
        branchId,
        TOP_PRODUCT_LIMIT,
      )
      const categories = await repository.selectCategoryTotals(tx, window, branchId)
      const branchRanking = isAdmin
        ? await repository.selectBranchRanking(tx, window, BRANCH_RANKING_LIMIT)
        : ([] as BranchRank[])
      const attention = await repository.selectAttention(tx, branchId)
      const syncHealth = await repository.selectSyncHealth(tx, window, branchId)
      return {
        pointsPerCedi,
        header,
        lines,
        previousHeader,
        previousLines,
        series,
        tender,
        topProducts,
        categories,
        branchRanking,
        attention,
        syncHealth,
      }
    },
    { isolationLevel: SNAPSHOT_OPTIONS.isolationLevel, accessMode: SNAPSHOT_OPTIONS.accessMode },
  )

  const {
    header,
    lines,
    previousHeader,
    previousLines,
    series,
    tender,
    topProducts,
    categories,
    branchRanking,
    attention,
    syncHealth,
    pointsPerCedi,
  } = snapshot

  const grossProfitMinor = lines.revenueBaseMinor - lines.costMinor
  const previousGrossProfitMinor = previousLines.revenueBaseMinor - previousLines.costMinor
  const marginBp = marginWhenCosted({
    revenueBaseMinor: lines.revenueBaseMinor,
    costMinor: lines.costMinor,
    uncostedRevenueBaseMinor: lines.uncostedRevenueBaseMinor,
  })
  const previousMarginBp = ratioBp(previousGrossProfitMinor, previousLines.revenueBaseMinor)
  const avgBasketMinor = averageBasketMinor(header.takeMinor, header.salesCount)
  const previousAvgBasketMinor = averageBasketMinor(
    previousHeader.takeMinor,
    previousHeader.salesCount,
  )

  const tenderMix = buildTenderMix(header.takeMinor, tender.creditMinor, tender.electronic)

  return {
    currency: 'GHS',
    period,
    comparison: { from: comparison.from, to: comparison.to },
    scope: { branchId, allBranches: branchId === null },
    totals: {
      takeMinor: header.takeMinor,
      revenueBaseMinor: lines.revenueBaseMinor,
      grossProfitMinor,
      marginBp,
      uncostedRevenueMinor: lines.uncostedRevenueBaseMinor,
      uncostedLines: lines.uncostedLines,
      tax: {
        baseMinor: header.takeMinor - header.taxTotalMinor,
        vatMinor: header.vatMinor,
        nhilMinor: header.nhilMinor,
        getfundMinor: header.getfundMinor,
        totalMinor: header.taxTotalMinor,
      },
      salesCount: header.salesCount,
      avgBasketMinor,
      itemsSold: lines.itemsSold,
      changeMinor: header.changeMinor,
      cashMinor: tenderMix[0]?.amountMinor ?? 0,
      electronicMinor: tender.electronic.reduce((total, slice) => total + slice.amountMinor, 0),
      creditMinor: header.creditMinor,
      refundsMinor: 0,
      refundCount: 0,
    },
    deltas: {
      take: moneyDelta(header.takeMinor, previousHeader.takeMinor),
      grossProfit: moneyDelta(grossProfitMinor, previousGrossProfitMinor),
      salesCount: moneyDelta(header.salesCount, previousHeader.salesCount),
      avgBasket: moneyDelta(avgBasketMinor, previousAvgBasketMinor),
      marginBpDelta:
        marginBp === null || previousMarginBp === null ? null : marginBp - previousMarginBp,
    },
    series,
    tenderMix,
    topProducts,
    categorySplit: foldCategories(categories),
    branchRanking,
    attention: {
      ...attention,
      expiringPointsValueMinor: pointsToValueMinor(attention.expiringPoints, pointsPerCedi),
    },
    syncHealth,
    driftMinor: {
      revenue: header.takeMinor - header.taxTotalMinor - lines.revenueBaseMinor,
      tax: header.taxTotalMinor - lines.taxTotalMinor,
    },
  }
}

/** Exported for tests: the two invariants the series and mix must satisfy. */
export const invariants = {
  seriesTake: (points: SeriesPoint[]) => sumSeries(points, 'takeMinor'),
  seriesTax: (points: SeriesPoint[]) => sumSeries(points, 'taxTotalMinor'),
  seriesCount: (points: SeriesPoint[]) => sumSeries(points, 'salesCount'),
  tenderTotal: (mix: TenderSlice[]) => mix.reduce((total, slice) => total + slice.amountMinor, 0),
  expiringWindowDays: EXPIRING_SOON_DAYS,
}

// --- Reports ----------------------------------------------------------------

export interface ReportContext<Q extends AnalyticsQuery> {
  user: SessionUser
  query: Q
}

function scopeView(branchId: string | null) {
  return { branchId, allBranches: branchId === null }
}

/** Runs `fn` in the same read-only snapshot every report uses. */
async function inSnapshot<T>(
  fn: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<T>,
): Promise<T> {
  return db.transaction(fn, {
    isolationLevel: SNAPSHOT_OPTIONS.isolationLevel,
    accessMode: SNAPSHOT_OPTIONS.accessMode,
  })
}

export async function getSales(
  context: ReportContext<
    AnalyticsQuery & {
      sort?: string
      direction?: 'asc' | 'desc'
      limit?: number
      offset?: number
    }
  >,
): Promise<import('./analytics.types.ts').SalesResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period, comparison } = resolvePeriod(query)
  const window = toWindow(period)
  const previousWindow = toWindow(comparison)
  const isAdmin = roleOf(user) === 'ADMIN'
  const sort = query.sort ?? 'date'
  const direction = query.direction ?? 'desc'
  const limit = Math.min(query.limit ?? 20, 50)
  const offset = query.offset ?? 0

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const header = await repository.selectHeaderTotals(tx, window, branchId)
    const lines = await repository.selectLineTotals(tx, window, branchId)
    const previousHeader = await repository.selectHeaderTotals(tx, previousWindow, branchId)
    const series = await repository.selectSeries(tx, window, period.granularity, branchId)
    const byTerminal = await repository.selectByTerminal(tx, window, branchId)
    const byCashier = await repository.selectByCashier(tx, window, branchId)
    const byBranch = isAdmin ? await repository.selectByBranch(tx, window, branchId) : []
    const byHour = await repository.selectHourlyTotals(tx, window, branchId)
    const page = await repository.selectSalesRows(tx, window, branchId, {
      sort,
      direction,
      limit,
      offset,
    })
    return { header, lines, previousHeader, series, byTerminal, byCashier, byBranch, byHour, page }
  })

  const avgBasketMinor = averageBasketMinor(result.header.takeMinor, result.header.salesCount)
  const previousAvgBasket = averageBasketMinor(
    result.previousHeader.takeMinor,
    result.previousHeader.salesCount,
  )

  return {
    currency: 'GHS',
    period,
    comparison: { from: comparison.from, to: comparison.to },
    scope: scopeView(branchId),
    totals: {
      takeMinor: result.header.takeMinor,
      salesCount: result.header.salesCount,
      avgBasketMinor,
      itemsSold: result.lines.itemsSold,
      changeMinor: result.header.changeMinor,
      tax: {
        baseMinor: result.header.takeMinor - result.header.taxTotalMinor,
        vatMinor: result.header.vatMinor,
        nhilMinor: result.header.nhilMinor,
        getfundMinor: result.header.getfundMinor,
        totalMinor: result.header.taxTotalMinor,
      },
    },
    deltas: {
      take: moneyDelta(result.header.takeMinor, result.previousHeader.takeMinor),
      salesCount: moneyDelta(result.header.salesCount, result.previousHeader.salesCount),
      avgBasket: moneyDelta(avgBasketMinor, previousAvgBasket),
    },
    series: result.series,
    byBranch: result.byBranch,
    byTerminal: result.byTerminal,
    byCashier: result.byCashier,
    byHour: result.byHour,
    rows: result.page.rows,
    total: result.page.total,
  }
}

export async function getProducts(
  context: ReportContext<
    AnalyticsQuery & {
      sort?: string
      direction?: 'asc' | 'desc'
      limit?: number
      offset?: number
      categoryId?: string
    }
  >,
): Promise<import('./analytics.types.ts').ProductsResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)
  const sort = query.sort ?? 'revenue'
  const direction = query.direction ?? 'desc'
  const limit = Math.min(query.limit ?? 20, 50)
  const offset = query.offset ?? 0

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const totals = await repository.selectProductTotals(tx, window, branchId, query.categoryId)
    const top = await repository.selectTopProducts(tx, window, branchId, 10)
    const concentration = await repository.selectTopFiveRevenue(tx, window, branchId)
    const categories = await repository.selectCategoryTotals(tx, window, branchId)
    const page = await repository.selectProductRows(tx, window, branchId, {
      sort,
      direction,
      limit,
      offset,
      categoryId: query.categoryId,
    })
    return { totals, top, concentration, categories, page }
  })

  const grossProfitMinor = result.totals.revenueBaseMinor - result.totals.costMinor

  return {
    currency: 'GHS',
    period,
    scope: scopeView(branchId),
    totals: {
      revenueBaseMinor: result.totals.revenueBaseMinor,
      costMinor: result.totals.costMinor,
      grossProfitMinor,
      marginBp: marginWhenCosted({
        revenueBaseMinor: result.totals.revenueBaseMinor,
        costMinor: result.totals.costMinor,
        uncostedRevenueBaseMinor: result.totals.uncostedRevenueBaseMinor,
      }),
      uncostedRevenueMinor: result.totals.uncostedRevenueBaseMinor,
      uncostedLines: result.totals.uncostedLines,
      unitsSold: result.totals.unitsSold,
      distinctProducts: result.totals.distinctProducts,
    },
    top: result.top,
    concentration: {
      top5RevenueBp: ratioBp(result.concentration.top5Minor, result.concentration.totalMinor),
    },
    byCategory: foldCategories(result.categories),
    rows: result.page.rows,
    total: result.page.total,
    sort: sort as import('./analytics.types.ts').ProductSort,
    direction,
  }
}

export async function getTax(
  context: ReportContext<AnalyticsQuery>,
): Promise<import('./analytics.types.ts').TaxResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)
  const isAdmin = roleOf(user) === 'ADMIN'

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const header = await repository.selectHeaderTotals(tx, window, branchId)
    const lines = await repository.selectLineTotals(tx, window, branchId)
    const byBranch = isAdmin ? await repository.selectTaxByBranch(tx, window, branchId) : []
    const byCategory = await repository.selectTaxByCategory(tx, window, branchId)
    const series = await repository.selectTaxSeries(tx, window, period.granularity, branchId)
    return { header, lines, byBranch, byCategory, series }
  })

  const standard = result.byCategory.find((row) => row.category === 'STANDARD')

  return {
    currency: 'GHS',
    period,
    scope: scopeView(branchId),
    totals: {
      baseMinor: result.header.takeMinor - result.header.taxTotalMinor,
      vatMinor: result.header.vatMinor,
      nhilMinor: result.header.nhilMinor,
      getfundMinor: result.header.getfundMinor,
      totalMinor: result.header.taxTotalMinor,
      salesCount: result.header.salesCount,
      standardLineTotalMinor: standard?.lineTotalMinor ?? 0,
    },
    byBranch: result.byBranch,
    byCategory: result.byCategory,
    series: result.series,
    driftMinor: {
      revenue:
        result.header.takeMinor - result.header.taxTotalMinor - result.lines.revenueBaseMinor,
      tax: result.header.taxTotalMinor - result.lines.taxTotalMinor,
    },
    driftExplanation:
      'Header totals are the charged amounts; line totals are the server recomputation. They differ only for sales stored with TOTAL_MISMATCH.',
    rates: {
      vatBp: VAT_RATE_BP,
      nhilBp: NHIL_RATE_BP,
      getfundBp: GETFUND_RATE_BP,
      totalBp: STANDARD_TAX_RATE_BP,
      source: 'packages/shared/src/tax.ts',
    },
  }
}

// --- CSV exports -------------------------------------------------------------

/** A runaway export would exhaust memory before it printed anything useful. */
const MAX_EXPORT_ROWS = 50_000

function exportFilename(report: string, branchCode: string | null, period: Period): string {
  const scope = branchCode ?? 'all-branches'
  return `sceptre-${report}-${scope.toLowerCase()}-${period.from}-${period.to}.csv`
}

export interface ExportResult {
  filename: string
  csv: string
}

export async function exportSales(context: ReportContext<AnalyticsQuery>): Promise<ExportResult> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const page = await repository.selectSalesRows(tx, window, branchId, {
      sort: 'date',
      direction: 'desc',
      limit: MAX_EXPORT_ROWS,
      offset: 0,
    })
    const branchCode = branchId ? await repository.selectBranchCode(tx, branchId) : null
    return { page, branchCode }
  })

  const csv = toCsv(
    [
      { key: 'receiptNumber', header: 'receipt_number' },
      { key: 'occurredAt', header: 'occurred_at' },
      { key: 'branchCode', header: 'branch_code' },
      { key: 'terminalCode', header: 'terminal_code' },
      { key: 'cashierStaffId', header: 'cashier_staff_id' },
      { key: 'cashierName', header: 'cashier_name' },
      { key: 'itemsSold', header: 'items_sold' },
      { key: 'takeMinor', header: 'take_minor' },
      { key: 'taxTotalMinor', header: 'tax_minor' },
      { key: 'changeMinor', header: 'change_minor' },
    ],
    result.page.rows,
  )

  return { filename: exportFilename('sales', result.branchCode, period), csv }
}

export async function exportProducts(
  context: ReportContext<AnalyticsQuery>,
): Promise<ExportResult> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const page = await repository.selectProductRows(tx, window, branchId, {
      sort: 'revenue',
      direction: 'desc',
      limit: MAX_EXPORT_ROWS,
      offset: 0,
    })
    const branchCode = branchId ? await repository.selectBranchCode(tx, branchId) : null
    return { page, branchCode }
  })

  const csv = toCsv(
    [
      { key: 'sku', header: 'sku' },
      { key: 'name', header: 'name' },
      { key: 'quantity', header: 'units_sold' },
      { key: 'revenueBaseMinor', header: 'revenue_base_minor' },
      { key: 'costMinor', header: 'cost_minor' },
      { key: 'grossProfitMinor', header: 'gross_profit_minor' },
      { key: 'marginBp', header: 'margin_bp' },
    ],
    result.page.rows,
  )

  return { filename: exportFilename('products', result.branchCode, period), csv }
}

export async function exportTax(context: ReportContext<AnalyticsQuery>): Promise<ExportResult> {
  const report = await getTax(context)
  const rows = [
    ...report.series.map((point) => ({
      bucketStart: point.bucketStart,
      vatMinor: point.vatMinor,
      nhilMinor: point.nhilMinor,
      getfundMinor: point.getfundMinor,
      totalMinor: point.totalMinor,
    })),
    {
      bucketStart: 'TOTAL',
      vatMinor: report.totals.vatMinor,
      nhilMinor: report.totals.nhilMinor,
      getfundMinor: report.totals.getfundMinor,
      totalMinor: report.totals.totalMinor,
    },
  ]

  const csv = toCsv(
    [
      { key: 'bucketStart', header: 'bucket_start' },
      { key: 'vatMinor', header: 'vat_minor' },
      { key: 'nhilMinor', header: 'nhil_minor' },
      { key: 'getfundMinor', header: 'getfund_minor' },
      { key: 'totalMinor', header: 'tax_minor' },
    ],
    rows,
  )

  const branchId = report.scope.branchId
  const branchCode = branchId ? await repository.selectBranchCode(db, branchId) : null
  return { filename: exportFilename('tax', branchCode, report.period), csv }
}

// --- Inventory, credit, loyalty, payables read models ------------------------

const TOP_MOVER_LIMIT = 10
const TOP_SUPPLIER_LIMIT = 10
const LOYALTY_EXPIRY_MONTHS_KEY = 'loyalty.expiryMonths' as const

/**
 * Stock value and movement.
 *
 * Every figure is an aggregate over `stock_level` (the projection) and `stock_movement`
 * (the append-only ledger). Nothing is re-valued in JavaScript: the projection already
 * carries the average cost the inventory service maintains, and the trend sums the
 * ledger's own deltas.
 */
export async function getInventory(
  context: ReportContext<AnalyticsQuery>,
): Promise<import('./analytics.types.ts').InventoryResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)
  const isAdmin = roleOf(user) === 'ADMIN'

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const totals = await repository.selectStockTotals(tx, branchId)
    const byBranch = isAdmin ? await repository.selectStockByBranch(tx, branchId) : []
    const flow = await repository.selectStockFlow(tx, window, period.granularity, branchId)
    const topMovers = await repository.selectTopMovers(tx, window, branchId, TOP_MOVER_LIMIT)
    const deadStockCount = await repository.selectDeadStockCount(tx, window, branchId)
    const countAccuracy = await repository.selectCountAccuracy(tx, branchId, window)
    return { totals, byBranch, flow, topMovers, deadStockCount, countAccuracy }
  })

  return {
    currency: 'GHS',
    period,
    scope: scopeView(branchId),
    totals: result.totals,
    byBranch: result.byBranch,
    flow: result.flow,
    topMovers: result.topMovers,
    countAccuracy: result.countAccuracy,
    deadStock: { count: result.deadStockCount },
  }
}

/**
 * Credit read model.
 *
 * `outstandingMinor` is the stored profile projection; `ledgerBalanceMinor` is the same
 * customers' append-only ledger. They must agree, so the drift is a first-class field
 * rather than something a reconciliation screen computes later (P9-D10, append-only rule).
 *
 * No customer row enters this payload — only counts, buckets, and branch totals (D15).
 */
export async function getCredit(
  context: ReportContext<AnalyticsQuery>,
): Promise<import('./analytics.types.ts').CreditResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)
  const isAdmin = roleOf(user) === 'ADMIN'

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const position = await repository.selectCreditPosition(tx, branchId)
    const ledgerBalanceMinor = await repository.selectCreditLedgerBalance(tx, branchId)
    const series = await repository.selectCreditSeries(tx, window, period.granularity, branchId)
    const distribution = await repository.selectCreditDistribution(tx, branchId)
    const byBranch = isAdmin ? await repository.selectCreditByBranch(tx, branchId) : []
    return { position, ledgerBalanceMinor, series, distribution, byBranch }
  })

  const { position } = result

  return {
    currency: 'GHS',
    period,
    scope: scopeView(branchId),
    totals: {
      outstandingMinor: position.outstandingMinor,
      limitMinor: position.limitMinor,
      utilisationBp: ratioBp(position.outstandingMinor, position.limitMinor),
      customersWithBalance: position.customersWithBalance,
      overLimitCount: position.overLimitCount,
      onHoldCount: position.onHoldCount,
      overLimitExposureMinor: position.overLimitExposureMinor,
      ledgerBalanceMinor: result.ledgerBalanceMinor,
      reconcileDriftMinor: position.outstandingMinor - result.ledgerBalanceMinor,
    },
    series: result.series,
    distribution: result.distribution,
    byBranch: result.byBranch,
  }
}

/**
 * Loyalty read model.
 *
 * Points outstanding are a global account projection, so they are not branch-filtered;
 * the flow figures are, with the owning service's expiry-row convention. Valuation calls
 * `pointsToValueMinor` and the activity sums call `getBranchActivityTotals`, so the tab
 * cannot disagree with `/api/loyalty/liability`.
 */
export async function getLoyalty(
  context: ReportContext<AnalyticsQuery>,
): Promise<import('./analytics.types.ts').LoyaltyResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)
  const isAdmin = roleOf(user) === 'ADMIN'
  const now = new Date()

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const totals = await repository.selectLoyaltyTotals(tx, window, branchId)
    const outstanding = await sumOutstandingPoints(tx)
    const expiringPoints = await sumExpiringSoonPoints(now, tx)
    const series = await repository.selectLoyaltySeries(tx, window, period.granularity, branchId)
    const activity = await getBranchActivityTotals(
      { from: window.from, to: new Date(window.toExclusive.getTime() - 1), branchId },
      tx,
    )
    const branches = isAdmin ? await repository.selectBranchLabels(tx) : []
    const pointsPerCedi = await getSettingValue('loyalty.pointsPerCedi', {}, tx)
    const earnPointsPerCedi = await getSettingValue('loyalty.earnPointsPerCedi', {}, tx)
    const expiryMonths = await getSettingValue(LOYALTY_EXPIRY_MONTHS_KEY, {}, tx)
    return {
      totals,
      outstandingPoints: outstanding.points,
      expiringPoints,
      series,
      activity,
      branches,
      earnRate: { pointsPerCedi, earnPointsPerCedi, expiryMonths },
    }
  })

  const branchLabels = new Map(result.branches.map((row) => [row.branchId, row]))
  // The global expiry row (branch null) stays out of the per-branch list but is still in
  // the totals above.
  const byBranch = isAdmin
    ? result.activity
        .filter((row): row is typeof row & { branchId: string } => row.branchId !== null)
        .map((row) => ({
          branchId: row.branchId,
          code: branchLabels.get(row.branchId)?.code ?? '',
          name: branchLabels.get(row.branchId)?.name ?? '',
          earnedPoints: row.earnedPoints,
          redeemedPoints: row.redeemedPoints,
          clawedBackPoints: row.clawedBackPoints,
          adjustedPoints: row.adjustedPoints,
          expiredPoints: row.expiredPoints,
          netPoints: row.netPoints,
        }))
    : []

  return {
    currency: 'GHS',
    period,
    scope: scopeView(branchId),
    totals: {
      ...result.totals,
      outstandingPoints: result.outstandingPoints,
      outstandingValueMinor: pointsToValueMinor(
        result.outstandingPoints,
        result.earnRate.pointsPerCedi,
      ),
    },
    expiringSoon: {
      points: result.expiringPoints,
      valueMinor: pointsToValueMinor(result.expiringPoints, result.earnRate.pointsPerCedi),
      days: EXPIRING_SOON_DAYS,
    },
    series: result.series,
    earnRate: result.earnRate,
    byBranch,
  }
}

/**
 * Payables read model.
 *
 * Outstanding and overdue are positions as of today; invoiced and paid are window flows.
 * The ageing buckets come from `payables.service.getAgingTotals`, which owns the
 * boundaries, so this tab and `/api/payables/aging` cannot disagree.
 */
export async function getPayables(
  context: ReportContext<AnalyticsQuery>,
): Promise<import('./analytics.types.ts').PayablesResponse> {
  const { user, query } = context
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const { period } = resolvePeriod(query)
  const window = toWindow(period)
  const today = accraIsoDay()

  const result = await inSnapshot(async (tx) => {
    await tx.execute(STATEMENT_TIMEOUT_SQL)
    const position = await repository.selectPayablesPosition(tx, branchId, today)
    const invoicedMinor = await repository.selectInvoicedInWindow(tx, window, branchId)
    const paidMinor = await repository.selectPaidInWindow(tx, window, branchId)
    const onAccountMinor = await repository.selectOnAccountTotal(tx, branchId)
    const series = await repository.selectPayablesSeries(tx, window, period.granularity, branchId)
    const topSuppliers = await repository.selectTopSuppliersByOutstanding(
      tx,
      branchId,
      today,
      TOP_SUPPLIER_LIMIT,
    )
    const overdueBuckets = await getAgingTotals(branchId, today, tx)
    return {
      position,
      invoicedMinor,
      paidMinor,
      onAccountMinor,
      series,
      topSuppliers,
      overdueBuckets,
    }
  })

  return {
    currency: 'GHS',
    period,
    scope: scopeView(branchId),
    overdueBuckets: result.overdueBuckets,
    totals: {
      outstandingMinor: result.position.outstandingMinor,
      paidMinor: result.paidMinor,
      overdueMinor: result.position.overdueMinor,
      invoicedMinor: result.invoicedMinor,
      onAccountMinor: result.onAccountMinor,
    },
    series: result.series,
    topSuppliers: result.topSuppliers,
  }
}

// --- Exports for the four state reports --------------------------------------

/**
 * Every view exports the table it shows (ANL-03/D12). The four state reports export their
 * breakdown table — branch exposure for inventory and credit, branch activity for loyalty,
 * supplier balances for payables — with a TOTAL row so the file reconciles to the headline
 * without the reader adding anything up.
 *
 * Money columns stay raw pesewas, named `…_minor`, exactly as in the sales and product
 * exports.
 */
async function exportFilenameFor(
  report: string,
  branchId: string | null,
  period: Period,
): Promise<string> {
  const branchCode = branchId ? await repository.selectBranchCode(db, branchId) : null
  return exportFilename(report, branchCode, period)
}

export async function exportInventory(
  context: ReportContext<AnalyticsQuery>,
): Promise<ExportResult> {
  const report = await getInventory(context)
  const rows = report.byBranch.map((row) => ({
    code: row.code,
    name: row.name,
    stockValueMinor: row.stockValueMinor,
    unitsOnHand: row.unitsOnHand,
    lowStockCount: row.lowStockCount,
  }))
  rows.push({
    code: 'TOTAL',
    name: '',
    stockValueMinor: report.totals.stockValueMinor,
    unitsOnHand: report.totals.unitsOnHand,
    lowStockCount: report.totals.lowStockCount,
  })

  return {
    filename: await exportFilenameFor('inventory', report.scope.branchId, report.period),
    csv: toCsv(
      [
        { key: 'code', header: 'branch_code' },
        { key: 'name', header: 'branch_name' },
        { key: 'stockValueMinor', header: 'stock_value_minor' },
        { key: 'unitsOnHand', header: 'units_on_hand' },
        { key: 'lowStockCount', header: 'low_stock_count' },
      ],
      rows,
    ),
  }
}

export async function exportCredit(context: ReportContext<AnalyticsQuery>): Promise<ExportResult> {
  const report = await getCredit(context)
  const rows = report.byBranch.map((row) => ({
    code: row.code,
    name: row.name,
    outstandingMinor: row.outstandingMinor,
    limitMinor: row.limitMinor,
    overLimitCount: row.overLimitCount,
  }))
  rows.push({
    code: 'TOTAL',
    name: '',
    outstandingMinor: report.totals.outstandingMinor,
    limitMinor: report.totals.limitMinor,
    overLimitCount: report.totals.overLimitCount,
  })

  return {
    filename: await exportFilenameFor('credit', report.scope.branchId, report.period),
    csv: toCsv(
      [
        { key: 'code', header: 'branch_code' },
        { key: 'name', header: 'branch_name' },
        { key: 'outstandingMinor', header: 'credit_outstanding_minor' },
        { key: 'limitMinor', header: 'credit_limit_minor' },
        { key: 'overLimitCount', header: 'over_limit_customers' },
      ],
      rows,
    ),
  }
}

export async function exportLoyalty(context: ReportContext<AnalyticsQuery>): Promise<ExportResult> {
  const report = await getLoyalty(context)
  const rows = report.byBranch.map((row) => ({
    code: row.code,
    name: row.name,
    earnedPoints: row.earnedPoints,
    redeemedPoints: row.redeemedPoints,
    expiredPoints: row.expiredPoints,
    netPoints: row.netPoints,
  }))
  rows.push({
    code: 'TOTAL',
    name: '',
    earnedPoints: report.totals.issuedPoints,
    redeemedPoints: report.totals.redeemedPoints,
    expiredPoints: report.totals.expiredPoints,
    netPoints:
      report.totals.issuedPoints - report.totals.redeemedPoints - report.totals.expiredPoints,
  })

  return {
    filename: await exportFilenameFor('loyalty', report.scope.branchId, report.period),
    csv: toCsv(
      [
        { key: 'code', header: 'branch_code' },
        { key: 'name', header: 'branch_name' },
        { key: 'earnedPoints', header: 'earned_points' },
        { key: 'redeemedPoints', header: 'redeemed_points' },
        { key: 'expiredPoints', header: 'expired_points' },
        { key: 'netPoints', header: 'net_points' },
      ],
      rows,
    ),
  }
}

export async function exportPayables(
  context: ReportContext<AnalyticsQuery>,
): Promise<ExportResult> {
  const report = await getPayables(context)
  const rows = report.topSuppliers.map((row) => ({
    code: row.code,
    name: row.name,
    outstandingMinor: row.outstandingMinor,
    overdueMinor: row.overdueMinor,
  }))
  rows.push({
    code: 'TOTAL',
    name: '',
    outstandingMinor: report.totals.outstandingMinor,
    overdueMinor: report.totals.overdueMinor,
  })

  return {
    filename: await exportFilenameFor('payables', report.scope.branchId, report.period),
    csv: toCsv(
      [
        { key: 'code', header: 'supplier_code' },
        { key: 'name', header: 'supplier_name' },
        { key: 'outstandingMinor', header: 'outstanding_minor' },
        { key: 'overdueMinor', header: 'overdue_minor' },
      ],
      rows,
    ),
  }
}
