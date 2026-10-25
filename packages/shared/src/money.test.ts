import { describe, expect, it } from 'vitest'
import { averageBasketMinor } from './money.ts'

describe('averageBasketMinor', () => {
  it('returns zero when there are no sales, not NaN or Infinity', () => {
    expect(averageBasketMinor(0, 0)).toBe(0)
    expect(Object.is(averageBasketMinor(0, 0), -0)).toBe(false)
  })

  it('returns the take unchanged for a single sale', () => {
    expect(averageBasketMinor(15_000, 1)).toBe(15_000)
  })

  it('divides exactly when the take splits evenly', () => {
    expect(averageBasketMinor(24_500, 2)).toBe(12_250)
  })

  it('rounds the basket once, half up', () => {
    // 33.33 -> 33 and 66.67 -> 67: the remainder is dropped, never carried into a float.
    expect(averageBasketMinor(100, 3)).toBe(33)
    expect(averageBasketMinor(200, 3)).toBe(67)
    expect(averageBasketMinor(50, 4)).toBe(13)
  })

  it('loses nothing before the final round at the top of the safe range', () => {
    expect(averageBasketMinor(Number.MAX_SAFE_INTEGER, 1)).toBe(Number.MAX_SAFE_INTEGER)
    expect(averageBasketMinor(9_000_000_000_000_000, 3)).toBe(3_000_000_000_000_000)
    expect(averageBasketMinor(9_000_000_000_000_002, 2)).toBe(4_500_000_000_000_001)
  })

  it('rejects a negative take or count instead of producing a negative basket', () => {
    expect(() => averageBasketMinor(-1, 1)).toThrow(TypeError)
    expect(() => averageBasketMinor(15_000, -1)).toThrow(TypeError)
  })

  it('rejects negative zero, which is a sign bug rather than a count', () => {
    expect(() => averageBasketMinor(15_000, -0)).toThrow(TypeError)
    expect(() => averageBasketMinor(-0, 1)).toThrow(TypeError)
  })

  it('rejects non-integer and non-finite input rather than rounding it silently', () => {
    expect(() => averageBasketMinor(10.5, 1)).toThrow(TypeError)
    expect(() => averageBasketMinor(15_000, 2.5)).toThrow(TypeError)
    expect(() => averageBasketMinor(Number.NaN, 1)).toThrow(TypeError)
    expect(() => averageBasketMinor(15_000, Number.NaN)).toThrow(TypeError)
    expect(() => averageBasketMinor(Number.POSITIVE_INFINITY, 1)).toThrow(TypeError)
    expect(() => averageBasketMinor(15_000, Number.POSITIVE_INFINITY)).toThrow(TypeError)
  })
})
