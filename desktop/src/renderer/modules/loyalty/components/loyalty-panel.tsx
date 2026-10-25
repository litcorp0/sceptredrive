import { StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Empty, EmptyDescription, EmptyHeader, EmptyTitle } from '@/components/ui/empty'
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
 * must not learn how the cart is priced. The dialog portals itself to the body,
 * so the rail sitting below the cart under 1024 px does not stop F6 from
 * opening it.
 *
 * An applied redemption is a verified state, so it wears the `--ok` tint with
 * foreground copy; the numbers are unchanged.
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
      <Card aria-label="Loyalty" role="region" className="gap-2 py-3" data-testid="loyalty-card">
        <CardHeader className="items-center gap-1.5 px-3">
          <CardTitle className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            Loyalty
          </CardTitle>
        </CardHeader>

        <CardContent className="px-3">
          {!customer ? (
            <Empty className="items-start gap-1 border-0 p-0 text-left md:p-0">
              <EmptyHeader className="items-start gap-1 text-left">
                <EmptyTitle className="text-sm font-medium text-foreground">
                  No customer yet
                </EmptyTitle>
                <EmptyDescription className="text-xs">
                  Add a customer to earn or redeem points.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          ) : (
            <div className="grid gap-2 text-xs" data-testid="loyalty-panel">
              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">Points available</span>
                <span
                  className="font-mono font-semibold tabular-nums"
                  data-testid="loyalty-available"
                >
                  {loyalty.availablePoints}
                </span>
              </div>

              <div className="flex items-baseline justify-between gap-2">
                <span className="text-muted-foreground">This sale earns</span>
                <span className="font-mono tabular-nums" data-testid="loyalty-earn-preview">
                  {totals.earnPreviewPoints > 0 ? `${totals.earnPreviewPoints} pts` : '0 points'}
                </span>
              </div>

              {totals.loyaltyDiscountMinor > 0 ? (
                <StatusNote tone="ok" className="px-2 py-1.5" data-testid="loyalty-applied">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="font-medium">{redeemPoints} pts redeemed</span>
                    <span className="font-mono tabular-nums">
                      −{formatGhs(totals.loyaltyDiscountMinor)}
                    </span>
                  </div>
                  <p className="mt-0.5 text-[10px] text-muted-foreground">
                    Pre-tax discount · {config.minimumRedeemPoints} pt minimum
                  </p>
                  <Button
                    type="button"
                    variant="link"
                    onClick={onClear}
                    className="h-11 min-w-11 justify-start px-0 text-[10px] text-foreground"
                    data-testid="clear-redemption"
                  >
                    Remove redemption
                  </Button>
                </StatusNote>
              ) : null}

              <Button
                type="button"
                variant="outline"
                onClick={onRedeem}
                disabled={!canRedeem}
                className="h-11 w-full text-xs"
                data-testid="redeem-points"
                title={
                  canRedeem
                    ? 'Redeem points against this sale (F6)'
                    : `Needs at least ${config.minimumRedeemPoints} points`
                }
              >
                Redeem points
                <span className="font-mono text-[11px] font-normal text-muted-foreground">F6</span>
              </Button>

              {!canRedeem && loyalty.availablePoints > 0 ? (
                <p className="text-[10px] text-muted-foreground">
                  {totals.priced.netMinor === 0
                    ? 'Add an item to redeem points against this sale.'
                    : `Minimum redemption is ${config.minimumRedeemPoints} points.`}
                </p>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {open ? (
        <LoyaltyRedeemDialog
          loyalty={loyalty}
          config={config}
          cartNetMinor={totals.priced.netMinor}
          cartTotalMinor={totals.priced.totalMinor}
          currentPoints={redeemPoints}
          preview={onPreview}
          onClose={onClose}
          onConfirm={onConfirm}
        />
      ) : null}
    </>
  )
}
