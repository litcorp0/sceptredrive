import { HOLD_LABEL_MAX, holdLabelProblem, MAX_HELD_CARTS } from '@sceptre/shared'
import { type FormEvent, useState } from 'react'
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

/**
 * Naming a parked cart (P13-D29).
 *
 * The rule and the wording are `holdLabelProblem` from the shared package, so
 * the till, the limit, and the message cannot drift. The live "3 of 10 held"
 * count is the one thing the cashier needs before the eleventh refusal.
 */
export function HoldCartDialog({
  existingCount,
  onClose,
  onConfirm,
}: {
  existingCount: number
  onClose: () => void
  onConfirm: (label: string) => Promise<void>
}) {
  const focusReturn = useDialogFocusReturn()
  const [label, setLabel] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const problem = holdLabelProblem(label, existingCount)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (problem) {
      setError(problem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(label.trim())
    } catch (holdError) {
      setError(holdError instanceof Error ? holdError.message : 'The cart could not be held')
    } finally {
      setBusy(false)
    }
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
        data-testid="hold-cart-dialog"
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Hold this cart</DialogTitle>
          <DialogDescription>
            The basket and its prices are parked on this till. Recall it from the tray above the
            products, after a restart or after the shift is closed.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form onSubmit={submit} className="grid gap-4">
            <label htmlFor="hold-label" className="grid gap-1.5 text-sm font-medium">
              Name
              <input
                id="hold-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                maxLength={HOLD_LABEL_MAX}
                autoFocus
                aria-invalid={label.trim().length > 0 && problem !== null ? true : undefined}
                aria-describedby="hold-label-problem"
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                placeholder="Ama’s brake pads"
              />
            </label>
            <p id="hold-label-problem" className="text-xs text-muted-foreground">
              {problem ?? `${HOLD_LABEL_MAX} characters or fewer.`}
            </p>
            <p className="text-xs text-muted-foreground" data-testid="hold-count">
              {existingCount} of {MAX_HELD_CARTS} held on this till.
            </p>

            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}

            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Keep selling
                </Button>
                <Button
                  type="submit"
                  disabled={busy || problem !== null}
                  className="h-11 flex-[2]"
                  data-testid="hold-cart-confirm"
                >
                  {busy ? 'Holding…' : 'Hold cart'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
