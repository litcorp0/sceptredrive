import type { PowerSyncDatabase } from '@powersync/web'
import { useEffect, useState } from 'react'
import {
  BindingError,
  type LocalStaffBinding,
  listBindings,
  unlockWithManagerPin,
} from '../../lib/auth/bindings'
import type { LockoutPolicy } from '../../lib/auth/pin'
import { PinPad } from './pin-pad'

/**
 * A locked cashier binding is cleared by a manager/admin PIN. The manager's own
 * lockout counters are used, so a brute-force attempt against the manager also
 * locks the manager out.
 */
export function ManagerUnlock({
  db,
  target,
  policy,
  onClose,
  onUnlocked,
}: {
  db: PowerSyncDatabase
  target: LocalStaffBinding
  policy: LockoutPolicy
  onClose: () => void
  onUnlocked: (manager: LocalStaffBinding) => void
}) {
  const [managers, setManagers] = useState<LocalStaffBinding[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    let cancelled = false
    void listBindings(db).then((rows) => {
      if (cancelled) return
      const candidates = rows.filter(
        (row) => row.id !== target.id && (row.role === 'MANAGER' || row.role === 'ADMIN'),
      )
      setManagers(candidates)
      setSelectedId(candidates[0]?.id ?? '')
    })
    return () => {
      cancelled = true
    }
  }, [db, target.id])

  async function submit() {
    if (!selectedId || pin.length < 4) {
      setError('Choose a manager and enter their PIN')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const manager = await unlockWithManagerPin(db, target.id, selectedId, pin, policy)
      onUnlocked(manager)
    } catch (unlockError) {
      if (unlockError instanceof BindingError) {
        setError(unlockError.message)
      } else {
        setError('Could not unlock this terminal')
      }
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-6">
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Manager unlock"
        className="w-full max-w-md rounded-xl border border-border bg-background p-6 shadow-xl"
      >
        <h2 className="text-lg font-semibold">Manager unlock</h2>
        <p className="mt-1 text-sm text-muted-foreground">
          {target.name} is locked. A manager or admin can unlock the terminal.
        </p>

        {managers.length === 0 ? (
          <p className="mt-4 rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
            No manager is authorized on this terminal. Authorize one online, then try again.
          </p>
        ) : (
          <>
            <label htmlFor="unlock-manager" className="mt-4 block text-sm font-medium">
              Manager
            </label>
            <select
              id="unlock-manager"
              value={selectedId}
              onChange={(event) => setSelectedId(event.target.value)}
              className="mt-1 h-10 w-full rounded-md border border-border bg-background px-3 text-sm"
            >
              {managers.map((manager) => (
                <option key={manager.id} value={manager.id}>
                  {manager.name} ({manager.role})
                </option>
              ))}
            </select>

            <div className="mt-4">
              <PinPad
                value={pin}
                onChange={setPin}
                onSubmit={submit}
                busy={busy}
                submitLabel="Unlock"
              />
            </div>
          </>
        )}

        {error ? (
          <p role="alert" className="mt-3 text-sm text-destructive">
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={onClose}
          className="mt-4 h-10 w-full rounded-md border border-border text-sm font-medium hover:bg-muted"
        >
          Cancel
        </button>
      </div>
    </div>
  )
}
