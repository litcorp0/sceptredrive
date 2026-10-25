import { formatCount } from '@sceptre/shared'
import type { AttentionItem } from '../types'

/**
 * The needs-attention strip (Plan 04 §7, P10-D2).
 *
 * Four counts, all read from the terminal's own database, and no judgement: an out-of-stock
 * part, an unprinted receipt, a waiting upload, and an open conflict. The strip never blocks
 * a sale — every one of these is a report about a sale that already happened.
 *
 * Two rules copied from the admin dashboard's strip:
 *
 * - **A link only goes somewhere a cashier can act.** Unprinted receipts open today's sales,
 *   conflicts and waiting uploads open the sync screen. There is no POS stock screen, so
 *   "out of stock" carries no route at all: a labelled count is honest, a link that goes
 *   nowhere is worse than one.
 * - **Zero-count items are omitted.** An empty strip means a quiet till, not a broken one.
 */

export interface AttentionCounts {
  /** `useUnprintedCount()` — sales whose receipt has not come out of the printer yet. */
  unprinted: number
  /** `sync_conflict_local` rows with `status = 'OPEN'`. */
  openConflicts: number
  /** The `HIGH` subset of the above; it is what raises the tone to `danger`. */
  highSeverityConflicts: number
  /** Outbox rows still waiting to reach the server. */
  uploads: number
  /** Active products at this branch with `quantity_on_hand <= 0`. */
  outOfStock: number
}

/**
 * A count is a safe, positive integer or it does not exist.
 *
 * The aggregates are SQL `COUNT`s, so anything else is an upstream bug. Dropping it keeps a
 * `NaN` or a `1.5` off a counter screen whose only job is to be trusted at a glance; a
 * count that is wrong is worse than a count that is absent.
 */
function safeCount(value: number): number {
  return Number.isSafeInteger(value) && value > 0 ? value : 0
}

/**
 * The strip's items, in the order a cashier should read them, with zeroes removed.
 *
 * Tone is not decoration: `danger` is reserved for a conflict the server rated `HIGH`,
 * which is the only one of these four a manager must look at today.
 */
export function attentionItems(counts: AttentionCounts): AttentionItem[] {
  const openConflicts = safeCount(counts.openConflicts)
  const highConflicts = safeCount(counts.highSeverityConflicts)

  const items: AttentionItem[] = [
    {
      id: 'unprinted',
      count: safeCount(counts.unprinted),
      label: 'Unprinted receipts',
      detail: 'The sale is safe; the paper is not out yet',
      tone: 'warn',
      route: 'pos/sales',
    },
    {
      id: 'conflicts',
      count: openConflicts,
      label: 'Sync conflicts',
      detail: highConflicts > 0 ? `${formatCount(highConflicts)} high severity` : 'Awaiting review',
      tone: highConflicts > 0 ? 'danger' : 'warn',
      route: 'pos/sync',
    },
    {
      id: 'uploads',
      count: safeCount(counts.uploads),
      label: 'Uploads waiting',
      detail: 'Recorded on this terminal, not on the server yet',
      tone: 'info',
      route: 'pos/sync',
    },
    {
      id: 'out-of-stock',
      count: safeCount(counts.outOfStock),
      label: 'Out of stock',
      detail: 'Products at this branch',
      tone: 'warn',
      // No POS stock screen exists (P10-D2); Phase 11 owns replenishment.
      route: null,
    },
  ]

  return items.filter((item) => item.count > 0)
}
