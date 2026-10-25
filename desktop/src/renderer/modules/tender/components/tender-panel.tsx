import { Check } from 'lucide-react'
import { StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatGhs } from '@/lib/format'
import type { TenderMethod } from '@/lib/sale/sale-draft'

/**
 * Cash keypad for the tender screen (Plan 06 Task 7, retuned by Plan 07).
 *
 * Digits are pesewas, like a real till: typing 500 shows GHS 5.00. Quick
 * buttons cover the notes a cashier is handed. The change preview is exact
 * integer arithmetic — the same number the server will validate.
 *
 * The figures are a hierarchy, not equal rows. The total is context and lives
 * in the screen header, muted. What the customer handed over is what the
 * cashier is counting. The change is what has to be read aloud and handed back,
 * so it is the largest thing on the screen.
 *
 * **Short and change are distinguishable without colour.** The label reads
 * *Short* only in the short case, it carries a `--danger` dot as reinforcement,
 * and the figure is always `text-foreground` — colour is never the signal
 * (WCAG 2.2 SC 1.4.1).
 */

const QUICK_NOTES_MINOR = [2_000, 5_000, 10_000, 20_000, 50_000]

export function CashKeypad({
  totalMinor,
  tenderedMinor,
  onChange,
}: {
  totalMinor: number
  tenderedMinor: number
  onChange: (minor: number) => void
}) {
  const digits = String(tenderedMinor)
  const change = tenderedMinor > totalMinor ? tenderedMinor - totalMinor : 0
  const short = tenderedMinor < totalMinor

  function press(digit: string) {
    const next = `${digits}${digit}`.replace(/^0+(?=\d)/, '')
    if (next.length > 9) return
    onChange(Number(next))
  }

  return (
    <div className="grid gap-3" data-testid="cash-keypad">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-xs text-muted-foreground">Received</span>
          <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="tendered">
            {formatGhs(tenderedMinor)}
          </span>
        </div>

        <div className="mt-2 flex items-baseline justify-between gap-4 border-t border-border pt-2">
          <span className="flex items-center gap-1.5 text-xs font-medium text-muted-foreground">
            {short ? (
              <>
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-danger" />
                Short
              </>
            ) : (
              'Change due'
            )}
          </span>
          <span
            className="font-display text-4xl font-semibold tabular-nums"
            data-testid="change-due"
            data-state={short ? 'short' : 'change'}
            aria-live="polite"
            aria-atomic="true"
          >
            {formatGhs(short ? totalMinor - tenderedMinor : change)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(totalMinor)}
          className="h-11"
          data-testid="exact-cash"
        >
          Exact
        </Button>
        {QUICK_NOTES_MINOR.map((note) => (
          <Button
            key={note}
            type="button"
            variant="outline"
            onClick={() => onChange(tenderedMinor + note)}
            className="h-11 font-mono tabular-nums"
          >
            +{formatGhs(note)}
          </Button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            onClick={() => press(digit)}
            className="h-12 bg-card text-lg font-semibold"
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(0)}
          className="h-12 bg-card text-xs text-muted-foreground"
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => press('0')}
          className="h-12 bg-card text-lg font-semibold"
          aria-label="Digit 0"
        >
          0
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(Math.floor(tenderedMinor / 10))}
          className="h-12 bg-card text-xs text-muted-foreground"
          aria-label="Backspace"
        >
          Back
        </Button>
      </div>
    </div>
  )
}

export function NoPaymentDue() {
  return (
    <StatusNote tone="ok" role="status" data-testid="no-payment-due">
      <p className="font-semibold text-foreground">No payment due</p>
      <p className="mt-0.5">
        Loyalty points cover this cart. Completing the sale records a zero-total cash sale.
      </p>
    </StatusNote>
  )
}

/**
 * Cash or credit, as one 44 px segmented pair.
 *
 * The selected state is not colour-only: it carries a check icon, a heavier
 * border, and a heavier label (WCAG 2.2 SC 1.4.1). The icon's box is reserved
 * in both states so choosing a method cannot shift the label sideways.
 *
 * Radix reports `''` when the pressed item is pressed again. A till always has
 * a payment method, so an empty value is ignored rather than clearing it.
 */
export function TenderMethodToggle({
  method,
  onChange,
  creditDisabled,
}: {
  method: TenderMethod
  onChange: (method: TenderMethod) => void
  creditDisabled: boolean
}) {
  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={method}
      onValueChange={(value) => {
        if (value) onChange(value as TenderMethod)
      }}
      aria-label="Payment method"
      className="mb-4 flex w-full"
    >
      {(
        [
          { value: 'CASH', label: 'Cash', testId: 'method-cash', disabled: false },
          { value: 'CREDIT', label: 'Credit', testId: 'method-credit', disabled: creditDisabled },
        ] as const
      ).map((option) => (
        <ToggleGroupItem
          key={option.value}
          value={option.value}
          disabled={option.disabled}
          className="h-12 min-h-12 flex-1 gap-2 text-sm font-semibold data-[state=on]:border-2 data-[state=on]:border-foreground data-[state=on]:font-bold"
          data-testid={option.testId}
        >
          <span aria-hidden="true" className="flex size-4 items-center justify-center">
            {method === option.value ? <Check className="size-4" /> : null}
          </span>
          {option.label}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
