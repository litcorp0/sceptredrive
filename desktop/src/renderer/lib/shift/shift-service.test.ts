import { describe, expect, it } from 'vitest'
import { computeExpectedCash, computeVariance } from './shift-service'

/**
 * Expected cash (P13-D32).
 *
 * The drawer formula has to net off a settled cash refund: the money is gone
 * from the till even though no sale in the shift ever paid it back in. A
 * refund that never used cash must change nothing.
 */

describe('computeExpectedCash', () => {
  it('subtracts a settled cash refund from the drawer it left', () => {
    const expected = computeExpectedCash({
      openingFloatMinor: 20_000,
      cashTendersMinor: 180_000,
      changeMinor: 0,
      cashInMinor: 10_000,
      cashOutMinor: 0,
      cashRefundsMinor: 50_000,
    })

    // 20 000 + 180 000 − 0 + 10 000 − 0 − 50 000
    expect(expected).toBe(160_000)
    expect(
      computeVariance(160_000, expected),
      'a drawer counted at the formula disagrees by nothing',
    ).toBe(0)
  })

  it('leaves the drawer alone when the shift paid no cash refund', () => {
    expect(
      computeExpectedCash({
        openingFloatMinor: 20_000,
        cashTendersMinor: 180_000,
        changeMinor: 0,
        cashInMinor: 10_000,
        cashOutMinor: 0,
        cashRefundsMinor: 0,
      }),
    ).toBe(210_000)
  })
})
