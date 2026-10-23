/**
 * Loyalty balance display (Plan 06 Task 4).
 *
 * The terminal keeps its own unacked deltas on top of the synced balance, so a
 * cashier who sells twice offline sees the points from both sales before either
 * has reached the server. The server remains authoritative; on sync it
 * recomputes and raises a conflict if this view was wrong (D18).
 */

export interface LotLike {
  remaining_points: number
  expires_at: string
}

export interface DeltaLike {
  points_delta: number
}

export const EXPIRING_SOON_DAYS = 30

function safeInteger(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

/** Synced balance plus unacked local deltas. */
export function availablePoints(
  balancePoints: number,
  pendingDeltas: readonly DeltaLike[],
): number {
  return pendingDeltas.reduce(
    (total, delta) => total + safeInteger(delta.points_delta),
    safeInteger(balancePoints),
  )
}

export function pendingPoints(pendingDeltas: readonly DeltaLike[]): number {
  return pendingDeltas.reduce((total, delta) => total + safeInteger(delta.points_delta), 0)
}

/** Points in live lots that expire within the window (still spendable now). */
export function expiringSoonPoints(
  lots: readonly LotLike[],
  now = new Date(),
  withinDays = EXPIRING_SOON_DAYS,
): number {
  const cutoff = now.getTime() + withinDays * 24 * 60 * 60 * 1000
  return lots.reduce((total, lot) => {
    const remaining = safeInteger(lot.remaining_points)
    if (remaining <= 0) return total
    const expiresAt = Date.parse(lot.expires_at)
    if (Number.isNaN(expiresAt)) return total
    return expiresAt <= cutoff ? total + remaining : total
  }, 0)
}

/** "in 12 days" / "expired" — receipt and panel hint text. */
export function expiryHint(expiresAt: string, now = new Date()): string {
  const at = Date.parse(expiresAt)
  if (Number.isNaN(at)) return 'no expiry'
  const days = Math.floor((at - now.getTime()) / (24 * 60 * 60 * 1000))
  if (days < 0) return 'expired'
  if (days === 0) return 'expires today'
  if (days === 1) return 'expires tomorrow'
  return `expires in ${days} days`
}
