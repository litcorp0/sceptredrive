import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, useMemo, useRef } from 'react'
import type { SellableProduct } from '../../lib/cart/types'
import {
  displayPriceMinor,
  type StockBadge,
  stockBadge,
  toSellableProduct,
} from '../../lib/catalog/pricing'
import type { CatalogProductRow } from '../../lib/catalog/search'
import { formatGhs } from '../../lib/format'

/**
 * The product grid (Plan 06 Task 2).
 *
 * A counter screen shows a lot of products, so the list is virtualised: only
 * the visible rows are in the DOM even when the branch has 5k SKUs. Rows hold
 * two cards, which keeps touch targets large on a 1366-wide terminal.
 *
 * Out-of-stock products stay sellable and visible — the till never blocks a
 * sale (D16).
 */

const COLUMNS = 2
const CARD_HEIGHT = 84
const ROW_GAP = 8

const TAX_LABEL: Record<string, string> = {
  STANDARD: 'VAT',
  ZERO_RATED: 'Zero-rated',
  EXEMPT: 'Exempt',
}

const TONE_CLASS: Record<StockBadge['tone'], string> = {
  ok: 'bg-muted text-muted-foreground',
  low: 'bg-amber-50 text-amber-800',
  out: 'bg-red-50 text-red-700',
  oversold: 'bg-amber-100 text-amber-900',
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

function ProductCard({
  row,
  overrideMinor,
  available,
  onAdd,
}: {
  row: CatalogProductRow
  overrideMinor: number | null
  available: number
  onAdd: (product: SellableProduct) => void
}) {
  const product = toSellableProduct(row, overrideMinor)
  const price = displayPriceMinor(row, overrideMinor)
  const badge = stockBadge(available)

  return (
    <button
      type="button"
      data-testid="product-card"
      data-sku={row.sku}
      disabled={!product}
      onClick={() => {
        if (product) onAdd(product)
      }}
      className="flex h-[84px] w-full flex-col justify-between rounded-lg border border-border bg-card p-3 text-left transition-colors hover:border-foreground/30 hover:bg-muted/40 disabled:opacity-50"
    >
      <div className="flex items-start justify-between gap-2">
        <span className="line-clamp-2 text-sm leading-tight font-medium">{row.name}</span>
        <span className="shrink-0 font-mono text-sm font-semibold">
          {price === null ? '—' : formatGhs(price)}
        </span>
      </div>
      <div className="flex items-center justify-between gap-2">
        <span className="truncate font-mono text-[11px] text-muted-foreground">{row.sku}</span>
        <span className="flex items-center gap-1">
          <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] font-medium text-muted-foreground">
            {TAX_LABEL[row.tax_category] ?? row.tax_category}
          </span>
          <span
            className={`rounded px-1.5 py-0.5 text-[10px] font-medium ${TONE_CLASS[badge.tone]}`}
          >
            {badge.label}
          </span>
        </span>
      </div>
    </button>
  )
}

export function ProductGrid({
  rows,
  priceOverrides,
  available,
  onAdd,
  empty,
}: {
  rows: readonly CatalogProductRow[]
  priceOverrides: Map<string, number>
  available: Map<string, number>
  onAdd: (product: SellableProduct) => void
  empty: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRows = useMemo(() => chunk(rows, COLUMNS), [rows])

  const virtualizer = useVirtualizer({
    count: cardRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => CARD_HEIGHT + ROW_GAP,
    overscan: 6,
    // React 19: avoid the flushSync warning during scroll updates.
    useFlushSync: false,
  })

  if (rows.length === 0) {
    return (
      <div className="flex h-full items-center justify-center rounded-lg border border-dashed border-border p-6 text-center text-sm text-muted-foreground">
        {empty}
      </div>
    )
  }

  return (
    <div ref={scrollRef} className="h-full overflow-y-auto" data-testid="product-grid">
      <div style={{ height: virtualizer.getTotalSize(), position: 'relative', width: '100%' }}>
        {virtualizer.getVirtualItems().map((virtualRow) => {
          const rowCards = cardRows[virtualRow.index] ?? []
          return (
            <div
              key={virtualRow.key}
              style={{
                position: 'absolute',
                top: 0,
                left: 0,
                width: '100%',
                height: CARD_HEIGHT,
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="grid grid-cols-2 gap-2"
            >
              {rowCards.map((card) => (
                <ProductCard
                  key={card.id}
                  row={card}
                  overrideMinor={priceOverrides.get(card.id) ?? null}
                  available={available.get(card.id) ?? 0}
                  onAdd={onAdd}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
