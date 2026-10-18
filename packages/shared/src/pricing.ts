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
