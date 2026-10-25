import { useEffect, useState } from 'react'
import { BindingError, type LocalStaffBinding } from '../../lib/auth/bindings'
import type { LockoutPolicy } from '../../lib/auth/pin'
import type { CartOverrideProof } from '../../lib/cart/types'
import { formatGhs } from '../../lib/format'
import {
  approveOverride,
  listApprovers,
  OverrideError,
  type OverridePermission,
  reasonCodesFor,
} from '../../lib/overrides/override-service'
import { usePosDatabase } from '../../lib/powersync/provider'
import { Modal } from './modal'
import { PinPad } from './pin-pad'

/**
 * Manager approval dialog (Plan 06 Tasks 5 and 6).
 *
 * The approver is a *binding*, not a password: a manager or admin authorized on
 * this terminal enters their own PIN, which is verified against their device
 * verifier with their own lockout counters. A cashier's binding cannot be
 * selected for approval at all.
 */

const REASON_LABELS: Record<string, string> = {
  STAFF: 'Staff discount',
  DAMAGE: 'Damaged goods',
  PROMO: 'Promotion',
  OTHER: 'Other',
  CUSTOMER_REQUEST: 'Customer request',
  APPROVED: 'Approved customer',
}

export function ManagerOverrideDialog({
  title,
  description,
  permission,
  amountMinor,
  overByMinor,
  policy,
  onClose,
  onApproved,
  onBypass,
}: {
  title: string
  description: string
  permission: OverridePermission
  amountMinor?: number
  overByMinor?: number
  policy: LockoutPolicy
  onClose: () => void
  onApproved: (proof: CartOverrideProof) => void
  /** Credit over-limit only: sell anyway and let the server raise a conflict. */
  onBypass?: () => void
}) {
  const db = usePosDatabase()
  const [approvers, setApprovers] = useState<LocalStaffBinding[]>([])
  const [approverId, setApproverId] = useState('')
  const [reasonCode, setReasonCode] = useState(reasonCodesFor(permission)[0] ?? '')
  const [note, setNote] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listApprovers(db).then((rows) => {
      if (cancelled) return
      setApprovers(rows)
      setApproverId(rows[0]?.bindingId ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [db])

  async function submit() {
    if (!approverId) {
      setError('Choose a manager')
      return
    }
    if (pin.length < 4) {
      setError('Enter the manager PIN')
      return
    }

    setBusy(true)
    setError(null)
    try {
      const proof = await approveOverride(db, {
        approverBindingId: approverId,
        pin,
        policy,
        permission,
        reasonCode,
        note,
      })
      onApproved(proof)
      onClose()
    } catch (approvalError) {
      if (approvalError instanceof BindingError) {
        setError(approvalError.message)
      } else if (approvalError instanceof OverrideError) {
        setError(approvalError.message)
      } else {
        setError('Could not approve this override')
      }
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <Modal
      title={title}
      description={description}
      onClose={onClose}
      testId="override-dialog"
      footer={
        <div className="grid gap-2">
          {onBypass ? (
            <button
              type="button"
              onClick={() => {
                onBypass()
                onClose()
              }}
              className="h-10 w-full rounded-md border border-amber-300 bg-amber-50 text-sm font-medium text-amber-900 hover:bg-amber-100"
              data-testid="continue-without-approval"
            >
              Continue without approval
            </button>
          ) : null}
          <button
            type="button"
            onClick={onClose}
            className="h-10 w-full rounded-md border border-border text-sm font-medium hover:bg-muted"
          >
            Cancel
          </button>
        </div>
      }
    >
      <div className="grid gap-3">
        {typeof amountMinor === 'number' ? (
          <div className="flex items-baseline justify-between rounded-md border border-border bg-muted/40 px-3 py-2 text-sm">
            <span className="text-muted-foreground">Amount</span>
            <span className="font-mono font-semibold">{formatGhs(amountMinor)}</span>
          </div>
        ) : null}

        {typeof overByMinor === 'number' && overByMinor > 0 ? (
          <div
            className="flex items-baseline justify-between rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900"
            data-testid="over-by"
          >
            <span>Over the limit by</span>
            <span className="font-mono font-semibold">{formatGhs(overByMinor)}</span>
          </div>
        ) : null}

        <label htmlFor="override-approver" className="grid gap-1.5 text-sm font-medium">
          Approver
          <select
            id="override-approver"
            value={approverId}
            onChange={(event) => setApproverId(event.target.value)}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            data-testid="override-approver"
          >
            {approvers.length === 0 ? <option value="">No manager authorized here</option> : null}
            {approvers.map((approver) => (
              <option key={approver.bindingId} value={approver.bindingId}>
                {approver.name} ({approver.role})
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="override-reason" className="grid gap-1.5 text-sm font-medium">
          Reason
          <select
            id="override-reason"
            value={reasonCode}
            onChange={(event) => setReasonCode(event.target.value)}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
          >
            {reasonCodesFor(permission).map((code) => (
              <option key={code} value={code}>
                {REASON_LABELS[code] ?? code}
              </option>
            ))}
          </select>
        </label>

        <label htmlFor="override-note" className="grid gap-1.5 text-sm font-medium">
          Note (optional)
          <input
            id="override-note"
            value={note}
            onChange={(event) => setNote(event.target.value)}
            maxLength={200}
            className="h-11 rounded-md border border-border bg-background px-3 text-sm"
            placeholder="Why this is allowed"
          />
        </label>

        {approvers.length === 0 ? (
          <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No manager is authorized on this terminal. Authorize one online, then try again.
          </p>
        ) : (
          <PinPad
            value={pin}
            onChange={setPin}
            onSubmit={() => {
              void submit()
            }}
            busy={busy}
            disabled={!approverId}
            submitLabel="Approve"
          />
        )}

        {error ? (
          <p role="alert" className="text-sm text-destructive" data-testid="override-error">
            {error}
          </p>
        ) : null}
      </div>
    </Modal>
  )
}
