import { describe, expect, it } from 'vitest'
import {
  isFullyRedeemed,
  quoteRedemption,
  REDEEM_ABOVE_BALANCE,
  REDEEM_BELOW_MINIMUM,
  REDEEM_INVALID_POINTS,
} from './quote'

const base = {
  pointsPerCedi: 100,
  minimumRedeemPoints: 100,
  availablePoints: 1_000,
  cartNetMinor: 10_000,
}

describe('quoteRedemption', () => {
  it('values points at the current rate', () => {
    const quote = quoteRedemption({ ...base, points: 250 })
    expect(quote.valueMinor).toBe(250)
    expect(quote.appliedMinor).toBe(250)
    expect(quote.problem).toBeNull()
  })

  it('accepts zero as "no redemption"', () => {
    const quote = quoteRedemption({ ...base, points: 0 })
    expect(quote.problem).toBeNull()
    expect(quote.appliedMinor).toBe(0)
  })

  it('rejects a positive amount below the minimum', () => {
    const quote = quoteRedemption({ ...base, points: 99 })
    expect(quote.problem).toBe(REDEEM_BELOW_MINIMUM)
  })

  it('accepts exactly the minimum', () => {
    expect(quoteRedemption({ ...base, points: 100 }).problem).toBeNull()
  })

  it('rejects more than the balance', () => {
    expect(quoteRedemption({ ...base, points: 1_001 }).problem).toBe(REDEEM_ABOVE_BALANCE)
  })

  it('accepts exactly the balance', () => {
    expect(quoteRedemption({ ...base, points: 1_000 }).problem).toBeNull()
  })

  it('rejects fractional or negative points', () => {
    expect(quoteRedemption({ ...base, points: 12.5 }).problem).toBe(REDEEM_INVALID_POINTS)
    expect(quoteRedemption({ ...base, points: -1 }).problem).toBe(REDEEM_INVALID_POINTS)
  })

  it('caps the applied value at the cart net so the total cannot go negative', () => {
    const quote = quoteRedemption({ ...base, points: 1_000, cartNetMinor: 500 })
    expect(quote.valueMinor).toBe(1_000)
    expect(quote.appliedMinor).toBe(500)
  })

  it('offers the most points the cart and balance allow', () => {
    expect(quoteRedemption({ ...base, points: 0, cartNetMinor: 500 }).maxPoints).toBe(500)
    expect(
      quoteRedemption({ ...base, points: 0, availablePoints: 200, cartNetMinor: 10_000 }).maxPoints,
    ).toBe(200)
    expect(quoteRedemption({ ...base, points: 0, cartNetMinor: 0 }).maxPoints).toBe(0)
  })

  it('still reports a problem-free zero when the cart is empty', () => {
    const quote = quoteRedemption({ ...base, points: 100, cartNetMinor: 0 })
    expect(quote.problem).toBeNull()
    expect(quote.appliedMinor).toBe(0)
  })
})

describe('isFullyRedeemed', () => {
  it('detects a zero-total sale', () => {
    expect(isFullyRedeemed(1_000, 1_000)).toBe(true)
    expect(isFullyRedeemed(1_000, 999)).toBe(true)
    expect(isFullyRedeemed(999, 1_000)).toBe(false)
    expect(isFullyRedeemed(0, 0)).toBe(false)
  })
})
