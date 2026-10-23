import type { Role, TaxCategory } from '@gikautos/shared'

/**
 * The selling cart, as the terminal holds it.
 *
 * Pure data only: no money is derived here (see `totals.ts`, which runs the
 * shared `priceCart`). Every amount is an integer in pesewas, every quantity a
 * positive integer — the reducer keeps those invariants so pricing can never
 * throw on a cart the cashier built through the UI.
 */

/** Mirrors the upload contract's `saleDiscount.reasonCode` enum (D22/D23). */
export const DISCOUNT_REASON_CODES = ['STAFF', 'DAMAGE', 'PROMO', 'OTHER'] as const
export type DiscountReasonCode = (typeof DISCOUNT_REASON_CODES)[number]

/** Mirrors the server's `CreditOverrideReason` codes the POS may send. */
export const CREDIT_REASON_CODES = ['CUSTOMER_REQUEST', 'APPROVED', 'OTHER'] as const
export type CreditReasonCode = (typeof CREDIT_REASON_CODES)[number]

/**
 * Proof that a manager/admin approved something at the till (D22).
 *
 * The device verifies the PIN against the manager's own binding, then stores
 * this on the cart and ships it with the sale. The server revalidates the
 * person, role, branch, and permission, and raises `OVERRIDE_INVALID` if the
 * proof does not hold — the sale still applies.
 */
export interface CartOverrideProof {
  approverUserId: string
  approverStaffId: string
  approverRole: Role
  bindingId: string
  pinVersion: number
  reasonCode: string
  note: string | null
  approvedAt: string
}

export interface CartDiscount {
  amountMinor: number
  reasonCode: DiscountReasonCode
  note: string | null
  override: CartOverrideProof | null
}

export interface CartLine {
  /** Local line id; stable across quantity and discount edits. */
  id: string
  productId: string
  sku: string
  name: string
  /** The code that added the line, for the receipt and re-scanning. */
  barcode: string | null
  quantity: number
  unitPriceMinor: number
  taxCategory: TaxCategory
  lineDiscountMinor: number
  discountReasonCode: DiscountReasonCode | null
  discountNote: string | null
  discountOverride: CartOverrideProof | null
}

/** A synced customer or an offline draft, presented the same way. */
export interface CartCustomer {
  /** Set for a synced customer. */
  customerId: string | null
  /** Set for a local `customer_draft` not yet linked by the server. */
  draftId: string | null
  name: string
  phone: string
  isDraft: boolean
}

export interface CartState {
  /** Future sale id and client transaction id (D13). */
  saleId: string
  shiftId: string | null
  lines: CartLine[]
  saleDiscount: CartDiscount | null
  loyaltyRedeemPoints: number
  customer: CartCustomer | null
  creditOverride: CartOverrideProof | null
  updatedAt: string
}

/** What the catalogue needs to hand the cart when a product is added. */
export interface SellableProduct {
  id: string
  sku: string
  name: string
  barcode: string | null
  unitPriceMinor: number
  taxCategory: TaxCategory
}

export type CartAction =
  | { type: 'addProduct'; product: SellableProduct; quantity?: number; now?: string }
  | { type: 'setQuantity'; lineId: string; quantity: number; now?: string }
  | { type: 'removeLine'; lineId: string; now?: string }
  | { type: 'setLineDiscount'; lineId: string; discount: CartDiscount | null; now?: string }
  | { type: 'setSaleDiscount'; discount: CartDiscount | null; now?: string }
  | { type: 'setCustomer'; customer: CartCustomer | null; now?: string }
  | { type: 'setLoyaltyRedeem'; points: number; now?: string }
  | { type: 'setCreditOverride'; override: CartOverrideProof | null; now?: string }
  | { type: 'clear'; now?: string }
  | { type: 'hydrate'; state: CartState }
