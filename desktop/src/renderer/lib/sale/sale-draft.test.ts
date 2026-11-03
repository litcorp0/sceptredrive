import { describe, expect, it } from 'vitest'
import { cartReducer, emptyCart } from '../cart/reducer'
import { computeCartTotals } from '../cart/totals'
import type { CartOverrideProof, CartState, SellableProduct } from '../cart/types'
import {
  buildSaleDraft,
  parseTenderMethod,
  SaleDraftError,
  type TenderMethod,
  toSaleProof,
} from './sale-draft'

const NOW = '2026-10-23T10:00:00.000Z'
const CONTEXT = {
  taxMode: 'INCLUSIVE' as const,
  loyalty: { pointsPerCedi: 100, earnPointsPerCedi: 1 },
}

const CASHIER = {
  userId: 'user-cashier',
  staffId: 'SD-0003',
  bindingId: '33333333-3333-7333-8333-333333333333',
  bindingToken: 'binding-token-value',
  pinVersion: 2,
}

const PROOF: CartOverrideProof = {
  approverUserId: 'user-manager',
  approverStaffId: 'SD-0002',
  approverRole: 'MANAGER',
  bindingId: '22222222-2222-7222-8222-222222222222',
  pinVersion: 4,
  reasonCode: 'CUSTOMER_REQUEST',
  note: 'Known customer',
  approvedAt: NOW,
}

function product(id: string, priceMinor: number): SellableProduct {
  return {
    id,
    sku: `SKU-${id}`,
    name: `Product ${id}`,
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

function draftFor(
  cart: CartState,
  tender: {
    method: TenderMethod
    amountMinor: number
    override?: CartOverrideProof | null
    paymentId?: string | null
    providerReference?: string | null
  },
  extra: Array<{
    method: TenderMethod
    amountMinor: number
    override?: CartOverrideProof | null
    paymentId?: string | null
    providerReference?: string | null
  }> = [],
) {
  return buildSaleDraft({
    cart,
    totals: computeCartTotals(cart, CONTEXT),
    cashier: CASHIER,
    shiftId: 'shift-1',
    receiptNumber: 'SPX-T01-20261023-0001',
    tenders: [tender, ...extra].map((line) => ({
      method: line.method,
      amountMinor: line.amountMinor,
      override: line.override ?? null,
      paymentId: line.paymentId ?? null,
      providerReference: line.providerReference ?? null,
    })),
    occurredAt: NOW,
    appVersion: '0.1.0',
  })
}

describe('buildSaleDraft — cash', () => {
  it('carries the cart, the cashier binding, and integer totals', () => {
    const cart = cartWith([['p1', 10_000, 2]])
    const draft = draftFor(cart, { method: 'CASH', amountMinor: 25_000 })

    expect(draft.type).toBe('SALE')
    expect(draft.payloadVersion).toBe(1)
    expect(draft.clientTransactionId).toBe(cart.saleId)
    expect(draft.payload.receiptNumber).toBe('SPX-T01-20261023-0001')
    expect(draft.payload.cashier).toEqual({
      userId: 'user-cashier',
      staffId: 'SD-0003',
      bindingId: CASHIER.bindingId,
      bindingToken: CASHIER.bindingToken,
      pinVersion: 2,
    })
    expect(draft.payload.lines).toEqual([
      {
        productId: 'p1',
        quantity: 2,
        unitPriceMinor: 10_000,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      },
    ])
    expect(draft.payload.totals.totalMinor).toBe(20_000)
    expect(draft.payload.totals.changeMinor).toBe(5_000)
    expect(draft.payload.tenders).toEqual([
      {
        method: 'CASH',
        amountMinor: 25_000,
        override: null,
        paymentId: null,
      },
    ])
  })

  it('matches the server payload contract key for key', () => {
    const draft = draftFor(cartWith([['p1', 1_000, 1]]), { method: 'CASH', amountMinor: 1_000 })

    // The upload schema is `.strict()` at every level: an extra key is a 400.
    expect(Object.keys(draft.payload).sort()).toEqual(
      [
        'appVersion',
        'cashier',
        'customer',
        'lines',
        'loyalty',
        'occurredAt',
        'receiptNumber',
        'saleDiscount',
        'shiftId',
        'tenders',
        'totals',
      ].sort(),
    )
    expect(Object.keys(draft.payload.cashier).sort()).toEqual(
      ['bindingId', 'bindingToken', 'pinVersion', 'staffId', 'userId'].sort(),
    )
    expect(Object.keys(draft.payload.totals).sort()).toEqual(
      [
        'changeMinor',
        'getfundMinor',
        'lineDiscountMinor',
        'loyaltyDiscountMinor',
        'nhilMinor',
        'saleDiscountMinor',
        'subtotalMinor',
        'taxTotalMinor',
        'totalMinor',
        'vatMinor',
      ].sort(),
    )
  })

  it('accepts exact cash and gives no change', () => {
    const draft = draftFor(cartWith([['p1', 1_000, 1]]), { method: 'CASH', amountMinor: 1_000 })
    expect(draft.payload.totals.changeMinor).toBe(0)
  })

  it('refuses cash below the total', () => {
    expect(() =>
      draftFor(cartWith([['p1', 1_000, 1]]), { method: 'CASH', amountMinor: 999 }),
    ).toThrow(SaleDraftError)
  })

  it('refuses an empty cart or a missing shift', () => {
    const cart = cartWith([['p1', 1_000, 1]])
    expect(() => draftFor(emptyCart({ now: NOW }), { method: 'CASH', amountMinor: 0 })).toThrow(
      /at least one line/,
    )
    expect(() =>
      buildSaleDraft({
        cart,
        totals: computeCartTotals(cart, CONTEXT),
        cashier: CASHIER,
        shiftId: '',
        receiptNumber: 'X-1',
        tenders: [
          {
            method: 'CASH',
            amountMinor: 1_000,
            override: null,
            paymentId: null,
            providerReference: null,
          },
        ],
        occurredAt: NOW,
      }),
    ).toThrow(/Open a shift/)
  })
})

describe('buildSaleDraft — zero total', () => {
  it('sends no tender when loyalty covers the cart', () => {
    let cart = cartWith([['p1', 1_000, 1]])
    cart = cartReducer(cart, {
      type: 'setCustomer',
      customer: {
        customerId: '44444444-4444-7444-8444-444444444444',
        draftId: null,
        name: 'Akosua',
        phone: '+233241234567',
        isDraft: false,
      },
      now: NOW,
    })
    cart = cartReducer(cart, { type: 'setLoyaltyRedeem', points: 1_000, now: NOW })

    const draft = buildSaleDraft({
      cart,
      totals: computeCartTotals(cart, CONTEXT),
      cashier: CASHIER,
      shiftId: 'shift-1',
      receiptNumber: 'SPX-T01-20261023-0001',
      tenders: [],
      occurredAt: NOW,
      appVersion: '0.1.0',
    })
    expect(draft.payload.totals.totalMinor).toBe(0)
    expect(draft.payload.tenders).toEqual([])
    expect(draft.payload.totals.changeMinor).toBe(0)
    expect(draft.payload.loyalty).toEqual({ redeemPoints: 1_000, earnPreviewPoints: 0 })
  })
})

describe('buildSaleDraft — credit', () => {
  const customer = {
    customerId: '44444444-4444-7444-8444-444444444444',
    draftId: null,
    name: 'Akosua',
    phone: '+233241234567',
    isDraft: false,
  }

  it('charges the total and ships the approval proof', () => {
    let cart = cartWith([['p1', 1_000, 1]])
    cart = cartReducer(cart, { type: 'setCustomer', customer, now: NOW })
    cart = cartReducer(cart, { type: 'setCreditOverride', override: PROOF, now: NOW })

    const draft = draftFor(cart, { method: 'CREDIT', amountMinor: 1_000, override: PROOF })
    expect(draft.payload.customer).toEqual({
      id: customer.customerId,
      phone: customer.phone,
    })
    expect(draft.payload.tenders).toEqual([
      {
        method: 'CREDIT',
        amountMinor: 1_000,
        override: {
          staffId: 'SD-0002',
          userId: 'user-manager',
          bindingId: PROOF.bindingId,
          pinVersion: 4,
          reasonCode: 'CUSTOMER_REQUEST',
          note: 'Known customer',
          occurredAt: NOW,
        },
        paymentId: null,
      },
    ])
    expect(draft.payload.totals.changeMinor).toBe(0)
  })

  it('refuses credit without a customer', () => {
    expect(() =>
      draftFor(cartWith([['p1', 1_000, 1]]), { method: 'CREDIT', amountMinor: 1_000 }),
    ).toThrow(/needs a customer/)
  })

  it('sends a draft customer by its client id with a name', () => {
    let cart = cartWith([['p1', 1_000, 1]])
    cart = cartReducer(cart, {
      type: 'setCustomer',
      customer: {
        customerId: null,
        draftId: '66666666-6666-7666-8666-666666666666',
        name: 'Ama Boateng',
        phone: '+233201234567',
        isDraft: true,
      },
      now: NOW,
    })

    const draft = draftFor(cart, { method: 'CREDIT', amountMinor: 1_000 })
    expect(draft.payload.customer).toEqual({
      id: '66666666-6666-7666-8666-666666666666',
      phone: '+233201234567',
      name: 'Ama Boateng',
    })
  })
})

describe('buildSaleDraft — discounts', () => {
  it('sends the sale discount with its approval', () => {
    let cart = cartWith([['p1', 10_000, 1]])
    cart = cartReducer(cart, {
      type: 'setSaleDiscount',
      discount: { amountMinor: 2_000, reasonCode: 'PROMO', note: 'Weekend', override: PROOF },
      now: NOW,
    })

    const draft = draftFor(cart, { method: 'CASH', amountMinor: 8_000 })
    expect(draft.payload.saleDiscount).toEqual({
      amountMinor: 2_000,
      reasonCode: 'PROMO',
      note: 'Weekend',
      override: expect.objectContaining({ staffId: 'SD-0002', occurredAt: NOW }),
    })
  })

  it('promotes a line-discount approval onto the sale discount slot', () => {
    let cart = cartWith([['p1', 10_000, 1]])
    cart = cartReducer(cart, {
      type: 'setLineDiscount',
      lineId: cart.lines[0]?.id as string,
      discount: { amountMinor: 1_000, reasonCode: 'STAFF', note: null, override: PROOF },
      now: NOW,
    })

    const draft = draftFor(cart, { method: 'CASH', amountMinor: 9_000 })
    expect(draft.payload.lines[0]?.lineDiscountMinor).toBe(1_000)
    expect(draft.payload.saleDiscount).toMatchObject({
      amountMinor: 0,
      reasonCode: 'OTHER',
      override: { staffId: 'SD-0002' },
    })
  })

  it('sends no discount object and no proof for a plain sale', () => {
    const draft = draftFor(cartWith([['p1', 1_000, 1]]), { method: 'CASH', amountMinor: 1_000 })
    expect(draft.payload.saleDiscount).toBeNull()
  })
})

describe('buildSaleDraft — split tender', () => {
  const customer = {
    customerId: '44444444-4444-7444-8444-444444444444',
    draftId: null,
    name: 'Akosua',
    phone: '+233241234567',
    isDraft: false,
  }

  it('carries both tenders in payment order with no change', () => {
    let cart = cartWith([['p1', 10_000, 1]])
    cart = cartReducer(cart, { type: 'setCustomer', customer, now: NOW })

    const draft = draftFor(cart, { method: 'CASH', amountMinor: 4_000 }, [
      { method: 'CREDIT', amountMinor: 6_000 },
    ])

    expect(draft.payload.totals.totalMinor).toBe(10_000)
    expect(draft.payload.tenders).toEqual([
      {
        method: 'CASH',
        amountMinor: 4_000,
        override: null,
        paymentId: null,
      },
      {
        method: 'CREDIT',
        amountMinor: 6_000,
        override: null,
        paymentId: null,
      },
    ])
    expect(draft.payload.totals.changeMinor).toBe(0)
  })

  it('takes change from cash that overpays the whole sale', () => {
    const draft = draftFor(cartWith([['p1', 10_000, 1]]), { method: 'CASH', amountMinor: 12_000 })
    expect(draft.payload.totals.changeMinor).toBe(2_000)
  })

  it('refuses credit larger than the sale total', () => {
    let cart = cartWith([['p1', 10_000, 1]])
    cart = cartReducer(cart, { type: 'setCustomer', customer, now: NOW })

    try {
      draftFor(cart, { method: 'CREDIT', amountMinor: 10_001 })
      throw new Error('expected failure')
    } catch (error) {
      expect(error).toBeInstanceOf(SaleDraftError)
      expect((error as SaleDraftError).code).toBe('CREDIT_EXCEEDS_TOTAL')
    }
  })

  it('refuses a proof on a cash tender — only credit can be approved', () => {
    const cart = cartWith([['p1', 1_000, 1]])
    expect(() => draftFor(cart, { method: 'CASH', amountMinor: 1_000, override: PROOF })).toThrow(
      /Only a credit payment/,
    )
  })

  it('refuses a zero-total sale that carries a tender', () => {
    let cart = cartWith([['p1', 1_000, 1]])
    cart = cartReducer(cart, {
      type: 'setCustomer',
      customer,
      now: NOW,
    })
    cart = cartReducer(cart, { type: 'setLoyaltyRedeem', points: 1_000, now: NOW })
    expect(() => draftFor(cart, { method: 'CASH', amountMinor: 500 })).toThrow(/takes no payment/)
  })
})

describe('buildSaleDraft — electronic tender', () => {
  const paymentId = '77777777-7777-7777-8777-777777777777'

  it('sends the payment reference for an electronic tender and null for cash', () => {
    const draft = draftFor(cartWith([['p1', 10_000, 1]]), { method: 'CASH', amountMinor: 4_000 }, [
      {
        method: 'MOMO',
        amountMinor: 6_000,
        paymentId,
        providerReference: 'sd-cp_1',
      },
    ])

    expect(draft.payload.tenders).toEqual([
      {
        method: 'CASH',
        amountMinor: 4_000,
        override: null,
        paymentId: null,
      },
      {
        method: 'MOMO',
        amountMinor: 6_000,
        override: null,
        paymentId,
      },
    ])
  })

  it('keeps exactly the keys the strict upload schema expects', () => {
    const draft = draftFor(cartWith([['p1', 10_000, 1]]), {
      method: 'CARD',
      amountMinor: 10_000,
      paymentId,
      providerReference: 'sd-cp_2',
    })

    expect(Object.keys(draft.payload.tenders[0] ?? {}).sort()).toEqual(
      ['amountMinor', 'method', 'override', 'paymentId'].sort(),
    )
  })
})

describe('parseTenderMethod', () => {
  it('reads a stored method back as itself', () => {
    expect(parseTenderMethod('MOMO')).toBe('MOMO')
    expect(parseTenderMethod('CASH')).toBe('CASH')
  })

  it('throws instead of reading an unknown value as cash', () => {
    // The old coercion would have printed a stored MOMO row as cash on a reprint.
    try {
      parseTenderMethod('MOMO_LEGACY')
      throw new Error('expected failure')
    } catch (error) {
      expect((error as SaleDraftError).code).toBe('INVALID_TENDER')
    }
  })
})

describe('toSaleProof', () => {
  it('maps only the fields the server accepts', () => {
    expect(toSaleProof(PROOF)).toEqual({
      staffId: 'SD-0002',
      userId: 'user-manager',
      bindingId: PROOF.bindingId,
      pinVersion: 4,
      reasonCode: 'CUSTOMER_REQUEST',
      note: 'Known customer',
      occurredAt: NOW,
    })
    expect(toSaleProof(null)).toBeNull()
  })
})
