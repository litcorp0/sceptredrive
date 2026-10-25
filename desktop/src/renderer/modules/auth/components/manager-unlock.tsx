import type { PowerSyncDatabase } from '@powersync/web'
import { useEffect, useState } from 'react'
import { PinPad, useDialogFocusReturn } from '@/components/common'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import {
  BindingError,
  type LocalStaffBinding,
  listBindings,
  unlockWithManagerPin,
} from '@/lib/auth/bindings'
import type { LockoutPolicy } from '@/lib/auth/pin'

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
  const focusReturn = useDialogFocusReturn()
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
          <DialogTitle className="text-base">Manager unlock</DialogTitle>
          <DialogDescription>
            {target.name} is locked. A manager or admin can unlock the terminal.
          </DialogDescription>
        </DialogHeader>

        <div className="min-h-0 flex-1 overflow-y-auto px-5 py-4">
          {managers.length === 0 ? (
            <p className="rounded-md border border-amber-300 bg-amber-50 px-3 py-2 text-sm text-amber-900">
              No manager is authorized on this terminal. Authorize one online, then try again.
            </p>
          ) : (
            <>
              <label htmlFor="unlock-manager" className="block text-sm font-medium">
                Manager
              </label>
              <select
                id="unlock-manager"
                value={selectedId}
                onChange={(event) => setSelectedId(event.target.value)}
                className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
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
        </div>

        <DialogFooter className="border-t border-border px-5 py-3">
          <div className="flex w-full">
            <Button type="button" variant="outline" onClick={onClose} className="h-11 w-full">
              Cancel
            </Button>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
