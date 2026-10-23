import { formatGhs } from '../../lib/format'

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
          <span className="font-mono text-2xl font-semibold" data-testid="tendered">
            {formatGhs(tenderedMinor)}
          </span>
        </div>
        <div className="mt-1 flex items-baseline justify-between">
          <span className="text-xs text-muted-foreground">Change due</span>
          <span
            className={`font-mono text-lg font-semibold ${short ? 'text-amber-700' : 'text-emerald-700'}`}
            data-testid="change-due"
          >
            {short ? `Short ${formatGhs(totalMinor - tenderedMinor)}` : formatGhs(change)}
          </span>
        </div>
      </div>

      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={() => onChange(totalMinor)}
          className="h-10 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          data-testid="exact-cash"
        >
          Exact
        </button>
        {QUICK_NOTES_MINOR.map((note) => (
          <button
            key={note}
            type="button"
            onClick={() => onChange(tenderedMinor + note)}
            className="h-10 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
          >
            +{formatGhs(note)}
          </button>
        ))}
      </div>

      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <button
            key={digit}
            type="button"
            onClick={() => press(digit)}
            className="h-12 rounded-lg border border-border bg-card text-lg font-semibold hover:bg-muted"
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </button>
        ))}
        <button
          type="button"
          onClick={() => onChange(0)}
          className="h-12 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:bg-muted"
        >
          Clear
        </button>
        <button
          type="button"
          onClick={() => press('0')}
          className="h-12 rounded-lg border border-border bg-card text-lg font-semibold hover:bg-muted"
          aria-label="Digit 0"
        >
          0
        </button>
        <button
          type="button"
          onClick={() => onChange(Math.floor(tenderedMinor / 10))}
          className="h-12 rounded-lg border border-border bg-card text-xs font-medium text-muted-foreground hover:bg-muted"
          aria-label="Backspace"
        >
          Back
        </button>
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
