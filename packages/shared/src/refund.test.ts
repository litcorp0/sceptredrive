import { describe, expect, it } from 'vitest'
import {
  movesStockBack,
  REFUND_REASON_LABELS,
  REFUND_REASONS,
  REFUND_RESTOCK_LABELS,
  REFUND_RESTOCK_OPTIONS,
  type RefundableSaleLine,
  type RefundableTender,
  refundAllocationProblem,
  refundApprovalRequired,
  refundableQuantity,
  refundableTenderMinor,
  restockRequiresReason,
} from './refund.ts'

function saleLine(overrides: Partial<RefundableSaleLine> = {}): RefundableSaleLine {
  return { saleLineId: 'line-1', quantity: 2, refundedQuantity: 0, ...overrides }
}

function tender(overrides: Partial<RefundableTender> = {}): RefundableTender {
  return {
    saleTenderId: 'tender-1',
    method: 'CASH',
    amountMinor: 10_000,
    refundedMinor: 0,
    ...overrides,
  }
}

const SALE_TENDER_TOTAL = 10_000
const SALE_CHANGE = 1_000

describe('refund vocabulary', () => {
  it('lists every reason and restock option with a label', () => {
    expect(REFUND_REASONS).toEqual([
      'CUSTOMER_CHANGED_MIND',
      'WRONG_ITEM',
      'DEFECTIVE',
      'PRICE_DISPUTE',
      'DUPLICATE_SALE',
      'OTHER',
    ])
    expect(REFUND_RESTOCK_OPTIONS).toEqual(['RESALABLE', 'DAMAGED', 'NOT_RETURNED'])

    for (const reason of REFUND_REASONS) {
      expect(REFUND_REASON_LABELS[reason].length).toBeGreaterThan(0)
    }
    for (const restock of REFUND_RESTOCK_OPTIONS) {
      expect(REFUND_RESTOCK_LABELS[restock].length).toBeGreaterThan(0)
    }
  })

  it('moves stock back only for a resalable return', () => {
    expect(movesStockBack('RESALABLE')).toBe(true)
    expect(movesStockBack('DAMAGED')).toBe(false)
    expect(movesStockBack('NOT_RETURNED')).toBe(false)
  })

  it('requires a damage reason only for DAMAGED', () => {
    expect(restockRequiresReason('DAMAGED')).toBe(true)
    expect(restockRequiresReason('RESALABLE')).toBe(false)
    expect(restockRequiresReason('NOT_RETURNED')).toBe(false)
  })
})

describe('refundableQuantity', () => {
  it('returns the whole line before any refund', () => {
    expect(refundableQuantity(saleLine({ quantity: 3, refundedQuantity: 0 }))).toBe(3)
  })

  it('returns zero at the cap and never goes negative', () => {
    expect(refundableQuantity(saleLine({ quantity: 3, refundedQuantity: 3 }))).toBe(0)
    expect(refundableQuantity(saleLine({ quantity: 3, refundedQuantity: 4 }))).toBe(0)
  })
})

describe('refundableTenderMinor', () => {
  it('returns the tender remainder', () => {
    expect(refundableTenderMinor(tender({ amountMinor: 10_000, refundedMinor: 0 }))).toBe(10_000)
    expect(refundableTenderMinor(tender({ amountMinor: 10_000, refundedMinor: 4_000 }))).toBe(6_000)
  })

  it('returns zero when fully refunded or over-refunded', () => {
    expect(refundableTenderMinor(tender({ amountMinor: 10_000, refundedMinor: 10_000 }))).toBe(0)
    expect(refundableTenderMinor(tender({ amountMinor: 10_000, refundedMinor: 11_000 }))).toBe(0)
  })

  it('nets the sale change out of the cash tender only', () => {
    expect(refundableTenderMinor(tender({ method: 'CASH', amountMinor: 10_000 }), 1_000)).toBe(
      9_000,
    )
    expect(refundableTenderMinor(tender({ method: 'CARD', amountMinor: 10_000 }), 1_000)).toBe(
      10_000,
    )
    expect(
      refundableTenderMinor(
        tender({ method: 'CASH', amountMinor: 10_000, refundedMinor: 2_000 }),
        1_000,
      ),
    ).toBe(7_000)
  })

  it('keeps the full remainder when the sale produced no change', () => {
    expect(refundableTenderMinor(tender({ method: 'CASH', amountMinor: 10_000 }), 0)).toBe(10_000)
    expect(refundableTenderMinor(tender({ method: 'CASH', amountMinor: 10_000 }))).toBe(10_000)
  })
})

describe('refundAllocationProblem', () => {
  it('accepts an allocation that fits every cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 9_000 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender({ amountMinor: 10_000 })],
        refundedMinor: 9_000,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: SALE_CHANGE,
      }),
    ).toBeNull()
  })

  it('accepts a line at exactly its refundable cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 2 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 8_000 }],
        },
        lines: [saleLine({ quantity: 3, refundedQuantity: 1 })],
        tenders: [tender({ amountMinor: 10_000 })],
        refundedMinor: 8_000,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: SALE_CHANGE,
      }),
    ).toBeNull()
  })

  it('refuses a line one over its cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 3 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 9_000 }],
        },
        lines: [saleLine({ quantity: 3, refundedQuantity: 1 })],
        tenders: [tender()],
        refundedMinor: 9_000,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: SALE_CHANGE,
      }),
    ).toBe('EXCEEDS_LINE')
  })

  it('refuses a line quantity of zero', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 0 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 3_000 }],
        },
        lines: [saleLine({ quantity: 3 })],
        tenders: [tender()],
        refundedMinor: 3_000,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: SALE_CHANGE,
      }),
    ).toBe('EXCEEDS_LINE')
  })

  it('refuses a tender one over its remainder', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 8_001 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender({ amountMinor: 10_000, refundedMinor: 2_000 })],
        refundedMinor: 8_001,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: 0,
      }),
    ).toBe('EXCEEDS_TENDER')
  })

  it('accepts a tender exactly at its remainder', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 8_000 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender({ amountMinor: 10_000, refundedMinor: 2_000 })],
        refundedMinor: 8_000,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: 0,
      }),
    ).toBeNull()
  })

  it('refuses an allocation whose tenders do not sum to the refund', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 8_000 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender()],
        refundedMinor: 9_000,
        saleTenderTotalMinor: SALE_TENDER_TOTAL,
        saleChangeMinor: SALE_CHANGE,
      }),
    ).toBe('SUM_MISMATCH')
  })

  it('keeps the sale cap as a belt when a non-cash tender would let change back out', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 9_100 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender({ method: 'CARD', amountMinor: 10_000 })],
        refundedMinor: 9_100,
        saleTenderTotalMinor: 10_000,
        saleChangeMinor: 1_000,
      }),
    ).toBe('EXCEEDS_SALE')
  })

  it('accepts a refund of exactly the sale cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 9_000 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender({ amountMinor: 10_000 })],
        refundedMinor: 9_000,
        saleTenderTotalMinor: 10_000,
        saleChangeMinor: 1_000,
      }),
    ).toBeNull()
  })

  it('sums duplicate tender rows before comparing them with the cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [
            { saleTenderId: 'tender-1', amountMinor: 6_000 },
            { saleTenderId: 'tender-1', amountMinor: 6_000 },
          ],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender({ amountMinor: 10_000 })],
        refundedMinor: 12_000,
        saleTenderTotalMinor: 10_000,
        saleChangeMinor: 0,
      }),
    ).toBe('EXCEEDS_TENDER')
  })

  it('sums duplicate line rows before comparing them with the cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [
            { saleLineId: 'line-1', quantity: 2 },
            { saleLineId: 'line-1', quantity: 2 },
          ],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 9_000 }],
        },
        lines: [saleLine({ quantity: 3 })],
        tenders: [tender({ amountMinor: 10_000 })],
        refundedMinor: 9_000,
        saleTenderTotalMinor: 10_000,
        saleChangeMinor: 1_000,
      }),
    ).toBe('EXCEEDS_LINE')
  })

  it('refuses to refund change through the cash tender', () => {
    const base = {
      lines: [saleLine({ quantity: 2 })],
      tenders: [
        tender({ saleTenderId: 'cash', method: 'CASH', amountMinor: 10_000 }),
        tender({ saleTenderId: 'card', method: 'CARD', amountMinor: 1_000 }),
      ],
      saleTenderTotalMinor: 11_000,
      saleChangeMinor: 1_000,
    }

    expect(
      refundAllocationProblem({
        ...base,
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'cash', amountMinor: 10_000 }],
        },
        refundedMinor: 10_000,
      }),
    ).toBe('EXCEEDS_TENDER')

    expect(
      refundAllocationProblem({
        ...base,
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'cash', amountMinor: 9_000 }],
        },
        refundedMinor: 9_000,
      }),
    ).toBeNull()
  })

  it('counts prior refunds against the sale cap as a second line of defence', () => {
    const base = {
      allocation: {
        lines: [{ saleLineId: 'line-1', quantity: 1 }],
        tenders: [{ saleTenderId: 'card', amountMinor: 1_000 }],
      },
      lines: [saleLine({ quantity: 2 })],
      tenders: [tender({ saleTenderId: 'card', method: 'CARD', amountMinor: 2_000 })],
      refundedMinor: 1_000,
      saleTenderTotalMinor: 2_000,
      saleChangeMinor: 1_000,
    }

    expect(refundAllocationProblem(base)).toBeNull()
    expect(refundAllocationProblem({ ...base, previouslyRefundedMinor: 1_000 })).toBe(
      'EXCEEDS_SALE',
    )
  })

  it('refuses an empty allocation', () => {
    const base = {
      lines: [saleLine()],
      tenders: [tender()],
      saleTenderTotalMinor: SALE_TENDER_TOTAL,
      saleChangeMinor: SALE_CHANGE,
    }

    expect(
      refundAllocationProblem({
        ...base,
        allocation: { lines: [], tenders: [{ saleTenderId: 'tender-1', amountMinor: 1_000 }] },
        refundedMinor: 1_000,
      }),
    ).toBe('NO_ALLOCATION')

    expect(
      refundAllocationProblem({
        ...base,
        allocation: { lines: [{ saleLineId: 'line-1', quantity: 1 }], tenders: [] },
        refundedMinor: 1_000,
      }),
    ).toBe('NO_ALLOCATION')

    expect(
      refundAllocationProblem({
        ...base,
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 1 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 0 }],
        },
        refundedMinor: 0,
      }),
    ).toBe('NO_ALLOCATION')
  })

  it('checks the line cap before the tender cap', () => {
    expect(
      refundAllocationProblem({
        allocation: {
          lines: [{ saleLineId: 'line-1', quantity: 5 }],
          tenders: [{ saleTenderId: 'tender-1', amountMinor: 20_000 }],
        },
        lines: [saleLine({ quantity: 2 })],
        tenders: [tender()],
        refundedMinor: 20_000,
        saleTenderTotalMinor: 20_000,
        saleChangeMinor: 0,
      }),
    ).toBe('EXCEEDS_LINE')
  })
})

describe('refundApprovalRequired', () => {
  it('triggers at exactly the threshold', () => {
    expect(refundApprovalRequired(20_000, 20_000)).toBe(true)
  })

  it('does not trigger one pesewa below the threshold', () => {
    expect(refundApprovalRequired(19_999, 20_000)).toBe(false)
  })

  it('triggers above the threshold', () => {
    expect(refundApprovalRequired(20_001, 20_000)).toBe(true)
  })

  it('treats a non-integer amount as a caller bug', () => {
    expect(() => refundApprovalRequired(NaN, 20_000)).toThrow(RangeError)
    expect(() => refundApprovalRequired(1_000, Number.POSITIVE_INFINITY)).toThrow(RangeError)
    expect(() => refundApprovalRequired(-1, 20_000)).toThrow(RangeError)
  })
})
