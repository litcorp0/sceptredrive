/** True when the value is a usable price in integer minor units (pesewas). */
export function isValidPriceMinor(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0
}

/**
 * Resolves the price a branch should charge: the branch override when one is
 * set, otherwise the product's base price. Mirrors the server rule so the
 * console preview and the offline POS agree with the API.
 *
 * Throws `TypeError` when either input is not a non-negative integer minor
 * amount.
 */
export function resolveEffectivePrice(
  basePriceMinor: number,
  overrideMinor: number | null | undefined,
): number {
  if (!isValidPriceMinor(basePriceMinor)) {
    throw new TypeError('basePriceMinor must be a non-negative safe integer in minor units')
  }
  if (overrideMinor === null || overrideMinor === undefined) return basePriceMinor
  if (!isValidPriceMinor(overrideMinor)) {
    throw new TypeError('overrideMinor must be a non-negative safe integer in minor units')
  }
  return overrideMinor
}

/** A whole-number percentage of a price, 0…100. */
function assertPercent(percent: number): void {
  if (!Number.isSafeInteger(percent) || percent < 0 || percent > 100) {
    throw new TypeError('percent must be a safe integer between 0 and 100')
  }
}

/**
 * Integer floor division by 100 for a non-negative safe integer.
 *
 * `Math.floor(n / 100)` would round through a float; subtracting the remainder
 * first leaves an exact multiple of 100, so the division is exact and the result
 * is an integer.
 */
function floorHundredths(value: number): number {
  return (value - (value % 100)) / 100
}

/**
 * True when `proposed` is within `percent` of `current`, inclusive at the edge.
 *
 * Integer-only: `|proposed − current| × 100 ≤ current × percent`. No float
 * touches the money, so exactly 10% is inside and one pesewa beyond is outside.
 * A zero `current` admits only a zero proposal — a free-to-paid change is not a
 * percentage change, so it takes the request path (P12-D18).
 */
export function withinPriceBand(
  currentMinor: number,
  proposedMinor: number,
  percent: number,
): boolean {
  if (!isValidPriceMinor(currentMinor)) {
    throw new TypeError('currentMinor must be a non-negative safe integer in minor units')
  }
  if (!isValidPriceMinor(proposedMinor)) {
    throw new TypeError('proposedMinor must be a non-negative safe integer in minor units')
  }
  assertPercent(percent)

  const scaledDelta = Math.abs(proposedMinor - currentMinor) * 100
  const allowance = currentMinor * percent
  if (!Number.isSafeInteger(scaledDelta) || !Number.isSafeInteger(allowance)) {
    throw new TypeError('prices are too large to compare inside the band exactly')
  }
  return scaledDelta <= allowance
}

/**
 * Display bounds derived from the same rule: `current ± floor(current × percent / 100)`.
 *
 * Both bounds are inclusive and are the largest and smallest prices
 * `withinPriceBand` accepts, so a console can render the window and a test can
 * prove the two agree at the edge.
 */
export function priceBandBounds(
  currentMinor: number,
  percent: number,
): { minMinor: number; maxMinor: number } {
  if (!isValidPriceMinor(currentMinor)) {
    throw new TypeError('currentMinor must be a non-negative safe integer in minor units')
  }
  assertPercent(percent)

  const allowance = currentMinor * percent
  if (!Number.isSafeInteger(allowance)) {
    throw new TypeError('price is too large to express the band exactly')
  }
  const spread = floorHundredths(allowance)
  return { minMinor: currentMinor - spread, maxMinor: currentMinor + spread }
}
