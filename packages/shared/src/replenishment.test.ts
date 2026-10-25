import { describe, expect, it } from 'vitest'
import {
  ceilDiv,
  type ReplenishmentInputs,
  suggestedValueMinor,
  suggestReplenishment,
  VELOCITY_DAYS,
} from './replenishment.ts'

function inputs(overrides: Partial<ReplenishmentInputs> = {}): ReplenishmentInputs {
  return {
    unitsSold: 900,
    onHand: 10,
    onOrder: 0,
    minLevel: 10,
    maxLevel: 40,
    minOrderQuantity: 0,
    leadTimeDays: 7,
    leadTimeAssumed: false,
    safetyDays: 7,
    ...overrides,
  }
}

describe('ceilDiv', () => {
  it('rounds up, once', () => {
    expect(ceilDiv(0, 90)).toBe(0)
    expect(ceilDiv(1, 90)).toBe(1)
    expect(ceilDiv(90, 90)).toBe(1)
    expect(ceilDiv(91, 90)).toBe(2)
    expect(ceilDiv(12_600, 90)).toBe(140)
  })

  it('rejects a negative numerator and a non-positive denominator', () => {
    expect(() => ceilDiv(-1, 90)).toThrow(TypeError)
    expect(() => ceilDiv(1, 0)).toThrow(TypeError)
    expect(() => ceilDiv(1, -90)).toThrow(TypeError)
    expect(() => ceilDiv(1.5, 90)).toThrow(TypeError)
  })
})

describe('suggestReplenishment', () => {
  it('covers lead time plus safety from real sales', () => {
    const result = suggestReplenishment(inputs())

    // 900 sold over 90 days at 14 days of cover = 140 units.
    expect(result.coverageLevel).toBe(140)
    expect(result.targetLevel).toBe(140)
    expect(result.position).toBe(10)
    expect(result.suggested).toBe(130)
    expect(result.basis).toBe('COVERAGE')
    expect(VELOCITY_DAYS).toBe(90)
  })

  it('does not double-order what is already on its way', () => {
    const result = suggestReplenishment(inputs({ onOrder: 130 }))

    expect(result.position).toBe(140)
    expect(result.suggested).toBe(0)
    expect(result.basis).toBe('AT_TARGET')
  })

  it('falls back to the stored maximum with no sales history', () => {
    const result = suggestReplenishment(inputs({ unitsSold: 0 }))

    expect(result.coverageLevel).toBe(0)
    expect(result.targetLevel).toBe(40)
    expect(result.suggested).toBe(30)
    expect(result.basis).toBe('NO_HISTORY')
  })

  it('applies a minimum order quantity as a floor', () => {
    const result = suggestReplenishment(inputs({ unitsSold: 0, minOrderQuantity: 50 }))

    expect(result.suggested).toBe(50)
    expect(result.basis).toBe('MIN_ORDER')
  })

  it('honours the floor even when the branch is at target', () => {
    const result = suggestReplenishment(inputs({ onHand: 140, minOrderQuantity: 50 }))

    expect(result.position).toBe(140)
    expect(result.suggested).toBe(50)
    expect(result.basis).toBe('MIN_ORDER')
  })

  it('reports no level when there is neither a max nor any sales', () => {
    const result = suggestReplenishment(inputs({ unitsSold: 0, maxLevel: null }))

    expect(result.targetLevel).toBe(0)
    expect(result.suggested).toBe(0)
    expect(result.basis).toBe('NO_LEVEL')
  })

  it('uses the stored maximum when it is larger than coverage', () => {
    const result = suggestReplenishment(inputs({ unitsSold: 90, maxLevel: 100 }))

    expect(result.coverageLevel).toBe(14)
    expect(result.targetLevel).toBe(100)
    expect(result.suggested).toBe(90)
    expect(result.basis).toBe('STORED_MAX')
  })

  it('treats a never-stocked product exactly like one on zero', () => {
    const neverStocked = suggestReplenishment(inputs({ unitsSold: 0, onHand: 0, maxLevel: 20 }))

    expect(neverStocked.position).toBe(0)
    expect(neverStocked.suggested).toBe(20)
  })

  it('never returns a negative suggestion when stock is above target', () => {
    const result = suggestReplenishment(inputs({ onHand: 500 }))

    expect(result.suggested).toBe(0)
    expect(result.basis).toBe('AT_TARGET')
  })

  it('never returns a float, at any input', () => {
    const result = suggestReplenishment(inputs({ unitsSold: 7, onHand: 1 }))
    for (const value of Object.values(result)) {
      if (typeof value === 'number') expect(Number.isSafeInteger(value)).toBe(true)
    }
  })

  it('rejects negative, fractional, or non-safe inputs', () => {
    expect(() => suggestReplenishment(inputs({ unitsSold: -1 }))).toThrow(TypeError)
    expect(() => suggestReplenishment(inputs({ onHand: 1.5 }))).toThrow(TypeError)
    expect(() => suggestReplenishment(inputs({ maxLevel: -5 }))).toThrow(TypeError)
    expect(() => suggestReplenishment(inputs({ leadTimeDays: Number.NaN }))).toThrow(TypeError)
    expect(() => suggestReplenishment(inputs({ minOrderQuantity: -1 }))).toThrow(TypeError)
  })

  it('is deterministic: the same inputs give the same answer', () => {
    const a = suggestReplenishment(inputs())
    const b = suggestReplenishment(inputs())
    expect(a).toEqual(b)
  })
})

describe('suggestedValueMinor', () => {
  it('multiplies quantity by unit cost', () => {
    expect(suggestedValueMinor(130, 3200)).toBe(416_000)
  })

  it('rejects nonsense and overflow', () => {
    expect(() => suggestedValueMinor(-1, 100)).toThrow(TypeError)
    expect(() => suggestedValueMinor(1, -100)).toThrow(TypeError)
    expect(() => suggestedValueMinor(1_000_000, 100_000_000_000)).toThrow(TypeError)
  })
})
