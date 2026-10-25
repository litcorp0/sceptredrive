import { useQuery } from '@powersync/react'

/**
 * The unprinted-receipt count (Plan 03).
 *
 * One SQL string, consumed by the header today and by the home strip in Plan 04.
 * It lives in the `sales` module — the module that owns the `sale` table's local
 * read paths — rather than in either consumer, so the two surfaces can never
 * disagree about what "unprinted" means.
 *
 * Read-only and non-blocking: a printer problem shows a count, it never stops a
 * sale.
 */
export function useUnprintedCount(): number {
  const result = useQuery<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sale
      WHERE print_status IN ('PENDING', 'FAILED', 'PRINTING')`,
  )
  return result.data?.[0]?.count ?? 0
}
