import type { ShiftCashTotals } from '@/lib/shift/shift-repository'
/**
 * The home screen's vocabulary (Plan 04).
 *
 * These are domain shapes, not query rows: the row types stay in `api/queries.ts` beside
 * the SQL that produces them, and the pure functions in `utils/` translate one into the
 * other. Nothing here knows about React or the database.
 */

/**
 * One Accra day, as the half-open window every home figure is counted in.
 *
 * `from` is 00:00 UTC of `day` and `to` is 00:00 UTC of the next day, exclusive.
 * Africa/Accra is UTC+0 all year (P10-D13), so those are also the Accra instants —
 * computed by `accraDayBounds` in `@sceptre/shared`, never re-derived here.
 */
export interface AccraDay {
  /** `2026-10-25` — the calendar day, used for labels and as a cache key. */
  day: string
  /** ISO instant of that day's 00:00, inclusive. */
  from: string
  /** ISO instant of the next day's 00:00, exclusive. */
  to: string
}

/** One bucket of the hourly shape. A quiet hour is a zero point, never a gap. */
export interface HourPoint {
  /** 0…23, Accra hour. */
  hour: number
  takeMinor: number
}

/** One row of the top-five list. `name` is the snapshot written at sale time. */
export interface TopSeller {
  productId: string
  name: string
  quantity: number
  revenueMinor: number
}

/**
 * The day's tiles, assembled once.
 *
 * `hasSales` is the UI contract for an empty day: an average basket of `0` means "nothing
 * sold", not "the basket was free", so the tile renders `—` rather than `GHS 0.00`
 * (P10-D3). Keeping the flag here is what stops the screen inventing it later.
 *
 * `expectedCashMinor` is `null` — not `0` — when no shift is open, because a drawer with
 * no shift has no expected figure and must not display the last close's (P10-D5).
 */
export interface HomeSummary {
  salesCount: number
  /** What customers paid today, tax included (P10-D5c). */
  takeMinor: number
  /** The part of `takeMinor` to remit. */
  taxMinor: number
  /** Credit extended today. Nothing about it is cash in the drawer. */
  creditMinor: number
  changeMinor: number
  itemsSold: number
  /** `averageBasketMinor(takeMinor, salesCount)` — the shared function, never a local divide. */
  averageBasketMinor: number
  hasSales: boolean
  expectedCashMinor: number | null
  /** The open shift's number, shown beside the drawer figure so the window is unambiguous. */
  shiftNumber: string | null
  /** The drawer's own terms, so the tile can show how the figure was reached (P20-D10). */
  cashTotals: ShiftCashTotals | null
}

/** A hash route a cashier can actually reach today. */
export type AttentionRoute = 'pos/sales' | 'pos/sync'

export type AttentionTone = 'warn' | 'danger' | 'info'

/**
 * One item of the needs-attention strip.
 *
 * `route` is `null` when no screen exists yet — a labelled count is honest, a link that
 * goes nowhere is not (the admin dashboard's rule, P9/Plan 04 §Attention).
 */
export interface AttentionItem {
  id: 'unprinted' | 'conflicts' | 'uploads' | 'out-of-stock'
  count: number
  label: string
  detail: string
  tone: AttentionTone
  route: AttentionRoute | null
}
