import type { Role } from '@sceptre/shared'
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
import type { CartDiscount } from '@/lib/cart/types'
import { DISCOUNT_REASON_CODES, type DiscountReasonCode } from '@/lib/cart/types'
import {
  capPercentFor,
  DISCOUNT_REASON_LABELS,
  type DiscountCaps,
  type DiscountInputMode,
  discountAmountFromInput,
  formatPercent,
} from '@/lib/discounts/discount-service'
import { formatGhs, formatMinorPlain } from '@/lib/format'

/**
 * Line or sale discount (F8).
 *
 * The dialog collects an amount (cedis or a percentage), a reason, and an
 * optional note, then shows what the cap allows for this person. Whether the
 * discount may be applied without a manager is decided by the caller, which
 * owns the cart state and can measure the *resulting* total.
 */
export function DiscountDialog({
  title,
  description,
  baseMinor,
  existing,
  role,
  caps,
  onClose,
  onSubmit,
}: {
  title: string
  description: string
  /** The most this discount may be: line gross or net after line discounts. */
  baseMinor: number
  existing: CartDiscount | null
  role: Role
  caps: DiscountCaps
  onClose: () => void
  onSubmit: (discount: CartDiscount | null) => void
}) {
  const focusReturn = useDialogFocusReturn()
  const [mode, setMode] = useState<DiscountInputMode>('AMOUNT')
  // Integer pesewas in, integer pesewas out: an editable amount is seeded from
  // `formatMinorPlain`, never from a `toFixed` round-trip.
  const [raw, setRaw] = useState(existing ? formatMinorPlain(existing.amountMinor) : '')
  const [reasonCode, setReasonCode] = useState<DiscountReasonCode>(existing?.reasonCode ?? 'STAFF')
  const [note, setNote] = useState(existing?.note ?? '')
  const [error, setError] = useState<string | null>(null)

  const amountMinor = discountAmountFromInput(raw, mode, baseMinor)
  const percent = baseMinor > 0 ? Math.floor(((amountMinor ?? 0) * 100) / baseMinor) : 0
  const capPercent = capPercentFor(role, caps)
  const needsManager = (amountMinor ?? 0) > 0 && percent > capPercent
  const approvedAlready = Boolean(existing?.override)

  function submit() {
    if (amountMinor === null) {
      setError(mode === 'AMOUNT' ? 'Enter an amount like 10.00' : 'Enter a whole percentage')
      return
    }
    if (amountMinor === 0) {
      onSubmit(null)
      onClose()
      return
    }
    onSubmit({
      amountMinor,
      reasonCode,
      note: note.trim() || null,
      override: existing?.override ?? null,
    })
  }

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        {...focusReturn}
        data-testid="discount-dialog"
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">{title}</DialogTitle>
          <DialogDescription>{description}</DialogDescription>
        </DialogHeader>

        <div className="grid min-h-0 flex-1 gap-4 overflow-y-auto px-5 py-4">
          <div className="grid grid-cols-2 gap-2">
            {(['AMOUNT', 'PERCENT'] as const).map((option) => (
              <Button
                key={option}
                type="button"
                variant={mode === option ? 'secondary' : 'outline'}
                aria-pressed={mode === option}
                onClick={() => {
                  if (option !== mode) {
                    setRaw('')
                    setMode(option)
                    setError(null)
                  }
                }}
                className="h-11"
              >
                {option === 'AMOUNT' ? 'Amount (GHS)' : 'Percent'}
              </Button>
            ))}
          </div>

          <label htmlFor="discount-input" className="grid gap-1.5 text-sm font-medium">
            {mode === 'AMOUNT' ? 'Amount off' : 'Percent off'}
            <input
              id="discount-input"
              data-autofocus
              inputMode={mode === 'AMOUNT' ? 'decimal' : 'numeric'}
              value={raw}
              onChange={(event) => {
                setRaw(event.target.value)
                setError(null)
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') {
                  event.preventDefault()
                  submit()
                }
              }}
              placeholder={mode === 'AMOUNT' ? '10.00' : '10'}
              className="h-11 rounded-md border border-border bg-background px-3 font-mono text-base tabular-nums"
              data-testid="discount-input"
            />
          </label>

          <div className="grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <div className="flex items-baseline justify-between">
              <span className="text-muted-foreground">Applies</span>
              <span className="font-mono tabular-nums" data-testid="discount-amount">
                {amountMinor === null ? '—' : formatGhs(amountMinor)}
              </span>
            </div>
            <div className="flex items-baseline justify-between text-xs">
              <span className="text-muted-foreground">Of base {formatGhs(baseMinor)}</span>
              <span className="font-mono tabular-nums" data-testid="discount-percent">
                {formatPercent(percent)}
              </span>
            </div>
          </div>

          <p
            className={
              needsManager
                ? 'rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-xs text-amber-900'
                : 'text-xs text-muted-foreground'
            }
            data-testid="discount-cap-note"
          >
            {needsManager
              ? `Above the ${formatPercent(capPercent)} cap for ${role === 'CASHIER' ? 'a cashier' : role.toLowerCase()} — a manager or admin PIN is required.`
              : `Within the ${formatPercent(capPercent)} cap for ${role === 'CASHIER' ? 'a cashier' : role.toLowerCase()}.`}
            {approvedAlready ? ' Already approved by a manager.' : ''}
          </p>

          <label htmlFor="discount-reason" className="grid gap-1.5 text-sm font-medium">
            Reason
            <select
              id="discount-reason"
              value={reasonCode}
              onChange={(event) => setReasonCode(event.target.value as DiscountReasonCode)}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            >
              {DISCOUNT_REASON_CODES.map((code) => (
                <option key={code} value={code}>
                  {DISCOUNT_REASON_LABELS[code]}
                </option>
              ))}
            </select>
          </label>

          <label htmlFor="discount-note" className="grid gap-1.5 text-sm font-medium">
            Note (optional)
            <input
              id="discount-note"
              value={note}
              onChange={(event) => setNote(event.target.value)}
              maxLength={200}
              className="h-11 rounded-md border border-border bg-background px-3 text-sm"
              placeholder="Why this is discounted"
            />
          </label>

          {error ? (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          ) : null}
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full gap-2">
            {existing ? (
              <Button
                type="button"
                variant="outline"
                onClick={() => {
                  onSubmit(null)
                  onClose()
                }}
                className="h-11 flex-1 text-destructive"
                data-testid="remove-discount"
              >
                Remove
              </Button>
            ) : null}
            <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
              Cancel
            </Button>
            <Button
              type="button"
              onClick={submit}
              disabled={amountMinor === null}
              className="h-11 flex-[2]"
              data-testid="apply-discount"
            >
              {needsManager ? 'Apply — needs a manager' : 'Apply discount'}
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
