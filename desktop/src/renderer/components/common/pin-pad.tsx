import { cn } from 'cn'
import { useEffect, useId, useRef } from 'react'
import { Button } from '@/components/ui/button'
import { PIN_MAX_LENGTH } from '../../lib/auth/pin'

/**
 * Touch PIN pad for the terminal. Large hit targets, digits only, and no
 * on-screen keyboard (a POS terminal may be a touchscreen without one).
 *
 * A counter is a touch screen and a keyboard at the same time, so the pad is
 * driven by **one hidden field** rather than by the buttons alone: the number
 * row types, Backspace edits, Enter submits, and `inputMode="numeric"` asks a
 * soft keyboard for digits on a tablet. The buttons write to the same state and
 * hand focus back to the field, so mixing both is seamless.
 *
 * The count is announced; the digits are not. `type="password"` keeps the value
 * out of the accessibility tree, and the live region says how many digits are
 * entered — which is what a cashier needs to know and nothing an onlooker does.
 *
 * Three details that are easy to get wrong, and were:
 *
 * - **`readOnly`, not `disabled`, while a check is running.** A disabled control
 *   loses focus to `<body>`, so after one wrong PIN the number row stopped
 *   working until the cashier clicked a key. `readOnly` keeps focus and refuses
 *   the keystroke.
 * - **Autofocus is opt-in.** On the activation screen the first field is the
 *   staff code, and an unconditionally focused digit field swallowed it.
 * - **The dot display shows focus.** The field itself is `sr-only`, so without a
 *   ring on the box that wraps it there is no visible focus position at all.
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  maxLength = PIN_MAX_LENGTH,
  submitLabel = 'Sign in',
  busy = false,
  label = 'PIN',
  autoFocus = false,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  disabled?: boolean
  maxLength?: number
  submitLabel?: string
  busy?: boolean
  /** Accessible name for the hidden field. */
  label?: string
  /** Focus the field on mount. Only where the PIN is the first thing to type. */
  autoFocus?: boolean
}) {
  const inputRef = useRef<HTMLInputElement>(null)
  const inputId = useId()
  const canSubmit = value.length >= 4 && !disabled && !busy

  // Focus on mount when asked, and restore it after a check finishes if it has
  // gone nowhere: a request that ends with focus on `<body>` leaves a keyboard
  // cashier with a dead number row until they tap a key. Never steal focus from
  // another field — on the activation screen the staff code comes first.
  useEffect(() => {
    if (disabled) return
    const active = document.activeElement
    const focusLost = !active || active === document.body
    if (autoFocus || focusLost) inputRef.current?.focus()
  }, [disabled, busy, autoFocus])

  function press(digit: string) {
    if (value.length >= maxLength) return
    onChange(value + digit)
    inputRef.current?.focus()
  }

  return (
    <div className="flex flex-col gap-4">
      {/*
       * The ring is an arbitrary property, not `outline-2`: that utility reads
       * `--tw-outline-style`, which is `none` in this stylesheet, and a focus ring that does not
       * draw is worse than none. This is the same declaration the global focus rule uses.
       */}
      <label
        htmlFor={inputId}
        className="block cursor-text rounded-lg focus-within:[outline:2px_solid_var(--brand-ink)] focus-within:[outline-offset:2px]"
      >
        <span className="sr-only">{label}</span>
        <span
          aria-hidden="true"
          className="flex h-14 items-center justify-center gap-3 rounded-lg border border-border bg-muted/40"
          data-testid="pin-display"
        >
          {Array.from({ length: maxLength }).map((_, index) => (
            <span
              key={index}
              className={cn(
                'size-3 rounded-full border border-muted-foreground/40',
                index < value.length ? 'bg-foreground' : 'bg-transparent',
              )}
            />
          ))}
        </span>
        <input
          ref={inputRef}
          id={inputId}
          type="password"
          inputMode="numeric"
          autoComplete="off"
          enterKeyHint="done"
          maxLength={maxLength}
          value={value}
          onChange={(event) => {
            if (busy) return
            onChange(event.target.value.replace(/\D/g, '').slice(0, maxLength))
          }}
          onKeyDown={(event) => {
            if (event.key !== 'Enter') return
            event.preventDefault()
            if (canSubmit) onSubmit()
          }}
          // `readOnly` rather than `disabled`: a disabled field drops focus and the
          // number row stops working until the cashier taps a key.
          readOnly={busy}
          disabled={disabled}
          className="sr-only"
          data-testid="pin-input"
        />
      </label>

      <p className="sr-only" aria-live="polite" data-testid="pin-progress">
        {value.length === 0
          ? `No digits entered of ${maxLength}`
          : `${value.length} of ${maxLength} digits entered`}
      </p>

      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            onClick={() => press(digit)}
            disabled={disabled || busy}
            className="h-16 min-w-16 rounded-lg bg-card text-2xl font-semibold"
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange('')
            inputRef.current?.focus()
          }}
          disabled={disabled || busy}
          className="h-16 min-w-16 rounded-lg bg-card text-sm text-muted-foreground"
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => press('0')}
          disabled={disabled || busy}
          className="h-16 min-w-16 rounded-lg bg-card text-2xl font-semibold"
          aria-label="Digit 0"
        >
          0
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => {
            onChange(value.slice(0, -1))
            inputRef.current?.focus()
          }}
          disabled={disabled || busy}
          className="h-16 min-w-16 rounded-lg bg-card text-sm text-muted-foreground"
          aria-label="Backspace"
        >
          Back
        </Button>
      </div>

      <Button
        type="button"
        onClick={onSubmit}
        disabled={!canSubmit}
        className="h-14 rounded-lg text-base"
      >
        {busy ? 'Checking…' : submitLabel}
      </Button>
    </div>
  )
}
