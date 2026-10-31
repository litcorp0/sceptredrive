import { cn } from 'cn'
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
import type { HeldCartSummary } from '@/lib/hold/hold-service'
import { computeVariance } from '@/lib/shift/shift-service'
import {
  NO_UNSYNCED_SALES,
  needsUnsyncedAcknowledgement,
  type UnsyncedSales,
  unsyncedSalesAcknowledgement,
  unsyncedSalesWarning,
} from '@/lib/sync/outbox-summary'
import { amountProblem } from '../utils/amount'
import type { HoldsDecision } from '../utils/close-shift'
import { varianceWords } from '../utils/variance'

/**
 * A money field that rejects a bad amount while it is being typed.
 *
 * The three shift dialogs all collect an amount, and all three used to accept
 * anything and complain only on submit. A cashier who typed `200,00` learned
 * about it after pressing the button; the field now says so immediately, marks
 * itself `aria-invalid`, and points at the sentence with `aria-describedby`.
 *
 * Integer pesewas throughout: `parseGhsToMinor` returns `null` rather than a
 * float, so an unparseable amount can never reach the shift arithmetic.
 */
function MoneyField({
  id,
  label,
  value,
  onChange,
  minimumMinor = 0,
  placeholder,
}: {
  id: string
  label: string
  value: string
  onChange: (next: string) => void
  /** Smallest acceptable amount. `0` allows an empty drawer. */
  minimumMinor?: number
  placeholder?: string
}) {
  const problem = amountProblem(value, minimumMinor)

  return (
    <label htmlFor={id} className="grid gap-1.5 text-sm font-medium">
      {label}
      <input
        id={id}
        inputMode="decimal"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        aria-invalid={problem ? true : undefined}
        aria-describedby={problem ? `${id}-problem` : undefined}
        className={cn(
          'h-11 rounded-md border bg-background px-3 text-sm tabular-nums',
          problem ? 'border-danger' : 'border-border',
        )}
        placeholder={placeholder}
      />
      {problem ? (
        <span id={`${id}-problem`} className="text-xs font-normal text-danger">
          {problem}
        </span>
      ) : null}
    </label>
  )
}

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

  const minor = parseGhsToMinor(amount)
  // An empty field is not a wrong one: the button stays live and the submit explains it, so a
  // disabled control never has to carry a reason it cannot show.
  const ready = amountProblem(amount) === null

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
            <MoneyField
              id="opening-float"
              label="Opening float (cash in the drawer)"
              value={amount}
              onChange={setAmount}
              placeholder="200.00"
            />
            <p className="text-xs text-muted-foreground">
              The shift is numbered for this terminal and day. Selling stays blocked until it is
              open.
            </p>
            {error ? (
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !ready} className="h-11 flex-[2]">
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

  const minor = parseGhsToMinor(amount)
  const ready = amountProblem(amount, 1) === null && reason.trim().length > 0

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
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
            <MoneyField
              id="cash-amount"
              label="Amount"
              value={amount}
              onChange={setAmount}
              minimumMinor={1}
              placeholder="50.00"
            />
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
              <p role="alert" className="text-sm text-danger">
                {error}
              </p>
            ) : null}
            <DialogFooter className="border-t border-border pt-3">
              <div className="flex w-full gap-2">
                <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                  Cancel
                </Button>
                <Button type="submit" disabled={busy || !ready} className="h-11 flex-[2]">
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
  holds,
  otherCashierName = null,
  unsynced = NO_UNSYNCED_SALES,
  onClose,
  onConfirm,
}: {
  expectedCashMinor: number
  /** Held carts are not pruned by the close: the cashier chooses (P13-D30). */
  holds: readonly HeldCartSummary[]
  /**
   * The drawer's cashier when the signed-in staff member is not them — the
   * manager takeover of P14-D12. Null when the closer opened the drawer.
   */
  otherCashierName?: string | null
  /**
   * Sales on this till the server does not have yet. The close is never blocked
   * by them, but it says so before the drawer is counted and asks for one
   * acknowledgement, because a sale that lands after the close needs a manager.
   */
  unsynced?: UnsyncedSales
  onClose: () => void
  onConfirm: (input: {
    countedCashMinor: number
    note?: string
    holdsDecision: HoldsDecision
  }) => Promise<void>
}) {
  // Integer pesewas in, integer pesewas out — the counted-cash field is seeded
  // from `formatMinorPlain`, not from a `toFixed` float round-trip.
  const focusReturn = useDialogFocusReturn()
  const [step, setStep] = useState<'holds' | 'count'>(holds.length > 0 ? 'holds' : 'count')
  const [decision, setDecision] = useState<HoldsDecision | null>(null)
  const [amount, setAmount] = useState(formatMinorPlain(expectedCashMinor))
  const [note, setNote] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [acknowledged, setAcknowledged] = useState(false)

  const counted = parseGhsToMinor(amount)
  const variance = counted === null ? null : computeVariance(counted, expectedCashMinor)
  const holdsValue = holds.reduce((total, hold) => total + hold.totalMinor, 0)
  const unsyncedWarning = unsyncedSalesWarning(unsynced)
  const acknowledgement = unsyncedSalesAcknowledgement(unsynced)
  const readyToClose =
    amountProblem(amount) === null && (!needsUnsyncedAcknowledgement(unsynced) || acknowledged)

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (counted === null) {
      setError('Enter the counted cash, e.g. 200.00')
      return
    }
    if (holds.length > 0 && !decision) {
      setError('Choose what happens to the held carts')
      return
    }
    if (needsUnsyncedAcknowledgement(unsynced) && !acknowledged) {
      setError('Acknowledge that this close happens before every sale has synced')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await onConfirm({
        countedCashMinor: counted,
        ...(note.trim() ? { note: note.trim() } : {}),
        holdsDecision: decision ?? 'KEEP',
      })
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
          <DialogTitle className="text-base">
            {step === 'holds' ? 'Held carts' : 'Close shift'}
          </DialogTitle>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {otherCashierName ? (
            <p
              className="mb-4 rounded-md border border-warn bg-warn/10 px-3 py-2 text-sm"
              data-testid="close-takeover"
            >
              You are closing {otherCashierName}’s drawer. The variance review will name you as the
              requester.
            </p>
          ) : null}
          {step === 'holds' ? (
            <div className="grid gap-4">
              <p className="text-sm text-muted-foreground">
                {holds.length === 1 ? 'One cart is' : `${holds.length} carts are`} still held on
                this till, worth{' '}
                <span className="font-mono tabular-nums">{formatGhs(holdsValue)}</span>. A hold
                belongs to the terminal, not the shift, so nothing happens unless you choose.
              </p>
              <ul className="grid gap-1.5">
                {holds.map((hold) => (
                  <li
                    key={hold.id}
                    className="flex items-baseline justify-between gap-3 rounded-md border border-border bg-muted/40 px-3 py-2 text-sm"
                  >
                    <span className="truncate">{hold.label}</span>
                    <span className="font-mono text-xs text-muted-foreground tabular-nums">
                      {hold.itemCount} · {formatGhs(hold.totalMinor)}
                    </span>
                  </li>
                ))}
              </ul>
              <div className="grid gap-2">
                <Button
                  type="button"
                  variant={decision === 'KEEP' ? 'default' : 'outline'}
                  aria-pressed={decision === 'KEEP'}
                  onClick={() => setDecision('KEEP')}
                  className="h-11 justify-start"
                  data-testid="holds-keep"
                >
                  Keep for the next shift
                </Button>
                <Button
                  type="button"
                  variant={decision === 'VOID_ALL' ? 'destructive' : 'outline'}
                  aria-pressed={decision === 'VOID_ALL'}
                  onClick={() => setDecision('VOID_ALL')}
                  className="h-11 justify-start"
                  data-testid="holds-void-all"
                >
                  Void all — customer left
                </Button>
                <p className="text-xs text-muted-foreground">
                  Voiding records one customer-left void per cart with its name, so the day&rsquo;s
                  report can account for it. Closing is never blocked by a hold, only by not
                  choosing.
                </p>
              </div>
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <DialogFooter className="border-t border-border pt-3">
                <div className="flex w-full gap-2">
                  <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                    Cancel
                  </Button>
                  <Button
                    type="button"
                    disabled={!decision}
                    onClick={() => setStep('count')}
                    className="h-11 flex-[2]"
                    data-testid="holds-continue"
                  >
                    Continue
                  </Button>
                </div>
              </DialogFooter>
            </div>
          ) : (
            <form onSubmit={submit} className="grid gap-4">
              {unsyncedWarning ? (
                <div className="grid gap-2 rounded-md border border-warn bg-warn/10 px-3 py-2 text-sm">
                  <p data-testid="close-unsynced-warning">{unsyncedWarning}</p>
                  {acknowledgement ? (
                    <label className="flex items-start gap-2 text-xs font-medium">
                      <input
                        type="checkbox"
                        checked={acknowledged}
                        onChange={(event) => setAcknowledged(event.target.checked)}
                        className="mt-0.5 size-4 shrink-0"
                        data-testid="close-unsynced-acknowledge"
                      />
                      <span>{acknowledgement}</span>
                    </label>
                  ) : null}
                </div>
              ) : null}
              <div className="flex items-baseline justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
                <span>Expected cash</span>
                <span className="font-mono font-semibold tabular-nums">
                  {formatGhs(expectedCashMinor)}
                </span>
              </div>
              <MoneyField
                id="counted-cash"
                label="Counted cash"
                value={amount}
                onChange={setAmount}
              />
              <div className="flex items-baseline justify-between gap-3 text-sm">
                <span className="text-muted-foreground">Variance</span>
                <span className="flex items-center gap-1.5">
                  {variance === null ? null : (
                    <span
                      aria-hidden="true"
                      className={cn(
                        'size-1.5 shrink-0 rounded-full',
                        variance === 0 ? 'bg-ok' : variance > 0 ? 'bg-warn' : 'bg-danger',
                      )}
                    />
                  )}
                  <span
                    className="font-mono font-semibold text-foreground tabular-nums"
                    data-testid="close-variance"
                  >
                    {variance === null ? '—' : varianceWords(variance)}
                  </span>
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
              {holds.length > 0 ? (
                <div className="flex items-center justify-between gap-3 rounded-md border border-border px-3 py-2 text-xs">
                  <span data-testid="holds-decision">
                    {decision === 'VOID_ALL'
                      ? `${holds.length} held cart${holds.length === 1 ? '' : 's'} will be voided as customer-left.`
                      : `${holds.length} held cart${holds.length === 1 ? '' : 's'} will stay for the next shift.`}
                  </span>
                  <Button
                    type="button"
                    variant="ghost"
                    onClick={() => setStep('holds')}
                    className="h-8 px-2 text-[11px]"
                  >
                    Change
                  </Button>
                </div>
              ) : null}
              {error ? (
                <p role="alert" className="text-sm text-danger">
                  {error}
                </p>
              ) : null}
              <DialogFooter className="border-t border-border pt-3">
                <div className="flex w-full gap-2">
                  <Button type="button" variant="outline" onClick={onClose} className="h-11 flex-1">
                    Cancel
                  </Button>
                  <Button
                    type="submit"
                    disabled={busy || !readyToClose}
                    className="h-14 flex-[2] text-base"
                    data-testid="close-shift-confirm"
                  >
                    {busy ? 'Closing…' : 'Close shift'}
                  </Button>
                </div>
              </DialogFooter>
              <p className="text-xs text-muted-foreground">
                Closing works offline. The server checks the drawer when the shift syncs and flags
                any difference for a manager.
              </p>
            </form>
          )}
        </div>
      </DialogContent>
    </Dialog>
  )
}
