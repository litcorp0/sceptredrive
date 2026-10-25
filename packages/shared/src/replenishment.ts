/**
 * Replenishment arithmetic: how many units to order, and why.
 *
 * Every input is a stored fact the API passes in, so the console can print the
 * whole calculation beside the answer. Nothing is cached, nothing is forecast,
 * and no float is involved: the only division happens in `ceilDiv`, once, at the
 * end.
 *
 *   coverage  = ceilDiv(unitsSold × (leadTimeDays + safetyDays), 90)
 *   target    = max(maxLevel, coverage)
 *   position  = onHand + onOrder
 *   suggested = max(clamp(target − position, 0, target), minOrderQuantity)
 *
 * `onOrder` is part of the position because ordering a part that is already on
 * its way is how a branch ends up with twice as much as it wanted.
 */

/** The trailing window the suggestion is computed over. Fixed, not a setting. */
export const VELOCITY_DAYS = 90

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

/** Ceiling division on non-negative integers: `ceilDiv(1, 90) === 1`. */
export function ceilDiv(numerator: number, denominator: number): number {
  assertNonNegativeInteger(numerator, 'Numerator')
  if (!Number.isSafeInteger(denominator) || denominator <= 0) {
    throw new TypeError('Denominator must be a positive safe integer')
  }
  return Math.ceil(numerator / denominator)
}

export interface ReplenishmentInputs {
  /** Units sold at this branch in the trailing `VELOCITY_DAYS`. */
  unitsSold: number
  /** `stock_level.quantity_on_hand`; 0 when the branch has never stocked it. */
  onHand: number
  /** Σ(max(ordered − received, 0)) over open order lines. */
  onOrder: number
  /** `stock_threshold.threshold` — the level that says "reorder". */
  minLevel: number
  /** `stock_threshold.max_quantity`; null when the branch has not set one. */
  maxLevel: number | null
  /** `stock_threshold.min_order_quantity` — a supplier's minimum. */
  minOrderQuantity: number
  /** `supplier_product.lead_time_days`, already resolved by the caller. */
  leadTimeDays: number
  /** True when `leadTimeDays` came from `procurement.defaultLeadDays`. */
  leadTimeAssumed: boolean
  safetyDays: number
}

export type ReplenishmentBasis =
  | 'COVERAGE'
  | 'STORED_MAX'
  | 'NO_HISTORY'
  | 'NO_LEVEL'
  | 'AT_TARGET'
  /** The supplier's minimum order quantity is what set the answer. */
  | 'MIN_ORDER'

export interface ReplenishmentSuggestion {
  /** max(stored max, coverage): the level the row is topped up to. */
  targetLevel: number
  /** ceilDiv(unitsSold × (lead + safety), VELOCITY_DAYS). */
  coverageLevel: number
  /** onHand + onOrder: the inventory position, not the shelf. */
  position: number
  /** The answer, always a whole number of units, never negative. */
  suggested: number
  /** Why; the screen prints a sentence from this and the inputs. */
  basis: ReplenishmentBasis
}

/**
 * The suggestion for one product at one branch.
 *
 * A never-stocked product behaves exactly like one on zero: the row exists
 * because the branch set a min/max, and on hand reads 0. That is how "parts the
 * branch has never stocked" reach the replenishment screen without inventing
 * sales history for them.
 */
export function suggestReplenishment(input: ReplenishmentInputs): ReplenishmentSuggestion {
  assertNonNegativeInteger(input.unitsSold, 'Units sold')
  assertNonNegativeInteger(input.onHand, 'On hand')
  assertNonNegativeInteger(input.onOrder, 'On order')
  assertNonNegativeInteger(input.minLevel, 'Minimum level')
  assertNonNegativeInteger(input.minOrderQuantity, 'Minimum order quantity')
  assertNonNegativeInteger(input.leadTimeDays, 'Lead time')
  assertNonNegativeInteger(input.safetyDays, 'Safety days')
  if (input.maxLevel !== null) assertNonNegativeInteger(input.maxLevel, 'Maximum level')

  const coverDays = input.leadTimeDays + input.safetyDays
  const coverageLevel = ceilDiv(input.unitsSold * coverDays, VELOCITY_DAYS)
  const storedMax = input.maxLevel ?? 0
  const targetLevel = Math.max(storedMax, coverageLevel)
  const position = input.onHand + input.onOrder

  const gap = Math.min(Math.max(targetLevel - position, 0), targetLevel)
  const suggested = Math.max(gap, input.minOrderQuantity)

  if (!Number.isSafeInteger(coverageLevel) || !Number.isSafeInteger(suggested)) {
    throw new TypeError('Replenishment figure is too large to represent safely')
  }

  return {
    targetLevel,
    coverageLevel,
    position,
    suggested,
    basis: basisOf(input, { coverageLevel, targetLevel, position, gap }),
  }
}

function basisOf(
  input: ReplenishmentInputs,
  computed: { coverageLevel: number; targetLevel: number; position: number; gap: number },
): ReplenishmentBasis {
  const { coverageLevel, targetLevel, position, gap } = computed

  // The floor is the most specific reason, so it is named first: without it the
  // suggestion would have been smaller, whatever else is true of the row.
  if (input.minOrderQuantity > gap) return 'MIN_ORDER'
  // "No level set" beats "at target": with a target of zero the row is trivially
  // at target, and saying so tells the manager nothing they can act on.
  if (input.maxLevel === null && coverageLevel === 0) return 'NO_LEVEL'
  if (position >= targetLevel) return 'AT_TARGET'
  if (input.unitsSold === 0) return 'NO_HISTORY'
  if (coverageLevel > (input.maxLevel ?? 0)) return 'COVERAGE'
  return 'STORED_MAX'
}

/**
 * `suggested × last cost`, for the group total on the screen. Kept here so the
 * multiplication is validated once and the console never does money maths.
 */
export function suggestedValueMinor(suggested: number, unitCostMinor: number): number {
  assertNonNegativeInteger(suggested, 'Suggested quantity')
  assertNonNegativeInteger(unitCostMinor, 'Unit cost')
  const value = suggested * unitCostMinor
  if (!Number.isSafeInteger(value)) {
    throw new TypeError('Suggested value is too large to represent safely')
  }
  return value
}
