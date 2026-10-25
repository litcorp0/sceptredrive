import { useState } from 'react'
import { Modal } from '@/components/common'
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
    <Modal
      title="Redeem points"
      description={`${loyalty.availablePoints} points available · ${config.minimumRedeemPoints} point minimum`}
      onClose={onClose}
      testId="loyalty-dialog"
      footer={
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-10 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="button"
            disabled={Boolean(quote.problem)}
            onClick={() => {
              onConfirm(quote.points)
              onClose()
            }}
            className="h-10 flex-1 rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
            data-testid="confirm-redemption"
          >
            {quote.points === 0 ? 'Clear redemption' : `Redeem ${quote.points} pts`}
          </button>
        </div>
      }
    >
      <div className="grid gap-4">
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
            className="h-11 rounded-md border border-border bg-background px-3 font-mono text-base"
          />
        </label>

        <div className="flex flex-wrap gap-2">
          {[100, 250, 500].map((preset) => (
            <button
              key={preset}
              type="button"
              onClick={() => setValue(String(preset))}
              disabled={preset > loyalty.availablePoints}
              className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
            >
              {preset}
            </button>
          ))}
          <button
            type="button"
            onClick={() => setValue(String(quote.maxPoints))}
            disabled={quote.maxPoints === 0}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted disabled:opacity-40"
            data-testid="redeem-max"
          >
            Max ({quote.maxPoints})
          </button>
          <button
            type="button"
            onClick={() => setValue('')}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
          >
            None
          </button>
        </div>

        <div className="grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">Value</span>
            <span className="font-mono" data-testid="redeem-value">
              {formatGhs(quote.valueMinor)}
            </span>
          </div>
          {quote.valueMinor !== quote.appliedMinor ? (
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Applied to this cart</span>
              <span className="font-mono" data-testid="redeem-applied">
                {formatGhs(quote.appliedMinor)}
              </span>
            </div>
          ) : null}
          <div className="flex items-baseline justify-between">
            <span className="text-muted-foreground">New total</span>
            <span className="font-mono font-semibold" data-testid="redeem-new-total">
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
    </Modal>
  )
}
