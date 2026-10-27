import { isTenderMethod, type TenderMethod } from '@sceptre/shared'

/**
 * The payment method a `ToggleGroup type="single"` is reporting.
 *
 * Radix reports `''` when the pressed item is pressed again, and its callback is
 * typed as a plain `string`. A till always has a payment method, so anything that
 * is not one of the two known values keeps the current choice — "no method" is
 * not a state this screen has, and an unchecked cast would let it through.
 */
export function nextTenderMethod(value: string, current: TenderMethod): TenderMethod {
  return isTenderMethod(value) ? value : current
}
