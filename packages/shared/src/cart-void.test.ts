import { describe, expect, it } from 'vitest'
import {
  CART_VOID_NOTE_MIN,
  CART_VOID_REASON_LABELS,
  CART_VOID_REASONS,
  type CartVoidReason,
  cartVoidNeedsNote,
  cartVoidNoteProblem,
} from './cart-void.ts'

const NOTE_REQUIRED = `Say why in a few words — at least ${CART_VOID_NOTE_MIN} characters`

describe('cart void reasons', () => {
  it('lists every reason with a label', () => {
    expect(CART_VOID_REASONS).toEqual([
      'CUSTOMER_CHANGED_MIND',
      'WRONG_ITEM',
      'PRICE_DISPUTE',
      'DUPLICATE_SCAN',
      'CUSTOMER_LEFT',
      'OTHER',
    ])
    expect(CART_VOID_NOTE_MIN).toBe(3)

    for (const reason of CART_VOID_REASONS) {
      expect(CART_VOID_REASON_LABELS[reason].length).toBeGreaterThan(0)
    }
  })

  it('needs a note only for OTHER', () => {
    expect(cartVoidNeedsNote('OTHER')).toBe(true)
    for (const reason of CART_VOID_REASONS) {
      if (reason === 'OTHER') continue
      expect(cartVoidNeedsNote(reason)).toBe(false)
    }
  })

  it('refuses OTHER with no note', () => {
    expect(cartVoidNoteProblem('OTHER', null)).toBe(NOTE_REQUIRED)
    expect(cartVoidNoteProblem('OTHER', '')).toBe(NOTE_REQUIRED)
  })

  it(`refuses OTHER with fewer than ${CART_VOID_NOTE_MIN} characters after trimming`, () => {
    expect(cartVoidNoteProblem('OTHER', 'ab')).toBe(NOTE_REQUIRED)
    expect(cartVoidNoteProblem('OTHER', '  ab  ')).toBe(NOTE_REQUIRED)
  })

  it(`accepts OTHER with exactly ${CART_VOID_NOTE_MIN} characters after trimming`, () => {
    expect(cartVoidNoteProblem('OTHER', 'abc')).toBeNull()
    expect(cartVoidNoteProblem('OTHER', '  abc  ')).toBeNull()
  })

  it('accepts every other reason with no note at all', () => {
    const others: CartVoidReason[] = CART_VOID_REASONS.filter((reason) => reason !== 'OTHER')

    for (const reason of others) {
      expect(cartVoidNoteProblem(reason, null)).toBeNull()
      expect(cartVoidNoteProblem(reason, '')).toBeNull()
    }
  })

  it('does not reject a note supplied for a reason that does not need one', () => {
    expect(cartVoidNoteProblem('WRONG_ITEM', 'scanned twice')).toBeNull()
  })
})
