import { describe, expect, it } from 'vitest'
import {
  isOpeningAdditive,
  OPENING_MAX_ROWS,
  openingDelta,
  openingLineValueMinor,
  openingTotals,
} from './openings.ts'

describe('opening arithmetic', () => {
  it('values a line in integer pesewas', () => {
    expect(openingLineValueMinor(12, 4_500)).toBe(54_000)
    expect(openingLineValueMinor(0, 4_500)).toBe(0)
  })

  it('computes a count delta against on-hand', () => {
    expect(openingDelta(12, 0)).toBe(12)
    expect(openingDelta(12, 5)).toBe(7)
    expect(openingDelta(4, 5)).toBe(-1)
    expect(isOpeningAdditive(4, 5)).toBe(false)
    expect(isOpeningAdditive(12, 5)).toBe(true)
  })

  it('totals units, value and uncosted lines', () => {
    expect(
      openingTotals([
        { quantity: 10, unitCostMinor: 1_000 },
        { quantity: 5, unitCostMinor: 2_000 },
        { quantity: 1, unitCostMinor: 0 },
        { quantity: 0, unitCostMinor: 0 },
      ]),
    ).toEqual({
      lineCount: 4,
      totalUnits: 16,
      countedValueMinor: 20_000,
      uncostedLineCount: 1,
    })
  })

  it('refuses a negative quantity, cost or float', () => {
    expect(() => openingLineValueMinor(-1, 100)).toThrow(TypeError)
    expect(() => openingLineValueMinor(1, -100)).toThrow(TypeError)
    expect(() => openingLineValueMinor(1.5, 100)).toThrow(TypeError)
    expect(() => openingDelta(1.5, 0)).toThrow(TypeError)
  })

  it('keeps the documented cap', () => {
    expect(OPENING_MAX_ROWS).toBe(5_000)
  })
})
