import { resolveEffectivePrice, type TaxCategory } from '@sceptre/shared'
import type { OutOfStockPolicy } from '../api/types'
import type { SellableProduct } from '../cart/types'
import type { CatalogProductRow } from './search'

/**
 * Catalogue → cart pricing (Plan 06 Task 2).
 *
 * The price a cashier sees is the branch price when one is set, otherwise the
 * base price — the same rule the API uses (`resolveEffectivePrice`).
 *
 * Stock is still not a hard sale limit: an oversold line sells and the server
 * records the conflict (D16). What P20-D9 added is a control limit — the `+`
 * button stops at availability so a cashier is not walked past the shelf one
 * click at a time, while a quantity typed by hand still oversells and is recorded.
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

/**
 * Whether adding this line needs authorisation (18-04).
 *
 * `ALLOW` is the pre-18 behaviour. `BLOCK` and `WARN` both stop the plain add and
 * open the manager dialog; `WARN` also offers "sell anyway" without a PIN.
 */
export function outOfStockBlocked(policy: OutOfStockPolicy, available: number): boolean {
  return policy !== 'ALLOW' && available <= 0
}

/**
 * Whether the `+` control may raise this line (P20-D9).
 *
 * The stock rule overall is unchanged — the till still sells, and an oversold line
 * still reaches the server as a `STOCK_OVERSELL` conflict rather than being lost.
 * What this stops is the *button* walking a cashier past what the shelf holds, one
 * click at a time, without them noticing: at 11 of 11, `+` is done.
 *
 * It only ever refuses to go **up**. A line already above availability — a recalled
 * hold, or stock that synced downwards while the cart was open — keeps its
 * quantity; nothing on this till reduces a line the cashier already set. And a
 * typed quantity is still the cashier's decision, so a genuine 12th unit can be
 * keyed in and will be recorded as the oversell it is.
 *
 * `null`/`undefined` means "not known here" (a product with no stock row in the
 * map), which allows the increase rather than inventing a limit.
 */
export function canIncreaseQuantity(
  quantity: number,
  available: number | null | undefined,
): boolean {
  if (available === null || available === undefined) return true
  if (!Number.isSafeInteger(available)) return true
  return quantity < available
}

export function stockBadge(available: number, threshold = 5): StockBadge {
  if (available < 0) return { label: `${Math.abs(available)} oversold`, tone: 'oversold' }
  if (available === 0) return { label: 'Out of stock', tone: 'out' }
  // The branch's threshold, not a hard-coded 5: "low" must mean the same thing
  // on the till as it does on the dashboard (18-04).
  if (available <= threshold) return { label: `${available} left`, tone: 'low' }
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
