import { describe, expect, it } from 'vitest'
import type { ShiftCashTotals } from '@/lib/shift/shift-repository'
import { cashTerms } from '../components/drawer-tile'

/**
 * The drawer line on the home screen (P20-D10).
 *
 * The complaint it answers: "the take says 4,245 but the drawer says 2,930". Both were right —
 * the take counts every tender and every shift of the day; the drawer counts this shift's cash.
 * The line has to show the terms, from the same totals `computeExpectedCash` sums.
 */
const TOTALS: ShiftCashTotals = {
  openingFloatMinor: 0,
  cashTendersMinor: 300_000,
  changeMinor: 7_000,
  cashInMinor: 0,
  cashOutMinor: 0,
  cashRefundsMinor: 0,
  cashRepaymentsMinor: 0,
}

describe('cashTerms', () => {
  it('shows the cash sale minus the change, which is the drawer figure', () => {
    const terms = cashTerms(TOTALS)

    expect(terms.map((term) => term.label)).toEqual(['float', 'cash', 'change'])
    expect(terms.map((term) => term.sign)).toEqual([1, 1, -1])
    expect(terms.reduce((sum, term) => sum + term.sign * term.amountMinor, 0)).toBe(293_000)
  })

  it('names every movement that changed the drawer', () => {
    const terms = cashTerms({
      ...TOTALS,
      openingFloatMinor: 20_000,
      cashInMinor: 5_000,
      cashOutMinor: 2_000,
      cashRefundsMinor: 1_500,
      cashRepaymentsMinor: 4_000,
    })

    expect(terms.map((term) => `${term.sign > 0 ? '+' : '-'}${term.label}`)).toEqual([
      '+float',
      '+cash',
      '-change',
      '+cash in',
      '-cash out',
      '-refunds',
      '+repayments',
    ])
    // float + cash − change + in − out − refunds + repayments = the expected figure.
    expect(terms.reduce((sum, term) => sum + term.sign * term.amountMinor, 0)).toBe(318_500)
  })

  it('keeps a zero cash line, because a day with no cash is a fact', () => {
    const terms = cashTerms({
      ...TOTALS,
      cashTendersMinor: 0,
      changeMinor: 0,
    })

    expect(terms.map((term) => term.label)).toEqual(['float', 'cash'])
    expect(terms.reduce((sum, term) => sum + term.sign * term.amountMinor, 0)).toBe(0)
  })
})
