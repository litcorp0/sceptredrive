export type TaxCategory = 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'

export type TaxMode = 'INCLUSIVE' | 'EXCLUSIVE'

export interface TaxBreakdown {
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
}

/**
 * Ghana rates as integer basis points (1/100th of a percent), per the VAT Act
 * 2025 (Act 1151) effective 2026-01-01: VAT 15% + NHIL 2.5% + GETFund 2.5%,
 * all charged on the same base.
 */
export const VAT_RATE_BP = 1500
export const NHIL_RATE_BP = 250
export const GETFUND_RATE_BP = 250
export const STANDARD_TAX_RATE_BP = VAT_RATE_BP + NHIL_RATE_BP + GETFUND_RATE_BP

const BASIS_POINTS = 10000

const TAX_CATEGORIES: readonly TaxCategory[] = ['STANDARD', 'ZERO_RATED', 'EXEMPT']
const TAX_MODES: readonly TaxMode[] = ['INCLUSIVE', 'EXCLUSIVE']

function assertAmountMinor(amountMinor: number, label: string): void {
  if (!Number.isSafeInteger(amountMinor) || amountMinor < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer in minor units`)
  }
}

function assertTaxCategory(category: TaxCategory): void {
  if (!TAX_CATEGORIES.includes(category)) {
    throw new TypeError(`Unknown tax category: ${String(category)}`)
  }
}

function assertTaxMode(mode: TaxMode): void {
  if (!TAX_MODES.includes(mode)) {
    throw new TypeError(`Unknown tax mode: ${String(mode)}`)
  }
}

function componentMinor(baseMinor: number, rateBp: number): number {
  return Math.round((baseMinor * rateBp) / BASIS_POINTS)
}

function assertBreakdown(breakdown: TaxBreakdown): void {
  const fields: Array<keyof TaxBreakdown> = [
    'baseMinor',
    'vatMinor',
    'nhilMinor',
    'getfundMinor',
    'taxTotalMinor',
    'totalMinor',
  ]
  for (const field of fields) {
    const value = breakdown[field]
    if (!Number.isSafeInteger(value) || value < 0) {
      throw new TypeError(`Tax breakdown ${field} must be a non-negative safe integer`)
    }
  }
}

/**
 * Computes a Ghana tax breakdown for a single line amount.
 *
 * - `EXCLUSIVE`: the amount is the pre-tax base; components are rounded
 *   individually and the total is their exact sum.
 * - `INCLUSIVE`: the amount is the tax-inclusive total; the base is derived,
 *   components are computed on the base, and any rounding residual is added to
 *   VAT so that `base + VAT + NHIL + GETFund === total` exactly.
 * - `ZERO_RATED` / `EXEMPT`: no tax, the amount is the base and the total.
 *
 * All values are integer minor units (pesewas); all arithmetic is integer-safe.
 */
export function taxBreakdown(
  amountMinor: number,
  category: TaxCategory,
  mode: TaxMode,
): TaxBreakdown {
  assertAmountMinor(amountMinor, 'amountMinor')
  assertTaxCategory(category)
  assertTaxMode(mode)

  if (category !== 'STANDARD') {
    return zeroBreakdown(amountMinor)
  }

  if (mode === 'EXCLUSIVE') {
    const base = amountMinor
    const vat = componentMinor(base, VAT_RATE_BP)
    const nhil = componentMinor(base, NHIL_RATE_BP)
    const getfund = componentMinor(base, GETFUND_RATE_BP)
    const taxTotal = vat + nhil + getfund
    return {
      baseMinor: base,
      vatMinor: vat,
      nhilMinor: nhil,
      getfundMinor: getfund,
      taxTotalMinor: taxTotal,
      totalMinor: base + taxTotal,
    }
  }

  const total = amountMinor
  const base = Math.round((total * BASIS_POINTS) / (BASIS_POINTS + STANDARD_TAX_RATE_BP))
  const nhil = componentMinor(base, NHIL_RATE_BP)
  const getfund = componentMinor(base, GETFUND_RATE_BP)
  const vatBase = componentMinor(base, VAT_RATE_BP)
  const residual = total - (base + vatBase + nhil + getfund)
  const vat = vatBase + residual
  const taxTotal = vat + nhil + getfund

  return {
    baseMinor: base,
    vatMinor: vat,
    nhilMinor: nhil,
    getfundMinor: getfund,
    taxTotalMinor: taxTotal,
    totalMinor: total,
  }
}

/** A no-tax breakdown for zero-rated and exempt lines. */
export function zeroBreakdown(amountMinor: number): TaxBreakdown {
  assertAmountMinor(amountMinor, 'amountMinor')
  return {
    baseMinor: amountMinor,
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
    taxTotalMinor: 0,
    totalMinor: amountMinor,
  }
}

/** Sums line breakdowns into an invoice total with integer arithmetic. */
export function addTaxBreakdowns(...breakdowns: readonly TaxBreakdown[]): TaxBreakdown {
  const summed: TaxBreakdown = {
    baseMinor: 0,
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
    taxTotalMinor: 0,
    totalMinor: 0,
  }

  for (const breakdown of breakdowns) {
    assertBreakdown(breakdown)
    summed.baseMinor += breakdown.baseMinor
    summed.vatMinor += breakdown.vatMinor
    summed.nhilMinor += breakdown.nhilMinor
    summed.getfundMinor += breakdown.getfundMinor
    summed.taxTotalMinor += breakdown.taxTotalMinor
    summed.totalMinor += breakdown.totalMinor
  }

  return summed
}
