import { formatGhs } from '@/lib/format'

/**
 * Expected cash in the drawer for **this shift** (P10-D5).
 *
 * A different window from the day figures above it: the take spans every shift of the day,
 * the drawer holds only the open one. The caption says "this shift" and carries the shift
 * number so a cashier who closed and reopened at lunchtime cannot read the difference as a
 * shortage.
 *
 * With no open shift the tile says so and offers the way to open one. It never keeps the last
 * close's figure on screen: a stale number on a cash tile is worse than no number, because it
 * looks like today's.
 */
export function DrawerTile({
  expectedCashMinor,
  shiftNumber,
}: {
  expectedCashMinor: number | null
  shiftNumber: string | null
}) {
  const shiftLabel = shiftNumber ? `this shift · ${shiftNumber}` : 'this shift'

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
