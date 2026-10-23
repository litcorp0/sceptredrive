import { useQuery } from '@powersync/react'

/**
 * Outbox summary for the POS header (Plan 06 Task 1 badge; Plan 08 adds the
 * uploader and the full sync screen).
 *
 * Reading the queue is read-only and local, so it is safe to show before the
 * uploader exists: the count tells the cashier whether anything is waiting to
 * reach the server.
 */

interface OutboxCountRow {
  pending: number
  failed: number
}

export interface OutboxSummary {
  pending: number
  failed: number
}

export function useOutboxSummary(): OutboxSummary {
  const { data } = useQuery<OutboxCountRow>(
    `SELECT
       COALESCE(SUM(CASE WHEN status IN ('pending', 'in_flight') THEN 1 ELSE 0 END), 0) AS pending,
       COALESCE(SUM(CASE WHEN status IN ('conflict', 'dead_letter') THEN 1 ELSE 0 END), 0) AS failed
       FROM outbox`,
  )

  return { pending: data?.[0]?.pending ?? 0, failed: data?.[0]?.failed ?? 0 }
}
