import { isUuid, uuidv7 } from '../id'
import {
  type CartAction,
  type CartDiscount,
  type CartLine,
  type CartState,
  DISCOUNT_REASON_CODES,
  type DiscountReasonCode,
  type SellableProduct,
} from './types'

/**
 * Cart state machine (Plan 06 Task 1).
 *
 * The reducer owns the invariants that keep pricing safe:
 *
 * - quantity is an integer in `1..MAX_LINE_QUANTITY` (0 removes the line);
 * - a line discount never exceeds that line's gross;
 * - the sale discount never exceeds the net after line discounts;
 * - loyalty points are a non-negative integer and only exist with a customer;
 * - an override never outlives the customer it was approved for.
 *
 * Money itself is never computed here — `totals.ts` runs the shared
 * `priceCart`, which is the single pricing implementation on both sides
 * (D14).
 */

export const MAX_LINE_QUANTITY = 10_000

const TAX_CATEGORIES = new Set<string>(['STANDARD', 'ZERO_RATED', 'EXEMPT'])

function toMinor(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

function toQuantity(value: unknown): number {
  if (typeof value !== 'number' || !Number.isSafeInteger(value)) return 1
  if (value < 1) return 1
  return value > MAX_LINE_QUANTITY ? MAX_LINE_QUANTITY : value
}

export function lineGrossMinor(line: Pick<CartLine, 'quantity' | 'unitPriceMinor'>): number {
  return line.unitPriceMinor * line.quantity
}

/** Gross minus line discounts: what a sale-level discount may be spread over. */
export function netAfterLineDiscounts(state: CartState): number {
  return (
    state.lines.reduce((total, line) => total + lineGrossMinor(line), 0) -
    state.lines.reduce((total, line) => total + line.lineDiscountMinor, 0)
  )
}

function clampDiscount(discount: CartDiscount | null, availableMinor: number): CartDiscount | null {
  if (!discount) return null
  const amountMinor = Math.min(toMinor(discount.amountMinor), Math.max(0, availableMinor))
  if (amountMinor === 0) return null
  if (!DISCOUNT_REASON_CODES.includes(discount.reasonCode)) return null
  return {
    amountMinor,
    reasonCode: discount.reasonCode,
    note: discount.note?.trim() ? discount.note.trim().slice(0, 200) : null,
    override: discount.override,
  }
}

function emptyLineId(): string {
  return uuidv7()
}

export function emptyCart(
  options: { now?: string; saleId?: string; shiftId?: string | null } = {},
): CartState {
  return {
    saleId: options.saleId ?? uuidv7(),
    shiftId: options.shiftId ?? null,
    lines: [],
    saleDiscount: null,
    loyaltyRedeemPoints: 0,
    customer: null,
    creditOverride: null,
    updatedAt: options.now ?? new Date().toISOString(),
  }
}

/**
 * Re-establishes every invariant. Used after hydration, so a draft written by
 * an older build (or a partially written row) can never reach `priceCart` in a
 * shape it rejects.
 */
export function sanitizeCartState(input: CartState): CartState {
  const lines: CartLine[] = []

  for (const line of Array.isArray(input.lines) ? input.lines : []) {
    if (!line || typeof line.productId !== 'string' || !line.productId) continue
    if (!TAX_CATEGORIES.has(line.taxCategory)) continue
    const quantity = toQuantity(line.quantity)
    const unitPriceMinor = toMinor(line.unitPriceMinor)
    const gross = unitPriceMinor * quantity
    const lineDiscountMinor = Math.min(toMinor(line.lineDiscountMinor), gross)
    if (!Number.isSafeInteger(gross)) continue
    lines.push({
      id: typeof line.id === 'string' && line.id ? line.id : emptyLineId(),
      productId: line.productId,
      sku: typeof line.sku === 'string' ? line.sku : '',
      name: typeof line.name === 'string' ? line.name : '',
      barcode: typeof line.barcode === 'string' ? line.barcode : null,
      quantity,
      unitPriceMinor,
      taxCategory: line.taxCategory,
      lineDiscountMinor,
      discountReasonCode: lineDiscountMinor > 0 ? (line.discountReasonCode ?? null) : null,
      discountNote: lineDiscountMinor > 0 ? (line.discountNote ?? null) : null,
      discountOverride: lineDiscountMinor > 0 ? (line.discountOverride ?? null) : null,
    })
  }

  const customer = input.customer ?? null
  const state: CartState = {
    saleId: isUuid(input.saleId) ? input.saleId : uuidv7(),
    shiftId: typeof input.shiftId === 'string' ? input.shiftId : null,
    lines,
    saleDiscount: null,
    loyaltyRedeemPoints: customer ? toMinor(input.loyaltyRedeemPoints) : 0,
    customer,
    creditOverride: customer ? (input.creditOverride ?? null) : null,
    updatedAt: typeof input.updatedAt === 'string' ? input.updatedAt : new Date().toISOString(),
  }

  state.saleDiscount = clampDiscount(input.saleDiscount ?? null, netAfterLineDiscounts(state))
  return state
}

function sameSellable(line: CartLine, product: SellableProduct): boolean {
  return (
    line.productId === product.id &&
    line.unitPriceMinor === product.unitPriceMinor &&
    line.taxCategory === product.taxCategory &&
    line.lineDiscountMinor === 0
  )
}

function withTimestamp(state: CartState, now: string | undefined): CartState {
  return { ...state, updatedAt: now ?? new Date().toISOString() }
}

function replaceLine(state: CartState, lineId: string, patch: Partial<CartLine>): CartState {
  return {
    ...state,
    lines: state.lines.map((line) => (line.id === lineId ? { ...line, ...patch } : line)),
  }
}

export function cartReducer(state: CartState, action: CartAction): CartState {
  switch (action.type) {
    case 'addProduct': {
      const quantityToAdd = toQuantity(action.quantity ?? 1)
      const existing = state.lines.find((line) => sameSellable(line, action.product))

      if (existing) {
        const nextQuantity = Math.min(existing.quantity + quantityToAdd, MAX_LINE_QUANTITY)
        return withTimestamp(
          replaceLine(state, existing.id, { quantity: nextQuantity }),
          action.now,
        )
      }

      const line: CartLine = {
        id: emptyLineId(),
        productId: action.product.id,
        sku: action.product.sku,
        name: action.product.name,
        barcode: action.product.barcode,
        quantity: quantityToAdd,
        unitPriceMinor: action.product.unitPriceMinor,
        taxCategory: action.product.taxCategory,
        lineDiscountMinor: 0,
        discountReasonCode: null,
        discountNote: null,
        discountOverride: null,
      }

      return withTimestamp({ ...state, lines: [...state.lines, line] }, action.now)
    }

    case 'setQuantity': {
      const line = state.lines.find((candidate) => candidate.id === action.lineId)
      if (!line) return state

      const requested = Number.isSafeInteger(action.quantity) ? action.quantity : line.quantity
      if (requested < 1) {
        return cartReducer(state, { type: 'removeLine', lineId: action.lineId, now: action.now })
      }

      const quantity = Math.min(requested, MAX_LINE_QUANTITY)
      const gross = line.unitPriceMinor * quantity
      const next = replaceLine(state, line.id, {
        quantity,
        lineDiscountMinor: Math.min(line.lineDiscountMinor, gross),
      })
      return withTimestamp(next, action.now)
    }

    case 'removeLine': {
      const lines = state.lines.filter((line) => line.id !== action.lineId)
      if (lines.length === state.lines.length) return state
      const next = sanitizeCartState({ ...state, lines })
      return withTimestamp(next, action.now)
    }

    case 'setLineDiscount': {
      const line = state.lines.find((candidate) => candidate.id === action.lineId)
      if (!line) return state

      if (!action.discount) {
        return withTimestamp(
          replaceLine(state, line.id, {
            lineDiscountMinor: 0,
            discountReasonCode: null,
            discountNote: null,
            discountOverride: null,
          }),
          action.now,
        )
      }

      const clamped = clampDiscount(action.discount, lineGrossMinor(line))
      if (!clamped)
        return cartReducer(state, {
          type: 'setLineDiscount',
          lineId: line.id,
          discount: null,
          now: action.now,
        })

      return withTimestamp(
        replaceLine(state, line.id, {
          lineDiscountMinor: clamped.amountMinor,
          discountReasonCode: clamped.reasonCode,
          discountNote: clamped.note,
          discountOverride: clamped.override,
        }),
        action.now,
      )
    }

    case 'setSaleDiscount': {
      const clamped = clampDiscount(action.discount, netAfterLineDiscounts(state))
      return withTimestamp({ ...state, saleDiscount: clamped }, action.now)
    }

    case 'setCustomer': {
      // Loyalty and credit approvals are customer-specific: changing or
      // clearing the customer starts those choices over (Plan 06 Task 3).
      return withTimestamp(
        {
          ...state,
          customer: action.customer,
          loyaltyRedeemPoints: 0,
          creditOverride: null,
        },
        action.now,
      )
    }

    case 'setLoyaltyRedeem': {
      if (!state.customer) {
        return withTimestamp({ ...state, loyaltyRedeemPoints: 0 }, action.now)
      }
      const points = Math.min(toMinor(action.points), Number.MAX_SAFE_INTEGER)
      return withTimestamp({ ...state, loyaltyRedeemPoints: points }, action.now)
    }

    case 'setCreditOverride': {
      return withTimestamp(
        { ...state, creditOverride: state.customer ? action.override : null },
        action.now,
      )
    }

    case 'clear': {
      return emptyCart({ now: action.now, shiftId: state.shiftId })
    }

    case 'hydrate': {
      return sanitizeCartState(action.state)
    }

    default: {
      return state
    }
  }
}

/** Reason codes the discount dialog offers, in display order. */
export const DISCOUNT_REASONS: ReadonlyArray<{ code: DiscountReasonCode; label: string }> = [
  { code: 'STAFF', label: 'Staff' },
  { code: 'DAMAGE', label: 'Damaged' },
  { code: 'PROMO', label: 'Promotion' },
  { code: 'OTHER', label: 'Other' },
]
