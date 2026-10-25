/**
 * Money is an integer count of pesewas, and it is never divided — with one exception.
 *
 * Every other money value in the product is a sum of integer rows (`take`, `items sold`,
 * `cash in the drawer`). The average basket is the single figure that has to divide, so the
 * division is written once, here, and both the analytics service and the till call it. Two
 * implementations of one rounding rule is how a cashier and a manager come to disagree.
 *
 * Amounts in and out are integer minor units; only `formatGhs` turns one into a string.
 */

/**
 * A value that must be a safe integer in pesewas, or a count.
 *
 * Negative zero is rejected as well as a negative number: a `-0` arrives from a sign bug
 * (`-count` where `count` was already zero), never from a real till, and letting it through
 * would let a wrong sign travel unnoticed.
 */
function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || Object.is(value, -0)) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

/**
 * Average basket in integer minor units: `round(take / count)`, or `0` when nothing sold.
 *
 * **This is a display figure. It is never posted anywhere**: it does not appear on a sale, a
 * receipt, a shift close, the credit ledger, or the loyalty ledger, and no other amount is
 * ever derived from it. That is what makes it safe to be the only division in the codebase
 * that produces a money value.
 *
 * The division is rounded exactly once, half up, at the end (`Math.round` on a non-negative
 * quotient). With no sales the answer is `0`, not `NaN`: an empty day's basket is empty, not
 * undefined.
 */
export function averageBasketMinor(takeMinor: number, salesCount: number): number {
  assertNonNegativeInteger(takeMinor, 'takeMinor')
  assertNonNegativeInteger(salesCount, 'salesCount')
  return salesCount === 0 ? 0 : Math.round(takeMinor / salesCount)
}
