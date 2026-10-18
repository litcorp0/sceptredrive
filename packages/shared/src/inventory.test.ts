import { describe, expect, it } from 'vitest'
import { averageCostAfterReceipt } from './inventory.ts'

describe('averageCostAfterReceipt', () => {
  it('blends an inbound cost into the current average', () => {
    expect(averageCostAfterReceipt(4_500, 10, 5_500, 10)).toBe(5_000)
    expect(averageCostAfterReceipt(4_500, 30, 6_000, 10)).toBe(4_875)
  })

  it('adopts the incoming cost when on hand is zero or negative', () => {
    expect(averageCostAfterReceipt(0, 0, 7_200, 5)).toBe(7_200)
    expect(averageCostAfterReceipt(4_500, 0, 7_200, 5)).toBe(7_200)
    expect(averageCostAfterReceipt(4_500, -3, 7_200, 5)).toBe(7_200)
  })

  it('rounds half-up to whole pesewas', () => {
    expect(averageCostAfterReceipt(100, 1, 101, 1)).toBe(101)
    expect(averageCostAfterReceipt(100, 2, 101, 1)).toBe(100)
    expect(averageCostAfterReceipt(1, 1, 2, 1)).toBe(2)
  })

  it('keeps the average when the incoming cost matches', () => {
    expect(averageCostAfterReceipt(5_000, 12, 5_000, 3)).toBe(5_000)
  })

  it('rejects invalid inputs', () => {
    expect(() => averageCostAfterReceipt(-1, 1, 1, 1)).toThrow(TypeError)
    expect(() => averageCostAfterReceipt(1.5, 1, 1, 1)).toThrow(TypeError)
    expect(() => averageCostAfterReceipt(1, 1.5, 1, 1)).toThrow(TypeError)
    expect(() => averageCostAfterReceipt(1, 1, -1, 1)).toThrow(TypeError)
    expect(() => averageCostAfterReceipt(1, 1, 1, 0)).toThrow(TypeError)
    expect(() => averageCostAfterReceipt(1, 1, 1, -2)).toThrow(TypeError)
    expect(() => averageCostAfterReceipt(Number.NaN, 1, 1, 1)).toThrow(TypeError)
  })
})
