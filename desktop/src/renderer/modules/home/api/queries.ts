/**
 * Every statement the home screen watches, and the row type each one returns.
 *
 * This file is SQL and types only — no React, no hooks, no formatting. Keeping it that
 * way is what makes the day window reviewable in one place: every statement that touches
 * `sale` carries `terminal_id = ? AND occurred_at >= ? AND occurred_at < ?`, so none of
 * them can scan an ever-growing table unbounded (P10-D12). `sale` is indexed on
 * `(terminal_id, occurred_at)` for exactly this filter (`schema.ts`, Plan 01).
 *
 * The window is the **Accra day**, all shifts of it; the drawer figure is a different,
 * shift-shaped window and lives in `lib/shift/shift-service.ts` (P10-D5). That is why the
 * day header and the drawer card are separate reads rather than one number with two labels.
 *
 * Owner-specific statements stay with their owners: the unprinted count lives in
 * `modules/sales/api/queries.ts` and the open-conflict count in
 * `modules/sync/api/queries.ts`. This file does not restate them.
 */

/**
 * The three parameters every day-bounded statement takes.
 *
 * `terminal_id` comes first because it is the index's leading column. `from`/`to` are ISO
 * strings at 00:00 UTC, half-open — a sale written at exactly midnight belongs to the new
 * day, one millisecond earlier to the old one.
 */
export interface DayWindow {
  terminalId: string
  from: string
  to: string
}

/** The day header: what the till took, what of it is tax, and how much was credit. */
export interface DayHeaderRow {
  sales_count: number
  take_minor: number
  tax_minor: number
  credit_minor: number
  change_minor: number
}

export interface ItemsSoldRow {
  items_sold: number
}

/** One bucket of the hourly shape. Only hours that saw a sale are returned; see `fillHours`. */
export interface HourRow {
  hour: number
  take_minor: number
}

export interface TopSellerRow {
  product_id: string
  name: string
  quantity: number
  revenue_minor: number
}

export interface CountRow {
  count: number
}

/**
 * Take, tax, credit, and change for the day.
 *
 * `take_minor` is what customers paid, tax included; `tax_minor` is the part to remit.
 * The window spans **all shifts of the day**, which is why the drawer figure is a
 * separate card with its own label (P10-D5).
 */
export const DAY_HEADER_SQL = `SELECT COUNT(*)                              AS sales_count,
       COALESCE(SUM(total_minor), 0)         AS take_minor,
       COALESCE(SUM(tax_total_minor), 0)     AS tax_minor,
       COALESCE(SUM(credit_amount_minor), 0) AS credit_minor,
       COALESCE(SUM(change_minor), 0)        AS change_minor
  FROM sale
 WHERE terminal_id = ? AND occurred_at >= ? AND occurred_at < ?`

/** How many units left the shelf, not how many receipts were printed. */
export const ITEMS_SOLD_SQL = `SELECT COALESCE(SUM(sl.quantity), 0) AS items_sold
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
 WHERE s.terminal_id = ? AND s.occurred_at >= ? AND s.occurred_at < ?`

/**
 * The day's shape, grouped by the ISO string's hour.
 *
 * `occurred_at` is written as `new Date().toISOString()` (`lib/sale/complete-sale.ts`), so
 * `substr(occurred_at, 12, 2)` is the UTC hour — and Africa/Accra is UTC+0 with no DST
 * (`packages/shared/src/dates.ts`), so it is also the Accra hour. That equivalence is
 * asserted in `utils/day.test.ts`; if a non-zero offset is ever introduced the test fails
 * rather than the dashboard silently shifting an hour.
 *
 * Only non-empty hours come back — `fillHours` zero-fills the other 23, so a quiet morning
 * is a visible zero rather than a missing point.
 */
export const HOURLY_SHAPE_SQL = `SELECT CAST(substr(occurred_at, 12, 2) AS INTEGER) AS hour,
       COALESCE(SUM(total_minor), 0)               AS take_minor
  FROM sale
 WHERE terminal_id = ? AND occurred_at >= ? AND occurred_at < ?
 GROUP BY hour
 ORDER BY hour`

/**
 * The five products that moved most, ranked by quantity.
 *
 * `sl.name` is the snapshot written at sale time, so a renamed or archived product still
 * reads correctly and no join to the catalogue is needed. `name ASC` is the tiebreak that
 * makes the order deterministic between two runs over the same rows.
 */
export const TOP_SELLERS_SQL = `SELECT sl.product_id            AS product_id,
       sl.name                  AS name,
       SUM(sl.quantity)         AS quantity,
       SUM(sl.total_minor)      AS revenue_minor
  FROM sale_line sl
  JOIN sale s ON s.id = sl.sale_id
 WHERE s.terminal_id = ? AND s.occurred_at >= ? AND s.occurred_at < ?
 GROUP BY sl.product_id, sl.name
 ORDER BY SUM(sl.quantity) DESC, sl.name ASC
 LIMIT 5`

/**
 * Products at this branch with nothing on hand (P10-D2).
 *
 * This is the only statement here that is not day-bounded: "out of stock now" is a
 * property of the shelf, not of today's trading. It is still bounded by `branch_id`, which
 * is indexed.
 *
 * Documented gap: a product the branch has **never** stocked has no `stock_level` row and
 * does not appear. `stock_threshold` is a server table and is not in any sync stream, so
 * "low stock" is impossible offline; Phase 11 owns replenishment.
 */
export const OUT_OF_STOCK_SQL = `SELECT COUNT(*) AS count
  FROM stock_level sl
  JOIN product p ON p.id = sl.product_id AND p.is_active = 1
 WHERE sl.branch_id = ? AND sl.quantity_on_hand <= 0`

/** `[terminalId, from, to]` — the parameter list for every day-bounded statement above. */
export function dayParameters(day: DayWindow): [string, string, string] {
  return [day.terminalId, day.from, day.to]
}
