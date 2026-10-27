import { describe, expect, it } from 'vitest'
import {
  accraClock,
  canAttachToCart,
  orphanSentence,
  parseOrphanConflicts,
} from './payment-attention'

/**
 * The banner must never invent an amount, a method or a reference: a cashier
 * reads it to decide what to do with a customer's money.
 */

const DETAILS = JSON.stringify({
  paymentId: 'pay_1',
  providerReference: 'sd-cp_1',
  terminalId: 'term_1',
  method: 'MOMO',
  amountMinor: 5_000,
  providerPaidAt: '2026-10-27T14:32:00.000Z',
})

describe('parseOrphanConflicts', () => {
  it('reads the allowlisted projection into an actionable orphan', () => {
    const [orphan] = parseOrphanConflicts([
      { id: 'conflict_1', details: DETAILS, created_at: '2026-10-27T14:33:00.000Z' },
    ])

    expect(orphan).toEqual({
      conflictId: 'conflict_1',
      paymentId: 'pay_1',
      providerReference: 'sd-cp_1',
      method: 'MOMO',
      amountMinor: 5_000,
      paidAt: '2026-10-27T14:32:00.000Z',
      createdAt: '2026-10-27T14:33:00.000Z',
    })
  })

  it('drops a row with no payment id, a bad amount, or an unknown method', () => {
    expect(
      parseOrphanConflicts([
        { id: 'a', details: '{}', created_at: '2026-10-27T14:33:00.000Z' },
        { id: 'b', details: 'not json', created_at: '2026-10-27T14:33:00.000Z' },
        {
          id: 'c',
          details: JSON.stringify({ ...JSON.parse(DETAILS), amountMinor: 0 }),
          created_at: '2026-10-27T14:33:00.000Z',
        },
        {
          id: 'd',
          details: JSON.stringify({ ...JSON.parse(DETAILS), method: 'CASH' }),
          created_at: '2026-10-27T14:33:00.000Z',
        },
      ]),
    ).toEqual([])
  })

  it('hides a payment that a cart or a sale already references', () => {
    const orphans = parseOrphanConflicts(
      [{ id: 'conflict_1', details: DETAILS, created_at: '2026-10-27T14:33:00.000Z' }],
      new Set(['pay_1']),
    )
    expect(orphans).toEqual([])
  })
})

describe('orphanSentence', () => {
  it('says what happened, in money and a clock time', () => {
    const [orphan] = parseOrphanConflicts([
      { id: 'conflict_1', details: DETAILS, created_at: '2026-10-27T14:33:00.000Z' },
    ])
    if (!orphan) throw new Error('expected an orphan')
    expect(orphanSentence(orphan)).toBe('Payment received without a sale — GH₵50.00 MoMo, 14:32')
  })

  it('falls back to the conflict time when the provider gave none', () => {
    const details = JSON.stringify({ ...JSON.parse(DETAILS), providerPaidAt: null })
    const [orphan] = parseOrphanConflicts([
      { id: 'conflict_1', details, created_at: '2026-10-27T09:05:00.000Z' },
    ])
    if (!orphan) throw new Error('expected an orphan')
    expect(orphanSentence(orphan)).toContain('09:05')
  })

  it('returns null for an unparseable instant rather than a wrong time', () => {
    expect(accraClock('not a date')).toBeNull()
    expect(accraClock(null)).toBeNull()
  })
})

describe('canAttachToCart', () => {
  it('allows the attachment only when the cart owes exactly the amount', () => {
    expect(canAttachToCart(5_000, 5_000)).toBe(true)
    expect(canAttachToCart(5_000, 4_999)).toBe(false)
    expect(canAttachToCart(5_000, null)).toBe(false)
    expect(canAttachToCart(0, 0)).toBe(false)
  })
})
