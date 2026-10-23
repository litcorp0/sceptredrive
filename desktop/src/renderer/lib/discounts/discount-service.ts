import type { Role } from '@gikautos/shared'
import type { DiscountReasonCode } from '../cart/types'
import { parseGhsToMinor } from '../format'

/**
 * Discount authority at the till (Plan 06 Task 6, D22/D23).
 *
 * The cap is measured on **total discounts over gross** — line discounts and
 * the sale discount together — which is exactly what the server enforces on
 * upload. Measuring only the sale discount would let a cashier give away a
 * whole line without a manager, so client and server use this one formula.
 *
 * A cashier's cap defaults to 0%: without `pos.discount` authority every
 * discount needs a manager.
 */

export interface DiscountCaps {
  maxCashierDiscountPercent: number
  maxManagerDiscountPercent: number
}

export interface DiscountAuthorityInput {
  role: Role
  /** Line + sale discounts, integer pesewas. */
  totalDiscountMinor: number
  /** Gross before any discount, integer pesewas. */
  grossMinor: number
  caps: DiscountCaps
  /** True when a valid manager proof is attached to this discount. */
  hasApproval: boolean
}

export interface DiscountAuthority {
  /** Floor of total discounts over gross, as the server computes it. */
  percent: number
  capPercent: number
  requiresApproval: boolean
  approved: boolean
  /** Percentage points above the cap (0 when within it). */
  overByPercent: number
  /** Pesewas above the cap (0 when within it). */
  overByMinor: number
}

const BASIS_POINTS = 100

function safe(value: unknown): number {
  return typeof value === 'number' && Number.isSafeInteger(value) && value >= 0 ? value : 0
}

export function capPercentFor(role: Role, caps: DiscountCaps): number {
  return role === 'ADMIN' || role === 'MANAGER'
    ? caps.maxManagerDiscountPercent
    : caps.maxCashierDiscountPercent
}

/** The amount the cap allows at this gross. */
export function allowedDiscountMinor(grossMinor: number, capPercent: number): number {
  return Math.floor((safe(grossMinor) * Math.max(0, safe(capPercent))) / BASIS_POINTS)
}

export function discountAuthority(input: DiscountAuthorityInput): DiscountAuthority {
  const gross = safe(input.grossMinor)
  const total = safe(input.totalDiscountMinor)
  const capPercent = capPercentFor(input.role, input.caps)
  const percent = gross > 0 ? Math.floor((total * BASIS_POINTS) / gross) : 0
  const allowed = allowedDiscountMinor(gross, capPercent)
  // Compare pesewas, not just the floored percentage: at a 0% cap a discount
  // smaller than 1% of a large cart would otherwise floor to "0%" and slip past.
  const requiresApproval = total > 0 && total > allowed

  return {
    percent,
    capPercent,
    requiresApproval,
    approved: !requiresApproval || input.hasApproval,
    overByPercent: requiresApproval ? percent - capPercent : 0,
    overByMinor: total > allowed ? total - allowed : 0,
  }
}

export type DiscountInputMode = 'AMOUNT' | 'PERCENT'

/**
 * Turns what the cashier typed into integer pesewas off.
 *
 * - `AMOUNT` accepts cedis (`12`, `12.5`, `12.50`), clamped to the base;
 * - `PERCENT` accepts a whole percentage, converted with a floor so the
 *   discount can never exceed the base.
 *
 * Returns null for input that is not a usable discount.
 */
export function discountAmountFromInput(
  raw: string,
  mode: DiscountInputMode,
  baseMinor: number,
): number | null {
  const base = safe(baseMinor)

  if (mode === 'AMOUNT') {
    const minor = parseGhsToMinor(raw)
    if (minor === null) return null
    return Math.min(minor, base)
  }

  const trimmed = raw.trim().replace(/%$/, '')
  if (!/^\d{1,3}$/.test(trimmed)) return null
  const percent = Number(trimmed)
  if (percent > 100) return null
  return Math.min(Math.floor((base * percent) / BASIS_POINTS), base)
}

/** "12.5%" for display; percentages are floored to whole numbers. */
export function formatPercent(percent: number): string {
  return `${Math.max(0, Math.floor(percent))}%`
}

export const DISCOUNT_REASON_LABELS: Record<DiscountReasonCode, string> = {
  STAFF: 'Staff discount',
  DAMAGE: 'Damaged goods',
  PROMO: 'Promotion',
  OTHER: 'Other',
}
