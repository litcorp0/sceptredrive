import { formatGhs } from '@/lib/format'
import type { ShiftCashTotals } from '@/lib/shift/shift-repository'

/**
 * Expected cash in the drawer for **this shift** (P10-D5, P20-D10).
 *
 * A different window from the day figures above it: the take spans every shift of the day
 * and every tender method, the drawer holds only the open shift and only cash. The caption
 * says "this shift" and carries the shift number so a cashier who closed and reopened at
 * lunchtime cannot read the difference as a shortage — and the line underneath shows the
 * terms, so a take of GHS 4,245 beside a drawer of GHS 2,930 reads as "the rest was MoMo"
 * rather than as missing money.
 *
 * With no open shift the tile says so and offers the way to open one. It never keeps the last
 * close's figure on screen: a stale number on a cash tile is worse than no number, because it
 * looks like today's.
 */
export function DrawerTile({
  expectedCashMinor,
  shiftNumber,
  cashTotals,
}: {
  expectedCashMinor: number | null
  shiftNumber: string | null
  cashTotals: ShiftCashTotals | null
}) {
  const shiftLabel = shiftNumber ? `this shift · ${shiftNumber}` : 'this shift'
  const terms = cashTotals ? cashTerms(cashTotals) : []

  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium tracking-[0.08em] text-muted-foreground uppercase">
        Expected in the drawer
      </p>
      <p className="mt-0.5 text-xs text-muted-foreground">{shiftLabel}</p>

      {expectedCashMinor === null ? (
        <div className="mt-1">
          <p className="font-display text-lg font-semibold">No open shift</p>
          <a
            href="#shift"
            className="inline-flex h-11 items-center text-sm font-medium text-brand-ink underline underline-offset-4 hover:no-underline"
            data-testid="home-open-shift"
          >
            Open a shift
          </a>
        </div>
      ) : (
        <>
          <p
            className="mt-1 font-mono text-2xl font-semibold tabular-nums"
            data-money
            data-testid="home-drawer"
          >
            {formatGhs(expectedCashMinor)}
          </p>
          {terms.length > 0 ? (
            <p
              className="mt-1 text-[11px] leading-relaxed text-muted-foreground tabular-nums"
              data-testid="home-drawer-terms"
            >
              {terms.map((term, index) => (
                <span key={term.label}>
                  {index > 0 ? (term.sign > 0 ? ' + ' : ' − ') : ''}
                  {term.label} {formatGhs(term.amountMinor)}
                </span>
              ))}
            </p>
          ) : null}
          <p className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
            Cash only. Card, MoMo and credit never enter the drawer.
          </p>
          <a
            href="#shift"
            className="inline-flex h-11 items-center text-sm font-medium text-brand-ink underline underline-offset-4 hover:no-underline"
            data-testid="home-shift-details"
          >
            Shift details
          </a>
        </>
      )}
    </div>
  )
}

interface CashTerm {
  label: string
  amountMinor: number
  sign: 1 | -1
}

/**
 * The drawer formula, spelled out in the order it is added up.
 *
 * Every term comes from `ShiftCashTotals` — the same object `computeExpectedCash` sums — so
 * the line on screen cannot drift from the figure above it. Zero terms are dropped, except
 * `cash`: "cash GHS 0.00" is a fact about a shop that took no cash, and hiding it would leave
 * an empty line.
 */
export function cashTerms(totals: ShiftCashTotals): CashTerm[] {
  const terms: CashTerm[] = [{ label: 'float', amountMinor: totals.openingFloatMinor, sign: 1 }]
  terms.push({ label: 'cash', amountMinor: totals.cashTendersMinor, sign: 1 })
  if (totals.changeMinor > 0) {
    terms.push({ label: 'change', amountMinor: totals.changeMinor, sign: -1 })
  }
  if (totals.cashInMinor > 0) {
    terms.push({ label: 'cash in', amountMinor: totals.cashInMinor, sign: 1 })
  }
  if (totals.cashOutMinor > 0) {
    terms.push({ label: 'cash out', amountMinor: totals.cashOutMinor, sign: -1 })
  }
  if (totals.cashRefundsMinor > 0) {
    terms.push({ label: 'refunds', amountMinor: totals.cashRefundsMinor, sign: -1 })
  }
  if (totals.cashRepaymentsMinor > 0) {
    terms.push({ label: 'repayments', amountMinor: totals.cashRepaymentsMinor, sign: 1 })
  }
  return terms
}
