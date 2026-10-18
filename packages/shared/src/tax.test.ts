import { describe, expect, it } from 'vitest'
import {
  addTaxBreakdowns,
  GETFUND_RATE_BP,
  NHIL_RATE_BP,
  taxBreakdown,
  VAT_RATE_BP,
  zeroBreakdown,
} from './tax.ts'

describe('taxBreakdown exclusive', () => {
  it('matches the GRA worked example (GHS 1,000 exclusive)', () => {
    expect(taxBreakdown(100_000, 'STANDARD', 'EXCLUSIVE')).toEqual({
      baseMinor: 100_000,
      vatMinor: 15_000,
      nhilMinor: 2_500,
      getfundMinor: 2_500,
      taxTotalMinor: 20_000,
      totalMinor: 120_000,
    })
  })

  it('treats the amount as the base and sums the total exactly', () => {
    const breakdown = taxBreakdown(333, 'STANDARD', 'EXCLUSIVE')
    expect(breakdown.baseMinor).toBe(333)
    expect(breakdown.vatMinor).toBe(Math.round((333 * VAT_RATE_BP) / 10_000))
    expect(breakdown.nhilMinor).toBe(Math.round((333 * NHIL_RATE_BP) / 10_000))
    expect(breakdown.getfundMinor).toBe(Math.round((333 * GETFUND_RATE_BP) / 10_000))
    expect(breakdown.totalMinor).toBe(breakdown.baseMinor + breakdown.taxTotalMinor)
  })

  it('handles zero', () => {
    expect(taxBreakdown(0, 'STANDARD', 'EXCLUSIVE')).toEqual({
      baseMinor: 0,
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 0,
    })
  })
})

describe('taxBreakdown inclusive', () => {
  it('inverts the GRA example (GHS 1,200 inclusive)', () => {
    expect(taxBreakdown(120_000, 'STANDARD', 'INCLUSIVE')).toEqual({
      baseMinor: 100_000,
      vatMinor: 15_000,
      nhilMinor: 2_500,
      getfundMinor: 2_500,
      taxTotalMinor: 20_000,
      totalMinor: 120_000,
    })
  })

  it('splits a GHS 100.00 inclusive price correctly', () => {
    // Roadmap success criterion 4: GHS 100 inclusive = 10,000 pesewas.
    const breakdown = taxBreakdown(10_000, 'STANDARD', 'INCLUSIVE')
    expect(breakdown.baseMinor).toBe(8_333)
    expect(breakdown.totalMinor).toBe(10_000)
    expect(breakdown.baseMinor + breakdown.taxTotalMinor).toBe(10_000)
    expect(
      breakdown.baseMinor + breakdown.vatMinor + breakdown.nhilMinor + breakdown.getfundMinor,
    ).toBe(10_000)
  })

  it('keeps the residual invariant for every amount from 0 to 200,000 pesewas', () => {
    const violations: number[] = []
    for (let amount = 0; amount <= 200_000; amount += 1) {
      const breakdown = taxBreakdown(amount, 'STANDARD', 'INCLUSIVE')
      const componentsSum =
        breakdown.baseMinor + breakdown.vatMinor + breakdown.nhilMinor + breakdown.getfundMinor
      const hasNegative =
        breakdown.baseMinor < 0 ||
        breakdown.vatMinor < 0 ||
        breakdown.nhilMinor < 0 ||
        breakdown.getfundMinor < 0
      if (
        componentsSum !== breakdown.totalMinor ||
        breakdown.totalMinor !== amount ||
        breakdown.taxTotalMinor !== breakdown.totalMinor - breakdown.baseMinor ||
        hasNegative
      ) {
        violations.push(amount)
      }
    }
    expect(violations).toEqual([])
  })

  it('keeps the exact-sum invariant for every exclusive amount from 0 to 200,000 pesewas', () => {
    const violations: number[] = []
    for (let amount = 0; amount <= 200_000; amount += 1) {
      const breakdown = taxBreakdown(amount, 'STANDARD', 'EXCLUSIVE')
      const componentsSum =
        breakdown.baseMinor + breakdown.vatMinor + breakdown.nhilMinor + breakdown.getfundMinor
      if (breakdown.baseMinor !== amount || breakdown.totalMinor !== componentsSum) {
        violations.push(amount)
      }
    }
    expect(violations).toEqual([])
  })
})

describe('taxBreakdown zero-rated and exempt', () => {
  it('charges no tax for zero-rated supplies in both modes', () => {
    expect(taxBreakdown(45_678, 'ZERO_RATED', 'INCLUSIVE')).toEqual({
      baseMinor: 45_678,
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 45_678,
    })
    expect(taxBreakdown(45_678, 'ZERO_RATED', 'EXCLUSIVE')).toEqual({
      baseMinor: 45_678,
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 45_678,
    })
  })

  it('charges no tax for exempt supplies', () => {
    expect(taxBreakdown(1_234, 'EXEMPT', 'INCLUSIVE').taxTotalMinor).toBe(0)
    expect(taxBreakdown(1_234, 'EXEMPT', 'EXCLUSIVE').totalMinor).toBe(1_234)
  })
})

describe('taxBreakdown validation', () => {
  it('rejects non-integer amounts', () => {
    expect(() => taxBreakdown(1.5, 'STANDARD', 'INCLUSIVE')).toThrow(TypeError)
    expect(() => taxBreakdown(100.01, 'STANDARD', 'EXCLUSIVE')).toThrow(TypeError)
  })

  it('rejects negative amounts', () => {
    expect(() => taxBreakdown(-1, 'STANDARD', 'INCLUSIVE')).toThrow(TypeError)
  })

  it('rejects NaN, Infinity, and unsafe integers', () => {
    expect(() => taxBreakdown(Number.NaN, 'STANDARD', 'INCLUSIVE')).toThrow(TypeError)
    expect(() => taxBreakdown(Number.POSITIVE_INFINITY, 'STANDARD', 'INCLUSIVE')).toThrow(TypeError)
    expect(() => taxBreakdown(Number.MAX_SAFE_INTEGER + 1, 'STANDARD', 'INCLUSIVE')).toThrow(
      TypeError,
    )
  })

  it('rejects unknown categories and modes', () => {
    expect(() => taxBreakdown(100, 'STANDARD_RATED' as never, 'INCLUSIVE')).toThrow(TypeError)
    expect(() => taxBreakdown(100, 'STANDARD', 'NET' as never)).toThrow(TypeError)
  })
})

describe('zeroBreakdown', () => {
  it('returns the amount as base and total with no tax', () => {
    expect(zeroBreakdown(999)).toEqual({
      baseMinor: 999,
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 999,
    })
  })

  it('validates the amount', () => {
    expect(() => zeroBreakdown(-5)).toThrow(TypeError)
  })
})

describe('addTaxBreakdowns', () => {
  it('returns zeros for no lines', () => {
    expect(addTaxBreakdowns()).toEqual(zeroBreakdown(0))
  })

  it('sums line breakdowns into an invoice total', () => {
    const lines = [
      taxBreakdown(100_000, 'STANDARD', 'EXCLUSIVE'),
      taxBreakdown(120_000, 'STANDARD', 'INCLUSIVE'),
      taxBreakdown(50_000, 'ZERO_RATED', 'INCLUSIVE'),
    ]
    expect(addTaxBreakdowns(...lines)).toEqual({
      baseMinor: 250_000,
      vatMinor: 30_000,
      nhilMinor: 5_000,
      getfundMinor: 5_000,
      taxTotalMinor: 40_000,
      totalMinor: 290_000,
    })
  })

  it('rejects malformed breakdowns', () => {
    expect(() => addTaxBreakdowns({ ...zeroBreakdown(1), vatMinor: -1 })).toThrow(TypeError)
    expect(() => addTaxBreakdowns({ ...zeroBreakdown(1), totalMinor: 1.5 })).toThrow(TypeError)
  })
})
