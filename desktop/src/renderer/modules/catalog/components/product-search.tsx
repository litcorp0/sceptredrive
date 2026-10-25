import { useQuery } from '@powersync/react'
import { type RefObject, useMemo, useState } from 'react'
import type { SellableProduct } from '@/lib/cart/types'
import { availableQuantity, indexByProduct, toSellableProduct } from '@/lib/catalog/pricing'
import {
  BROWSE_LIMIT,
  buildProductSearchQuery,
  type CatalogProductRow,
  pickEnterTarget,
  SEARCH_LIMIT,
} from '@/lib/catalog/search'
import { useDebouncedValue } from '@/lib/hooks'
import { ProductGrid } from './product-grid'

/**
 * Catalogue panel (Plan 06 Task 2): one search field that also accepts a
 * scanner, and a virtualised grid underneath.
 *
 * Empty search = browse the branch catalogue. A term searches name, SKU, and
 * barcode. Enter adds the exact match (or the only result) and clears the field
 * so the next scan starts clean.
 */

const SEARCH_DEBOUNCE_MS = 150

interface ProductPriceRow {
  product_id: string
  price_minor: number
}

interface StockRow {
  product_id: string
  quantity_on_hand: number
}

interface DeltaRow {
  product_id: string
  quantity_delta: number
}

export function ProductSearch({
  branchId,
  focusRef,
  onAdd,
  onUnknown,
}: {
  branchId: string
  focusRef: RefObject<HTMLInputElement | null>
  onAdd: (product: SellableProduct) => void
  onUnknown: (code: string) => void
}) {
  const [term, setTerm] = useState('')
  const debouncedTerm = useDebouncedValue(term, SEARCH_DEBOUNCE_MS)

  const query = useMemo(
    () =>
      buildProductSearchQuery(debouncedTerm, debouncedTerm.trim() ? SEARCH_LIMIT : BROWSE_LIMIT),
    [debouncedTerm],
  )

  const products = useQuery<CatalogProductRow>(query.sql, query.parameters)
  const prices = useQuery<ProductPriceRow>(
    'SELECT product_id, price_minor FROM product_price WHERE branch_id = ?',
    [branchId],
  )
  const stock = useQuery<StockRow>(
    'SELECT product_id, quantity_on_hand FROM stock_level WHERE branch_id = ?',
    [branchId],
  )
  const deltas = useQuery<DeltaRow>(
    `SELECT product_id, SUM(quantity_delta) AS quantity_delta
       FROM local_stock_delta
      WHERE acked_at IS NULL
      GROUP BY product_id`,
  )

  const priceOverrides = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of prices.data ?? []) map.set(row.product_id, row.price_minor)
    return map
  }, [prices.data])

  const available = useMemo(() => {
    const stockIndex = indexByProduct(stock.data ?? [])
    const deltaIndex = indexByProduct(deltas.data ?? [])
    const map = new Map<string, number>()

    for (const row of products.data ?? []) {
      map.set(
        row.id,
        availableQuantity(
          stockIndex.get(row.id)?.quantity_on_hand ?? 0,
          deltaIndex.get(row.id)?.quantity_delta ?? 0,
        ),
      )
    }
    return map
  }, [products.data, stock.data, deltas.data])

  function addRow(row: CatalogProductRow) {
    const product = toSellableProduct(row, priceOverrides.get(row.id) ?? null)
    if (!product) {
      onUnknown(row.sku)
      return
    }
    onAdd(product)
    setTerm('')
    focusRef.current?.focus()
  }

  function onEnter() {
    const rows = products.data ?? []
    const target = pickEnterTarget(term, rows)
    if (target) {
      addRow(target)
      return
    }
    // A complete code that matched nothing is worth saying out loud; an
    // ambiguous word is not (the cashier can see the results).
    if (term.trim() && rows.length === 0) onUnknown(term.trim())
  }

  const searching = term.trim().length > 0
  const shown = products.data?.length ?? 0

  return (
    <div className="flex h-full flex-col">
      <div className="mb-3 flex items-center gap-2">
        <label htmlFor="product-search" className="sr-only">
          Search products
        </label>
        <input
          id="product-search"
          ref={focusRef}
          data-testid="product-search"
          value={term}
          onChange={(event) => setTerm(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter') {
              event.preventDefault()
              onEnter()
            }
            if (event.key === 'Escape') {
              setTerm('')
            }
          }}
          placeholder="Scan a barcode, or search by name or SKU (F2)"
          autoComplete="off"
          autoCorrect="off"
          spellCheck={false}
          className="h-12 w-full rounded-lg border border-border bg-background px-4 text-base"
        />
        {term ? (
          <button
            type="button"
            onClick={() => {
              setTerm('')
              focusRef.current?.focus()
            }}
            className="h-12 rounded-lg border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            Clear
          </button>
        ) : null}
      </div>

      <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
        <span data-testid="product-count">
          {searching ? `${shown} match${shown === 1 ? '' : 'es'}` : `${shown} products`}
        </span>
        {shown >= (searching ? SEARCH_LIMIT : BROWSE_LIMIT) ? (
          <span>
            Showing the first {searching ? SEARCH_LIMIT : BROWSE_LIMIT} — refine the search
          </span>
        ) : null}
      </div>

      <div className="min-h-0 flex-1">
        <ProductGrid
          rows={products.data ?? []}
          priceOverrides={priceOverrides}
          available={available}
          onAdd={onAdd}
          empty={
            searching
              ? `Nothing matches “${term.trim()}”. Check the spelling, or use the barcode.`
              : 'No products have synced to this terminal yet.'
          }
        />
      </div>
    </div>
  )
}
