import { type FormEvent, useState } from 'react'
import { useDialogFocusReturn } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { formatGhs, formatMinorPlain, parseGhsToMinor } from '@/lib/format'

/** Opening float entry. The amount is collected before the shift row exists. */
export function OpenShiftDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (openingFloatMinor: number) => Promise<void>
}) {
  const focusReturn = useDialogFocusReturn()
  const [amount, setAmount] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minor = parseGhsToMinor(amount)
    if (minor === null) {
      setError('Enter an amount like 200.00')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm(minor)
    } catch (openError) {
      setError(openError instanceof Error ? openError.message : 'Could not open the shift')
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
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Open shift</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form onSubmit={submit} className="grid gap-4">
            <label htmlFor="opening-float" className="grid gap-1.5 text-sm font-medium">
              Opening float (cash in the drawer)
              <input
                id="opening-float"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
                placeholder="200.00"
              />
            </label>
            <p className="text-xs text-muted-foreground">
              The shift is numbered for this terminal and day. Selling stays blocked until it is
              open.
            </p>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="h-11 flex-[2]">
                  {busy ? 'Opening…' : 'Open shift'}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CashMovementDialog({
  type,
  expectedCashMinor,
  onClose,
  onConfirm,
}: {
  type: 'CASH_IN' | 'CASH_OUT'
  expectedCashMinor: number
  onClose: () => void
  onConfirm: (input: {
    type: 'CASH_IN' | 'CASH_OUT'
    amountMinor: number
    reason: string
  }) => Promise<void>
}) {
  const focusReturn = useDialogFocusReturn()
  const [amount, setAmount] = useState('')
  const [reason, setReason] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const label = type === 'CASH_IN' ? 'Cash in' : 'Cash out'

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const minor = parseGhsToMinor(amount)
    if (minor === null || minor <= 0) {
      setError('Enter an amount like 50.00')
      return
    }
    if (!reason.trim()) {
      setError('A reason is required')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm({ type, amountMinor: minor, reason })
    } catch (movementError) {
      setError(movementError instanceof Error ? movementError.message : 'Could not record the cash')
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
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">{label}</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form onSubmit={submit} className="grid gap-4">
            <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              Expected cash now{' '}
              <span className="font-mono font-semibold tabular-nums">
                {formatGhs(expectedCashMinor)}
              </span>
            </div>
            <label htmlFor="cash-amount" className="grid gap-1.5 text-sm font-medium">
              Amount
              <input
                id="cash-amount"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
                placeholder="50.00"
              />
            </label>
            <label htmlFor="cash-reason" className="grid gap-1.5 text-sm font-medium">
              Reason
              <input
                id="cash-reason"
                value={reason}
                onChange={(event) => setReason(event.target.value)}
                maxLength={120}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                placeholder={type === 'CASH_IN' ? 'Float top-up' : 'Change run'}
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="h-11 flex-[2]">
                  {busy ? 'Saving…' : label}
                </Button>
              </div>
            </DialogFooter>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}

export function CloseShiftDialog({
  expectedCashMinor,
  onClose,
  onConfirm,
}: {
  expectedCashMinor: number
  onClose: () => void
  onConfirm: (input: { countedCashMinor: number; note?: string }) => Promise<void>
}) {
  // Integer pesewas in, integer pesewas out — the counted-cash field is seeded
  // from `formatMinorPlain`, not from a `toFixed` float round-trip.
  const focusReturn = useDialogFocusReturn()
  const [amount, setAmount] = useState(formatMinorPlain(expectedCashMinor))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const counted = parseGhsToMinor(amount)
  const variance = counted === null ? null : counted - expectedCashMinor

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (counted === null) {
      setError('Enter the counted cash, e.g. 200.00')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm({ countedCashMinor: counted, note: note.trim() || undefined })
    } catch (closeError) {
      setError(closeError instanceof Error ? closeError.message : 'Could not close the shift')
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
        className="flex max-h-[90vh] max-w-md flex-col gap-0 overflow-hidden p-0 sm:max-w-md"
      >
        <DialogHeader className="border-b border-border px-5 py-4 pr-16">
          <DialogTitle className="text-base">Close shift</DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          <form onSubmit={submit} className="grid gap-4">
            <div className="flex items-baseline justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
              <span>Expected cash</span>
              <span className="font-mono font-semibold tabular-nums">
                {formatGhs(expectedCashMinor)}
              </span>
            </div>
            <label htmlFor="counted-cash" className="grid gap-1.5 text-sm font-medium">
              Counted cash
              <input
                id="counted-cash"
                inputMode="decimal"
                value={amount}
                onChange={(event) => setAmount(event.target.value)}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm tabular-nums"
              />
            </label>
            <div className="flex items-baseline justify-between text-sm">
              <span className="text-muted-foreground">Variance</span>
              <span
                className={
                  variance === null
                    ? 'font-mono text-muted-foreground tabular-nums'
                    : variance === 0
                      ? 'font-mono font-semibold text-emerald-600 tabular-nums'
                      : 'font-mono font-semibold text-red-600 tabular-nums'
                }
              >
                {variance === null ? '—' : formatGhs(variance)}
              </span>
            </div>
            <label htmlFor="close-note" className="grid gap-1.5 text-sm font-medium">
              Note (optional)
              <input
                id="close-note"
                value={note}
                onChange={(event) => setNote(event.target.value)}
                maxLength={200}
                className="h-11 rounded-md border border-border bg-background px-3 text-sm"
                placeholder="Short by 5 at the drawer"
              />
            </label>
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy} className="h-14 flex-[2] text-base">
                  {busy ? 'Closing…' : 'Close shift'}
                </Button>
              </div>
            </DialogFooter>
            <p className="text-xs text-muted-foreground">
              Closing works offline. The server recomputes expected cash when the shift syncs and
              flags any difference.
            </p>
          </form>
        </div>
      </DialogContent>
    </Dialog>
  )
}
