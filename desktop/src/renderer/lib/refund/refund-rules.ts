import { CART_VOID_NOTE_MIN, type RefundReason } from '@sceptre/shared'

/**
 * The refund's own copy rules, kept beside the pricing so the screen and the
 * write path cannot disagree about when a document is complete.
 *
 * `OTHER` is the only reason that needs a note, and it uses the same minimum as
 * a cart void: one free-text bar at the till, measured the same way
 * (`cart-void.ts`). A note supplied for a coded reason is context, not a second
 * reason, and is kept.
 */

export const REFUND_NOTE_MIN = CART_VOID_NOTE_MIN

export function refundNoteProblem(reason: RefundReason, note: string | null): string | null {
  if (reason !== 'OTHER') return null
  if ((note ?? '').trim().length < REFUND_NOTE_MIN) {
    return `Say why in a few words — at least ${REFUND_NOTE_MIN} characters`
  }
  return null
}
