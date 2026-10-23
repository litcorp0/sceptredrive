import { AppHeader } from '../../components/pos/app-header'
import type { PosConfigSnapshot } from '../../lib/api/types'
import type { StaffSession } from '../../lib/auth/staff-session'
import { useCart } from '../../lib/cart/cart-store'
import { formatGhs } from '../../lib/format'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { navigate } from '../../lib/router'

/**
 * Tender screen. Plan 06 Task 7 replaces this shell with the cash keypad,
 * credit panel, and the sale-draft hand-off; for now it proves the route and
 * keeps the cart intact when the cashier backs out.
 */
export function TenderScreen({
  identity,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
  config: PosConfigSnapshot
}) {
  const { totals, state } = useCart()

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={() => navigate('pos')}
        lockNote="Back to the sale"
      />
      <main className="mx-auto max-w-2xl p-6">
        <h1 className="text-lg font-semibold">Tender</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          {totals.itemCount} item{totals.itemCount === 1 ? '' : 's'} ·{' '}
          {formatGhs(totals.priced.totalMinor)}
        </p>
        <p className="mt-6 text-sm text-muted-foreground">
          Cash and credit selection arrive with the tender task. The cart is unchanged.
        </p>
        <button
          type="button"
          onClick={() => navigate('pos')}
          className="mt-6 h-11 rounded-md border border-border px-4 text-sm font-medium hover:bg-muted"
        >
          Back to cart
        </button>
        <p className="mt-4 text-xs text-muted-foreground">
          {state.lines.length} lines in the draft
        </p>
      </main>
    </div>
  )
}
