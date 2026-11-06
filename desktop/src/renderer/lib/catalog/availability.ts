import { useQuery } from '@powersync/react'
import { useMemo } from 'react'
import { availableQuantity, indexByProduct } from './pricing'

/**
 * What this branch can actually sell, per product (D16, P20-D9).
 *
 * On-hand at the branch plus this terminal's unacked `local_stock_delta` rows: the
 * deltas are sales this till has committed but the server has not acked yet, and
 * ignoring them would let a cashier resell the same unit until the upload lands.
 *
 * One definition, two readers: the catalogue panel paints its badges from it, and
 * the cart uses the same number to decide how far `+` may go. Two readers with two
 * queries is how a badge says 11 while the cart happily counts to 12.
 */

export interface StockLevelRow {
  product_id: string
  quantity_on_hand: number
}

export interface StockDeltaRow {
  product_id: string
  quantity_delta: number
}

/** Pure, so the join can be pinned without a database. */
export function buildAvailability(
  stockRows: readonly StockLevelRow[],
  deltaRows: readonly StockDeltaRow[],
): Map<string, number> {
  const deltas = indexByProduct(deltaRows)
  const map = new Map<string, number>()
  for (const row of stockRows) {
    map.set(
      row.product_id,
      availableQuantity(row.quantity_on_hand, deltas.get(row.product_id)?.quantity_delta ?? 0),
    )
  }
  return map
}

/**
 * Live availability for one branch.
 *
 * A product with no `stock_level` row is absent from the map, which every reader
 * treats as zero: a part this branch has never stocked has nothing to sell until
 * it is received.
 */
export function useBranchAvailability(branchId: string): Map<string, number> {
  const stock = useQuery<StockLevelRow>(
    'SELECT product_id, quantity_on_hand FROM stock_level WHERE branch_id = ?',
    [branchId],
  )
  const deltas = useQuery<StockDeltaRow>(
    `SELECT product_id, SUM(quantity_delta) AS quantity_delta
       FROM local_stock_delta
      WHERE acked_at IS NULL
      GROUP BY product_id`,
  )

  return useMemo(
    () => buildAvailability(stock.data ?? [], deltas.data ?? []),
    [stock.data, deltas.data],
  )
}
