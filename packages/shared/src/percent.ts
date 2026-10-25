/**
 * Percentages are integers too.
 *
 * Every ratio this product shows — a period-over-period delta, a margin, a share of
 * revenue, a credit utilisation — is an integer count of **basis points** (1 bp = 0.01%,
 * so `1240` is `+12.40%`). Nothing here divides money; callers pass integer minor units in
 * and get integer basis points out, and only `formatBasisPoints` produces a string.
 *
 * A ratio whose denominator is zero returns `null`, never `0` and never `Infinity`:
 * "no previous period" and "no change" are different statements.
 */
import { INVALID_DATE } from './dates.ts'

export const BASIS_POINT_SCALE = 10_000

function assertSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value)) {
    throw new TypeError(`${label} must be a safe integer`)
  }
}

/**
 * Exact integer division to basis points, rounding half away from zero.
 *
 * `Math.round(numerator / denominator)` would round through a float; this keeps the
 * arithmetic integral until the final step. The product is asserted to stay inside the
 * safe-integer range, which money in pesewas always does.
 */
function divideToBasisPoints(numerator: number, denominator: number): number {
  assertSafeInteger(numerator, 'numerator')
  assertSafeInteger(denominator, 'denominator')
  if (denominator === 0) throw new TypeError('denominator must not be zero')

  const scaled = numerator * BASIS_POINT_SCALE
  if (!Number.isSafeInteger(scaled)) {
    throw new TypeError('values are too large to express in basis points exactly')
  }

  const negative = scaled < 0 !== denominator < 0
  const absScaled = Math.abs(scaled)
  const absDenominator = Math.abs(denominator)
  const quotient = Math.floor(absScaled / absDenominator)
  const remainder = absScaled % absDenominator
  const rounded = remainder * 2 >= absDenominator ? quotient + 1 : quotient
  if (rounded === 0) return 0
  return negative ? -rounded : rounded
}

/**
 * Percent change from `previous` to `current`, in basis points.
 *
 * Returns `null` when there is no previous figure to compare against (a new shop's first
 * month), because a percentage change from zero is undefined, not infinite.
 */
export function deltaBp(previous: number, current: number): number | null {
  assertSafeInteger(previous, 'previous')
  assertSafeInteger(current, 'current')
  if (previous === 0) return null
  return divideToBasisPoints(current - previous, previous)
}

/**
 * `part` as a share of `whole`, in basis points. Returns `null` when `whole` is zero.
 *
 * `part` may exceed `whole` (credit utilisation above 100%) and may be negative (gross
 * profit below zero); the sign is preserved.
 */
export function ratioBp(part: number, whole: number): number | null {
  assertSafeInteger(part, 'part')
  assertSafeInteger(whole, 'whole')
  if (whole === 0) return null
  return divideToBasisPoints(part, whole)
}

/**
 * `"+12.40%"`, `"-3.10%"`, `"0.00%"`, or `"—"` for `null`.
 *
 * The sign is explicit for every non-zero ratio so a reader never has to infer direction
 * from colour. Formatting is integer-only; there is no float in this function.
 */
export function formatBasisPoints(bp: number | null): string {
  if (bp === null || !Number.isSafeInteger(bp)) return INVALID_DATE

  const abs = Math.abs(bp)
  const whole = Math.trunc(abs / 100)
  const fraction = abs % 100
  const sign = bp > 0 ? '+' : bp < 0 ? '-' : ''
  return `${sign}${whole}.${String(fraction).padStart(2, '0')}%`
}
