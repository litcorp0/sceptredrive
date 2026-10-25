import { describe, expect, it } from 'vitest'
import { BASIS_POINT_SCALE, deltaBp, formatBasisPoints, ratioBp } from './percent.ts'

describe('deltaBp', () => {
  it('returns null, not zero, when there is no previous period', () => {
    expect(deltaBp(0, 0)).toBeNull()
    expect(deltaBp(0, 25_000)).toBeNull()
  })

  it('expresses growth and decline in basis points', () => {
    expect(deltaBp(10_000, 11_000)).toBe(1_000)
    expect(deltaBp(10_000, 9_000)).toBe(-1_000)
    expect(deltaBp(20_000, 22_480)).toBe(1_240)
  })

  it('reports zero change as zero', () => {
    expect(deltaBp(12_345, 12_345)).toBe(0)
    expect(Object.is(deltaBp(12_345, 12_345), -0)).toBe(false)
  })

  it('rounds half away from zero exactly, without a float step', () => {
    // 1/20000 = 0.005% = 0.5 bp, which rounds to 1 bp.
    expect(deltaBp(20_000, 20_001)).toBe(1)
    expect(deltaBp(20_001, 20_000)).toBe(0)
    expect(deltaBp(150, 151)).toBe(67)
    expect(deltaBp(3, 4)).toBe(3_333)
  })

  it('handles a decline to zero', () => {
    expect(deltaBp(5_000, 0)).toBe(-10_000)
  })

  it('rejects non-integer input rather than rounding it silently', () => {
    expect(() => deltaBp(10.5, 20)).toThrow(TypeError)
    expect(() => deltaBp(10, Number.NaN)).toThrow(TypeError)
  })
})

describe('ratioBp', () => {
  it('returns null when the whole is zero', () => {
    expect(ratioBp(0, 0)).toBeNull()
    expect(ratioBp(500, 0)).toBeNull()
  })

  it('expresses a share, including above 100%', () => {
    expect(ratioBp(100, 100)).toBe(BASIS_POINT_SCALE)
    expect(ratioBp(1, 3)).toBe(3_333)
    expect(ratioBp(15_000, 10_000)).toBe(15_000)
  })

  it('preserves a negative direction', () => {
    expect(ratioBp(-2_500, 10_000)).toBe(-2_500)
  })

  it('rounds the half case away from zero', () => {
    expect(ratioBp(1, 20_000)).toBe(1)
    expect(ratioBp(-1, 20_000)).toBe(-1)
  })
})

describe('formatBasisPoints', () => {
  it('prints a signed percentage with two decimals', () => {
    expect(formatBasisPoints(1_240)).toBe('+12.40%')
    expect(formatBasisPoints(-310)).toBe('-3.10%')
    expect(formatBasisPoints(0)).toBe('0.00%')
    expect(formatBasisPoints(5)).toBe('+0.05%')
    expect(formatBasisPoints(-1)).toBe('-0.01%')
  })

  it('renders a dash when there is no comparison', () => {
    expect(formatBasisPoints(null)).toBe('—')
  })

  it('survives values beyond a safe integer by refusing them', () => {
    expect(formatBasisPoints(Number.MAX_SAFE_INTEGER + 2)).toBe('—')
    expect(formatBasisPoints(Number.NaN)).toBe('—')
  })
})
