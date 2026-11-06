import { accraDayBounds, averageBasketMinor } from '@sceptre/shared'
import type { ShiftCashTotals } from '@/lib/shift/shift-repository'
import type { DayHeaderRow, TopSellerRow } from '../api/queries'
import type { AccraDay, HomeSummary, HourPoint, TopSeller } from '../types'

/**
 * The home screen's arithmetic, all of it pure.
 *
 * Two rules that shape this file:
 *
 * - **Money is never summed twice.** `takeMinor`, `taxMinor`, `creditMinor` and
 *   `itemsSold` are already aggregates from SQL; nothing here adds them up again. The one
 *   division in the product — average basket — comes from `@sceptre/shared` (P10-D3), so
 *   the till and the console cannot round differently.
 * - **Hours are the UTC hour, which is the Accra hour.** `occurred_at` is stored as
 *   `toISOString()`, and Africa/Accra is UTC+0 all year, so the SQL bucket needs no
 *   offset. `dayWindow` proves the window is UTC-derived rather than host-zone-derived.
 */

/** A day has 24 buckets even when it was quiet: a zero is data, a gap is a lie. */
const HOURS_IN_DAY = 24

/**
 * The half-open `[from, to)` window for one Accra day, in UTC.
 *
 * The day string is anchored to UTC midnight before it reaches `accraDayBounds`. Passing
 * the bare string would parse as *local* midnight (date-fns `parseISO`), which moves the
 * window by the host's offset — a terminal whose clock sits in another zone would then
 * report a different day than the receipt numbers it printed.
 */
export function dayWindow(day: string): AccraDay {
  const bounds = accraDayBounds(Date.parse(`${day}T00:00:00.000Z`))
  return { day: bounds.day, from: bounds.from, to: bounds.to }
}

/**
 * The 24-point hourly shape, zero-filled in hour order.
 *
 * Rows arrive grouped but are not trusted to be complete, in order, or unique: a duplicate
 * hour accumulates into its bucket and an out-of-range hour is dropped rather than
 * creating a 25th point. Hours 0 and 23 are ordinary buckets.
 */
export function fillHours(rows: ReadonlyArray<{ hour: number; take_minor: number }>): HourPoint[] {
  const points: HourPoint[] = Array.from({ length: HOURS_IN_DAY }, (_, hour) => ({
    hour,
    takeMinor: 0,
  }))

  for (const row of rows) {
    if (!Number.isInteger(row.hour) || row.hour < 0 || row.hour >= HOURS_IN_DAY) continue
    const point = points[row.hour]
    if (!point) continue
    point.takeMinor += row.take_minor
  }

  return points
}

/**
 * The busiest hour, or `null` when the day took nothing.
 *
 * A tie goes to the **earlier** hour: on a flat day the first busy hour is the useful
 * answer ("it picked up at 10"), and picking by input order would make the summary
 * depend on row order.
 */
export function peakHour(points: ReadonlyArray<HourPoint>): number | null {
  let peak: HourPoint | null = null

  for (const point of points) {
    if (point.takeMinor <= 0) continue
    if (peak === null || point.takeMinor > peak.takeMinor) {
      peak = point
      continue
    }
    if (point.takeMinor === peak.takeMinor && point.hour < peak.hour) peak = point
  }

  return peak?.hour ?? null
}

/**
 * `11:00` — the hour label the chart axis, the summary sentence, and the table all use.
 *
 * Zero-padded and 24-hour because the counter reads a clock, not a locale: a cashier looking
 * for "when did it pick up" should never have to decide whether `1:00` is midday.
 */
export function hourLabel(hour: number): string {
  return `${String(hour).padStart(2, '0')}:00`
}

/** Query rows to the list the screen renders. Order is the SQL's — quantity desc, then name. */
export function toTopSellers(rows: ReadonlyArray<TopSellerRow>): TopSeller[] {
  return rows.map((row) => ({
    productId: row.product_id,
    name: row.name,
    quantity: row.quantity,
    revenueMinor: row.revenue_minor,
  }))
}

/** What `homeSummary` needs: the day header, the items count, and the drawer. */
export interface HomeSummaryInput {
  /**
   * The header row. `null` before the first result and after a failed read, which reads
   * as an empty day — which is also what a day with no sales returns.
   */
  header: DayHeaderRow | null
  itemsSold: number
  /** `null` when no shift is open, so the card can say so instead of showing a figure. */
  drawer: {
    expectedCashMinor: number
    shiftNumber: string
    cashTotals: ShiftCashTotals | null
  } | null
}

/**
 * The tiles' values, assembled once.
 *
 * This function does no arithmetic of its own beyond calling `averageBasketMinor`: every
 * amount it returns is a column. That is deliberate — a second place that divides or sums
 * money is a second place that can disagree with the API.
 */
export function homeSummary(input: HomeSummaryInput): HomeSummary {
  const salesCount = input.header?.sales_count ?? 0
  const takeMinor = input.header?.take_minor ?? 0

  return {
    salesCount,
    takeMinor,
    taxMinor: input.header?.tax_minor ?? 0,
    creditMinor: input.header?.credit_minor ?? 0,
    changeMinor: input.header?.change_minor ?? 0,
    itemsSold: input.itemsSold,
    averageBasketMinor: averageBasketMinor(takeMinor, salesCount),
    hasSales: salesCount > 0,
    expectedCashMinor: input.drawer?.expectedCashMinor ?? null,
    shiftNumber: input.drawer?.shiftNumber ?? null,
    cashTotals: input.drawer?.cashTotals ?? null,
  }
}
