import { loyaltyValueMinor, maxRedeemablePoints } from '../cart/totals'

/**
 * Redemption quoting (Plan 06 Task 4, D18).
 *
 * The terminal shows a value before the cashier commits: points × the current
 * rate, floored to pesewas, and how much the cart can actually absorb. The
 * screen never stops a valid redemption, and a redemption larger than the cart
 * is clamped by the pricing engine rather than producing a negative total.
 */

export const REDEEM_BELOW_MINIMUM = 'BELOW_MINIMUM'
export const REDEEM_ABOVE_BALANCE = 'ABOVE_BALANCE'
export const REDEEM_INVALID_POINTS = 'INVALID_POINTS'

export type RedeemProblem =
  | typeof REDEEM_BELOW_MINIMUM
  | typeof REDEEM_ABOVE_BALANCE
  | typeof REDEEM_INVALID_POINTS

export interface RedeemQuoteInput {
  points: number
  pointsPerCedi: number
  minimumRedeemPoints: number
  availablePoints: number
  /** Net after line and sale discounts: what the redemption can absorb. */
  cartNetMinor: number
}

export interface RedeemQuote {
  points: number
  /** What the points are worth at the current rate. */
  valueMinor: number
  /** What would actually come off this cart (never more than the net). */
  appliedMinor: number
  /** The most points this cart and balance allow. */
  maxPoints: number
  problem: RedeemProblem | null
}

export const REDEEM_PROBLEM_MESSAGES: Record<RedeemProblem, string> = {
  BELOW_MINIMUM: 'Below the minimum redemption',
  ABOVE_BALANCE: 'More points than this customer has',
  INVALID_POINTS: 'Enter a whole number of points',
}

export function quoteRedemption(input: RedeemQuoteInput): RedeemQuote {
  const maxPoints = maxRedeemablePoints(
    Math.max(0, input.cartNetMinor),
    Math.max(0, input.availablePoints),
    input.pointsPerCedi,
  )

  if (!Number.isSafeInteger(input.points) || input.points < 0) {
    return { points: 0, valueMinor: 0, appliedMinor: 0, maxPoints, problem: REDEEM_INVALID_POINTS }
  }

  const valueMinor = loyaltyValueMinor(input.points, input.pointsPerCedi)
  const appliedMinor = Math.min(valueMinor, Math.max(0, input.cartNetMinor))

  // Zero clears the redemption; any positive amount must respect the policy.
  if (input.points === 0) {
    return { points: 0, valueMinor: 0, appliedMinor: 0, maxPoints, problem: null }
  }
  if (input.points < input.minimumRedeemPoints) {
    return {
      points: input.points,
      valueMinor,
      appliedMinor,
      maxPoints,
      problem: REDEEM_BELOW_MINIMUM,
    }
  }
  if (input.points > input.availablePoints) {
    return {
      points: input.points,
      valueMinor,
      appliedMinor,
      maxPoints,
      problem: REDEEM_ABOVE_BALANCE,
    }
  }

  return { points: input.points, valueMinor, appliedMinor, maxPoints, problem: null }
}

/** True when the redemption covers the whole cart (no payment due). */
export function isFullyRedeemed(appliedMinor: number, cartTotalMinor: number): boolean {
  return cartTotalMinor > 0 && appliedMinor >= cartTotalMinor
}
