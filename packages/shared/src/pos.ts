import { type TaxBreakdown, type TaxCategory, type TaxMode, taxBreakdown } from './tax.ts'

export interface CartLineInput {
  productId: string
  name?: string
  sku?: string
  quantity: number
  unitPriceMinor: number
  lineDiscountMinor?: number
  taxCategory: TaxCategory
}

export interface CartPricingOptions {
  taxMode: TaxMode
  saleDiscountMinor?: number
  loyaltyDiscountMinor?: number
  /**
   * Whether the business is VAT-registered at all. `false` prices every line as
   * `EXEMPT` — no VAT, no NHIL, no GETFund — whatever the catalogue says about
   * the product. A business that is not registered must not charge the levies,
   * and marking five thousand products by hand is how one gets missed.
   *
   * Omitted means `true`: every existing caller keeps the old arithmetic, and a
   * caller that forgets it cannot silently stop collecting tax.
   */
  vatRegistered?: boolean
}

export interface PricedLine {
  productId: string
  name: string | undefined
  sku: string | undefined
  quantity: number
  unitPriceMinor: number
  taxCategory: TaxCategory
  grossMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  /** Gross minus line and sale discounts, before loyalty. */
  netMinor: number
  /** Net minus the allocated loyalty redemption; the tax base. */
  taxableMinor: number
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
}

export interface PricedCart {
  taxMode: TaxMode
  lines: PricedLine[]
  subtotalMinor: number
  lineDiscountMinor: number
  saleDiscountMinor: number
  loyaltyDiscountMinor: number
  /** Sum of line net (after line + sale discounts, before loyalty). */
  netMinor: number
  /** Sum of line taxable (after loyalty); the tax base. */
  taxableMinor: number
  baseMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  taxTotalMinor: number
  totalMinor: number
}

const TAX_CATEGORIES: readonly TaxCategory[] = ['STANDARD', 'ZERO_RATED', 'EXEMPT']
const TAX_MODES: readonly TaxMode[] = ['INCLUSIVE', 'EXCLUSIVE']

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new TypeError(`${label} must be a non-negative safe integer`)
  }
}

function assertPositiveInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new TypeError(`${label} must be a positive safe integer`)
  }
}

/**
 * Splits an integer amount across non-negative integer weights using the
 * largest-remainder method. The returned shares always sum exactly to
 * `amountMinor`; equal remainders go to the lower index, making the result
 * deterministic.
 */
export function allocateProportionally(amountMinor: number, weights: readonly number[]): number[] {
  assertNonNegativeInteger(amountMinor, 'amountMinor')
  if (weights.length === 0) {
    if (amountMinor === 0) return []
    throw new RangeError('Cannot allocate a positive amount across zero weights')
  }

  let totalWeight = 0
  for (const [index, weight] of weights.entries()) {
    assertNonNegativeInteger(weight, `weights[${index}]`)
    totalWeight += weight
  }

  if (totalWeight === 0) {
    if (amountMinor === 0) return weights.map(() => 0)
    throw new RangeError('Cannot allocate a positive amount across zero weights')
  }

  const shares: number[] = []
  const remainders: Array<{ index: number; remainder: number }> = []
  let allocated = 0

  for (const [index, weight] of weights.entries()) {
    const numerator = amountMinor * weight
    const share = Math.floor(numerator / totalWeight)
    shares.push(share)
    allocated += share
    remainders.push({ index, remainder: numerator - share * totalWeight })
  }

  remainders.sort((left, right) => {
    if (right.remainder !== left.remainder) return right.remainder - left.remainder
    return left.index - right.index
  })

  let residual = amountMinor - allocated
  for (let position = 0; residual > 0; position += 1) {
    const target = remainders[position % remainders.length]
    if (!target) throw new RangeError('Allocation residual could not be distributed')
    shares[target.index] = (shares[target.index] ?? 0) + 1
    residual -= 1
  }

  return shares
}

function clampDiscount(requested: number, available: number): number {
  assertNonNegativeInteger(requested, 'discount')
  return requested > available ? available : requested
}

/**
 * Prices a cart with the same integer arithmetic on the client and the server.
 *
 * Order of operations:
 *   gross -> line discounts -> sale discount (pro-rata by net) ->
 *   loyalty redemption (pre-tax, pro-rata by remaining net) -> per-line tax.
 *
 * Sale and loyalty discounts are clamped to what the cart can absorb rather
 * than throwing: an offline client must never be unable to complete a sale.
 * Invalid line data (bad quantity/price, line discount above the line gross)
 * is still rejected, because that is a client bug, not a customer choice.
 */
export function priceCart(
  lines: readonly CartLineInput[],
  options: CartPricingOptions,
): PricedCart {
  if (!TAX_MODES.includes(options.taxMode)) {
    throw new TypeError(`Unknown tax mode: ${String(options.taxMode)}`)
  }

  const grossByLine: number[] = []
  const netAfterLineDiscount: number[] = []

  for (const [index, line] of lines.entries()) {
    assertPositiveInteger(line.quantity, `lines[${index}].quantity`)
    assertNonNegativeInteger(line.unitPriceMinor, `lines[${index}].unitPriceMinor`)
    if (!TAX_CATEGORIES.includes(line.taxCategory)) {
      throw new TypeError(`Unknown tax category: ${String(line.taxCategory)}`)
    }

    const gross = line.unitPriceMinor * line.quantity
    if (!Number.isSafeInteger(gross)) {
      throw new TypeError(`lines[${index}] gross exceeds the safe integer range`)
    }
    const lineDiscount = line.lineDiscountMinor ?? 0
    assertNonNegativeInteger(lineDiscount, `lines[${index}].lineDiscountMinor`)
    if (lineDiscount > gross) {
      throw new RangeError(`lines[${index}].lineDiscountMinor cannot exceed the line gross`)
    }

    grossByLine.push(gross)
    netAfterLineDiscount.push(gross - lineDiscount)
  }

  const subtotalMinor = grossByLine.reduce((total, value) => total + value, 0)
  const lineDiscountMinor =
    subtotalMinor - netAfterLineDiscount.reduce((total, value) => total + value, 0)
  const netAfterLineTotal = netAfterLineDiscount.reduce((total, value) => total + value, 0)

  const saleDiscountMinor = clampDiscount(options.saleDiscountMinor ?? 0, netAfterLineTotal)
  const saleShares = allocateProportionally(saleDiscountMinor, netAfterLineDiscount)
  const netAfterSale = netAfterLineDiscount.map((value, index) => value - (saleShares[index] ?? 0))

  const netAfterSaleTotal = netAfterSale.reduce((total, value) => total + value, 0)
  const loyaltyDiscountMinor = clampDiscount(options.loyaltyDiscountMinor ?? 0, netAfterSaleTotal)
  const loyaltyShares = allocateProportionally(loyaltyDiscountMinor, netAfterSale)

  const pricedLines: PricedLine[] = lines.map((line, index) => {
    const netAfterSaleLine = netAfterSale[index] ?? 0
    const loyaltyShare = loyaltyShares[index] ?? 0
    const taxableMinor = netAfterSaleLine - loyaltyShare
    // A business that is not VAT-registered charges no levies at all. The stored
    // line says `EXEMPT` because that is what the money is: an untaxed supply,
    // not a standard-rated one that happened to be zero.
    const taxCategory = options.vatRegistered === false ? 'EXEMPT' : line.taxCategory
    const breakdown: TaxBreakdown = taxBreakdown(taxableMinor, taxCategory, options.taxMode)

    return {
      productId: line.productId,
      name: line.name,
      sku: line.sku,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      taxCategory,
      grossMinor: grossByLine[index] ?? 0,
      lineDiscountMinor: line.lineDiscountMinor ?? 0,
      saleDiscountMinor: saleShares[index] ?? 0,
      loyaltyDiscountMinor: loyaltyShare,
      netMinor: netAfterSaleLine,
      taxableMinor,
      ...breakdown,
    }
  })

  type NumericField =
    | 'grossMinor'
    | 'lineDiscountMinor'
    | 'saleDiscountMinor'
    | 'loyaltyDiscountMinor'
    | 'netMinor'
    | 'taxableMinor'
    | 'baseMinor'
    | 'vatMinor'
    | 'nhilMinor'
    | 'getfundMinor'
    | 'taxTotalMinor'
    | 'totalMinor'
  const sum = (field: NumericField): number =>
    pricedLines.reduce((total, line) => total + line[field], 0)

  return {
    taxMode: options.taxMode,
    lines: pricedLines,
    subtotalMinor,
    lineDiscountMinor,
    saleDiscountMinor,
    loyaltyDiscountMinor,
    netMinor: sum('netMinor'),
    taxableMinor: sum('taxableMinor'),
    baseMinor: sum('baseMinor'),
    vatMinor: sum('vatMinor'),
    nhilMinor: sum('nhilMinor'),
    getfundMinor: sum('getfundMinor'),
    taxTotalMinor: sum('taxTotalMinor'),
    totalMinor: sum('totalMinor'),
  }
}
