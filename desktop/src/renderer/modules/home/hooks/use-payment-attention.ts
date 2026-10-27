import { useQuery } from '@powersync/react'
import { useEffect, useMemo, useState } from 'react'
import { httpSyncClient } from '@/lib/api/sync-client'
import type { PosConfigSnapshot } from '@/lib/api/types'
import { loadCartDraft } from '@/lib/cart/cart-repository'
import { cartPricingContext } from '@/lib/cart/cart-store'
import { computeCartTotals } from '@/lib/cart/totals'
import { usePosDatabase } from '@/lib/powersync/provider'
import { refreshConflicts } from '@/lib/sync/conflicts'
import {
  type OrphanConflictRow,
  type OrphanPayment,
  parseOrphanConflicts,
} from '../utils/payment-attention'

/**
 * The shift home's orphan read (P13-D9).
 *
 * Two local reads, no network on the render path: the server's late-settlement
 * conflicts (already cached by the sync screen) and the payments that a cart or
 * a sale already points at. A conflict whose payment is referenced is not an
 * orphan any more, so it disappears from the banner the moment the sale is
 * written — even if the manager has not resolved the conflict itself yet.
 *
 * Opening the home screen asks the server for the conflict list once, because a
 * till that has been idle all morning has no upload to refresh the cache. That
 * read degrades silently offline; the banner then shows the last known truth.
 */

export function useOrphanPayments(): OrphanPayment[] {
  const db = usePosDatabase()

  useEffect(() => {
    void refreshConflicts(db, httpSyncClient).catch(() => {
      // Offline is not an error here: the cached list is still what we know.
    })
  }, [db])

  const conflicts = useQuery<OrphanConflictRow>(
    `SELECT id, details, created_at
       FROM sync_conflict_local
      WHERE type = 'PAYMENT_LATE_SETTLEMENT' AND status = 'OPEN'
      ORDER BY created_at DESC`,
    [],
    { throttleMs: 250, reportFetching: false },
  )

  const attached = useQuery<{ payment_id: string | null }>(
    `SELECT payment_id FROM cart_tender WHERE payment_id IS NOT NULL
     UNION
     SELECT payment_id FROM sale_tender WHERE payment_id IS NOT NULL`,
    [],
    { throttleMs: 250, reportFetching: false },
  )

  return useMemo(() => {
    const attachedIds = new Set(
      (attached.data ?? [])
        .map((row) => row.payment_id)
        .filter((id): id is string => typeof id === 'string' && id.length > 0),
    )
    return parseOrphanConflicts(conflicts.data ?? [], attachedIds)
  }, [conflicts.data, attached.data])
}

export interface DraftForClaim {
  draftId: string
  totalMinor: number
}

/**
 * The open draft's total, for deciding whether an orphan still fits it.
 *
 * `loadCartDraft` prunes drafts from another shift, so it is never called with
 * a null shift: looking at the home screen must not delete the cart the cashier
 * left on the sell screen.
 */
export function useDraftForClaim(
  shiftId: string | null,
  config: PosConfigSnapshot | null,
): DraftForClaim | null {
  const db = usePosDatabase()
  const [draft, setDraft] = useState<DraftForClaim | null>(null)

  useEffect(() => {
    if (!shiftId || !config) {
      setDraft(null)
      return
    }

    let cancelled = false
    void loadCartDraft(db, shiftId)
      .then((state) => {
        if (cancelled) return
        if (!state) {
          setDraft(null)
          return
        }
        const totals = computeCartTotals(state, cartPricingContext(config))
        setDraft({ draftId: state.saleId, totalMinor: totals.priced.totalMinor })
      })
      .catch(() => {
        if (!cancelled) setDraft(null)
      })

    return () => {
      cancelled = true
    }
  }, [db, shiftId, config])

  return draft
}
