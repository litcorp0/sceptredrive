import { formatGhs } from '@/lib/format'
import type { HomeSummary } from '../types'

/**
 * Credit given and tax included — the two figures a cashier should not have to work out.
 *
 * Neither is a second implementation of a rule: both are sums the local sale row already
 * carries (`credit_amount_minor`, `tax_total_minor`), scoped to today on this terminal. Tax is
 * shown because a cashier counting the drawer needs to know that part of the take is not the
 * shop's money (P10-D5). Credit is shown because nothing about it is cash in the drawer, and
 * the label has to say "given", not "taken".
 *
 * The component returns the two tiles as siblings — the page puts them in the same grid as the
 * drawer tile, so the row reads as three cards, not one card with two numbers.
 */
export function StatTiles({ summary }: { summary: HomeSummary }) {
  return (
    <>
      <StatTile
        label="Credit given"
        detail="today on this terminal"
        value={formatGhs(summary.creditMinor)}
        testId="home-credit"
      />
      <StatTile
        label="Tax included"
        detail="today on this terminal · to remit, not the shop's"
        value={formatGhs(summary.taxMinor)}
        testId="home-tax"
      />
    </>
  )
}

function StatTile({
  label,
  detail,
  value,
  testId,
}: {
  label: string
  detail: string
  value: string
  testId: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        {label}
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{detail}</p>
      <p
        className="mt-1 font-mono text-2xl font-semibold tabular-nums"
        data-money
        data-testid={testId}
      >
        {value}
      </p>
    </div>
  )
}
