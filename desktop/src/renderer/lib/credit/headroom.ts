/**
 * Credit headroom (Plan 06 Tasks 3 and 5).
 *
 * Headroom is `limit − (balance + pending charges this terminal has not
 * uploaded yet)`. Reading the synced balance alone would let a cashier spend
 * the same headroom twice offline, which is exactly the double-spend the
 * conflict system exists to catch (D17).
 */

export interface CreditSnapshot {
  /** False when the branch has no credit profile for this customer yet. */
  hasProfile: boolean
  limitMinor: number
  balanceMinor: number
  /** Sum of unacked `local_credit_delta` charges. */
  pendingMinor: number
  hold: boolean
}

export const EMPTY_CREDIT: CreditSnapshot = {
  hasProfile: false,
  limitMinor: 0,
  balanceMinor: 0,
  pendingMinor: 0,
  hold: false,
}

function safe(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) ? value : 0
}

/** What this customer can still take on credit at this branch. */
export function creditHeadroom(snapshot: CreditSnapshot): number {
  return safe(snapshot.limitMinor) - (safe(snapshot.balanceMinor) + safe(snapshot.pendingMinor))
}

export function creditUsed(snapshot: CreditSnapshot): number {
  return safe(snapshot.balanceMinor) + safe(snapshot.pendingMinor)
}

/** The amount by which a charge exceeds the headroom (0 when it fits). */
export function overLimitMinor(snapshot: CreditSnapshot, amountMinor: number): number {
  const overBy = safe(amountMinor) - creditHeadroom(snapshot)
  return overBy > 0 ? overBy : 0
}
