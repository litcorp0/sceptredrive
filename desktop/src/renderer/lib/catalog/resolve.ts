import type { PowerSyncDatabase } from '@powersync/web'
import type { SellableProduct } from '../cart/types'
import { toSellableProduct } from './pricing'
import { type CatalogProductRow, findProductByCode } from './search'

/**
 * Code → cart product (Plan 06 Task 2).
 *
 * Resolves a scanned barcode (or typed SKU) against the local catalogue and
 * applies the branch price override with the shared rule. The outcome is
 * explicit so the till can say "not found" instead of silently dropping the
 * scan — a cashier must never wonder whether the scanner worked.
 */

export type CodeLookup =
  | { status: 'found'; product: SellableProduct }
  | { status: 'unknown' }
  | { status: 'unsellable'; row: CatalogProductRow }

export async function lookupScannedProduct(
  db: PowerSyncDatabase,
  code: string,
  branchId: string,
): Promise<CodeLookup> {
  const row = await findProductByCode(db, code)
  if (!row) return { status: 'unknown' }

  const override = await db.getOptional<{ price_minor: number }>(
    'SELECT price_minor FROM product_price WHERE product_id = ? AND branch_id = ?',
    [row.id, branchId],
  )

  const product = toSellableProduct(row, override?.price_minor ?? null)
  if (!product) return { status: 'unsellable', row }
  return { status: 'found', product }
}
