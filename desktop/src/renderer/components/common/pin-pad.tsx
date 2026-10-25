import { cn } from 'cn'
import { Button } from '@/components/ui/button'
import { PIN_MAX_LENGTH } from '../../lib/auth/pin'

/**
 * Touch PIN pad for the terminal. Large hit targets, digits only, and no
 * on-screen keyboard (a POS terminal may be a touchscreen without one).
 */
export function PinPad({
  value,
  onChange,
  onSubmit,
  disabled = false,
  maxLength = PIN_MAX_LENGTH,
  submitLabel = 'Sign in',
  busy = false,
}: {
  value: string
  onChange: (next: string) => void
  onSubmit: () => void
  disabled?: boolean
  maxLength?: number
  submitLabel?: string
  busy?: boolean
}) {
  const canSubmit = value.length >= 4 && !disabled && !busy

  function press(digit: string) {
    if (value.length >= maxLength) return
    onChange(value + digit)
  }

  return (
    <div className="flex flex-col gap-4">
      <output
        className="flex h-14 items-center justify-center gap-3 rounded-lg border border-border bg-muted/40"
        aria-label={`PIN length ${value.length}`}
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
      </output>

      <div className="grid grid-cols-3 gap-2">
        {['1', '2', '3', '4', '5', '6', '7', '8', '9'].map((digit) => (
          <Button
            key={digit}
            type="button"
            variant="outline"
            onClick={() => press(digit)}
            disabled={disabled || busy}
            className="h-16 rounded-lg bg-card text-2xl font-semibold"
            aria-label={`Digit ${digit}`}
          >
            {digit}
          </Button>
        ))}
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange('')}
          disabled={disabled || busy}
          className="h-16 rounded-lg bg-card text-sm text-muted-foreground"
        >
          Clear
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => press('0')}
          disabled={disabled || busy}
          className="h-16 rounded-lg bg-card text-2xl font-semibold"
          aria-label="Digit 0"
        >
          0
        </Button>
        <Button
          type="button"
          variant="outline"
          onClick={() => onChange(value.slice(0, -1))}
          disabled={disabled || busy}
          className="h-16 rounded-lg bg-card text-sm text-muted-foreground"
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
