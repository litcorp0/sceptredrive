import { db } from '@sceptre/db'
import { accraIsoDay, deltaBp, ratioBp } from '@sceptre/shared'
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
