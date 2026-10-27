import { type CartLineInput, type CartPricingOptions, priceCart } from './pos.ts'
import type { TaxCategory } from './tax.ts'

/**
 * A held cart is a promise made at an earlier price. Recall re-prices against
 * today's catalogue through `priceCart` and reports every change, so the
 * cashier can acknowledge it instead of honouring a stale quote (P13-D35).
 */

export const MAX_HELD_CARTS = 10
export const HOLD_LABEL_MAX = 60

export function holdLabelProblem(label: string, existingCount: number): string | null {
  const trimmed = label.trim()
  if (trimmed.length === 0) return 'Give the cart a name so you can find it'
  if (trimmed.length > HOLD_LABEL_MAX) {
    return `Keep the name to ${HOLD_LABEL_MAX} characters or fewer`
  }
  if (existingCount >= MAX_HELD_CARTS) {
    return 'Ten carts are already held on this till. Use one or void one.'
  }
  return null
}

export interface HoldLine {
  productId: string
  sku: string
  name: string
  quantity: number
  unitPriceMinor: number
  taxCategory: TaxCategory
  lineDiscountMinor: number
  lineDiscountReason: string | null
  lineDiscountNote: string | null
}

export interface CatalogueSnapshotLine {
  productId: string
  name: string
  sku: string
  unitPriceMinor: number
  taxCategory: TaxCategory
  isActive: boolean
}

export type HoldDifferenceKind = 'TAX' | 'PRICE' | 'ARCHIVED' | 'GONE'

export interface HoldDifference {
  productId: string
  name: string
  kind: HoldDifferenceKind
  fromMinor: number
  toMinor: number
}

export interface RepricedHold {
  lines: HoldLine[]
  differences: HoldDifference[]
  loyaltyPointsRequested: number
  requiresAcknowledgement: boolean
}

/** `priceCart` rejects an over-discount as a client bug; recall clamps instead. */
function clampLineDiscount(requested: number, grossMinor: number): number {
  if (!Number.isSafeInteger(requested) || requested < 0) return 0
  return requested > grossMinor ? grossMinor : requested
}

function toCartLine(line: HoldLine): CartLineInput {
  return {
    productId: line.productId,
    name: line.name,
    sku: line.sku,
    quantity: line.quantity,
    unitPriceMinor: line.unitPriceMinor,
    lineDiscountMinor: line.lineDiscountMinor,
    taxCategory: line.taxCategory,
  }
}

interface RepriceEntry {
  held: HoldLine
  current: CatalogueSnapshotLine | undefined
  line: HoldLine
  originalInput: CartLineInput
  pricedInput: CartLineInput
}

/**
 * Re-prices the lines of a held cart against today's catalogue.
 *
 * A missing product becomes a `GONE` line kept at its old price so the cashier
 * can see what it was; an archived product is re-priced and flagged. A tax
 * reclassification is its own difference, ordered before a price change on the
 * same line: the kind tells the panel to say the tax treatment moved, while
 * `fromMinor`/`toMinor` show the line total on either side. The loyalty
 * question is deliberately left to the caller, which applies
 * `maxRedeemablePoints` against the live balance.
 */
export function repriceHeldCart(input: {
  lines: readonly HoldLine[]
  catalogue: readonly CatalogueSnapshotLine[]
  loyaltyPointsRequested: number
  pricing: CartPricingOptions
}): RepricedHold {
  const catalogueById = new Map(input.catalogue.map((line) => [line.productId, line]))
  const entries: RepriceEntry[] = []

  for (const held of input.lines) {
    const current = catalogueById.get(held.productId)

    const original: HoldLine = {
      ...held,
      lineDiscountMinor: clampLineDiscount(
        held.lineDiscountMinor,
        held.unitPriceMinor * held.quantity,
      ),
    }

    const line: HoldLine = current
      ? {
          ...held,
          name: current.name,
          sku: current.sku,
          unitPriceMinor: current.unitPriceMinor,
          taxCategory: current.taxCategory,
        }
      : { ...held }

    line.lineDiscountMinor = clampLineDiscount(
      line.lineDiscountMinor,
      line.unitPriceMinor * line.quantity,
    )

    entries.push({
      held,
      current,
      line,
      originalInput: toCartLine(original),
      pricedInput: toCartLine(line),
    })
  }

  const originalPriced = priceCart(
    entries.map((entry) => entry.originalInput),
    input.pricing,
  )
  const priced = priceCart(
    entries.map((entry) => entry.pricedInput),
    input.pricing,
  )

  const differences: HoldDifference[] = []
  for (const [index, entry] of entries.entries()) {
    const { held, current } = entry

    if (!current) {
      differences.push({
        productId: held.productId,
        name: held.name,
        kind: 'GONE',
        fromMinor: held.unitPriceMinor,
        toMinor: held.unitPriceMinor,
      })
      continue
    }

    if (current.taxCategory !== held.taxCategory) {
      differences.push({
        productId: held.productId,
        name: current.name,
        kind: 'TAX',
        fromMinor: originalPriced.lines[index]?.totalMinor ?? 0,
        toMinor: priced.lines[index]?.totalMinor ?? 0,
      })
    }

    if (!current.isActive) {
      differences.push({
        productId: held.productId,
        name: current.name,
        kind: 'ARCHIVED',
        fromMinor: held.unitPriceMinor,
        toMinor: current.unitPriceMinor,
      })
    } else if (current.unitPriceMinor !== held.unitPriceMinor) {
      differences.push({
        productId: held.productId,
        name: current.name,
        kind: 'PRICE',
        fromMinor: held.unitPriceMinor,
        toMinor: current.unitPriceMinor,
      })
    }
  }

  return {
    lines: entries.map((entry, index) => ({
      ...entry.line,
      lineDiscountMinor: priced.lines[index]?.lineDiscountMinor ?? entry.line.lineDiscountMinor,
    })),
    differences,
    loyaltyPointsRequested: input.loyaltyPointsRequested,
    requiresAcknowledgement: differences.length > 0,
  }
}
