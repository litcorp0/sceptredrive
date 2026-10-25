import { Button } from '@/components/ui/button'
import { formatGhs } from '@/lib/format'

/**
 * Cash keypad for the tender screen (Plan 06 Task 7).
 *
 * Digits are pesewas, like a real till: typing 500 shows GHS 5.00. Quick
 * buttons cover the notes a cashier is handed. The change preview is exact
 * integer arithmetic — the same number the server will validate.
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
        <div className="flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Cash received</span>
          <span className="font-mono text-2xl font-semibold tabular-nums" data-testid="tendered">
            {formatGhs(tenderedMinor)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Change due</span>
          <span
            className={`font-mono text-lg font-semibold tabular-nums ${short ? 'text-amber-700' : 'text-emerald-700'}`}
            data-testid="change-due"
          >
            {short ? `Short ${formatGhs(totalMinor - tenderedMinor)}` : formatGhs(change)}
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
    <div
      className="rounded-lg border border-emerald-200 bg-emerald-50 px-4 py-3 text-sm text-emerald-900"
      data-testid="no-payment-due"
    >
      <p className="font-semibold">No payment due</p>
      <p className="mt-0.5 text-emerald-800">
        Loyalty points cover this cart. Completing the sale records a zero-total cash sale.
      </p>
    </div>
  )
}
