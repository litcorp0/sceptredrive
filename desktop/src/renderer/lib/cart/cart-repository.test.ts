import { describe, expect, it } from 'vitest'
import { fromDraftRows, parseProof, toDraftRows } from './cart-repository'
import { emptyCart } from './reducer'
import type { CartOverrideProof, CartState } from './types'

const NOW = '2026-10-23T10:00:00.000Z'

const PROOF: CartOverrideProof = {
  approverUserId: 'user-manager',
  approverStaffId: 'GA-0002',
  approverRole: 'MANAGER',
  bindingId: '22222222-2222-7222-8222-222222222222',
  pinVersion: 4,
  reasonCode: 'CUSTOMER_REQUEST',
  note: 'Known customer',
  approvedAt: NOW,
}

function state(): CartState {
  return {
    saleId: '55555555-5555-7555-8555-555555555555',
    shiftId: 'shift-1',
    lines: [
      {
        id: 'line-1',
        productId: 'p1',
        sku: 'GIK-00001',
        name: 'Brake Pad Set',
        barcode: '4006381333931',
        quantity: 2,
        unitPriceMinor: 10_000,
        taxCategory: 'STANDARD',
        lineDiscountMinor: 500,
        discountReasonCode: 'STAFF',
        discountNote: null,
        discountOverride: PROOF,
      },
      {
        id: 'line-2',
        productId: 'p2',
        sku: 'GIK-00002',
        name: 'Oil Filter',
        barcode: null,
        quantity: 1,
        unitPriceMinor: 2_500,
        taxCategory: 'ZERO_RATED',
        lineDiscountMinor: 0,
        discountReasonCode: null,
        discountNote: null,
        discountOverride: null,
      },
    ],
    saleDiscount: {
      amountMinor: 1_000,
      reasonCode: 'PROMO',
      note: 'Weekend promo',
      override: PROOF,
    },
    loyaltyRedeemPoints: 250,
    customer: {
      customerId: null,
      draftId: '66666666-6666-7666-8666-666666666666',
      name: 'Ama Boateng',
      phone: '+233201234567',
      isDraft: true,
    },
    creditOverride: PROOF,
    updatedAt: NOW,
  }
}

describe('cart draft round-trip', () => {
  it('survives a write and read with every field intact', () => {
    const original = state()
    const { draft, lines } = toDraftRows(original)
    const restored = fromDraftRows(draft, lines)

    expect(restored).toEqual(original)
  })

  it('keeps line order by line number', () => {
    const { draft, lines } = toDraftRows(state())
    const restored = fromDraftRows(draft, [...lines].reverse())
    expect(restored.lines.map((line) => line.sku)).toEqual(['GIK-00001', 'GIK-00002'])
  })

  it('round-trips an empty cart', () => {
    const original = emptyCart({ now: NOW, shiftId: 'shift-1' })
    const { draft, lines } = toDraftRows(original)
    const restored = fromDraftRows(draft, lines)

    expect(restored).toEqual(original)
    expect(restored.lines).toEqual([])
    expect(restored.customer).toBeNull()
  })

  it('writes the shift id so a draft from another shift can be discarded', () => {
    const { draft } = toDraftRows(state())
    expect(draft.shift_id).toBe('shift-1')
  })
})

describe('parseProof', () => {
  it('accepts a well-formed proof', () => {
    expect(parseProof(JSON.stringify(PROOF))).toEqual(PROOF)
  })

  it('rejects malformed JSON and missing fields instead of trusting them', () => {
    expect(parseProof('not json')).toBeNull()
    expect(parseProof('{}')).toBeNull()
    expect(parseProof(JSON.stringify({ ...PROOF, approverRole: 'OWNER' }))).toBeNull()
    expect(parseProof(null)).toBeNull()
  })
})
