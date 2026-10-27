import {
  CART_VOID_REASON_LABELS,
  CART_VOID_REASONS,
  type CartVoidReason,
  cartVoidNoteProblem,
} from '@sceptre/shared'
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
import { formatGhs } from '@/lib/format'

/**
 * Discarding a cart is reason-coded, never silent (P13-D28).
 *
 * The old clear confirmation asked one question and threw the basket away. This
 * one records *why*: a shrink report that only knows "a cart disappeared" cannot
 * tell a customer who changed their mind from a price dispute, and a void that
 * needed a manager's PIN would simply not be recorded at all.
 *
 * `OTHER` is the only reason that needs words. Escape closes the dialog and the
 * cart stays exactly as it was — a mis-press must never cost a basket.
 */
export interface VoidCartInput {
  reasonCode: CartVoidReason
  note: string | null
}

const NOTE_MAX = 200

export function VoidCartDialog({
  itemCount,
  totalMinor,
  label,
  onClose,
  onConfirm,
}: {
  itemCount: number
  totalMinor: number
  /** The held cart's name, when what is being abandoned is a hold. */
  label?: string | null
  onClose: () => void
  onConfirm: (input: VoidCartInput) => Promise<void>
}) {
  const focusReturn = useDialogFocusReturn()
  const [reason, setReason] = useState<CartVoidReason | ''>('')
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const noteProblem = reason ? cartVoidNoteProblem(reason, note) : null
  const ready = reason !== '' && noteProblem === null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!reason) {
      setError('Choose a reason')
      return
    }
    if (noteProblem) {
      setError(noteProblem)
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm({ reasonCode: reason, note: note.trim() ? note.trim() : null })
    } catch (voidError) {
      setError(voidError instanceof Error ? voidError.message : 'The cart could not be recorded')
    } finally {
      setBusy(false)
    }
  }

  const items = `${itemCount} item${itemCount === 1 ? '' : 's'}`
  const worth = formatGhs(totalMinor)

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open) onClose()
      }}
    >
      <DialogContent
        {...focusReturn}
        data-testid="void-cart-dialog"
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">
            {label ? `Void “${label}”?` : 'Discard this cart?'}
          </DialogTitle>
          <DialogDescription>
            {items} worth <span className="font-mono tabular-nums">{worth}</span> — nothing has been
            charged. The reason is kept for the day&rsquo;s report.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form onSubmit={submit} className="grid gap-4">
            <label htmlFor="void-reason" className="grid gap-1.5 text-sm font-medium">
              Why is the cart being abandoned?
              <select
                id="void-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value as CartVoidReason | '')}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
              >
                <option value="">Choose a reason</option>
                {CART_VOID_REASONS.map((code) => (
                  <option key={code} value={code}>
                    {CART_VOID_REASON_LABELS[code]}
                  </option>
                ))}
              </select>
            </label>

            <label htmlFor="void-note" className="grid gap-1.5 text-sm font-medium">
              Note {reason === 'OTHER' ? '(required)' : '(optional)'}
              <input
                id="void-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={NOTE_MAX}
                aria-invalid={noteProblem ? true : undefined}
                aria-describedby={noteProblem ? 'void-note-problem' : undefined}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                placeholder={reason === 'OTHER' ? 'What happened?' : 'Anything worth knowing'}
              />
            </label>
            {noteProblem ? (
              <p id="void-note-problem" className="text-xs text-danger">
                {noteProblem}
              </p>
            ) : null}

            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}

            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Keep cart
                </Button>
                <Button
                  type="submit"
                  variant="destructive"
                  disabled={busy || !ready}
                  className="h-11 flex-1"
                  data-testid="void-cart-confirm"
                >
                  {busy ? 'Recording…' : 'Continue'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
