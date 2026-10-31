import { describe, expect, it } from 'vitest'
import { cartReducer, emptyCart } from './reducer'
import {
  computeCartTotals,
  earnPreviewPoints,
  loyaltyValueMinor,
  maxRedeemablePoints,
  pointsForValueMinor,
} from './totals'
import type { CartState, SellableProduct } from './types'

const NOW = '2026-10-23T10:00:00.000Z'

const CONTEXT = {
  taxMode: 'INCLUSIVE' as const,
  loyalty: { pointsPerCedi: 100, earnPointsPerCedi: 1 },
}

function product(id: string, priceMinor: number, name = 'Product'): SellableProduct {
  return {
    id,
    sku: `SKU-${id}`,
    name,
    barcode: null,
    unitPriceMinor: priceMinor,
    taxCategory: 'STANDARD',
  }
}

function cartWith(lines: Array<[string, number, number]>): CartState {
  let state = emptyCart({ now: NOW, shiftId: 'shift-1' })
  for (const [id, price, quantity] of lines) {
    state = cartReducer(state, {
      type: 'addProduct',
      product: product(id, price),
      quantity,
      now: NOW,
    })
  }
  return state
}

describe('loyalty quote', () => {
  it('values points at the configured rate (100 points = GHS 1)', () => {
    expect(loyaltyValueMinor(100, 100)).toBe(100)
    expect(loyaltyValueMinor(250, 100)).toBe(250)
    expect(loyaltyValueMinor(1, 100)).toBe(1)
    expect(loyaltyValueMinor(0, 100)).toBe(0)
  })

  it('floors instead of rounding value up', () => {
    expect(loyaltyValueMinor(99, 100)).toBe(99)
    expect(loyaltyValueMinor(1, 3)).toBe(33)
  })

  it('refuses a nonsensical rate rather than dividing by zero', () => {
    expect(loyaltyValueMinor(100, 0)).toBe(0)
    expect(loyaltyValueMinor(-5, 100)).toBe(0)
    expect(pointsForValueMinor(500, 0)).toBe(0)
  })

  it('inverts the value for the redemption ceiling', () => {
    expect(pointsForValueMinor(250, 100)).toBe(250)
    expect(pointsForValueMinor(10_000, 100)).toBe(10_000)
  })

  it('caps redemption at the cart value so no points are burnt for nothing', () => {
    expect(maxRedeemablePoints(500, 10_000, 100)).toBe(500)
    expect(maxRedeemablePoints(10_000, 300, 100)).toBe(300)
    expect(maxRedeemablePoints(0, 300, 100)).toBe(0)
  })
})

describe('earn preview', () => {
  it('mirrors the server formula (base × rate / 100, floored)', () => {
    expect(earnPreviewPoints(10_000, 1)).toBe(100)
    expect(earnPreviewPoints(99, 1)).toBe(0)
    expect(earnPreviewPoints(10_000, 2)).toBe(200)
    expect(earnPreviewPoints(0, 1)).toBe(0)
  })
})

describe('computeCartTotals', () => {
  it('prices lines with the shared engine (GHS 100 inclusive = 10,000 pesewas)', () => {
    const totals = computeCartTotals(cartWith([['p1', 10_000, 1]]), CONTEXT)

    expect(totals.priced.totalMinor).toBe(10_000)
    expect(totals.priced.baseMinor).toBe(8_333)
    // Inclusive: the base is derived, and the rounding residual lands on VAT.
    expect(totals.priced.vatMinor).toBe(1_251)
    expect(totals.priced.nhilMinor).toBe(208)
    expect(totals.priced.getfundMinor).toBe(208)
    expect(totals.priced.taxTotalMinor).toBe(1_667)
    expect(totals.itemCount).toBe(1)
    expect(totals.totalDiscountMinor).toBe(0)
    expect(totals.discountPercent).toBe(0)
  })

  it('charges nothing when the shop is not VAT-registered', () => {
    const totals = computeCartTotals(cartWith([['p1', 10_000, 1]]), {
      ...CONTEXT,
      vatRegistered: false,
    })

    // The same GHS 100 now buys the same goods with no levies on top of it, and
    // the whole amount is the untaxed base.
    expect(totals.priced.totalMinor).toBe(10_000)
    expect(totals.priced.baseMinor).toBe(10_000)
    expect(totals.priced.vatMinor).toBe(0)
    expect(totals.priced.nhilMinor).toBe(0)
    expect(totals.priced.getfundMinor).toBe(0)
    expect(totals.priced.taxTotalMinor).toBe(0)
  })

  it('sums quantities for the item count', () => {
    const totals = computeCartTotals(
      cartWith([
        ['p1', 1_000, 3],
        ['p2', 2_000, 2],
      ]),
      CONTEXT,
    )
    expect(totals.itemCount).toBe(5)
    expect(totals.grossMinor).toBe(7_000)
  })

  it('applies a sale discount pro-rata and keeps the header equal to the lines', () => {
    let state = cartWith([
      ['p1', 10_000, 1],
      ['p2', 10_000, 1],
    ])
    state = cartReducer(state, {
      type: 'setSaleDiscount',
      discount: { amountMinor: 2_000, reasonCode: 'PROMO', note: null, override: null },
      now: NOW,
    })

    const totals = computeCartTotals(state, CONTEXT)
    expect(totals.priced.saleDiscountMinor).toBe(2_000)
    expect(totals.priced.lines.reduce((total, line) => total + line.saleDiscountMinor, 0)).toBe(
      2_000,
    )
    expect(totals.priced.totalMinor).toBe(18_000)
  })

  it('takes the loyalty redemption off before tax', () => {
    let state = cartWith([['p1', 10_000, 1]])
    state = cartReducer(state, {
      type: 'setCustomer',
      customer: {
        customerId: 'c1',
        draftId: null,
        name: 'Akosua',
        phone: '+233241234567',
        isDraft: false,
      },
      now: NOW,
    })
    state = cartReducer(state, { type: 'setLoyaltyRedeem', points: 100, now: NOW })

    const totals = computeCartTotals(state, CONTEXT)
    expect(totals.loyaltyRequestedValueMinor).toBe(100)
    expect(totals.loyaltyDiscountMinor).toBe(100)
    expect(totals.priced.totalMinor).toBe(9_900)
    // Tax is recomputed on the reduced amount, not on the gross.
    expect(totals.priced.taxTotalMinor).toBeLessThan(1_667)
  })

  it('allows a fully redeemed cart to reach zero', () => {
    let state = cartWith([['p1', 1_000, 1]])
    state = cartReducer(state, {
      type: 'setCustomer',
      customer: {
        customerId: 'c1',
        draftId: null,
        name: 'Akosua',
        phone: '+233241234567',
        isDraft: false,
      },
      now: NOW,
    })
    state = cartReducer(state, { type: 'setLoyaltyRedeem', points: 1_000, now: NOW })

    const totals = computeCartTotals(state, CONTEXT)
    expect(totals.priced.totalMinor).toBe(0)
    expect(totals.loyaltyDiscountMinor).toBe(1_000)
  })

  it('clamps a redemption larger than the cart', () => {
    let state = cartWith([['p1', 1_000, 1]])
    state = cartReducer(state, {
      type: 'setCustomer',
      customer: {
        customerId: 'c1',
        draftId: null,
        name: 'Akosua',
        phone: '+233241234567',
        isDraft: false,
      },
      now: NOW,
    })
    state = cartReducer(state, { type: 'setLoyaltyRedeem', points: 50_000, now: NOW })

    const totals = computeCartTotals(state, CONTEXT)
    expect(totals.loyaltyRequestedValueMinor).toBe(50_000)
    expect(totals.loyaltyDiscountMinor).toBe(1_000)
    expect(totals.priced.totalMinor).toBe(0)
  })

  it('measures the discount percentage against gross, the same way the server does', () => {
    let state = cartWith([['p1', 10_000, 1]])
    state = cartReducer(state, {
      type: 'setSaleDiscount',
      discount: { amountMinor: 1_000, reasonCode: 'PROMO', note: null, override: null },
      now: NOW,
    })

    const totals = computeCartTotals(state, CONTEXT)
    expect(totals.totalDiscountMinor).toBe(1_000)
    expect(totals.discountPercent).toBe(10)
  })

  it('previews earn points from the tax-exclusive base', () => {
    const totals = computeCartTotals(cartWith([['p1', 10_000, 1]]), CONTEXT)
    expect(totals.earnPreviewPoints).toBe(earnPreviewPoints(totals.priced.baseMinor, 1))
    expect(totals.earnPreviewPoints).toBe(83)
  })

  it('prices an empty cart at zero without throwing', () => {
    const totals = computeCartTotals(emptyCart({ now: NOW }), CONTEXT)
    expect(totals.priced.totalMinor).toBe(0)
    expect(totals.discountPercent).toBe(0)
    expect(totals.earnPreviewPoints).toBe(0)
  })
})
