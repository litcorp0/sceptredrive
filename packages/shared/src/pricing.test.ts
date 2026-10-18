import { describe, expect, it } from 'vitest'
import { isValidPriceMinor, resolveEffectivePrice } from './pricing.ts'

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
