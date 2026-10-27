import { describe, expect, it } from 'vitest'
import {
  changeFromCash,
  ELECTRONIC_TENDER_METHODS,
  formatTenderLabel,
  isElectronicTender,
  isTenderMethod,
  MAX_TENDERS_PER_SALE,
  TENDER_LABELS,
  TENDER_METHODS,
  TENDER_PROBLEM_MESSAGES,
  type TenderMethod,
  tenderBalance,
} from './tender.ts'

function line(method: TenderMethod, amountMinor: number, sequence = 1) {
  return { method, amountMinor, sequence }
}

function tenders(...amounts: Array<[TenderMethod, number]>) {
  return amounts.map(([method, amountMinor], index) => line(method, amountMinor, index + 1))
}

describe('tender vocabulary', () => {
  it('lists the five methods in receipt order', () => {
    expect(TENDER_METHODS).toEqual(['CASH', 'CREDIT', 'MOMO', 'CARD', 'BANK_TRANSFER'])
    expect(ELECTRONIC_TENDER_METHODS).toEqual(['MOMO', 'CARD', 'BANK_TRANSFER'])
  })

  it('recognises a method at runtime', () => {
    expect(isTenderMethod('MOMO')).toBe(true)
    expect(isTenderMethod('CASH')).toBe(true)
    expect(isTenderMethod('CHEQUE')).toBe(false)
    expect(isTenderMethod('')).toBe(false)
  })

  it('separates electronic methods from cash and credit', () => {
    expect(isElectronicTender('MOMO')).toBe(true)
    expect(isElectronicTender('CARD')).toBe(true)
    expect(isElectronicTender('BANK_TRANSFER')).toBe(true)
    expect(isElectronicTender('CASH')).toBe(false)
    expect(isElectronicTender('CREDIT')).toBe(false)
  })

  it('labels every method and every problem', () => {
    expect(TENDER_LABELS).toEqual({
      CASH: 'Cash',
      CREDIT: 'Credit',
      MOMO: 'MoMo',
      CARD: 'Card',
      BANK_TRANSFER: 'Bank transfer',
    })
    expect(formatTenderLabel('BANK_TRANSFER')).toBe('Bank transfer')

    expect(TENDER_PROBLEM_MESSAGES.MULTIPLE_CREDIT_TENDERS).toContain('one credit')
    expect(TENDER_PROBLEM_MESSAGES.TOO_MANY_TENDERS).toContain('five')
    expect(MAX_TENDERS_PER_SALE).toBe(5)
  })
})

describe('tenderBalance', () => {
  it('balances a cash and MoMo split exactly', () => {
    const balance = tenderBalance(10_000, tenders(['CASH', 5_000], ['MOMO', 5_000]))

    expect(balance).toEqual({
      totalMinor: 10_000,
      appliedMinor: 10_000,
      cashMinor: 5_000,
      creditMinor: 0,
      electronicMinor: 5_000,
      remainingMinor: 0,
      changeMinor: 0,
      problem: null,
    })
  })

  it('takes change from cash when an electronic tender is larger than the cash tender', () => {
    // P13-D3 defines change as max(0, applied - total) capped by the cash tender,
    // so 50.00 cash + 60.00 MoMo on 100.00 leaves 10.00 of change the drawer can pay.
    const balance = tenderBalance(10_000, tenders(['CASH', 5_000], ['MOMO', 6_000]))

    expect(balance.appliedMinor).toBe(11_000)
    expect(balance.changeMinor).toBe(1_000)
    expect(balance.problem).toBeNull()
  })

  it('refuses an overpayment the cash tender cannot fund', () => {
    const balance = tenderBalance(10_000, tenders(['CASH', 2_000], ['CARD', 11_000]))

    expect(balance.appliedMinor).toBe(13_000)
    expect(balance.changeMinor).toBe(0)
    expect(balance.problem).toBe('OVERPAID_BY_ELECTRONIC')
  })

  it('accepts an overpayment exactly equal to the cash tender', () => {
    const balance = tenderBalance(10_000, tenders(['CASH', 2_000], ['CARD', 10_000]))

    expect(balance.changeMinor).toBe(2_000)
    expect(balance.problem).toBeNull()
  })

  it('reports an unpaid balance and how much is still owed', () => {
    const balance = tenderBalance(
      10_000,
      tenders(['CASH', 4_000], ['CREDIT', 4_000], ['CARD', 1_000]),
    )

    expect(balance.appliedMinor).toBe(9_000)
    expect(balance.remainingMinor).toBe(1_000)
    expect(balance.changeMinor).toBe(0)
    expect(balance.problem).toBe('UNPAID_BALANCE')
  })

  it('lets credit cover exactly the total but never produce change', () => {
    const exact = tenderBalance(10_000, tenders(['CASH', 3_000], ['CREDIT', 7_000]))
    expect(exact.changeMinor).toBe(0)
    expect(exact.problem).toBeNull()

    // The cashier hands back 10.00 of the cash; the credit portion is unchanged.
    const overpaidCash = tenderBalance(10_000, tenders(['CASH', 3_000], ['CREDIT', 8_000]))
    expect(overpaidCash.cashMinor).toBe(3_000)
    expect(overpaidCash.creditMinor).toBe(8_000)
    expect(overpaidCash.changeMinor).toBe(1_000)
    expect(overpaidCash.problem).toBeNull()
  })

  it('allows one credit tender and refuses two', () => {
    const one = tenderBalance(10_000, tenders(['CREDIT', 4_000], ['CASH', 6_000]))
    expect(one.problem).toBeNull()

    const two = tenderBalance(
      10_000,
      tenders(['CREDIT', 4_000], ['CREDIT', 4_000], ['CASH', 2_000]),
    )
    expect(two.problem).toBe('MULTIPLE_CREDIT_TENDERS')
  })

  it('refuses credit greater than the total', () => {
    expect(tenderBalance(10_000, tenders(['CREDIT', 10_001])).problem).toBe('CREDIT_EXCEEDS_TOTAL')
    expect(tenderBalance(10_000, tenders(['CREDIT', 10_000])).problem).toBeNull()
  })

  it('refuses a non-positive tender', () => {
    expect(tenderBalance(10_000, tenders(['CASH', -1])).problem).toBe('NEGATIVE_TENDER')
    expect(tenderBalance(10_000, tenders(['CASH', 1.5])).problem).toBe('NEGATIVE_TENDER')
    expect(tenderBalance(10_000, tenders(['CASH', 0], ['MOMO', 10_000])).problem).toBe(
      'NEGATIVE_TENDER',
    )
  })

  it('accepts the cap and refuses one tender over it', () => {
    const five = tenderBalance(
      10_000,
      tenders(
        ['CASH', 2_000],
        ['CREDIT', 2_000],
        ['MOMO', 2_000],
        ['CARD', 2_000],
        ['BANK_TRANSFER', 2_000],
      ),
    )
    expect(five.problem).toBeNull()

    const six = tenderBalance(
      10_000,
      tenders(
        ['CASH', 2_000],
        ['MOMO', 2_000],
        ['CARD', 2_000],
        ['BANK_TRANSFER', 2_000],
        ['MOMO', 2_000],
        ['CARD', 1_000],
      ),
    )
    expect(six.problem).toBe('TOO_MANY_TENDERS')
  })

  it('treats a zero sale with no tenders as valid', () => {
    expect(tenderBalance(0, [])).toEqual({
      totalMinor: 0,
      appliedMinor: 0,
      cashMinor: 0,
      creditMinor: 0,
      electronicMinor: 0,
      remainingMinor: 0,
      changeMinor: 0,
      problem: null,
    })
  })

  it('refuses any tender on a zero sale', () => {
    const balance = tenderBalance(0, tenders(['CASH', 1_000]))

    expect(balance.appliedMinor).toBe(1_000)
    expect(balance.changeMinor).toBe(0)
    expect(balance.problem).toBe('UNPAID_BALANCE')
    expect(tenderBalance(0, tenders(['CREDIT', 1_000])).problem).toBe('UNPAID_BALANCE')
  })

  it('treats a duplicate sequence as a caller bug', () => {
    expect(() => tenderBalance(10_000, [line('CASH', 5_000, 1), line('MOMO', 5_000, 1)])).toThrow(
      RangeError,
    )
  })

  it('does not require sequences to arrive sorted', () => {
    const balance = tenderBalance(10_000, [line('MOMO', 5_000, 2), line('CASH', 5_000, 1)])
    expect(balance.problem).toBeNull()
  })
})

describe('changeFromCash', () => {
  it('returns only the change the cash tender can fund', () => {
    expect(changeFromCash(10_000, tenders(['CASH', 5_000], ['MOMO', 5_000]))).toBe(0)
    expect(changeFromCash(10_000, tenders(['CASH', 6_000], ['MOMO', 5_000]))).toBe(1_000)
  })

  it('returns zero for an impossible tender set', () => {
    expect(changeFromCash(10_000, tenders(['CASH', 2_000], ['CARD', 11_000]))).toBe(0)
  })
})
