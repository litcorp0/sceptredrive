import { describe, expect, it } from 'vitest'
import {
  abcClassFromShare,
  advanceDueDate,
  COUNT_FREQUENCIES,
  type CountFrequency,
  countAccuracyBp,
  isCountOnTime,
  rotationBatchSize,
} from './counting.ts'

describe('COUNT_FREQUENCIES', () => {
  it('declares the four schedule frequencies exactly once each', () => {
    expect(COUNT_FREQUENCIES).toEqual(['WEEKLY', 'MONTHLY', 'QUARTERLY', 'BIANNUAL'])
    expect(new Set(COUNT_FREQUENCIES).size).toBe(COUNT_FREQUENCIES.length)
  })
})

describe('advanceDueDate', () => {
  it('adds a week across a year boundary', () => {
    expect(advanceDueDate('2026-12-28', 'WEEKLY')).toBe('2027-01-04')
    expect(advanceDueDate('2026-10-26', 'WEEKLY')).toBe('2026-11-02')
    expect(advanceDueDate('2026-02-28', 'WEEKLY')).toBe('2026-03-07')
    expect(advanceDueDate('2028-02-29', 'WEEKLY')).toBe('2028-03-07')
  })

  it('adds a month and clamps to the target month length', () => {
    expect(advanceDueDate('2026-01-31', 'MONTHLY')).toBe('2026-02-28')
    expect(advanceDueDate('2028-01-31', 'MONTHLY')).toBe('2028-02-29')
    expect(advanceDueDate('2026-03-31', 'MONTHLY')).toBe('2026-04-30')
    expect(advanceDueDate('2026-02-28', 'MONTHLY')).toBe('2026-03-28')
    expect(advanceDueDate('2026-12-15', 'MONTHLY')).toBe('2027-01-15')
  })

  it('adds a quarter', () => {
    expect(advanceDueDate('2026-11-15', 'QUARTERLY')).toBe('2027-02-15')
    expect(advanceDueDate('2026-08-31', 'QUARTERLY')).toBe('2026-11-30')
  })

  it('adds half a year', () => {
    expect(advanceDueDate('2026-12-31', 'BIANNUAL')).toBe('2027-06-30')
    expect(advanceDueDate('2026-06-30', 'BIANNUAL')).toBe('2026-12-30')
  })

  it('never drifts a day when the input is a bare calendar day', () => {
    // A `YYYY-MM-DD` string parses as local midnight; this arithmetic must not.
    expect(advanceDueDate('2026-10-24', 'MONTHLY')).toBe('2026-11-24')
    expect(advanceDueDate('2026-03-01', 'WEEKLY')).toBe('2026-03-08')
  })

  it('rejects a malformed or impossible calendar day', () => {
    expect(() => advanceDueDate('2026-1-31', 'MONTHLY')).toThrow(TypeError)
    expect(() => advanceDueDate('2026/01/31', 'MONTHLY')).toThrow(TypeError)
    expect(() => advanceDueDate('2026-02-30', 'MONTHLY')).toThrow(TypeError)
    expect(() => advanceDueDate('2026-13-01', 'MONTHLY')).toThrow(TypeError)
    expect(() => advanceDueDate('2026-00-10', 'MONTHLY')).toThrow(TypeError)
    expect(() => advanceDueDate('2026-01-00', 'MONTHLY')).toThrow(TypeError)
    expect(() => advanceDueDate('', 'MONTHLY')).toThrow(TypeError)
  })

  it('rejects an unknown frequency at runtime', () => {
    expect(() => advanceDueDate('2026-01-31', 'DAILY' as CountFrequency)).toThrow(TypeError)
  })
})

describe('isCountOnTime', () => {
  it('treats a count without a due date as never late', () => {
    expect(isCountOnTime('2026-10-26T12:00:00.000Z', null)).toBe(true)
    expect(isCountOnTime(null, null)).toBe(true)
  })

  it('is on time on the due day, late the day after', () => {
    expect(isCountOnTime('2026-10-26T23:59:59.000Z', '2026-10-26')).toBe(true)
    expect(isCountOnTime('2026-10-27T00:00:00.000Z', '2026-10-26')).toBe(false)
    expect(isCountOnTime(new Date('2026-10-20T09:00:00.000Z'), '2026-10-26')).toBe(true)
  })

  it('accepts a date-only posted day unchanged', () => {
    expect(isCountOnTime('2026-10-26', '2026-10-26')).toBe(true)
    expect(isCountOnTime('2026-10-27', '2026-10-26')).toBe(false)
  })

  it('is not on time when nothing was posted', () => {
    expect(isCountOnTime(null, '2026-10-26')).toBe(false)
  })
})

describe('abcClassFromShare', () => {
  it('is inclusive at both thresholds', () => {
    expect(abcClassFromShare(0, 8_000, 9_500)).toBe('A')
    expect(abcClassFromShare(8_000, 8_000, 9_500)).toBe('A')
    expect(abcClassFromShare(8_001, 8_000, 9_500)).toBe('B')
    expect(abcClassFromShare(9_500, 8_000, 9_500)).toBe('B')
    expect(abcClassFromShare(9_501, 8_000, 9_500)).toBe('C')
    expect(abcClassFromShare(10_000, 8_000, 9_500)).toBe('C')
  })

  it('treats a zero threshold as a zero share class', () => {
    expect(abcClassFromShare(0, 0, 0)).toBe('A')
    expect(abcClassFromShare(1, 0, 0)).toBe('C')
  })

  it('rejects non-integer, negative, and inverted thresholds', () => {
    expect(() => abcClassFromShare(1.5, 8_000, 9_500)).toThrow(TypeError)
    expect(() => abcClassFromShare(-1, 8_000, 9_500)).toThrow(TypeError)
    expect(() => abcClassFromShare(1, 9_500, 8_000)).toThrow(TypeError)
    expect(() => abcClassFromShare(1, -1, 8_000)).toThrow(TypeError)
  })
})

describe('countAccuracyBp', () => {
  it('returns null, never zero, when nothing was counted', () => {
    expect(countAccuracyBp(0, 0)).toBeNull()
  })

  it('expresses matched over counted in basis points', () => {
    expect(countAccuracyBp(10, 10)).toBe(10_000)
    expect(countAccuracyBp(0, 10)).toBe(0)
    expect(countAccuracyBp(7, 8)).toBe(8_750)
    expect(countAccuracyBp(1, 8)).toBe(1_250)
  })

  it('rounds half away from zero', () => {
    expect(countAccuracyBp(2, 3)).toBe(6_667)
    expect(countAccuracyBp(1, 3)).toBe(3_333)
    expect(countAccuracyBp(1, 16)).toBe(625)
  })

  it('rejects negative, fractional, and impossible line counts', () => {
    expect(() => countAccuracyBp(-1, 10)).toThrow(TypeError)
    expect(() => countAccuracyBp(1.5, 10)).toThrow(TypeError)
    expect(() => countAccuracyBp(1, -10)).toThrow(TypeError)
    expect(() => countAccuracyBp(11, 10)).toThrow(TypeError)
  })
})

describe('rotationBatchSize', () => {
  it('covers the catalogue exactly once per period', () => {
    expect(rotationBatchSize(52, 'WEEKLY')).toBe(1)
    expect(rotationBatchSize(53, 'WEEKLY')).toBe(2)
    expect(rotationBatchSize(12, 'MONTHLY')).toBe(1)
    expect(rotationBatchSize(13, 'MONTHLY')).toBe(2)
    expect(rotationBatchSize(120, 'MONTHLY')).toBe(10)
    expect(rotationBatchSize(4, 'QUARTERLY')).toBe(1)
    expect(rotationBatchSize(5, 'QUARTERLY')).toBe(2)
    expect(rotationBatchSize(2, 'BIANNUAL')).toBe(1)
    expect(rotationBatchSize(3, 'BIANNUAL')).toBe(2)
  })

  it('never asks for zero parts', () => {
    expect(rotationBatchSize(0, 'WEEKLY')).toBe(1)
    expect(rotationBatchSize(0, 'BIANNUAL')).toBe(1)
  })

  it('rejects a negative or fractional catalogue size', () => {
    expect(() => rotationBatchSize(-1, 'WEEKLY')).toThrow(TypeError)
    expect(() => rotationBatchSize(1.5, 'WEEKLY')).toThrow(TypeError)
    expect(() => rotationBatchSize(Number.NaN, 'WEEKLY')).toThrow(TypeError)
  })
})
