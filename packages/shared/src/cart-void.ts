/**
 * A voided cart carries no money and needs no PIN; it carries a reason so the
 * console can report shrink instead of hiding it. One vocabulary here keeps the
 * till's dialog and the future report from drifting apart.
 */

export const CART_VOID_REASONS = [
  'CUSTOMER_CHANGED_MIND',
  'WRONG_ITEM',
  'PRICE_DISPUTE',
  'DUPLICATE_SCAN',
  'CUSTOMER_LEFT',
  'OTHER',
] as const
export type CartVoidReason = (typeof CART_VOID_REASONS)[number]

export const CART_VOID_REASON_LABELS: Record<CartVoidReason, string> = {
  CUSTOMER_CHANGED_MIND: 'Customer changed their mind',
  WRONG_ITEM: 'Wrong item',
  PRICE_DISPUTE: 'Price dispute',
  DUPLICATE_SCAN: 'Duplicate scan',
  CUSTOMER_LEFT: 'Customer left',
  OTHER: 'Other',
}

/** `OTHER` is the only reason that needs a note (P13-D28). */
export function cartVoidNeedsNote(reason: CartVoidReason): boolean {
  return reason === 'OTHER'
}

/** The shortest note that says anything useful. */
export const CART_VOID_NOTE_MIN = 3

/**
 * Returns the sentence to show the cashier, or `null` when the reason and note
 * are a valid pairing. A note supplied for a coded reason is accepted: it is
 * context, not a second reason.
 */
export function cartVoidNoteProblem(reason: CartVoidReason, note: string | null): string | null {
  if (!cartVoidNeedsNote(reason)) return null
  if ((note ?? '').trim().length < CART_VOID_NOTE_MIN) {
    return `Say why in a few words — at least ${CART_VOID_NOTE_MIN} characters`
  }
  return null
}
