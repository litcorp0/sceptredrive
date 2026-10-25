import { createPortal } from 'react-dom'
import type { PosLoyaltyConfig } from '@/lib/api/types'
import type { CartTotals } from '@/lib/cart/totals'
import type { CartCustomer } from '@/lib/cart/types'
import type { CustomerLoyalty } from '@/lib/customers/context'
import { formatGhs } from '@/lib/format'
import { LoyaltyRedeemDialog } from './loyalty-redeem-dialog'

/**
 * Loyalty rail (Plan 06 Task 4).
 *
 * Shows the balance the cashier can spend now (synced + unsynced deltas), what
 * this sale will earn, and the redemption already applied. Points are not
 * money: the earn number is a preview, the redemption value is a pre-tax
 * discount computed by the shared engine.
 *
 * The panel owns the redeem dialog (P10-D11), so the sell page sees one
 * component and one `open` flag. The cart preview stays a callback: the panel
 * must not learn how the cart is priced. The dialog is portalled because the rail
 * is hidden below `lg`, and F6 must still open it there.
 */
export function LoyaltyPanel({
  customer,
  loyalty,
  totals,
  redeemPoints,
  config,
  open,
  onRedeem,
  onClose,
  onPreview,
  onConfirm,
  onClear,
}: {
  customer: CartCustomer | null
  loyalty: CustomerLoyalty
  totals: CartTotals
  /** The points the cashier actually chose (not reconstructed from money). */
  redeemPoints: number
  config: PosLoyaltyConfig
  /** The redeem dialog is open. */
  open: boolean
  onRedeem: () => void
  onClose: () => void
  /** What this many points would do to the cart, priced by the caller. */
  onPreview: (points: number) => { totalMinor: number; appliedMinor: number }
  onConfirm: (points: number) => void
  onClear: () => void
}) {
  const canRedeem =
    Boolean(customer) &&
    totals.priced.netMinor > 0 &&
    loyalty.availablePoints >= config.minimumRedeemPoints

  return (
    <>
      <section aria-label="Loyalty" className="rounded-lg border border-border bg-card p-3">
        <h2 className="mb-2 text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
          Loyalty
        </h2>

        {!customer ? (
          <p className="text-xs text-muted-foreground">Add a customer to earn or redeem points.</p>
        ) : (
          <div className="grid gap-2 text-xs" data-testid="loyalty-panel">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Points available</span>
              <span className="font-mono font-semibold" data-testid="loyalty-available">
                {loyalty.availablePoints}
              </span>
            </div>

            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">This sale earns</span>
              <span className="font-mono" data-testid="loyalty-earn-preview">
                {totals.earnPreviewPoints > 0 ? `${totals.earnPreviewPoints} pts` : '0 points'}
              </span>
            </div>

            {totals.loyaltyDiscountMinor > 0 ? (
              <div
                className="rounded-md border border-emerald-200 bg-emerald-50 px-2 py-1.5"
                data-testid="loyalty-applied"
              >
                <div className="flex items-baseline justify-between">
                  <span className="font-medium text-emerald-900">{redeemPoints} pts redeemed</span>
                  <span className="font-mono text-emerald-900">
                    −{formatGhs(totals.loyaltyDiscountMinor)}
                  </span>
                </div>
                <p className="mt-0.5 text-[10px] text-emerald-800">
                  Pre-tax discount · {config.minimumRedeemPoints} pt minimum
                </p>
                <button
                  type="button"
                  onClick={onClear}
                  className="mt-1 rounded px-1 py-0.5 text-[10px] font-medium text-emerald-900 underline"
                  data-testid="clear-redemption"
                >
                  Remove redemption
                </button>
              </div>
            ) : null}

            <button
              type="button"
              onClick={onRedeem}
              disabled={!canRedeem}
              className="h-9 w-full rounded-md border border-border text-xs font-medium hover:bg-muted disabled:opacity-40"
              data-testid="redeem-points"
              title={
                canRedeem
                  ? 'Redeem points against this sale'
                  : `Needs at least ${config.minimumRedeemPoints} points`
              }
            >
              Redeem points <span className="opacity-60">F6</span>
            </button>

            {!canRedeem && loyalty.availablePoints > 0 ? (
              <p className="text-[10px] text-muted-foreground">
                {totals.priced.netMinor === 0
                  ? 'Add an item to redeem points against this sale.'
                  : `Minimum redemption is ${config.minimumRedeemPoints} points.`}
              </p>
            ) : null}
          </div>
        )}
      </section>

      {open
        ? createPortal(
            <LoyaltyRedeemDialog
              loyalty={loyalty}
              config={config}
              cartNetMinor={totals.priced.netMinor}
              cartTotalMinor={totals.priced.totalMinor}
              currentPoints={redeemPoints}
              preview={onPreview}
              onClose={onClose}
              onConfirm={onConfirm}
            />,
            document.body,
          )
        : null}
    </>
  )
}
