import { formatCount } from '@sceptre/shared'
import { formatGhs } from '@/lib/format'
import type { HomeSummary } from '../types'

/**
 * The take, at counter distance (P10-D1, P10-D5).
 *
 * The dominant figure is what this terminal took today, tax included. It is not the branch's
 * takings and the heading above it says so — this device only ever holds the sales it wrote
 * itself, so a figure labelled "today's take" would be read as the shop's money and be wrong.
 *
 * The sub-line carries sales, units, and the average basket. On a day with no sales the basket
 * renders an em dash, never `GH₵ 0.00`: a zero basket is a claim about a sale that did not
 * happen (P10-D3).
 */
export function TakeFigure({ summary }: { summary: HomeSummary }) {
  const basket = summary.hasSales ? formatGhs(summary.averageBasketMinor) : '—'

  return (
    <section aria-labelledby="home-take-label" className="mt-4">
      <h2
        id="home-take-label"
        className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase"
      >
        Take · today on this terminal
      </h2>
      <p
        className="mt-1 font-display text-[5rem] leading-none font-semibold tabular-nums"
        data-money
        data-testid="home-take"
      >
        {formatGhs(summary.takeMinor)}
      </p>
      <p className="mt-2 text-sm text-muted-foreground" data-testid="home-take-subline">
        {formatCount(summary.salesCount)} {summary.salesCount === 1 ? 'sale' : 'sales'} ·{' '}
        {formatCount(summary.itemsSold)} {summary.itemsSold === 1 ? 'item' : 'items'} · {basket}{' '}
        average basket
      </p>
    </section>
  )
}
