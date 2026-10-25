/**
 * The two read models, and no arithmetic of their own.
 *
 * Every suggestion is `suggestReplenishment` from `@sceptre/shared` with the
 * inputs the row shows, so two screens cannot disagree about a quantity and a
 * manager can reproduce the number with a calculator. Performance metrics are
 * the P11-D11 definitions, each named after the date it measures so "on time"
 * is never an opinion.
 */
import { db } from '@sceptre/db'
import {
  accraIsoDay,
  ratioBp,
  suggestedValueMinor,
  suggestReplenishment,
  VELOCITY_DAYS,
} from '@sceptre/shared'
import { resolveBranchFilter } from '../../auth/scope.ts'
import { ValidationError } from '../../http/errors.ts'
import type { SessionUser } from '../../http/factory.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import * as repository from './replenishment.repository.ts'
import type {
  PerformanceLineFact,
  ReceiptCostFact,
  ReplenishmentGroup,
  ReplenishmentQuery,
  ReplenishmentResult,
  ReplenishmentRow,
  SupplierPerformanceQuery,
  SupplierPerformanceResult,
  SupplierPerformanceRow,
} from './replenishment.types.ts'

const DAY_MS = 86_400_000
const MAX_SPAN_DAYS = 366
const DEFAULT_WINDOW_DAYS = 90

const SNAPSHOT_OPTIONS = {
  isolationLevel: 'repeatable read',
  accessMode: 'read only',
} as const

/**
 * A figure for one branch. An admin who has not chosen one gets a sentence, not
 * every branch's rows quietly mixed together.
 */
function requireBranch(user: SessionUser, requestedBranchId?: string): string {
  const branchId = resolveBranchFilter(user, requestedBranchId ?? null)
  if (!branchId) {
    throw new ValidationError('Choose a branch to plan replenishment for')
  }
  return branchId
}

function parseIsoDay(value: string): Date {
  const date = new Date(`${value}T00:00:00.000Z`)
  if (Number.isNaN(date.getTime())) throw new ValidationError('Dates must be ISO days (YYYY-MM-DD)')
  return date
}

function isoDay(value: Date): string {
  return value.toISOString().slice(0, 10)
}

function addDays(value: Date, days: number): Date {
  return new Date(value.getTime() + days * DAY_MS)
}

/**
 * The report range as calendar days, `to` inclusive for the caller — the same
 * contract as every other report in the console. The SQL bound is half-open.
 */
export function resolvePerformanceWindow(query: { from?: string; to?: string }): {
  from: string
  to: string
  fromInstant: Date
  toExclusive: Date
} {
  const today = accraIsoDay()
  const to = query.to ?? today
  const from = query.from ?? isoDay(addDays(parseIsoDay(to), -(DEFAULT_WINDOW_DAYS - 1)))

  const fromDate = parseIsoDay(from)
  const toDate = parseIsoDay(to)
  if (fromDate.getTime() > toDate.getTime()) {
    throw new ValidationError('from must be on or before to')
  }
  const days = Math.round((toDate.getTime() - fromDate.getTime()) / DAY_MS) + 1
  if (days > MAX_SPAN_DAYS) {
    throw new ValidationError(`A performance report can cover at most ${MAX_SPAN_DAYS} days`)
  }

  return { from, to, fromInstant: fromDate, toExclusive: addDays(toDate, 1) }
}

function groupOf(
  supplierId: string,
  supplierName: string,
  rows: ReplenishmentRow[],
): ReplenishmentGroup {
  return {
    supplierId,
    supplierName,
    // A header cannot show one number per row: it is the longest commitment in
    // the group, and any assumed lead time is flagged rather than averaged away.
    leadTimeDays: rows.reduce((longest, row) => Math.max(longest, row.leadTimeDays), 0),
    leadTimeAssumed: rows.some((row) => row.leadTimeAssumed),
    rows,
    suggestedUnits: rows.reduce((total, row) => total + row.suggested, 0),
    totalValueMinor: rows.reduce((total, row) => total + row.suggestedValueMinor, 0),
  }
}

/**
 * What to order at this branch, grouped by preferred supplier.
 *
 * `onlySuggested` defaults to false so a manager can see a healthy part beside a
 * low one; the console turns it on for the ordering screen. Pagination applies
 * to the flattened rows and the totals describe the returned rows, so a total
 * on screen always equals the lines beneath it; `totalRows` says when there are
 * more.
 */
export async function getSuggestions(
  user: SessionUser,
  query: ReplenishmentQuery,
): Promise<ReplenishmentResult> {
  const branchId = requireBranch(user, query.branchId)

  const snapshot = await db.transaction(async (tx) => {
    const defaultLeadDays = await getSettingValue('procurement.defaultLeadDays', {}, tx)
    const safetyDays = await getSettingValue('procurement.safetyDays', { branchId }, tx)
    // Sequential on purpose: one connection, one snapshot (the analytics
    // convention). Racing queries on one client is what node-postgres refuses.
    const facts = await repository.selectReplenishmentRows(
      branchId,
      { supplierId: query.supplierId, q: query.q },
      tx,
    )
    const unitsSold = await repository.selectUnitsSold(branchId, VELOCITY_DAYS, tx)
    const onOrder = await repository.selectOnOrderByProduct(branchId, tx)
    return { defaultLeadDays, safetyDays, facts, unitsSold, onOrder }
  }, SNAPSHOT_OPTIONS)

  const { defaultLeadDays, safetyDays } = snapshot
  const rows: ReplenishmentRow[] = snapshot.facts.map((fact) => {
    const supplierLeadTime = fact.leadTimeDays
    const leadTimeDays = supplierLeadTime ?? defaultLeadDays
    const lastCostMinor =
      fact.linkLastCostMinor !== null && fact.linkLastCostMinor > 0
        ? fact.linkLastCostMinor
        : fact.catalogueCostMinor

    const suggestion = suggestReplenishment({
      unitsSold: snapshot.unitsSold.get(fact.productId) ?? 0,
      onHand: fact.onHand ?? 0,
      onOrder: snapshot.onOrder.get(fact.productId) ?? 0,
      minLevel: fact.minLevel,
      maxLevel: fact.maxLevel,
      minOrderQuantity: fact.minOrderQuantity,
      leadTimeDays,
      leadTimeAssumed: supplierLeadTime === null,
      safetyDays,
    })

    return {
      productId: fact.productId,
      sku: fact.sku,
      name: fact.name,
      supplierId: fact.supplierId,
      supplierName: fact.supplierName,
      leadTimeDays,
      leadTimeAssumed: supplierLeadTime === null,
      minLevel: fact.minLevel,
      maxLevel: fact.maxLevel,
      minOrderQuantity: fact.minOrderQuantity,
      onHand: fact.onHand ?? 0,
      onOrder: snapshot.onOrder.get(fact.productId) ?? 0,
      unitsSold: snapshot.unitsSold.get(fact.productId) ?? 0,
      velocityDays: VELOCITY_DAYS,
      targetLevel: suggestion.targetLevel,
      coverageLevel: suggestion.coverageLevel,
      position: suggestion.position,
      suggested: suggestion.suggested,
      basis: suggestion.basis,
      lastCostMinor,
      suggestedValueMinor: suggestedValueMinor(suggestion.suggested, lastCostMinor),
    }
  })

  const filtered = query.onlySuggested ? rows.filter((row) => row.suggested > 0) : rows
  const sorted = [...filtered].sort(
    (a, b) => b.suggestedValueMinor - a.suggestedValueMinor || a.sku.localeCompare(b.sku),
  )

  const assigned = sorted.filter((row) => row.supplierId !== null)
  const unassignedRows = sorted.filter((row) => row.supplierId === null)

  const bySupplier = new Map<string, { name: string; rows: ReplenishmentRow[] }>()
  for (const row of assigned) {
    const key = row.supplierId as string
    const entry = bySupplier.get(key) ?? { name: row.supplierName ?? '', rows: [] }
    entry.rows.push(row)
    bySupplier.set(key, entry)
  }

  const groups = [...bySupplier.entries()]
    .sort(([, a], [, b]) => a.name.localeCompare(b.name))
    .map(([supplierId, entry]) => groupOf(supplierId, entry.name, entry.rows))

  // Paging runs over the flattened rows in the order they are displayed, so a
  // page is a prefix of the screen and never a paragraph of each supplier.
  const flattened = [...groups.flatMap((group) => group.rows), ...unassignedRows]
  const page = flattened.slice(query.offset, query.offset + query.limit)

  const pageGroups = new Map<string, ReplenishmentRow[]>()
  const pageUnassigned: ReplenishmentRow[] = []
  for (const row of page) {
    if (row.supplierId === null) {
      pageUnassigned.push(row)
      continue
    }
    const existing = pageGroups.get(row.supplierId) ?? []
    existing.push(row)
    pageGroups.set(row.supplierId, existing)
  }

  const pagedGroups = groups
    .map((group) => pageGroups.get(group.supplierId))
    .filter((groupRows): groupRows is ReplenishmentRow[] => groupRows !== undefined)
    .map((groupRows) =>
      groupOf(groupRows[0]?.supplierId ?? '', groupRows[0]?.supplierName ?? '', groupRows),
    )

  return {
    branchId,
    velocityDays: VELOCITY_DAYS,
    groups: pagedGroups,
    // An empty `supplierId` marks the Unassigned group; the console owns the
    // word for it (the API returns machine values, the client writes sentences).
    unassigned: groupOf('', '', pageUnassigned),
    totals: {
      rows: page.length,
      suggestedUnits: page.reduce((total, row) => total + row.suggested, 0),
      valueMinor: page.reduce((total, row) => total + row.suggestedValueMinor, 0),
    },
    totalRows: flattened.length,
  }
}

/** Whole days between two ISO calendar days; never negative. */
function daysBetween(from: string, to: string): number {
  const diff = Math.round((parseIsoDay(to).getTime() - parseIsoDay(from).getTime()) / DAY_MS)
  return Math.max(diff, 0)
}

function averageTenths(totalDays: number, count: number): number | null {
  if (count === 0) return null
  return Math.round((totalDays * 10) / count)
}

interface Drift {
  driftMinor: number
  previousTotalMinor: number
  comparableProducts: number
}

/**
 * The two newest receipts per product, compared. A product with one receipt has
 * no drift to report, and `comparableProducts` says how many did.
 *
 * The two are re-sorted here rather than trusted to arrive newest-first, so the
 * figure cannot depend on the query's row order.
 */
function costDrift(history: readonly ReceiptCostFact[]): Drift {
  const byProduct = new Map<string, { unitCostMinor: number; receivedAt: Date }[]>()
  for (const fact of history) {
    const rows = byProduct.get(fact.productId) ?? []
    rows.push({ unitCostMinor: fact.unitCostMinor, receivedAt: fact.receivedAt })
    byProduct.set(fact.productId, rows)
  }

  let driftMinor = 0
  let previousTotalMinor = 0
  let comparableProducts = 0
  for (const rows of byProduct.values()) {
    if (rows.length < 2) continue
    const [latest, previous] = [...rows].sort(
      (a, b) => b.receivedAt.getTime() - a.receivedAt.getTime(),
    )
    if (!latest || !previous) continue
    driftMinor += latest.unitCostMinor - previous.unitCostMinor
    previousTotalMinor += previous.unitCostMinor
    comparableProducts += 1
  }

  return { driftMinor, previousTotalMinor, comparableProducts }
}

interface Accumulator {
  supplierId: string
  supplierCode: string
  supplierName: string
  orders: Set<string>
  linesCount: number
  onTimeLines: number
  lateLines: number
  noPromiseLines: number
  noReceiptLines: number
  orderedUnits: number
  receivedUnits: number
  fillNumerator: number
  fillDenominator: number
  actualLeadDays: number
  actualLeadCount: number
  promisedLeadDays: number
  promisedLeadCount: number
}

function emptyAccumulator(line: PerformanceLineFact): Accumulator {
  return {
    supplierId: line.supplierId,
    supplierCode: line.supplierCode,
    supplierName: line.supplierName,
    orders: new Set<string>(),
    linesCount: 0,
    onTimeLines: 0,
    lateLines: 0,
    noPromiseLines: 0,
    noReceiptLines: 0,
    orderedUnits: 0,
    receivedUnits: 0,
    fillNumerator: 0,
    fillDenominator: 0,
    actualLeadDays: 0,
    actualLeadCount: 0,
    promisedLeadDays: 0,
    promisedLeadCount: 0,
  }
}

/**
 * Which suppliers keep their promises, measured by the P11-D11 definitions.
 *
 * Lines that cannot be measured are counted and excluded, never treated as a
 * success: a rate whose denominator hides its missing data is the reason
 * supplier scorecards are distrusted.
 */
export async function getSupplierPerformance(
  user: SessionUser,
  query: SupplierPerformanceQuery,
): Promise<SupplierPerformanceResult> {
  const branchId = requireBranch(user, query.branchId)
  const window = resolvePerformanceWindow(query)

  const lines = await repository.selectPerformanceLines({
    branchId,
    supplierId: query.supplierId,
    from: window.fromInstant,
    toExclusive: window.toExclusive,
  })

  /**
   * A fill rate is only meaningful for an order that received something: P11-D11
   * names `RECEIVED`, `CLOSED` and `PARTIALLY_RECEIVED`. A cancelled or still
   * pending order has nothing to fill yet, and counting its lines as zero would
   * punish a supplier for an order that never happened.
   */
  const fillEligibleOrders = new Set(
    lines
      .filter(
        (line) =>
          line.status === 'RECEIVED' ||
          line.status === 'CLOSED' ||
          line.status === 'PARTIALLY_RECEIVED',
      )
      .map((line) => line.orderId),
  )

  const accumulators = new Map<string, Accumulator>()
  for (const line of lines) {
    const accumulator = accumulators.get(line.supplierId) ?? emptyAccumulator(line)
    accumulator.orders.add(line.orderId)
    accumulator.linesCount += 1
    accumulator.orderedUnits += line.orderedQuantity
    accumulator.receivedUnits += line.receivedQuantity

    if (line.expectedDate === null) {
      accumulator.noPromiseLines += 1
    } else if (line.firstReceiptDate === null) {
      accumulator.noReceiptLines += 1
    } else if (line.firstReceiptDate <= line.expectedDate) {
      accumulator.onTimeLines += 1
    } else {
      accumulator.lateLines += 1
    }

    if (fillEligibleOrders.has(line.orderId)) {
      accumulator.fillNumerator += Math.min(line.receivedQuantity, line.orderedQuantity)
      accumulator.fillDenominator += line.orderedQuantity
    }

    if (line.sentDate !== null && line.firstReceiptDate !== null) {
      accumulator.actualLeadDays += daysBetween(line.sentDate, line.firstReceiptDate)
      accumulator.actualLeadCount += 1
      // The promise is averaged over the same delivered lines as the actual, so
      // the pair compares like with like: "we promised 7, they took 9".
      if (line.expectedDate !== null) {
        accumulator.promisedLeadDays += daysBetween(line.sentDate, line.expectedDate)
        accumulator.promisedLeadCount += 1
      }
    }

    accumulators.set(line.supplierId, accumulator)
  }

  const suppliers: SupplierPerformanceRow[] = []
  const historyBySupplier = new Map<string, ReceiptCostFact[]>()
  for (const fact of await repository.selectReceiptHistory(branchId, [...accumulators.keys()])) {
    if (fact.supplierId === null) continue
    const rows = historyBySupplier.get(fact.supplierId) ?? []
    rows.push(fact)
    historyBySupplier.set(fact.supplierId, rows)
  }

  for (const accumulator of accumulators.values()) {
    const history = historyBySupplier.get(accumulator.supplierId) ?? []
    const drift = costDrift(history)
    const lastReceiptAt = history.reduce<Date | null>(
      (latest, fact) => (latest === null || fact.receivedAt > latest ? fact.receivedAt : latest),
      null,
    )

    suppliers.push({
      supplierId: accumulator.supplierId,
      supplierCode: accumulator.supplierCode,
      supplierName: accumulator.supplierName,
      ordersCount: accumulator.orders.size,
      linesCount: accumulator.linesCount,
      onTimeLines: accumulator.onTimeLines,
      lateLines: accumulator.lateLines,
      noPromiseLines: accumulator.noPromiseLines,
      noReceiptLines: accumulator.noReceiptLines,
      onTimeRateBasisPoints: ratioBp(
        accumulator.onTimeLines,
        accumulator.onTimeLines + accumulator.lateLines,
      ),
      orderedUnits: accumulator.orderedUnits,
      receivedUnits: accumulator.receivedUnits,
      fillRateBasisPoints: ratioBp(accumulator.fillNumerator, accumulator.fillDenominator),
      promisedLeadDaysAverageTenths: averageTenths(
        accumulator.promisedLeadDays,
        accumulator.promisedLeadCount,
      ),
      actualLeadDaysAverageTenths: averageTenths(
        accumulator.actualLeadDays,
        accumulator.actualLeadCount,
      ),
      lastCostDriftMinor: drift.comparableProducts > 0 ? drift.driftMinor : null,
      lastCostDriftBasisPoints:
        drift.comparableProducts > 0 ? ratioBp(drift.driftMinor, drift.previousTotalMinor) : null,
      lastCostAt: lastReceiptAt ? lastReceiptAt.toISOString() : null,
      driftComparableProducts: drift.comparableProducts,
    })
  }

  suppliers.sort((a, b) => a.supplierName.localeCompare(b.supplierName))

  const totalOnTime = suppliers.reduce((total, row) => total + row.onTimeLines, 0)
  const totalLate = suppliers.reduce((total, row) => total + row.lateLines, 0)
  const totalFill = lines.reduce((total, line) => {
    if (!fillEligibleOrders.has(line.orderId)) return total
    return total + Math.min(line.receivedQuantity, line.orderedQuantity)
  }, 0)
  const totalOrdered = lines.reduce((total, line) => {
    if (!fillEligibleOrders.has(line.orderId)) return total
    return total + line.orderedQuantity
  }, 0)

  return {
    branchId,
    from: window.from,
    to: window.to,
    suppliers,
    totals: {
      suppliers: suppliers.length,
      onTimeRateBasisPoints: ratioBp(totalOnTime, totalOnTime + totalLate),
      fillRateBasisPoints: ratioBp(totalFill, totalOrdered),
    },
    exclusions: {
      ordersWithoutSendDate: new Set(
        lines.filter((line) => line.sentDate === null).map((line) => line.orderId),
      ).size,
      linesWithoutReceipt: lines.filter((line) => line.firstReceiptDate === null).length,
    },
  }
}

/**
 * The supplier's last cost per product, for an order raised from suggestions.
 *
 * A missing link has no cost here; the caller rejects it by name, because a
 * zero-cost line would sail under any approval threshold (P11-D2).
 */
export async function resolveSupplierLastCosts(
  supplierId: string,
  productIds: readonly string[],
): Promise<Map<string, number>> {
  return repository.selectSupplierProductCosts(supplierId, productIds)
}
