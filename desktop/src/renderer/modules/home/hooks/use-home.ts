import { useQuery } from '@powersync/react'
import { useEffect, useMemo, useState } from 'react'
import { usePos } from '@/lib/powersync/provider'
import type { ShiftCashTotals } from '@/lib/shift/shift-repository'
import { loadShiftState } from '@/lib/shift/shift-service'
import { useOutboxSummary } from '@/lib/sync/outbox-summary'
import { useUnprintedCount } from '@/modules/sales'
import { useOpenConflictCounts } from '@/modules/sync'
import {
  type CountRow,
  DAY_HEADER_SQL,
  type DayHeaderRow,
  type DayWindow,
  dayParameters,
  HOURLY_SHAPE_SQL,
  type HourRow,
  ITEMS_SOLD_SQL,
  type ItemsSoldRow,
  OUT_OF_STOCK_SQL,
  TOP_SELLERS_SQL,
  type TopSellerRow,
} from '../api/queries'
import type { AccraDay, AttentionItem, HomeSummary, HourPoint, TopSeller } from '../types'
import { attentionItems } from '../utils/attention'
import { dayWindow, fillHours, homeSummary, peakHour, toTopSellers } from '../utils/day'

/**
 * The watched reads behind the home screen (Plan 04).
 *
 * One `useQuery` per aggregate, each day-bounded and throttled at 250 ms (P10-D12): a sale
 * writes a sale, its lines, and a tender inside one transaction, and without the throttle
 * seven aggregates would re-run three times in a burst.
 *
 * Scalar aggregates pass `reportFetching: false`. `isFetching` is what makes a tile flicker
 * while a sale uploads; the value itself does not change, so there is nothing to report.
 * The list reads leave it on — they render whole rows and a skeleton is honest there.
 *
 * Nothing here computes money. The drawer figure is the shift's own expected-cash path
 * (`loadShiftState` → `selectShiftCashTotals` + `computeExpectedCash`), reused rather than
 * re-derived: a second cash formula is a second till that can be short (P10-D5).
 */

/** Every scalar aggregate: throttled, and never flickers (P10-D12). */
const SCALAR_QUERY = { throttleMs: 250, reportFetching: false } as const

/** The list reads: throttled, and allowed to report that new rows are being computed. */
const LIST_QUERY = { throttleMs: 250 } as const

/**
 * The two identity fields the home reads need.
 *
 * Structural rather than importing `PosIdentityRow`, so the module depends on the two
 * values it uses and not on the shape of the runtime snapshot.
 */
export interface HomeIdentity {
  terminalId: string
  branchId: string
}

/** Today on this terminal: take, tax, credit, change. */
export function useDayHeader(range: DayWindow): DayHeaderRow | null {
  const { data } = useQuery<DayHeaderRow>(DAY_HEADER_SQL, dayParameters(range), SCALAR_QUERY)
  return data?.[0] ?? null
}

/** Units sold today on this terminal. */
export function useItemsSold(range: DayWindow): number {
  const { data } = useQuery<ItemsSoldRow>(ITEMS_SOLD_SQL, dayParameters(range), SCALAR_QUERY)
  return data?.[0]?.items_sold ?? 0
}

/** The 24-point hourly shape; a quiet hour is a zero, not a gap. */
export function useHourlyShape(range: DayWindow): HourPoint[] {
  const { data } = useQuery<HourRow>(HOURLY_SHAPE_SQL, dayParameters(range), LIST_QUERY)
  return useMemo(() => fillHours(data ?? []), [data])
}

/** The five products that moved most today. */
export function useTopSellers(range: DayWindow): TopSeller[] {
  const { data } = useQuery<TopSellerRow>(TOP_SELLERS_SQL, dayParameters(range), LIST_QUERY)
  return useMemo(() => toTopSellers(data ?? []), [data])
}

/** Active products with nothing on hand at this branch (P10-D2). Not day-bounded: a shelf is not a day. */
export function useOutOfStock(branchId: string): number {
  const { data } = useQuery<CountRow>(OUT_OF_STOCK_SQL, [branchId], SCALAR_QUERY)
  return data?.[0]?.count ?? 0
}

/** The drawer figure for the open shift, or `null` when there is none. */
export interface ExpectedCash {
  shiftNumber: string | null
  expectedCashMinor: number | null
  /** The terms the drawer figure was built from, so the tile can show them. */
  cashTotals: ShiftCashTotals | null
}

const NO_SHIFT: ExpectedCash = {
  shiftNumber: null,
  expectedCashMinor: null,
  cashTotals: null,
}

/**
 * Expected cash in the drawer for **this shift** — a different window from the day
 * figures and labelled as such (P10-D5).
 *
 * `loadShiftState` is an async service call, not a single statement, so it is re-run when
 * any table it reads changes rather than being watched itself: `db.onChange` is the SDK's
 * documented path for "several queries need to run together when data changes". The
 * throttle matches the watched queries, so one sale produces one refresh, not three.
 */
export function useExpectedCash(): ExpectedCash {
  const { db } = usePos()
  const [state, setState] = useState<ExpectedCash>(NO_SHIFT)

  useEffect(() => {
    if (!db) return

    let cancelled = false
    const refresh = (): void => {
      void loadShiftState(db).then(
        (next) => {
          if (cancelled) return
          setState(
            next.shift
              ? {
                  shiftNumber: next.shift.number,
                  expectedCashMinor: next.expectedCashMinor,
                  cashTotals: next.cashTotals,
                }
              : NO_SHIFT,
          )
        },
        () => {
          // A failed read must not blank the card into a wrong figure; keep the last value.
        },
      )
    }

    refresh()
    const dispose = db.onChange(
      { onChange: refresh },
      { tables: ['sale', 'sale_tender', 'cash_movement', 'shift'], throttleMs: 250 },
    )

    return () => {
      cancelled = true
      dispose()
    }
  }, [db])

  return state
}

/** Everything the home screen renders for one Accra day. */
export interface HomeDay {
  day: AccraDay
  header: DayHeaderRow | null
  hourly: HourPoint[]
  /** The busiest hour, or `null` on a day that took nothing. */
  peak: number | null
  topSellers: TopSeller[]
  drawer: ExpectedCash
  summary: HomeSummary
  attention: AttentionItem[]
}

/**
 * The whole day in one call.
 *
 * Composition only: each value comes from its own hook, and `homeSummary` and
 * `attentionItems` are the same pure functions the tests pin. No screen is created here —
 * Plan 05 renders this, and the figures it renders are these.
 */
export function useHomeDay(day: string, identity: HomeIdentity | null): HomeDay {
  const accraDay = useMemo(() => dayWindow(day), [day])
  /*
   * The SQL scope: this terminal's day. An unconfigured terminal has no id yet, and the
   * guard ladder means the home screen does not mount before the config row is read — so
   * an empty id here reads as an empty day rather than another terminal's takings.
   */
  const range = useMemo<DayWindow>(
    () => ({ terminalId: identity?.terminalId ?? '', ...accraDay }),
    [accraDay, identity?.terminalId],
  )

  const header = useDayHeader(range)
  const itemsSold = useItemsSold(range)
  const hourly = useHourlyShape(range)
  const topSellers = useTopSellers(range)
  const drawer = useExpectedCash()

  const unprinted = useUnprintedCount()
  const conflicts = useOpenConflictCounts()
  const outbox = useOutboxSummary()
  const outOfStock = useOutOfStock(identity?.branchId ?? '')

  const summary = useMemo(
    () =>
      homeSummary({
        header,
        itemsSold,
        drawer:
          drawer.shiftNumber !== null && drawer.expectedCashMinor !== null
            ? {
                shiftNumber: drawer.shiftNumber,
                expectedCashMinor: drawer.expectedCashMinor,
                cashTotals: drawer.cashTotals,
              }
            : null,
      }),
    [header, itemsSold, drawer],
  )

  const attention = useMemo(
    () =>
      attentionItems({
        unprinted,
        openConflicts: conflicts.open,
        highSeverityConflicts: conflicts.high,
        uploads: outbox.pending + outbox.failed,
        outOfStock,
      }),
    [unprinted, conflicts.open, conflicts.high, outbox.pending, outbox.failed, outOfStock],
  )

  return {
    day: accraDay,
    header,
    hourly,
    peak: useMemo(() => peakHour(hourly), [hourly]),
    topSellers,
    drawer,
    summary,
    attention,
  }
}
