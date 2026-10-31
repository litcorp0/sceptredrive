import { type SQL, sql } from 'drizzle-orm'

/**
 * The effective low-stock threshold, in one place (18-02).
 *
 * `coalesce` in three steps: the product's own row at this branch, the branch's
 * default, the company default, then the built-in 5. The stock list, the
 * inventory totals and the dashboard's attention counts all read this fragment —
 * the same discipline as the old `LOW_STOCK_SQL`, because two definitions is how
 * a badge and a report start disagreeing.
 *
 * The setting is read from the `setting` table in SQL rather than resolved in the
 * service, because a multi-branch read needs a different default per row.
 */
export const LOW_STOCK_THRESHOLD_KEY = 'inventory.defaultLowStockThreshold'

/** What a product with no threshold and no configured default falls back to. */
export const DEFAULT_LOW_STOCK_THRESHOLD = 5

export function effectiveThresholdSql(
  branchColumn: SQL | unknown,
  thresholdColumn: SQL | unknown,
): SQL {
  return sql`coalesce(
    ${thresholdColumn},
    (select (s.value #>> '{}')::int from setting s
      where s.key = ${LOW_STOCK_THRESHOLD_KEY} and s.branch_id = ${branchColumn}),
    (select (s.value #>> '{}')::int from setting s
      where s.key = ${LOW_STOCK_THRESHOLD_KEY} and s.branch_id is null),
    ${DEFAULT_LOW_STOCK_THRESHOLD}
  )`
}
