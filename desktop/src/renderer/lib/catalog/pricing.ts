import { resolveEffectivePrice, type TaxCategory } from '@gikautos/shared'
import type { SellableProduct } from '../cart/types'
import type { CatalogProductRow } from './search'

/**
 * Catalogue → cart pricing (Plan 06 Task 2).
 *
 * The price a cashier sees is the branch price when one is set, otherwise the
 * base price — the same rule the API uses (`resolveEffectivePrice`). Stock is
 * presented, never enforced: an oversold line still sells and the server
 * records the conflict (D16).
 */

const TAX_CATEGORIES: readonly TaxCategory[] = ['STANDARD', 'ZERO_RATED', 'EXEMPT']

export function isTaxCategory(value: string | null | undefined): value is TaxCategory {
  return typeof value === 'string' && (TAX_CATEGORIES as readonly string[]).includes(value)
}

export interface ProductPriceRow {
  product_id: string
  price_minor: number
}

export interface StockLevelRow {
  product_id: string
  quantity_on_hand: number
}

export interface StockDeltaRow {
  product_id: string
  quantity_delta: number
}

/** Indexes rows by product for O(1) lookup while rendering a grid. */
export function indexByProduct<T extends { product_id: string }>(
  rows: readonly T[],
): Map<string, T> {
  const map = new Map<string, T>()
  for (const row of rows) map.set(row.product_id, row)
  return map
}

/** Synced on-hand plus this terminal's unacked sale deltas (D16). */
export function availableQuantity(onHand: number, pendingDelta: number): number {
  return (
    (Number.isSafeInteger(onHand) ? onHand : 0) +
    (Number.isSafeInteger(pendingDelta) ? pendingDelta : 0)
  )
}

export type StockTone = 'ok' | 'low' | 'out' | 'oversold'

export interface StockBadge {
  label: string
  tone: StockTone
}

export function stockBadge(available: number): StockBadge {
  if (available < 0) return { label: `${Math.abs(available)} oversold`, tone: 'oversold' }
  if (available === 0) return { label: 'Out of stock', tone: 'out' }
  if (available <= 5) return { label: `${available} left`, tone: 'low' }
  return { label: `${available} in stock`, tone: 'ok' }
}

/**
 * Builds the cart payload for a catalogue row. Returns null when the row
 * cannot be priced safely (unknown tax category, invalid price) — a product the
 * engine would reject must never reach the cart.
 */
export function toSellableProduct(
  row: CatalogProductRow,
  overrideMinor: number | null | undefined,
): SellableProduct | null {
  if (!isTaxCategory(row.tax_category)) return null

  let unitPriceMinor: number
  try {
    unitPriceMinor = resolveEffectivePrice(row.base_price_minor, overrideMinor)
  } catch {
    return null
  }

  return {
    id: row.id,
    sku: row.sku,
    name: row.name,
    barcode: row.barcode ?? null,
    unitPriceMinor,
    taxCategory: row.tax_category,
  }
}

/** Display price for the grid, before the row becomes a cart line. */
export function displayPriceMinor(
  row: CatalogProductRow,
  overrideMinor: number | null | undefined,
): number | null {
  const product = toSellableProduct(row, overrideMinor)
  return product ? product.unitPriceMinor : null
}
