import { db } from '@sceptre/db'
import { accraIsoDay, toCsv } from '@sceptre/shared'
import { and, asc, desc, eq, gte, isNotNull, lt, lte, or, type SQL, sql } from 'drizzle-orm'
import { resolveBranchFilter, roleOf } from '../../auth/scope.ts'
import { type CsvExport, csvFilename, enforceExportCap } from '../../http/csv.ts'
import { ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { category } from '../catalog/catalog.schema.ts'
import { getCountAccuracy } from '../counts/counts.service.ts'
import { branch } from '../org/branches.schema.ts'
import { product } from '../products/products.schema.ts'
import { transfer } from '../transfers/transfers.schema.ts'
import { stockLevel, stockMovement, stockThreshold } from './inventory.schema.ts'
import type {
  StockReport,
  StockReportBranchRow,
  StockReportQuery,
  StockReportRow,
} from './inventory.types.ts'

/**
 * The stock report (RPT-04, P14-D16/D17).
 *
 * Only queries that are not already the stock list's live here, following
 * `pos.reconciliation.ts`'s precedent: this file is a read model, so it composes the
 * owning module's tables directly and nothing else imports it.
 *
 * Two invariants the plan is built on:
 *
 * - **Value is the projection, now.** `valueMinor = quantity_on_hand × avg_cost_minor`,
 *   read from `stock_level`. A past-dated valuation would have to replay the ledger's
 *   integer rounding and would disagree with the dashboard by a few pesewas; a report
 *   that quietly disagrees with the screen is worse than one that says "as at now". The
 *   response therefore carries `asOf`.
 * - **A manager's report is their branch, an admin's may be every branch.** A foreign
 *   branch id is a 403 in `resolveBranchFilter`, before any query runs (OWASP A01).
 */

/** The console paginates in the browser; this cap stops one request returning the catalogue twice. */
const REPORT_ROW_CAP = 5_000
const MAX_SPAN_DAYS = 366
const DAY_MS = 86_400_000

/** One consistent snapshot per report, so a row and its total cannot be read a sale apart. */
const SNAPSHOT_OPTIONS = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const

function dayStart(day: string): Date {
  return new Date(`${day}T00:00:00.000Z`)
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS)
}

interface ReportWindow {
  from: string
  to: string
  fromDate: Date
  /** `[from, to)` — the day after `to` at 00:00 UTC, which is 00:00 Accra. */
  toExclusive: Date
}

/**
 * `from`/`to` are inclusive Accra days. `to` defaults to today and a future `to` is
 * clamped, because asking for tomorrow is a UI shortcut rather than an error. A reversed
 * or over-long range is a client bug and is refused with a sentence a user can act on.
 */
export function resolveReportWindow(query: StockReportQuery): ReportWindow {
  const today = accraIsoDay()
  const requestedTo = query.to ?? today
  const to = requestedTo > today ? today : requestedTo
  const from = query.from ?? `${to.slice(0, 7)}-01`

  if (from > to) throw new ValidationError('from must be on or before to')
  const span = Math.round((dayStart(to).getTime() - dayStart(from).getTime()) / DAY_MS) + 1
  if (span > MAX_SPAN_DAYS) {
    throw new ValidationError(`A report can cover at most ${MAX_SPAN_DAYS} days`)
  }

  return { from, to, fromDate: dayStart(from), toExclusive: addDays(dayStart(to), 1) }
}

/** Join shape shared by the row, total and per-branch queries so they cannot drift. */
function movementWindowConditions(branchId: string | null, window: ReportWindow): SQL[] {
  const conditions: SQL[] = [
    gte(stockMovement.createdAt, window.fromDate),
    lt(stockMovement.createdAt, window.toExclusive),
  ]
  if (branchId) conditions.push(eq(stockMovement.branchId, branchId))
  return conditions
}

export async function getStockReport(
  user: SessionUser,
  query: StockReportQuery,
): Promise<StockReport> {
  const branchId = resolveBranchFilter(user, query.branchId ?? null)
  const window = resolveReportWindow(query)
  const isAdmin = roleOf(user) === 'ADMIN'
  const lowStockOnly = query.lowStock === true

  const levelConditions = [eq(product.isActive, true)]
  if (branchId) levelConditions.push(eq(stockLevel.branchId, branchId))
  if (query.categoryId) levelConditions.push(eq(product.categoryId, query.categoryId))
  if (lowStockOnly) {
    const low = and(
      isNotNull(stockThreshold.threshold),
      lte(stockLevel.quantityOnHand, stockThreshold.threshold),
    )
    if (low) levelConditions.push(low)
  }

  const movementConditions = movementWindowConditions(branchId, window)

  const transferConditions: SQL[] = []
  if (branchId) {
    const side = or(eq(transfer.fromBranchId, branchId), eq(transfer.toBranchId, branchId))
    if (side) transferConditions.push(side)
  }

  const accuracy = await getCountAccuracy(user, {
    branchId: branchId ?? undefined,
    from: window.from,
    to: window.to,
  })

  const [asOf, rows, totalsRow, byBranch, movementTotals, movementByType, transferRow] =
    await db.transaction(async (tx) => {
      const readAt = new Date().toISOString()

      const rowSelection = {
        productId: stockLevel.productId,
        sku: product.sku,
        productName: product.name,
        categoryName: category.name,
        branchId: stockLevel.branchId,
        branchCode: branch.code,
        branchName: branch.name,
        quantityOnHand: stockLevel.quantityOnHand,
        avgCostMinor: stockLevel.avgCostMinor,
        threshold: stockThreshold.threshold,
      }

      const levelRows = await tx
        .select(rowSelection)
        .from(stockLevel)
        .innerJoin(product, eq(product.id, stockLevel.productId))
        .innerJoin(category, eq(category.id, product.categoryId))
        .innerJoin(branch, eq(branch.id, stockLevel.branchId))
        .leftJoin(
          stockThreshold,
          and(
            eq(stockThreshold.productId, stockLevel.productId),
            eq(stockThreshold.branchId, stockLevel.branchId),
          ),
        )
        .where(and(...levelConditions))
        .orderBy(
          desc(sql`${stockLevel.quantityOnHand}::bigint * ${stockLevel.avgCostMinor}`),
          asc(product.name),
        )
        .limit(REPORT_ROW_CAP + 1)

      const totals = await tx
        .select({
          quantityOnHand:
            sql<number>`coalesce(sum(${stockLevel.quantityOnHand}), 0)::bigint`.mapWith(Number),
          valueMinor:
            sql<number>`coalesce(sum(${stockLevel.quantityOnHand}::bigint * ${stockLevel.avgCostMinor}), 0)::bigint`.mapWith(
              Number,
            ),
          products: sql<number>`count(distinct ${stockLevel.productId})::bigint`.mapWith(Number),
          rowCount: sql<number>`count(*)::bigint`.mapWith(Number),
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
        .where(and(...levelConditions))

      // `byBranch` answers "which branch holds the value". A manager already knows:
      // their own. Populating it only for an admin follows the analytics read model.
      const branchRows = isAdmin
        ? await tx
            .select({
              branchCode: branch.code,
              branchName: branch.name,
              quantityOnHand:
                sql<number>`coalesce(sum(${stockLevel.quantityOnHand}), 0)::bigint`.mapWith(Number),
              valueMinor:
                sql<number>`coalesce(sum(${stockLevel.quantityOnHand}::bigint * ${stockLevel.avgCostMinor}), 0)::bigint`.mapWith(
                  Number,
                ),
            })
            .from(stockLevel)
            .innerJoin(product, eq(product.id, stockLevel.productId))
            .innerJoin(category, eq(category.id, product.categoryId))
            .innerJoin(branch, eq(branch.id, stockLevel.branchId))
            .leftJoin(
              stockThreshold,
              and(
                eq(stockThreshold.productId, stockLevel.productId),
                eq(stockThreshold.branchId, stockLevel.branchId),
              ),
            )
            .where(and(...levelConditions))
            .groupBy(branch.id, branch.code, branch.name)
            .orderBy(
              desc(sql`sum(${stockLevel.quantityOnHand}::bigint * ${stockLevel.avgCostMinor})`),
              asc(branch.code),
            )
        : []

      const movements = await tx
        .select({
          inflow:
            sql<number>`coalesce(sum(${stockMovement.quantityDelta}) filter (where ${stockMovement.quantityDelta} > 0), 0)::bigint`.mapWith(
              Number,
            ),
          outflow:
            sql<number>`coalesce(sum(-${stockMovement.quantityDelta}) filter (where ${stockMovement.quantityDelta} < 0), 0)::bigint`.mapWith(
              Number,
            ),
        })
        .from(stockMovement)
        .where(and(...movementConditions))

      const byType = await tx
        .select({
          type: stockMovement.type,
          quantity: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)::bigint`.mapWith(
            Number,
          ),
        })
        .from(stockMovement)
        .where(and(...movementConditions))
        .groupBy(stockMovement.type)
        .orderBy(desc(sql`abs(sum(${stockMovement.quantityDelta}))`), asc(stockMovement.type))

      const transferCounts = await tx
        .select({
          dispatched:
            sql<number>`count(*) filter (where ${transfer.dispatchedAt} >= ${window.fromDate} and ${transfer.dispatchedAt} < ${window.toExclusive})::bigint`.mapWith(
              Number,
            ),
          received:
            sql<number>`count(*) filter (where ${transfer.receivedAt} >= ${window.fromDate} and ${transfer.receivedAt} < ${window.toExclusive})::bigint`.mapWith(
              Number,
            ),
          shortClosed:
            sql<number>`count(*) filter (where ${transfer.status} = 'SHORT_CLOSED' and ${transfer.closedAt} >= ${window.fromDate} and ${transfer.closedAt} < ${window.toExclusive})::bigint`.mapWith(
              Number,
            ),
        })
        .from(transfer)
        .where(transferConditions.length > 0 ? and(...transferConditions) : undefined)

      return [
        readAt,
        levelRows,
        totals[0],
        branchRows,
        movements[0],
        byType,
        transferCounts[0],
      ] as const
    }, SNAPSHOT_OPTIONS)

  const total = totalsRow?.rowCount ?? 0
  const reportRows: StockReportRow[] = rows.map((row) => ({
    productId: row.productId,
    sku: row.sku,
    productName: row.productName,
    categoryName: row.categoryName,
    branchId: row.branchId,
    branchCode: row.branchCode,
    branchName: row.branchName,
    quantityOnHand: row.quantityOnHand,
    avgCostMinor: row.avgCostMinor,
    valueMinor: row.quantityOnHand * row.avgCostMinor,
    threshold: row.threshold,
    belowThreshold: row.threshold !== null && row.quantityOnHand <= row.threshold,
  }))

  const branchTotals: StockReportBranchRow[] = byBranch.map((row) => ({
    branchCode: row.branchCode,
    branchName: row.branchName,
    quantityOnHand: row.quantityOnHand,
    valueMinor: row.valueMinor,
  }))

  return {
    asOf,
    period: { from: window.from, to: window.to },
    branchId,
    rows: reportRows.slice(0, REPORT_ROW_CAP),
    total,
    truncated: total > REPORT_ROW_CAP,
    totals: {
      quantityOnHand: totalsRow?.quantityOnHand ?? 0,
      valueMinor: totalsRow?.valueMinor ?? 0,
      products: totalsRow?.products ?? 0,
    },
    byBranch: branchTotals,
    movements: {
      inflow: movementTotals?.inflow ?? 0,
      outflow: movementTotals?.outflow ?? 0,
      byType: movementByType.map((row) => ({ type: row.type, quantity: row.quantity })),
    },
    transfers: {
      dispatched: transferRow?.dispatched ?? 0,
      received: transferRow?.received ?? 0,
      shortClosed: transferRow?.shortClosed ?? 0,
    },
    counts: {
      completed: accuracy.countsPosted,
      countedLines: accuracy.countedLines,
      matchedLines: accuracy.matchedLines,
      varianceValueMinor: accuracy.varianceValueMinor,
    },
  }
}

async function branchCodeOf(branchId: string | null): Promise<string | null> {
  if (!branchId) return null
  const [row] = await db
    .select({ code: branch.code })
    .from(branch)
    .where(eq(branch.id, branchId))
    .limit(1)
  return row?.code ?? null
}

/**
 * The report's product table as a file. Money stays in integer pesewas with `_minor`
 * headers: an export that divides by 100 has introduced a float into a report.
 *
 * `as_of` repeats on every row on purpose. A CSV outlives the tab it came from, and a
 * valuation whose instant is only in the filename is a number someone will quote without
 * its basis.
 */
export async function exportStockReport(
  user: SessionUser,
  query: StockReportQuery,
): Promise<CsvExport> {
  const report = await getStockReport(user, query)
  enforceExportCap(report.rows.length)

  type Row = {
    productId: string
    sku: string
    productName: string
    categoryName: string
    branchCode: string
    quantityOnHand: number
    avgCostMinor: number | ''
    valueMinor: number
    threshold: number | ''
    belowThreshold: string
    asOf: string
  }

  const rows: Row[] = report.rows.map((row) => ({
    productId: row.productId,
    sku: row.sku,
    productName: row.productName,
    categoryName: row.categoryName,
    branchCode: row.branchCode,
    quantityOnHand: row.quantityOnHand,
    avgCostMinor: row.avgCostMinor,
    valueMinor: row.valueMinor,
    threshold: row.threshold ?? '',
    belowThreshold: row.belowThreshold ? 'yes' : 'no',
    asOf: report.asOf,
  }))

  rows.push({
    productId: '',
    sku: 'TOTAL',
    productName: '',
    categoryName: '',
    branchCode: '',
    quantityOnHand: report.totals.quantityOnHand,
    avgCostMinor: '',
    valueMinor: report.totals.valueMinor,
    threshold: '',
    belowThreshold: '',
    asOf: report.asOf,
  })

  return {
    filename: csvFilename(
      'stock',
      await branchCodeOf(report.branchId),
      `${report.period.from}-${report.period.to}`,
    ),
    csv: toCsv(
      [
        { key: 'productId', header: 'product_id' },
        { key: 'sku', header: 'sku' },
        { key: 'productName', header: 'product_name' },
        { key: 'categoryName', header: 'category' },
        { key: 'branchCode', header: 'branch_code' },
        { key: 'quantityOnHand', header: 'quantity_on_hand' },
        { key: 'avgCostMinor', header: 'avg_cost_minor' },
        { key: 'valueMinor', header: 'value_minor' },
        { key: 'threshold', header: 'threshold' },
        { key: 'belowThreshold', header: 'below_threshold' },
        { key: 'asOf', header: 'as_of' },
      ],
      rows,
    ),
  }
}
