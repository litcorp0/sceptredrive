import { describe, expect, it } from 'vitest'
import { creditHeadroom, creditUsed, EMPTY_CREDIT, overLimitMinor } from './headroom'

describe('credit headroom', () => {
  it('is limit minus balance minus pending charges', () => {
    expect(
      creditHeadroom({
        hasProfile: true,
        limitMinor: 50_000,
        balanceMinor: 12_000,
        pendingMinor: 3_000,
        hold: false,
      }),
    ).toBe(35_000)
  })

  it('counts unsynced charges so headroom cannot be spent twice offline', () => {
    const snapshot = {
      hasProfile: true,
      limitMinor: 50_000,
      balanceMinor: 0,
      pendingMinor: 45_000,
      hold: false,
    }
    expect(creditHeadroom(snapshot)).toBe(5_000)
    expect(overLimitMinor(snapshot, 20_000)).toBe(15_000)
  })

  it('can be negative when the balance already exceeds the limit', () => {
    expect(
      creditHeadroom({
        hasProfile: true,
        limitMinor: 10_000,
        balanceMinor: 15_000,
        pendingMinor: 0,
        hold: false,
      }),
    ).toBe(-5_000)
  })

  it('is zero without a profile', () => {
    expect(creditHeadroom(EMPTY_CREDIT)).toBe(0)
    expect(overLimitMinor(EMPTY_CREDIT, 100)).toBe(100)
  })

  it('reports no overage when the charge fits', () => {
    const snapshot = {
      hasProfile: true,
      limitMinor: 10_000,
      balanceMinor: 0,
      pendingMinor: 0,
      hold: false,
    }
    expect(overLimitMinor(snapshot, 10_000)).toBe(0)
    expect(overLimitMinor(snapshot, 9_999)).toBe(0)
    expect(overLimitMinor(snapshot, 10_001)).toBe(1)
  })

  it('sums balance and pending for the "used" figure', () => {
    expect(
      creditUsed({
        hasProfile: true,
        limitMinor: 0,
        balanceMinor: 1_000,
        pendingMinor: 250,
        hold: false,
      }),
    ).toBe(1_250)
  })

  it('ignores non-integer input instead of producing NaN', () => {
    expect(
      creditHeadroom({
        hasProfile: true,
        limitMinor: Number.NaN,
        balanceMinor: 100,
        pendingMinor: 0,
        hold: false,
      }),
    ).toBe(-100)
  })
})
