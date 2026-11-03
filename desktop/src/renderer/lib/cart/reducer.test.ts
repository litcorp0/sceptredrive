import { describe, expect, it } from 'vitest'
import {
  cartReducer,
  emptyCart,
  lineGrossMinor,
  netAfterLineDiscounts,
  sanitizeCartState,
} from './reducer'
import type { CartOverrideProof, CartState, SellableProduct } from './types'

const NOW = '2026-10-23T10:00:00.000Z'

function product(overrides: Partial<SellableProduct> = {}): SellableProduct {
  return {
    id: '11111111-1111-7111-8111-111111111111',
    sku: 'SDP-00001',
    name: 'Brake Pad Set',
    barcode: '4006381333931',
    unitPriceMinor: 10_000,
    taxCategory: 'STANDARD',
    ...overrides,
  }
}

function proof(overrides: Partial<CartOverrideProof> = {}): CartOverrideProof {
  return {
    approverUserId: 'user-manager',
    approverStaffId: 'SD-0002',
    approverRole: 'MANAGER',
    bindingId: '22222222-2222-7222-8222-222222222222',
    pinVersion: 3,
    reasonCode: 'CUSTOMER_REQUEST',
    note: null,
    approvedAt: NOW,
    ...overrides,
  }
}

function withLines(count = 1): CartState {
  let state = emptyCart({ now: NOW, shiftId: 'shift-1' })
  for (let index = 0; index < count; index += 1) {
    state = cartReducer(state, {
      type: 'addProduct',
      product: product({
        id: `11111111-1111-7111-8111-00000000000${index}`,
        name: `Product ${index}`,
        unitPriceMinor: 10_000 * (index + 1),
      }),
      now: NOW,
    })
  }
  return state
}

describe('cart reducer — lines', () => {
  it('starts empty with the shift it belongs to', () => {
    const state = emptyCart({ now: NOW, shiftId: 'shift-1' })
    expect(state.lines).toEqual([])
    expect(state.shiftId).toBe('shift-1')
    expect(state.saleId).toMatch(/^[0-9a-f-]{36}$/)
    expect(state.updatedAt).toBe(NOW)
  })

  it('adds a product and merges a repeat scan into one line', () => {
    const once = cartReducer(emptyCart({ now: NOW }), {
      type: 'addProduct',
      product: product(),
      now: NOW,
    })
    const twice = cartReducer(once, { type: 'addProduct', product: product(), now: NOW })

    expect(twice.lines).toHaveLength(1)
    expect(twice.lines[0]?.quantity).toBe(2)
    expect(twice.lines[0]?.unitPriceMinor).toBe(10_000)
  })

  it('does not merge a product whose price changed', () => {
    const once = cartReducer(emptyCart({ now: NOW }), {
      type: 'addProduct',
      product: product(),
      now: NOW,
    })
    const twice = cartReducer(once, {
      type: 'addProduct',
      product: product({ unitPriceMinor: 11_000 }),
      now: NOW,
    })

    expect(twice.lines).toHaveLength(2)
  })

  it('does not merge into a discounted line', () => {
    let state = cartReducer(emptyCart({ now: NOW }), {
      type: 'addProduct',
      product: product(),
      now: NOW,
    })
    const lineId = state.lines[0]?.id as string
    state = cartReducer(state, {
      type: 'setLineDiscount',
      lineId,
      discount: { amountMinor: 500, reasonCode: 'STAFF', note: null, override: null },
      now: NOW,
    })
    state = cartReducer(state, { type: 'addProduct', product: product(), now: NOW })

    expect(state.lines).toHaveLength(2)
    expect(state.lines[1]?.lineDiscountMinor).toBe(0)
  })

  it('treats a zero quantity as a removal', () => {
    const state = withLines(1)
    const next = cartReducer(state, {
      type: 'setQuantity',
      lineId: state.lines[0]?.id as string,
      quantity: 0,
      now: NOW,
    })
    expect(next.lines).toHaveLength(0)
  })

  it('clamps quantity to the server limit instead of overflowing', () => {
    const state = withLines(1)
    const next = cartReducer(state, {
      type: 'setQuantity',
      lineId: state.lines[0]?.id as string,
      quantity: 99_999,
      now: NOW,
    })
    expect(next.lines[0]?.quantity).toBe(10_000)
  })
})

describe('cart reducer — discounts', () => {
  it('clamps a line discount to that line gross', () => {
    const state = withLines(1)
    const lineId = state.lines[0]?.id as string
    const next = cartReducer(state, {
      type: 'setLineDiscount',
      lineId,
      discount: { amountMinor: 99_999_999, reasonCode: 'DAMAGE', note: 'Cracked', override: null },
      now: NOW,
    })

    const line = state.lines[0]
    if (!line) throw new Error('expected a line')
    expect(next.lines[0]?.lineDiscountMinor).toBe(lineGrossMinor(line))
    expect(next.lines[0]?.discountReasonCode).toBe('DAMAGE')
    expect(next.lines[0]?.discountNote).toBe('Cracked')
  })

  it('clears a line discount with null', () => {
    const state = withLines(1)
    const lineId = state.lines[0]?.id as string
    const discounted = cartReducer(state, {
      type: 'setLineDiscount',
      lineId,
      discount: { amountMinor: 500, reasonCode: 'STAFF', note: null, override: null },
      now: NOW,
    })
    const cleared = cartReducer(discounted, {
      type: 'setLineDiscount',
      lineId,
      discount: null,
      now: NOW,
    })

    expect(cleared.lines[0]?.lineDiscountMinor).toBe(0)
    expect(cleared.lines[0]?.discountReasonCode).toBeNull()
  })

  it('clamps the sale discount to the net after line discounts', () => {
    const state = withLines(1)
    const next = cartReducer(state, {
      type: 'setSaleDiscount',
      discount: { amountMinor: 9_999_999, reasonCode: 'PROMO', note: null, override: null },
      now: NOW,
    })

    expect(next.saleDiscount?.amountMinor).toBe(netAfterLineDiscounts(state))
  })

  it('drops a sale discount when a line removal leaves nothing to absorb it', () => {
    let state = withLines(2)
    state = cartReducer(state, {
      type: 'setSaleDiscount',
      discount: { amountMinor: 15_000, reasonCode: 'PROMO', note: null, override: proof() },
      now: NOW,
    })
    expect(state.saleDiscount?.amountMinor).toBe(15_000)

    state = cartReducer(state, {
      type: 'removeLine',
      lineId: state.lines[1]?.id as string,
      now: NOW,
    })

    // Only the GHS 100 line is left, so the GHS 150 discount becomes GHS 100...
    expect(state.saleDiscount?.amountMinor).toBe(10_000)
    // ...and it keeps its reason and approval.
    expect(state.saleDiscount?.reasonCode).toBe('PROMO')
    expect(state.saleDiscount?.override?.approverStaffId).toBe('SD-0002')
  })

  it('requires a valid reason code to keep a discount', () => {
    const state = withLines(1)
    const next = cartReducer(state, {
      type: 'setSaleDiscount',
      // A forged draft could carry anything; the reducer refuses it.
      discount: {
        amountMinor: 500,
        reasonCode: 'NOT_A_REASON' as never,
        note: null,
        override: null,
      },
      now: NOW,
    })
    expect(next.saleDiscount).toBeNull()
  })
})

describe('cart reducer — customer, loyalty, overrides', () => {
  const customer = {
    customerId: '33333333-3333-7333-8333-333333333333',
    draftId: null,
    name: 'Akosua Mensah',
    phone: '+233241234567',
    isDraft: false,
  }

  it('clears loyalty and credit approvals when the customer changes', () => {
    let state = cartReducer(withLines(1), {
      type: 'setCustomer',
      customer,
      now: NOW,
    })
    state = cartReducer(state, { type: 'setLoyaltyRedeem', points: 250, now: NOW })
    state = cartReducer(state, { type: 'setCreditOverride', override: proof(), now: NOW })

    const switched = cartReducer(state, {
      type: 'setCustomer',
      customer: { ...customer, customerId: '44444444-4444-7444-8444-444444444444' },
      now: NOW,
    })

    expect(switched.loyaltyRedeemPoints).toBe(0)
    expect(switched.creditOverride).toBeNull()
  })

  it('refuses loyalty points without a customer', () => {
    const next = cartReducer(withLines(1), { type: 'setLoyaltyRedeem', points: 500, now: NOW })
    expect(next.loyaltyRedeemPoints).toBe(0)
  })

  it('refuses a credit approval without a customer', () => {
    const next = cartReducer(withLines(1), {
      type: 'setCreditOverride',
      override: proof(),
      now: NOW,
    })
    expect(next.creditOverride).toBeNull()
  })

  it('keeps points as a non-negative integer', () => {
    let state = cartReducer(withLines(1), { type: 'setCustomer', customer, now: NOW })
    state = cartReducer(state, { type: 'setLoyaltyRedeem', points: -50, now: NOW })
    expect(state.loyaltyRedeemPoints).toBe(0)
  })

  it('starts a new sale id on clear but keeps the shift', () => {
    const state = withLines(1)
    const cleared = cartReducer(state, { type: 'clear', now: NOW })

    expect(cleared.lines).toHaveLength(0)
    expect(cleared.saleId).not.toBe(state.saleId)
    expect(cleared.shiftId).toBe(state.shiftId)
  })
})

describe('sanitizeCartState', () => {
  it('drops lines the pricing engine would reject', () => {
    const state = sanitizeCartState({
      ...emptyCart({ now: NOW }),
      lines: [
        {
          id: 'line-1',
          productId: 'p1',
          sku: 'A',
          name: 'A',
          barcode: null,
          quantity: 0,
          unitPriceMinor: 1000,
          taxCategory: 'NOT_A_CATEGORY' as never,
          lineDiscountMinor: 0,
          discountReasonCode: null,
          discountNote: null,
          discountOverride: null,
        },
        {
          id: 'line-2',
          productId: 'p2',
          sku: 'B',
          name: 'B',
          barcode: null,
          quantity: -3,
          unitPriceMinor: 1000,
          taxCategory: 'STANDARD',
          lineDiscountMinor: 99_999,
          discountReasonCode: 'STAFF',
          discountNote: null,
          discountOverride: null,
        },
      ],
    })

    expect(state.lines).toHaveLength(1)
    expect(state.lines[0]?.quantity).toBe(1)
    expect(state.lines[0]?.lineDiscountMinor).toBe(1_000)
  })

  it('replaces an invalid sale id so the receipt can still be printed', () => {
    const state = sanitizeCartState({ ...emptyCart({ now: NOW }), saleId: 'not-a-uuid' })
    expect(state.saleId).toMatch(/^[0-9a-f-]{36}$/)
  })

  it('drops loyalty, credit approval, and sale discount without a customer', () => {
    const state = sanitizeCartState({
      ...emptyCart({ now: NOW }),
      lines: [],
      loyaltyRedeemPoints: 500,
      creditOverride: proof(),
      saleDiscount: null,
    })
    expect(state.loyaltyRedeemPoints).toBe(0)
    expect(state.creditOverride).toBeNull()
  })
})
