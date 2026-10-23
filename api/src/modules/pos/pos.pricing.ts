import type { DbExecutor } from '@gikautos/db'
import { resolveEffectivePrice, type TaxMode } from '@gikautos/shared'
import { selectProductsForSale } from './pos.repository.ts'
import type { SaleLinePayload, SaleTotalsPayload } from './pos.types.ts'

/**
 * Catalogue facts the server owns: the product, its effective branch price, and
 * where that price came from. The charged price stays the customer's fact; this
 * is only used to detect drift.
 */
export interface SaleCatalogLine {
  productId: string
  name: string
  sku: string
  expectedUnitPriceMinor: number
  priceSource: 'BASE' | 'BRANCH_OVERRIDE'
  taxCategory: SaleLinePayload['taxCategory']
  isActive: boolean
}

export interface SaleCatalog {
  byProductId: Map<string, SaleCatalogLine>
  missingProductIds: string[]
}

/** Loads every product in one query (products archived after a sale still exist). */
export async function loadSaleCatalog(
  tx: DbExecutor,
  branchId: string,
  lines: readonly SaleLinePayload[],
): Promise<SaleCatalog> {
  const productIds = [...new Set(lines.map((line) => line.productId))]
  const rows = await selectProductsForSale(productIds, branchId, tx)

  const byProductId = new Map<string, SaleCatalogLine>()
  for (const row of rows) {
    const hasOverride = row.overrideMinor !== null && row.overrideMinor !== undefined
    byProductId.set(row.product.id, {
      productId: row.product.id,
      name: row.product.name,
      sku: row.product.sku,
      expectedUnitPriceMinor: resolveEffectivePrice(row.product.basePriceMinor, row.overrideMinor),
      priceSource: hasOverride ? 'BRANCH_OVERRIDE' : 'BASE',
      taxCategory: row.product.taxCategory,
      isActive: row.product.isActive,
    })
  }

  return {
    byProductId,
    missingProductIds: productIds.filter((id) => !byProductId.has(id)),
  }
}

export type TotalsAssessment =
  | { ok: true; matched: boolean }
  | {
      ok: false
      reason: string
      details: { payload: SaleTotalsPayload; computed: SaleTotalsPayload }
    }

function sameTotals(left: SaleTotalsPayload, right: SaleTotalsPayload): boolean {
  return (Object.keys(left) as Array<keyof SaleTotalsPayload>).every(
    (key) => left[key] === right[key],
  )
}

/**
 * Compares the charged header with the server recomputation. When they differ,
 * the payload must at least be internally consistent as accounting (its own
 * split adds up); otherwise the sale is rejected. A consistent but different
 * split is stored and flagged TOTAL_MISMATCH — reconciliation surfaces it.
 */
export function assessSaleTotals(
  taxMode: TaxMode,
  payload: SaleTotalsPayload,
  computed: SaleTotalsPayload,
): TotalsAssessment {
  if (sameTotals(payload, computed)) return { ok: true, matched: true }

  const fields = Object.values(payload)
  if (fields.some((value) => !Number.isSafeInteger(value) || value < 0)) {
    return {
      ok: false,
      reason: 'Sale totals must be non-negative whole pesewas',
      details: { payload, computed },
    }
  }

  const taxComponents = payload.vatMinor + payload.nhilMinor + payload.getfundMinor
  if (payload.taxTotalMinor !== taxComponents) {
    return {
      ok: false,
      reason: 'VAT, NHIL, and GETFund do not add up to the tax total',
      details: { payload, computed },
    }
  }

  const taxable =
    payload.subtotalMinor -
    payload.lineDiscountMinor -
    payload.saleDiscountMinor -
    payload.loyaltyDiscountMinor
  const expectedTotal = taxMode === 'INCLUSIVE' ? taxable : taxable + payload.taxTotalMinor
  if (payload.totalMinor !== expectedTotal) {
    return {
      ok: false,
      reason: 'Sale total does not reconcile with its own discounts and tax',
      details: { payload, computed },
    }
  }

  if (taxable < 0) {
    return {
      ok: false,
      reason: 'Discounts exceed the sale subtotal',
      details: { payload, computed },
    }
  }

  return { ok: true, matched: false }
}
