import {
  isElectronicTender,
  TENDER_LABELS,
  TENDER_METHODS,
  type TenderMethod,
  tenderBalance,
} from '@sceptre/shared'
import { Check, X } from 'lucide-react'
import { StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { ToggleGroup, ToggleGroupItem } from '@/components/ui/toggle-group'
import { formatGhs } from '@/lib/format'
import { appendPesewaDigit, removePesewaDigit } from '../utils/pesewa'
import { nextTenderMethod } from '../utils/tender-method'

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
 *
 * Since Phase 13 the keypad is one tender of several: `appliedMinor` is what the
 * tenders already added cover, so "Exact" means "the rest of the bill" and the
 * change shown is the sale's change, not this keypad's arithmetic.
 */

const QUICK_NOTES_MINOR = [2_000, 5_000, 10_000, 20_000, 50_000]

export function CashKeypad({
  totalMinor,
  appliedMinor,
  tenderedMinor,
  onChange,
}: {
  totalMinor: number
  /** What the tenders already added on this sale cover. */
  appliedMinor: number
  tenderedMinor: number
  onChange: (minor: number) => void
}) {
  const coveredMinor = appliedMinor + tenderedMinor
  const change = coveredMinor > totalMinor ? coveredMinor - totalMinor : 0
  const short = coveredMinor < totalMinor

  return (
    <div className="grid gap-3" data-testid="cash-keypad">
      <div className="rounded-lg border border-border bg-card px-4 py-3">
        <div className="flex items-baseline justify-between gap-4">
          <span className="text-xs text-muted-foreground">Received</span>
          <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="tendered">
            {formatGhs(tenderedMinor)}
          </span>
        </div>

        <div
          className="mt-2 flex items-baseline justify-between gap-4 border-t border-border pt-2"
          aria-live="polite"
          aria-atomic="true"
        >
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
          >
            {formatGhs(short ? totalMinor - coveredMinor : change)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(Math.max(0, totalMinor - appliedMinor))}
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
            onClick={() => onChange(appendPesewaDigit(tenderedMinor, digit))}
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
          onClick={() => onChange(appendPesewaDigit(tenderedMinor, '0'))}
          className="h-12 bg-card text-lg font-semibold"
          aria-label="Digit 0"
        >
          0
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(removePesewaDigit(tenderedMinor))}
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

export interface TenderDraftLine {
  id: string
  method: TenderMethod
  amountMinor: number
}

/**
 * The tenders already added to this sale, in payment order.
 *
 * A split sale is read down this list by the customer, so the row order is the
 * receipt order and the remove button is the only control: changing an amount
 * is "remove it and type it again", which is one gesture at a counter.
 */
export function TenderList({
  lines,
  onRemove,
}: {
  lines: TenderDraftLine[]
  onRemove: (id: string) => void
}) {
  if (lines.length === 0) return null

  return (
    <ul className="grid gap-1" data-testid="tender-list">
      {lines.map((line, index) => (
        <li
          key={line.id}
          data-testid="tender-line"
          className="flex items-center justify-between gap-3 rounded-md border border-border bg-card px-3 py-1.5"
        >
          <span className="text-sm">
            <span className="mr-2 font-mono text-xs text-muted-foreground tabular-nums">
              {index + 1}
            </span>
            {TENDER_LABELS[line.method]}
          </span>
          <span className="flex items-center gap-2">
            <span className="font-mono text-sm tabular-nums">{formatGhs(line.amountMinor)}</span>
            <Button
              type="button"
              variant="ghost"
              aria-label={`Remove ${TENDER_LABELS[line.method]} payment`}
              onClick={() => onRemove(line.id)}
              className="h-8 w-8 px-0 text-muted-foreground"
            >
              <X className="size-4" />
            </Button>
          </span>
        </li>
      ))}
    </ul>
  )
}

/**
 * Applied, still owed, and change — the three numbers `tenderBalance` decides.
 *
 * It is driven by the shared function rather than by local subtraction so this
 * panel cannot disagree with the receipt, the sale row, or the server.
 */
export function TenderSummary({
  totalMinor,
  lines,
}: {
  totalMinor: number
  lines: Array<{ method: TenderMethod; amountMinor: number }>
}) {
  const balance = tenderBalance(
    totalMinor,
    lines.map((line, index) => ({
      method: line.method,
      amountMinor: line.amountMinor,
      sequence: index + 1,
    })),
  )

  return (
    <dl
      className="grid gap-1 rounded-md border border-border bg-muted/40 px-3 py-2 text-xs"
      data-testid="tender-summary"
    >
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">Applied</dt>
        <dd className="font-mono tabular-nums" data-testid="tender-applied">
          {formatGhs(balance.appliedMinor)}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">Remaining</dt>
        <dd className="font-mono tabular-nums" data-testid="tender-remaining">
          {formatGhs(balance.remainingMinor)}
        </dd>
      </div>
      <div className="flex items-baseline justify-between gap-4">
        <dt className="text-muted-foreground">Change</dt>
        <dd className="font-mono tabular-nums" data-testid="tender-change">
          {formatGhs(balance.changeMinor)}
        </dd>
      </div>
    </dl>
  )
}

/**
 * Cash or credit, as one 44 px segmented pair.
 *
 * The selected state is not colour-only: it carries a check icon, a heavier
 * border, and a heavier label (WCAG 2.2 SC 1.4.1). The icon's box is reserved
 * in both states, so the label does not jump when the icon appears.
 *
 * Radix reports `''` when the pressed item is pressed again; `nextTenderMethod`
 * turns that — and any other unexpected value — back into the current choice,
 * because a till always has a payment method.
 *
 * The list is the shared method vocabulary minus the electronic methods: MoMo,
 * card and bank arrive with the payment provider in Plan 09, and offering a
 * button that cannot be completed would be a lie at the counter.
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
  const methods = TENDER_METHODS.filter((candidate) => !isElectronicTender(candidate))

  return (
    <ToggleGroup
      type="single"
      variant="outline"
      value={method}
      onValueChange={(value) => onChange(nextTenderMethod(value, method))}
      aria-label="Payment method"
      className="mb-4 flex w-full"
    >
      {methods.map((option) => (
        <ToggleGroupItem
          key={option}
          value={option}
          disabled={option === 'CREDIT' && creditDisabled}
          className="h-12 min-h-12 flex-1 gap-2 text-sm font-semibold data-[state=on]:border-2 data-[state=on]:border-foreground data-[state=on]:font-bold"
          data-testid={option === 'CASH' ? 'method-cash' : 'method-credit'}
        >
          <span aria-hidden="true" className="flex size-4 items-center justify-center">
            {method === option ? <Check className="size-4" /> : null}
          </span>
          {TENDER_LABELS[option]}
        </ToggleGroupItem>
      ))}
    </ToggleGroup>
  )
}
