import { type PricedCart, priceCart, type TaxMode } from '@sceptre/shared'
import type { CartState } from './types'

/**
 * Cart money (Plan 06 Tasks 4 and 6).
 *
 * Every displayed amount comes from one call to the shared `priceCart` with the
 * branch's tax mode, so the till shows exactly what the server will recompute
 * (D14). Nothing in the UI may add, subtract, or round money itself.
 */

export interface CartPricingContext {
  taxMode: TaxMode
  /**
   * False prices every line exempt: no VAT, NHIL or GETFund. Omitted means
   * taxable — the safe default, so a caller that forgets the field cannot stop
   * collecting tax by accident. The till always passes it from the config
   * snapshot.
   */
  vatRegistered?: boolean
  loyalty: {
    /** Loyalty points per GHS 1 of redemption value (100 = 100 points per cedi). */
    pointsPerCedi: number
    /** Points earned per GHS 1 of taxable base (1 = 1 point per cedi). */
    earnPointsPerCedi: number
  }
}

export interface CartTotals {
  priced: PricedCart
  /** Sum of quantities, for the "N items" chip. */
  itemCount: number
  grossMinor: number
  /** Line plus sale discounts — the number the discount cap measures. */
  totalDiscountMinor: number
  /** Floor of `totalDiscountMinor / gross`, i.e. the server's cap formula. */
  discountPercent: number
  /** Value of the points the cashier asked to redeem, before clamping. */
  loyaltyRequestedValueMinor: number
  /** Value actually applied (never more than the cart can absorb). */
  loyaltyDiscountMinor: number
  earnPreviewPoints: number
}

const BASIS_POINTS = 100

/** Pesewa value of a points balance at the current rate. Integer floor. */
export function loyaltyValueMinor(points: number, pointsPerCedi: number): number {
  if (!Number.isSafeInteger(points) || points <= 0) return 0
  if (!Number.isSafeInteger(pointsPerCedi) || pointsPerCedi <= 0) return 0
  return Math.floor((points * BASIS_POINTS) / pointsPerCedi)
}

/** Inverse of `loyaltyValueMinor`, for "the most points this cart can absorb". */
export function pointsForValueMinor(valueMinor: number, pointsPerCedi: number): number {
  if (!Number.isSafeInteger(valueMinor) || valueMinor <= 0) return 0
  if (!Number.isSafeInteger(pointsPerCedi) || pointsPerCedi <= 0) return 0
  return Math.floor((valueMinor * pointsPerCedi) / BASIS_POINTS)
}

/**
 * Earn preview, identical to the server (`floor(base × rate / 100)`, where base
 * is the tax-exclusive base after discounts and redemption). Points are not
 * money, so the server owns the final number; this is only the preview the
 * cashier sees before committing (D18).
 */
export function earnPreviewPoints(baseMinor: number, earnPointsPerCedi: number): number {
  if (!Number.isSafeInteger(baseMinor) || baseMinor <= 0) return 0
  if (!Number.isSafeInteger(earnPointsPerCedi) || earnPointsPerCedi <= 0) return 0
  return Math.floor((baseMinor * earnPointsPerCedi) / BASIS_POINTS)
}

export function computeCartTotals(state: CartState, context: CartPricingContext): CartTotals {
  const requestedValueMinor = loyaltyValueMinor(
    state.loyaltyRedeemPoints,
    context.loyalty.pointsPerCedi,
  )

  const priced = priceCart(
    state.lines.map((line) => ({
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineDiscountMinor: line.lineDiscountMinor,
      taxCategory: line.taxCategory,
    })),
    {
      taxMode: context.taxMode,
      vatRegistered: context.vatRegistered,
      saleDiscountMinor: state.saleDiscount?.amountMinor ?? 0,
      loyaltyDiscountMinor: requestedValueMinor,
    },
  )

  const totalDiscountMinor = priced.lineDiscountMinor + priced.saleDiscountMinor

  return {
    priced,
    itemCount: state.lines.reduce((total, line) => total + line.quantity, 0),
    grossMinor: priced.subtotalMinor,
    totalDiscountMinor,
    discountPercent:
      priced.subtotalMinor > 0
        ? Math.floor((totalDiscountMinor * BASIS_POINTS) / priced.subtotalMinor)
        : 0,
    loyaltyRequestedValueMinor: requestedValueMinor,
    loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
    earnPreviewPoints: earnPreviewPoints(priced.baseMinor, context.loyalty.earnPointsPerCedi),
  }
}

/**
 * The most points this cart can usefully absorb: redeeming more than the total
 * would burn points for no discount (there is no change for points).
 */
export function maxRedeemablePoints(
  netMinor: number,
  availablePoints: number,
  pointsPerCedi: number,
): number {
  const byValue = pointsForValueMinor(netMinor, pointsPerCedi)
  return Math.max(0, Math.min(availablePoints, byValue))
}
