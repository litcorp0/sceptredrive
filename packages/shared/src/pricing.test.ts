import { describe, expect, it } from 'vitest'
import {
  isValidPriceMinor,
  priceBandBounds,
  resolveEffectivePrice,
  withinPriceBand,
} from './pricing.ts'

describe('isValidPriceMinor', () => {
  it('accepts non-negative safe integers', () => {
    expect(isValidPriceMinor(0)).toBe(true)
    expect(isValidPriceMinor(1_234_567)).toBe(true)
    expect(isValidPriceMinor(Number.MAX_SAFE_INTEGER)).toBe(true)
  })

  it('rejects negatives, fractions, and non-numbers', () => {
    expect(isValidPriceMinor(-1)).toBe(false)
    expect(isValidPriceMinor(10.5)).toBe(false)
    expect(isValidPriceMinor(Number.NaN)).toBe(false)
    expect(isValidPriceMinor(Number.POSITIVE_INFINITY)).toBe(false)
    expect(isValidPriceMinor(Number.MAX_SAFE_INTEGER + 1)).toBe(false)
    expect(isValidPriceMinor('100')).toBe(false)
    expect(isValidPriceMinor(null)).toBe(false)
    expect(isValidPriceMinor(undefined)).toBe(false)
  })
})

describe('resolveEffectivePrice', () => {
  it('returns the override when one is set', () => {
    expect(resolveEffectivePrice(10_000, 9_500)).toBe(9_500)
  })

  it('falls back to the base price when the override is null or undefined', () => {
    expect(resolveEffectivePrice(10_000, null)).toBe(10_000)
    expect(resolveEffectivePrice(10_000, undefined)).toBe(10_000)
  })

  it('allows a zero base price and a zero override', () => {
    expect(resolveEffectivePrice(0, null)).toBe(0)
    expect(resolveEffectivePrice(10_000, 0)).toBe(0)
  })

  it('rejects invalid base prices', () => {
    expect(() => resolveEffectivePrice(-1, null)).toThrow(TypeError)
    expect(() => resolveEffectivePrice(1.5, null)).toThrow(TypeError)
    expect(() => resolveEffectivePrice(Number.NaN, null)).toThrow(TypeError)
  })

  it('rejects invalid overrides', () => {
    expect(() => resolveEffectivePrice(10_000, -1)).toThrow(TypeError)
    expect(() => resolveEffectivePrice(10_000, 10.5)).toThrow(TypeError)
    expect(() => resolveEffectivePrice(10_000, Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })
})

describe('withinPriceBand', () => {
  it('admits a change exactly at the band edge', () => {
    expect(withinPriceBand(10_000, 11_000, 10)).toBe(true)
    expect(withinPriceBand(10_000, 9_000, 10)).toBe(true)
  })

  it('refuses one pesewa beyond the edge', () => {
    expect(withinPriceBand(10_000, 11_001, 10)).toBe(false)
    expect(withinPriceBand(10_000, 8_999, 10)).toBe(false)
  })

  it('floors the allowance, so the band is an integer window', () => {
    // 10% of 999 is 99.9 pesewas; the largest allowed change is 99.
    expect(withinPriceBand(999, 1_098, 10)).toBe(true)
    expect(withinPriceBand(999, 1_099, 10)).toBe(false)
    expect(withinPriceBand(999, 900, 10)).toBe(true)
    expect(withinPriceBand(999, 899, 10)).toBe(false)
  })

  it('admits only an unchanged price when the percent is zero', () => {
    expect(withinPriceBand(10_000, 10_000, 0)).toBe(true)
    expect(withinPriceBand(10_000, 10_001, 0)).toBe(false)
    expect(withinPriceBand(10_000, 9_999, 0)).toBe(false)
  })

  it('admits only a zero proposal when the current price is zero', () => {
    expect(withinPriceBand(0, 0, 10)).toBe(true)
    expect(withinPriceBand(0, 1, 10)).toBe(false)
    expect(withinPriceBand(0, 10_000, 100)).toBe(false)
  })

  it('handles a 100 percent band', () => {
    expect(withinPriceBand(10_000, 20_000, 100)).toBe(true)
    expect(withinPriceBand(10_000, 20_001, 100)).toBe(false)
  })

  it('rejects non-integer, negative, and out-of-range input', () => {
    expect(() => withinPriceBand(-1, 0, 10)).toThrow(TypeError)
    expect(() => withinPriceBand(1.5, 1, 10)).toThrow(TypeError)
    expect(() => withinPriceBand(Number.NaN, 1, 10)).toThrow(TypeError)
    expect(() => withinPriceBand(10_000, -1, 10)).toThrow(TypeError)
    expect(() => withinPriceBand(10_000, 10.5, 10)).toThrow(TypeError)
    expect(() => withinPriceBand(10_000, 10_000, -1)).toThrow(TypeError)
    expect(() => withinPriceBand(10_000, 10_000, 101)).toThrow(TypeError)
    expect(() => withinPriceBand(10_000, 10_000, 10.5)).toThrow(TypeError)
    expect(() => withinPriceBand(10_000, 10_000, Number.NaN)).toThrow(TypeError)
  })
})

describe('priceBandBounds', () => {
  it('derives the inclusive window from the same rule', () => {
    expect(priceBandBounds(10_000, 10)).toEqual({ minMinor: 9_000, maxMinor: 11_000 })
    expect(priceBandBounds(999, 10)).toEqual({ minMinor: 900, maxMinor: 1_098 })
  })

  it('collapses to the current price at a zero percent or zero price', () => {
    expect(priceBandBounds(10_000, 0)).toEqual({ minMinor: 10_000, maxMinor: 10_000 })
    expect(priceBandBounds(0, 10)).toEqual({ minMinor: 0, maxMinor: 0 })
  })

  it('agrees with withinPriceBand at both edges', () => {
    const { minMinor, maxMinor } = priceBandBounds(12_345, 10)
    expect(withinPriceBand(12_345, maxMinor, 10)).toBe(true)
    expect(withinPriceBand(12_345, maxMinor + 1, 10)).toBe(false)
    expect(withinPriceBand(12_345, minMinor, 10)).toBe(true)
    expect(withinPriceBand(12_345, minMinor - 1, 10)).toBe(false)
  })

  it('rejects non-integer, negative, and out-of-range input', () => {
    expect(() => priceBandBounds(-1, 10)).toThrow(TypeError)
    expect(() => priceBandBounds(10.5, 10)).toThrow(TypeError)
    expect(() => priceBandBounds(10_000, -1)).toThrow(TypeError)
    expect(() => priceBandBounds(10_000, 101)).toThrow(TypeError)
    expect(() => priceBandBounds(10_000, 10.5)).toThrow(TypeError)
  })
})
