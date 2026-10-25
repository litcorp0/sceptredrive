import { useQuery } from '@powersync/react'

/**
 * Open sync conflicts, as the terminal knows them (Plan 08 Task 3; moved here in Plan 04).
 *
 * The SQL lives in the module that owns the conflict screen, not in the header and not in
 * every consumer of it: the sync badge and the home strip must never disagree about what
 * "open" means. `high` is the subset a manager must review — the badge uses it to decide
 * whether the terminal needs a human, and the home strip uses it to raise its tone.
 *
 * Read-only and local: the device keeps a copy of what the server last raised
 * (`lib/sync/conflicts.ts`), so this answers offline too.
 */

export interface ConflictCounts {
  open: number
  high: number
}

export function useOpenConflictCounts(): ConflictCounts {
  const { data } = useQuery<{ open: number; high: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'OPEN' AND severity = 'HIGH' THEN 1 ELSE 0 END), 0) AS high,
       COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open
       FROM sync_conflict_local`,
    [],
    // P10-D12: a conflict write is bursty and this is a header-level figure.
    { throttleMs: 250, reportFetching: false },
  )

  return { open: data?.[0]?.open ?? 0, high: data?.[0]?.high ?? 0 }
}
