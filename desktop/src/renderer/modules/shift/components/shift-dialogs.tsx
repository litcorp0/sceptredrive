import { type FormEvent, type ReactNode, useState } from 'react'
import { formatGhs, parseGhsToMinor } from '@/lib/format'

/** Opening float entry. The amount is collected before the shift row exists. */
export function OpenShiftDialog({
  onClose,
  onConfirm,
}: {
  onClose: () => void
  onConfirm: (openingFloatMinor: number) => Promise<void>
}) {
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
    <Modal title="Open shift" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <label htmlFor="opening-float" className="grid gap-1.5 text-sm font-medium">
          Opening float (cash in the drawer)
          <input
            id="opening-float"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="200.00"
          />
        </label>
        <p className="text-xs text-muted-foreground">
          The shift is numbered for this terminal and day. Selling stays blocked until it is open.
        </p>
        {error ? (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        ) : null}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-11 flex-[2] rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Opening…' : 'Open shift'}
          </button>
        </div>
      </form>
    </Modal>
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
    <Modal title={label} onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          Expected cash now <span className="font-semibold">{formatGhs(expectedCashMinor)}</span>
        </div>
        <label htmlFor="cash-amount" className="grid gap-1.5 text-sm font-medium">
          Amount
          <input
            id="cash-amount"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-11 flex-[2] rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Saving…' : label}
          </button>
        </div>
      </form>
    </Modal>
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
  const [amount, setAmount] = useState((expectedCashMinor / 100).toFixed(2))
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
    <Modal title="Close shift" onClose={onClose}>
      <form onSubmit={submit} className="grid gap-4">
        <div className="flex items-baseline justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
          <span>Expected cash</span>
          <span className="font-mono font-semibold">{formatGhs(expectedCashMinor)}</span>
        </div>
        <label htmlFor="counted-cash" className="grid gap-1.5 text-sm font-medium">
          Counted cash
          <input
            id="counted-cash"
            inputMode="decimal"
            value={amount}
            onChange={(event) => setAmount(event.target.value)}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          />
        </label>
        <div className="flex items-baseline justify-between text-sm">
          <span className="text-muted-foreground">Variance</span>
          <span
            className={
              variance === null
                ? 'font-mono text-muted-foreground'
                : variance === 0
                  ? 'font-mono font-semibold text-emerald-600'
                  : 'font-mono font-semibold text-red-600'
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
        <div className="flex gap-2">
          <button
            type="button"
            onClick={onClose}
            className="h-11 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
          <button
            type="submit"
            disabled={busy}
            className="h-11 flex-[2] rounded-md bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
          >
            {busy ? 'Closing…' : 'Close shift'}
          </button>
        </div>
        <p className="text-xs text-muted-foreground">
          Closing works offline. The server recomputes expected cash when the shift syncs and flags
          any difference.
        </p>
      </form>
    </Modal>
  )
}

function Modal({
  title,
  onClose,
  children,
}: {
  title: string
  onClose: () => void
  children: ReactNode
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label={title}
        className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-lg font-semibold">{title}</h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted"
            aria-label="Close dialog"
          >
            ✕
          </button>
        </div>
        {children}
      </div>
    </div>
  )
}
