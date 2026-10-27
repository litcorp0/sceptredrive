/**
 * The conflict resolution vocabulary (P14-D13/P14-D14).
 *
 * A resolution is a record, not a repair: it writes a status, a code, a note,
 * an actor and a time against the conflict and never touches the sale, refund,
 * shift or ledger it points at. The labels live here so the console and the API
 * cannot name the same status two ways.
 */

export const CONFLICT_RESOLUTION_CODES = [
  'CONFIRMED', // the conflict is real and the fact stands
  'CORRECTED_ELSEWHERE', // a compensating document already handled it
  'ACCEPTED_RISK', // known, tolerated, recorded
  'TILL_INSTRUCTION', // the branch was told what to do at the counter
  'DUPLICATE', // the same fact, recorded twice
] as const

export type ConflictResolutionCode = (typeof CONFLICT_RESOLUTION_CODES)[number]

export const CONFLICT_RESOLUTION_LABELS: Record<ConflictResolutionCode, string> = {
  CONFIRMED: 'Confirmed',
  CORRECTED_ELSEWHERE: 'Corrected elsewhere',
  ACCEPTED_RISK: 'Accepted risk',
  TILL_INSTRUCTION: 'Till instruction',
  DUPLICATE: 'Duplicate',
}

/**
 * The 16 `sync_conflict_type` names in words. Listed rather than derived from
 * the string because acronyms like `MOMO` do not survive a generic title-caser.
 */
export const CONFLICT_TYPE_LABELS: Record<string, string> = {
  STOCK_OVERSELL: 'Stock oversell',
  CREDIT_OVER_LIMIT: 'Credit over limit',
  CREDIT_HOLD: 'Credit hold',
  LOYALTY_NEGATIVE: 'Loyalty balance negative',
  LOYALTY_RATE_CHANGED: 'Loyalty rate changed',
  PRICE_MISMATCH: 'Price mismatch',
  TOTAL_MISMATCH: 'Total mismatch',
  SHIFT_VARIANCE_MISMATCH: 'Shift variance mismatch',
  STALE_CREDENTIALS: 'Stale credentials',
  OVERRIDE_INVALID: 'Override invalid',
  DUPLICATE_CUSTOMER: 'Duplicate customer',
  CLOCK_SKEW: 'Clock skew',
  INVALID_CUSTOMER: 'Invalid customer',
  UNKNOWN_PRODUCT: 'Unknown product',
  PAYMENT_LATE_SETTLEMENT: 'Payment settled late',
  PAYMENT_AMOUNT_MISMATCH: 'Payment amount mismatch',
}

export const CONFLICT_SEVERITY_LABELS: Record<'LOW' | 'MEDIUM' | 'HIGH', string> = {
  LOW: 'Low',
  MEDIUM: 'Medium',
  HIGH: 'High',
}

function isBlank(value: string | null): boolean {
  return value === null || value.trim().length === 0
}

/**
 * Null when the resolution is complete, a sentence when it is not (P14-D14).
 *
 * `RESOLVED` needs a code; `DISMISSED` needs a code and a note. This is the only
 * place the rule lives, so the API and the console cannot disagree about when
 * the button is enabled.
 */
export function resolutionProblem(input: {
  status: 'RESOLVED' | 'DISMISSED'
  code: string | null
  note: string | null
}): string | null {
  if (isBlank(input.code)) {
    return 'A resolution needs a code: record what happened before closing the conflict.'
  }
  if (input.status === 'DISMISSED' && isBlank(input.note)) {
    return 'A dismissal needs a note: explain why the conflict is not a real problem.'
  }
  return null
}
