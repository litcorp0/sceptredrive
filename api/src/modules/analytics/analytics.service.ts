import { db } from '@sceptre/db'
import {
  accraIsoDay,
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
import { EXPIRING_SOON_DAYS, pointsToValueMinor } from '../loyalty/loyalty.service.ts'
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
  const marginBp = ratioBp(grossProfitMinor, lines.revenueBaseMinor)
  const previousMarginBp = ratioBp(previousGrossProfitMinor, previousLines.revenueBaseMinor)
  const avgBasketMinor =
    header.salesCount === 0 ? 0 : Math.round(header.takeMinor / header.salesCount)
  const previousAvgBasketMinor =
    previousHeader.salesCount === 0
      ? 0
      : Math.round(previousHeader.takeMinor / previousHeader.salesCount)

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

  const avgBasketMinor =
    result.header.salesCount === 0
      ? 0
      : Math.round(result.header.takeMinor / result.header.salesCount)
  const previousAvgBasket =
    result.previousHeader.salesCount === 0
      ? 0
      : Math.round(result.previousHeader.takeMinor / result.previousHeader.salesCount)

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
      marginBp: ratioBp(grossProfitMinor, result.totals.revenueBaseMinor),
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
