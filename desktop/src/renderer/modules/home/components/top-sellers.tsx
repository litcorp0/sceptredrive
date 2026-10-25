import { formatCount } from '@sceptre/shared'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
import { formatGhs } from '@/lib/format'
import type { TopSeller } from '../types'

/**
 * What moved today, in order (P10-D4).
 *
 * Five rows, quantity before revenue: a cashier restocking a shelf cares how many left, and a
 * manager cares what they were worth. Names come from the sale line's snapshot, so a renamed
 * or archived product still reads the way it did at the till.
 *
 * The SQL gives the order (quantity desc, then name) and this renders it — no second sort. An
 * empty day uses the registry `Empty`, not a dashed box of our own (Plan 03).
 */
export function TopSellers({ sellers }: { sellers: TopSeller[] }) {
  return (
    <section
      aria-labelledby="home-top-heading"
      className="rounded-lg border border-border bg-card p-4"
    >
      <h2 id="home-top-heading" className="text-sm font-semibold">
        Top five today
      </h2>
      <p className="mt-0.5 text-xs text-muted-foreground">By units sold · today on this terminal</p>

      {sellers.length === 0 ? (
        <Empty className="mt-2 border-0 p-4">
          <EmptyHeader>
            <EmptyTitle>Nothing sold yet</EmptyTitle>
            <EmptyDescription>The first sale of the day will appear here.</EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <ol className="mt-2 divide-y divide-border" data-testid="home-top-sellers">
          {sellers.map((seller, index) => (
            <li
              key={seller.productId}
              className="flex items-center justify-between gap-3 py-2"
              data-testid="home-top-seller-row"
            >
              <span className="flex min-w-0 items-center gap-2">
                <span className="w-4 shrink-0 font-mono text-xs text-muted-foreground tabular-nums">
                  {index + 1}
                </span>
                <span className="truncate text-sm" title={seller.name}>
                  {seller.name}
                </span>
              </span>
              <span className="flex shrink-0 items-baseline gap-3">
                <span className="font-mono text-xs text-muted-foreground tabular-nums">
                  ×{formatCount(seller.quantity)}
                </span>
                <span className="font-mono text-sm tabular-nums" data-money>
                  {formatGhs(seller.revenueMinor)}
                </span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </section>
  )
}
