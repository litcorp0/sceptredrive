import { useVirtualizer } from '@tanstack/react-virtual'
import { type ReactNode, type RefObject, useEffect, useMemo, useRef, useState } from 'react'
import { Badge } from '@/components/ui/badge'
import { Empty, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import type { OutOfStockPolicy } from '@/lib/api/types'
import type { SellableProduct } from '@/lib/cart/types'
import {
  displayPriceMinor,
  outOfStockBlocked,
  type StockBadge,
  stockBadge,
  toSellableProduct,
} from '@/lib/catalog/pricing'
import type { CatalogProductRow } from '@/lib/catalog/search'
import { formatGhs } from '@/lib/format'

/**
 * The product grid (Plan 06 Task 2).
 *
 * A counter screen shows a lot of products, so the list is virtualised: only
 * the visible rows are in the DOM even when the branch has 5k SKUs. Rows hold
 * two cards, which keeps touch targets large on a 1366-wide terminal.
 *
 * The card is two rows: the name (three lines, full width) over a foot row
 * (SKU, tax, stock). The price sits top-right beside the name once there is
 * room for both and wraps under it below 1280 px, so a long name is never cut
 * to keep the price on the same line.
 *
 * Height is not a constant here: cards size from `--product-card-height`, the
 * same variable the virtualiser's estimate reads. The card and the row height
 * therefore move together at the 1280 breakpoint instead of drifting.
 *
 * Out-of-stock products stay sellable and visible — the till never blocks a
 * sale (D16).
 */

const COLUMNS = 2
/** Space between rows, baked into the virtualiser's estimate only. */
const ROW_GAP = 8
/** Used before the stylesheet resolves, and in a non-browser context. */
const FALLBACK_CARD_HEIGHT = 120
const CARD_HEIGHT_VAR = '--product-card-height'

const TAX_LABEL: Record<string, string> = {
  STANDARD: 'VAT',
  ZERO_RATED: 'Zero-rated',
  EXEMPT: 'Exempt',
}

/*
 * Chip colour never carries the meaning: the label does. A 10 px coloured
 * label on a 10% tint lands under 4.5:1 (measured `text-warn` on `bg-warn/10`
 * over `bg-card` at 4.39:1), so the tint and the dot stay and the text is
 * `text-foreground`. `oversold` stays on the warn family and `out` on danger;
 * a transparent border on every tone keeps the chips the same height once
 * `oversold` draws its own.
 */
const TONE_CLASS: Record<StockBadge['tone'], string> = {
  ok: 'border border-transparent bg-muted text-foreground',
  low: 'border border-transparent bg-warn/10 text-foreground',
  out: 'border border-transparent bg-danger/10 text-foreground',
  oversold: 'border border-warn/30 bg-warn/10 text-foreground',
}

const TONE_DOT: Record<StockBadge['tone'], string | null> = {
  ok: null,
  low: 'bg-warn',
  out: 'bg-danger',
  oversold: 'bg-warn',
}

function chunk<T>(items: readonly T[], size: number): T[][] {
  const rows: T[][] = []
  for (let index = 0; index < items.length; index += size) {
    rows.push(items.slice(index, index + size))
  }
  return rows
}

function readCardHeight(): number {
  if (typeof document === 'undefined') return FALLBACK_CARD_HEIGHT
  const raw = window.getComputedStyle(document.documentElement).getPropertyValue(CARD_HEIGHT_VAR)
  const parsed = Number.parseFloat(raw)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : FALLBACK_CARD_HEIGHT
}

/**
 * The numeric height the virtualiser should assume. It is read from the CSS
 * variable rather than mirrored in TypeScript, and re-read whenever the scroll
 * column resizes so the 1280 breakpoint is the stylesheet's decision alone.
 */
function useCardHeight(element: RefObject<HTMLDivElement | null>): number {
  const [height, setHeight] = useState(readCardHeight)

  useEffect(() => {
    const target = element.current
    if (!target || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(() => setHeight(readCardHeight()))
    observer.observe(target)
    setHeight(readCardHeight())
    return () => observer.disconnect()
  }, [element])

  return height
}

function ProductCard({
  row,
  overrideMinor,
  available,
  carried,
  threshold,
  policy,
  onAdd,
  onBlocked,
}: {
  row: CatalogProductRow
  overrideMinor: number | null
  available: number
  /** False when this branch has never stocked the product (P20-D13). */
  carried: boolean
  threshold: number
  policy: OutOfStockPolicy
  onAdd: (product: SellableProduct) => void
  /** A blocked add: ask a manager, rather than silently refusing (18-04). */
  onBlocked: (product: SellableProduct) => void
}) {
  const product = toSellableProduct(row, overrideMinor)
  const price = displayPriceMinor(row, overrideMinor)
  // "Out of stock" and "Not stocked here" are different facts and must not read the
  // same: one is a product this branch sells and has run out of, the other is one it
  // has never carried. The card still sells it (a manager authorises, as at zero stock)
  // because a till that refuses is how a sale is lost.
  const badge = carried
    ? stockBadge(available, threshold)
    : { label: 'Not stocked here', tone: 'out' as const }
  const dot = TONE_DOT[badge.tone]
  // Blocked: dimmed, announced as disabled, and the click asks for a manager
  // instead of adding. `ALLOW` is the pre-18 behaviour (badge only).
  const blocked = outOfStockBlocked(policy, available)

  return (
    <button
      type="button"
      data-testid="product-card"
      data-sku={row.sku}
      data-blocked={blocked ? 'true' : undefined}
      aria-disabled={blocked || !product ? true : undefined}
      disabled={!product}
      onClick={() => {
        if (!product) return
        if (blocked) {
          onBlocked(product)
          return
        }
        onAdd(product)
      }}
      className="grid h-[var(--product-card-height)] w-full grid-rows-[minmax(0,1fr)_auto] gap-1 overflow-hidden rounded-lg border border-border bg-card p-2 text-left transition-colors hover:border-line-strong hover:bg-muted/40 disabled:opacity-50 data-[blocked=true]:opacity-50 data-[blocked=true]:grayscale"
    >
      <div className="flex min-h-0 flex-wrap items-start justify-between gap-x-2 gap-y-0.5">
        {row.brand_name ? (
          <span
            data-testid="product-brand"
            className="basis-full truncate text-[10px] font-semibold tracking-wide text-muted-foreground uppercase"
            title={row.brand_name}
          >
            {row.brand_name}
          </span>
        ) : null}
        <span
          data-testid="product-name"
          className={`${
            row.brand_name ? 'line-clamp-2' : 'line-clamp-3'
          } min-w-0 grow basis-full text-sm leading-tight font-medium xl:basis-auto`}
        >
          {row.name}
        </span>
        <span
          data-testid="product-price"
          className="shrink-0 font-mono text-sm leading-tight font-semibold tabular-nums"
        >
          {price === null ? '—' : formatGhs(price)}
        </span>
      </div>

      <div className="flex items-center justify-between gap-2">
        <span
          className="min-w-0 truncate font-mono text-[11px] text-muted-foreground"
          title={row.sku}
        >
          {row.sku}
        </span>
        <span className="flex shrink-0 items-center gap-1">
          <Badge variant="secondary" className="px-1.5 text-[10px] text-muted-foreground">
            {TAX_LABEL[row.tax_category] ?? row.tax_category}
          </Badge>
          <Badge className={`px-1.5 text-[10px] ${TONE_CLASS[badge.tone]}`}>
            {dot ? <span aria-hidden="true" className={`size-1.5 rounded-full ${dot}`} /> : null}
            {badge.label}
          </Badge>
        </span>
      </div>
    </button>
  )
}

export function ProductGrid({
  rows,
  priceOverrides,
  available,
  carried,
  threshold,
  policy,
  onAdd,
  onBlocked,
  empty,
}: {
  rows: readonly CatalogProductRow[]
  priceOverrides: Map<string, number>
  available: Map<string, number>
  /** Products this branch carries at all; absent means never stocked here. */
  carried: Set<string>
  threshold: number
  policy: OutOfStockPolicy
  onAdd: (product: SellableProduct) => void
  onBlocked: (product: SellableProduct) => void
  empty: ReactNode
}) {
  const scrollRef = useRef<HTMLDivElement>(null)
  const cardRows = useMemo(() => chunk(rows, COLUMNS), [rows])
  const cardHeight = useCardHeight(scrollRef)

  const virtualizer = useVirtualizer({
    count: cardRows.length,
    getScrollElement: () => scrollRef.current,
    estimateSize: () => cardHeight + ROW_GAP,
    overscan: 6,
    // React 19: avoid the flushSync warning during scroll updates.
    useFlushSync: false,
  })

  // A breakpoint change moves every row; drop the old measurements so the
  // scroll height is rebuilt from the new estimate rather than mixing both.
  useEffect(() => {
    virtualizer.measure()
  }, [virtualizer, cardHeight])

  if (rows.length === 0) {
    return (
      <Empty className="h-full border border-dashed border-border">
        <EmptyHeader>
          <EmptyTitle className="text-sm font-normal text-muted-foreground">{empty}</EmptyTitle>
        </EmptyHeader>
      </Empty>
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
                height: 'var(--product-card-height)',
                transform: `translateY(${virtualRow.start}px)`,
              }}
              className="grid grid-cols-2 gap-x-2"
            >
              {rowCards.map((card) => (
                <ProductCard
                  key={card.id}
                  row={card}
                  overrideMinor={priceOverrides.get(card.id) ?? null}
                  available={available.get(card.id) ?? 0}
                  carried={carried.has(card.id)}
                  threshold={threshold}
                  policy={policy}
                  onAdd={onAdd}
                  onBlocked={onBlocked}
                />
              ))}
            </div>
          )
        })}
      </div>
    </div>
  )
}
