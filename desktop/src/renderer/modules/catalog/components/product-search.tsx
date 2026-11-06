import { useQuery } from '@powersync/react'
import { type RefObject, useMemo, useState } from 'react'
import { ManagerOverrideDialog } from '@/components/common'
import { Button } from '@/components/ui/button'
import type { SellableProduct } from '@/lib/cart/types'
import { useBranchAvailability } from '@/lib/catalog/availability'
import { toSellableProduct } from '@/lib/catalog/pricing'
import {
  BROWSE_LIMIT,
  buildProductSearchQuery,
  type CatalogProductRow,
  pickEnterTarget,
  SEARCH_LIMIT,
} from '@/lib/catalog/search'
import { useDebouncedValue } from '@/lib/hooks'
import { lockoutPolicyFor } from '@/lib/pos-config'
import { usePos } from '@/lib/powersync/provider'
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
  const { session } = usePos()
  const config = session?.config ?? null
  // The branch's own threshold and policy, so the till agrees with the dashboard
  // and the shop chooses whether stock may be sold at zero (18-04).
  const threshold = config?.pos.lowStockThreshold ?? 5
  const policy = config?.pos.outOfStockPolicy ?? 'ALLOW'

  const [term, setTerm] = useState('')
  const [blocked, setBlocked] = useState<SellableProduct | null>(null)
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
  const priceOverrides = useMemo(() => {
    const map = new Map<string, number>()
    for (const row of prices.data ?? []) map.set(row.product_id, row.price_minor)
    return map
  }, [prices.data])

  // The same availability the cart caps `+` with (P20-D9): one query pair, so a
  // badge and a quantity control cannot disagree.
  const available = useBranchAvailability(branchId)

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

  /** A blocked add: a manager authorises it, then the line lands (18-04). */
  function addBlocked(product: SellableProduct) {
    onAdd(product)
    setTerm('')
    setBlocked(null)
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
        <div className="relative min-w-0 flex-1">
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
            placeholder="Scan a barcode, or search by name or SKU"
            autoComplete="off"
            autoCorrect="off"
            spellCheck={false}
            className="h-12 w-full rounded-lg border border-border bg-background pr-14 pl-4 text-base"
          />
          <kbd className="pointer-events-none absolute top-1/2 right-3 -translate-y-1/2 rounded border border-border px-1.5 py-0.5 font-mono text-[11px] text-muted-foreground">
            F2
          </kbd>
        </div>
        {term ? (
          <Button
            type="button"
            variant="outline"
            onClick={() => {
              setTerm('')
              focusRef.current?.focus()
            }}
            className="h-12 px-3 text-sm"
          >
            Clear
          </Button>
        ) : null}
      </div>

      {searching ? (
        <>
          <div className="mb-2 flex items-center justify-between text-[11px] text-muted-foreground">
            <span data-testid="product-count">{`${shown} match${shown === 1 ? '' : 'es'}`}</span>
            {shown >= SEARCH_LIMIT ? (
              <span>Showing the first {SEARCH_LIMIT} — refine the search</span>
            ) : null}
          </div>

          <div className="min-h-0 flex-1">
            <ProductGrid
              rows={products.data ?? []}
              priceOverrides={priceOverrides}
              available={available}
              threshold={threshold}
              policy={policy}
              onAdd={onAdd}
              onBlocked={setBlocked}
              empty={`Nothing matches “${term.trim()}”. Check the spelling, or use the barcode.`}
            />
          </div>
        </>
      ) : (
        // No cards until something is typed or scanned: a shop with thousands of
        // SKUs is searched, not browsed (18-04).
        <div
          className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-lg border border-dashed border-border bg-card/40 p-8 text-center"
          data-testid="catalogue-idle"
        >
          <p className="text-sm font-medium">Scan a barcode, or search by name or SKU.</p>
          <p className="mt-1 max-w-md text-xs text-muted-foreground">
            The catalogue is searchable only, so a long product list never hides the item in front
            of you.
          </p>
        </div>
      )}

      {blocked ? (
        <ManagerOverrideDialog
          title="Out of stock"
          description={`“${blocked.name}” has nothing on hand at this branch. A manager may authorise selling it; the sale records the stock conflict.`}
          permission="inventory.adjust"
          policy={lockoutPolicyFor(config)}
          onClose={() => setBlocked(null)}
          onApproved={() => addBlocked(blocked)}
          {...(policy === 'WARN' ? { onBypass: () => addBlocked(blocked) } : {})}
        />
      ) : null}
    </div>
  )
}
