import { useState } from 'react'
import { useDialogFocusReturn } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import type { PosLoyaltyConfig } from '@/lib/api/types'
import type { CustomerLoyalty } from '@/lib/customers/context'
import { formatGhs } from '@/lib/format'
import { quoteRedemption, REDEEM_PROBLEM_MESSAGES, type RedeemQuote } from '@/lib/loyalty/quote'

/**
 * Redeem points (F6).
 *
 * The quote is live: value at the current rate, the amount that would come off
 * this cart, and the resulting total. Nothing is sent anywhere — the server
 * recomputes the same numbers when the sale uploads (D18).
 */
export function LoyaltyRedeemDialog({
  loyalty,
  config,
  cartNetMinor,
  cartTotalMinor,
  currentPoints,
  preview,
  onClose,
  onConfirm,
}: {
  loyalty: CustomerLoyalty
  config: PosLoyaltyConfig
  cartNetMinor: number
  cartTotalMinor: number
  currentPoints: number
  preview: (points: number) => { totalMinor: number; appliedMinor: number }
  onClose: () => void
  onConfirm: (points: number) => void
}) {
  const focusReturn = useDialogFocusReturn()
  const [value, setValue] = useState(currentPoints > 0 ? String(currentPoints) : '')

  const parsed = value.trim() === '' ? 0 : Number(value)
  const quote: RedeemQuote = quoteRedemption({
    points: Number.isFinite(parsed) ? parsed : -1,
    pointsPerCedi: config.pointsPerCedi,
    minimumRedeemPoints: config.minimumRedeemPoints,
    availablePoints: loyalty.availablePoints,
    cartNetMinor,
  })

  const projected = quote.problem ? null : preview(quote.points)
  const zeroTotal = projected !== null && projected.totalMinor === 0 && cartTotalMinor > 0

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        {...focusReturn}
        data-testid="loyalty-dialog"
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Redeem points</DialogTitle>
          <DialogDescription>
            {`${loyalty.availablePoints} points available · ${config.minimumRedeemPoints} point minimum`}
          </DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
          <label htmlFor="redeem-points" className="grid gap-1.5 text-sm font-medium">
            Points
            <input
              id="redeem-points"
              data-autofocus
              inputMode="numeric"
              value={value}
              onChange={(event) => setValue(event.target.value.replace(/[^0-9]/g, ''))}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !quote.problem) {
                  event.preventDefault()
                  onConfirm(quote.points)
                  onClose()
                }
              }}
              placeholder="0"
              className="h-11 rounded-md border border-border bg-background px-3 font-mono text-base tabular-nums"
            />
          </label>

          <div className="flex flex-wrap gap-2">
            {[100, 250, 500].map((preset) => (
              <Button
                key={preset}
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setValue(String(preset))}
                disabled={preset > loyalty.availablePoints}
                className="h-11"
              >
                {preset}
              </Button>
            ))}
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue(String(quote.maxPoints))}
              disabled={quote.maxPoints === 0}
              className="h-11"
              data-testid="redeem-max"
            >
              Max ({quote.maxPoints})
            </Button>
            <Button
              type="button"
              variant="outline"
              size="sm"
              onClick={() => setValue('')}
              className="h-11"
            >
              None
            </Button>
          </div>

          <div className="grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Value</span>
              <span className="font-mono tabular-nums" data-testid="redeem-value">
                {formatGhs(quote.valueMinor)}
              </span>
            </div>
            {quote.valueMinor !== quote.appliedMinor ? (
              <div className="flex items-baseline justify-between text-xs">
                <span className="text-muted-foreground">Applied to this cart</span>
                <span className="font-mono tabular-nums" data-testid="redeem-applied">
                  {formatGhs(quote.appliedMinor)}
                </span>
              </div>
            ) : null}
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">New total</span>
              <span className="font-mono font-semibold tabular-nums" data-testid="redeem-new-total">
                {projected ? formatGhs(projected.totalMinor) : '—'}
              </span>
            </div>
            {quote.valueMinor > quote.appliedMinor && quote.points > 0 ? (
              <p className="mt-1 text-[11px] text-amber-800">
                Only the cart value is applied — the rest is not refunded as change.
              </p>
            ) : null}
          </div>

          {quote.problem ? (
            <p role="alert" className="text-sm text-destructive">
              {REDEEM_PROBLEM_MESSAGES[quote.problem]}
            </p>
          ) : null}

          {zeroTotal ? (
            <p className="rounded-md border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900">
              Fully redeemed: no payment will be due.
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full gap-2">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
              Cancel
            </Button>
            <Button
              type="button"
              disabled={Boolean(quote.problem)}
              onClick={() => {
                onConfirm(quote.points)
                onClose()
              }}
              className="h-11 flex-1"
              data-testid="confirm-redemption"
            >
              {quote.points === 0 ? 'Clear redemption' : `Redeem ${quote.points} pts`}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
