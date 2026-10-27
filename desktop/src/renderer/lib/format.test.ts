import { describe, expect, it } from 'vitest'
import { formatGhs, formatMinorPlain, formatMinorWithSymbol, parseGhsToMinor } from './format'
import {
  accraDay,
  computeExpectedCash,
  computeVariance,
  formatShiftNumber,
} from './shift/shift-service'

describe('money formatting', () => {
  it('renders integer pesewas as cedis', () => {
    expect(formatGhs(0)).toContain('0.00')
    expect(formatGhs(22_500)).toContain('225.00')
    expect(formatGhs(-500)).toContain('-')
    expect(formatGhs(-500)).toContain('5.00')
  })

  it('parses typed amounts into integer pesewas', () => {
    expect(parseGhsToMinor('12')).toBe(1200)
    expect(parseGhsToMinor('12.5')).toBe(1250)
    expect(parseGhsToMinor('12.50')).toBe(1250)
    expect(parseGhsToMinor('1,234.05')).toBe(123_405)
    expect(parseGhsToMinor('12.505')).toBeNull()
    expect(parseGhsToMinor('-1')).toBeNull()
    expect(parseGhsToMinor('abc')).toBeNull()
    expect(parseGhsToMinor('')).toBeNull()
  })

  it('formats receipt money without a float round-trip', () => {
    expect(formatMinorPlain(0)).toBe('0.00')
    expect(formatMinorPlain(5)).toBe('0.05')
    expect(formatMinorPlain(1234)).toBe('12.34')
    expect(formatMinorPlain(1_000_000)).toBe('10000.00')
    expect(formatMinorPlain(-500)).toBe('-5.00')
    expect(formatMinorWithSymbol(26_500, 'GHS')).toBe('GHS 265.00')
    expect(formatMinorWithSymbol(26_500, 'GH₵')).toBe('GH₵ 265.00')
  })
})

describe('shift arithmetic', () => {
  it('formats terminal-scoped shift numbers', () => {
    expect(formatShiftNumber('ACC-SPX-T01', '20261022', 7)).toBe('ACC-SPX-T01-S-20261022-07')
    expect(formatShiftNumber('ACC-SPX-T01', '20261022', 12)).toBe('ACC-SPX-T01-S-20261022-12')
  })

  it('derives the Accra day from UTC (Ghana has no DST)', () => {
    expect(accraDay(new Date('2026-10-22T00:00:00Z'))).toBe('20261022')
    expect(accraDay(new Date('2026-10-22T23:59:59Z'))).toBe('20261022')
    expect(accraDay(new Date('2026-10-23T00:00:01Z'))).toBe('20261023')
  })

  it('computes expected cash and variance', () => {
    const expected = computeExpectedCash({
      openingFloatMinor: 20_000,
      cashTendersMinor: 22_500,
      changeMinor: 7_500,
      cashInMinor: 5_000,
      cashOutMinor: 2_000,
      cashRefundsMinor: 0,
    })
    expect(expected).toBe(38_000)
    expect(computeVariance(22_500, 23_000)).toBe(-500)
    expect(computeVariance(23_000, 23_000)).toBe(0)
    expect(computeVariance(24_000, 23_000)).toBe(1_000)
  })
})
