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

export type CreditDecision = 'OK' | 'OVER_LIMIT' | 'HOLD' | 'NO_PROFILE' | 'NO_CUSTOMER'

/**
 * What the terminal can do for this cart without asking a manager.
 *
 * A missing profile is not "denied": the server bootstraps one on the first
 * charge, so an over-limit approval is legitimate — the office has simply not
 * set a limit yet.
 */
export function creditDecision(input: {
  hasCustomer: boolean
  snapshot: CreditSnapshot
  amountMinor: number
}): CreditDecision {
  if (!input.hasCustomer) return 'NO_CUSTOMER'
  if (input.snapshot.hold) return 'HOLD'
  if (!input.snapshot.hasProfile) return 'NO_PROFILE'
  return safe(input.amountMinor) > creditHeadroom(input.snapshot) ? 'OVER_LIMIT' : 'OK'
}

export const CREDIT_DECISION_MESSAGES: Record<CreditDecision, string> = {
  OK: 'Within the credit limit',
  OVER_LIMIT: 'Over the credit limit',
  HOLD: 'Account is on hold',
  NO_PROFILE: 'No credit account at this branch yet',
  NO_CUSTOMER: 'Choose a customer to sell on credit',
}
