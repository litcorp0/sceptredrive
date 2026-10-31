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
  verifyOfflinePin,
} from '@/lib/auth/bindings'
import { DEFAULT_LOCKOUT_POLICY, type LockoutPolicy } from '@/lib/auth/pin'
import { resetTerminalData } from '@/lib/auth/terminal-reset'
import { lockoutPolicyFor, readCachedConfig } from '@/lib/pos-config'
import { usePos } from '@/lib/powersync/provider'

/**
 * The explicit way out of a terminal whose server-side identity no longer
 * exists. Re-enrolment alone keeps local sales and cached data; this deletes
 * them, so it is a separate, confirmed action — and it destroys a drawer's worth
 * of unsynced sales, which is why it is not a cashier's button.
 *
 * The button lives on the sign-in screen because that is where a terminal with a
 * rejected credential ends up: there is nobody signed in to check a role against.
 * The check is therefore the one that screen can make — a live manager or admin
 * binding and that person's own offline PIN. With no manager enrolled, the
 * control does not render at all: there is nobody who could authorise it.
 *
 * The manager's lockout counters are used, so guessing here locks the manager
 * out exactly as guessing at the PIN screen would.
 */
export function ResetTerminalButton({
  label = 'Reset this terminal',
  className,
}: {
  label?: string
  className?: string
}) {
  const { db } = usePos()
  const focusReturn = useDialogFocusReturn()
  const [managers, setManagers] = useState<LocalStaffBinding[]>([])
  const [open, setOpen] = useState(false)
  const [step, setStep] = useState<'authorise' | 'confirm'>('authorise')
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState<LockoutPolicy>(DEFAULT_LOCKOUT_POLICY)

  useEffect(() => {
    if (!db) return
    let cancelled = false
    void Promise.all([listBindings(db), readCachedConfig(db)]).then(([rows, config]) => {
      if (cancelled) return
      const candidates = rows.filter(
        (row) => (row.role === 'MANAGER' || row.role === 'ADMIN') && row.isActive,
      )
      setManagers(candidates)
      setSelectedId(candidates[0]?.id ?? '')
      setPolicy(lockoutPolicyFor(config))
    })
    return () => {
      cancelled = true
    }
  }, [db])

  function openDialog() {
    // With no database open there is no binding to check a PIN against and no
    // local data left to protect — that terminal is already broken, so the
    // confirmation is the only gate available.
    setStep(db ? 'authorise' : 'confirm')
    setPin('')
    setError(null)
    setOpen(true)
  }

  async function authorise() {
    if (!db) {
      setError('The local database is not open yet')
      return
    }
    if (!selectedId || pin.length < 4) {
      setError('Choose a manager and enter their PIN')
      return
    }
    setBusy(true)
    setError(null)
    try {
      await verifyOfflinePin(db, selectedId, pin, policy)
      // Authenticated; now the destructive confirmation, with the PIN discarded.
      setPin('')
      setStep('confirm')
    } catch (authError) {
      if (authError instanceof BindingError) {
        setError(authError.message)
      } else {
        setError('Could not authorise this reset')
      }
      setPin('')
    } finally {
      setBusy(false)
    }
  }

  async function reset() {
    setBusy(true)
    setError(null)
    try {
      await resetTerminalData()
    } catch (resetError) {
      setError(resetError instanceof Error ? resetError.message : 'Could not reset this terminal')
      setBusy(false)
    }
  }

  // With a working database and no manager enrolled, nobody may authorise a
  // reset: the control is absent rather than present and useless. A terminal
  // whose database cannot open at all keeps the escape hatch (see `openDialog`).
  if (db && managers.length === 0) return null

  return (
    <>
      <Button type="button" variant="ghost" size="sm" className={className} onClick={openDialog}>
        {label}
      </Button>

      <Dialog
        open={open}
        onOpenChange={(next) => {
          if (!next) setOpen(false)
        }}
      >
        <DialogContent {...focusReturn} data-testid="reset-terminal-dialog">
          {step === 'authorise' ? (
            <>
              <DialogHeader>
                <DialogTitle>Reset this terminal</DialogTitle>
                <DialogDescription>
                  A manager must authorise this. It deletes local data, so the PIN is the check that
                  the person asking is trusted with it.
                </DialogDescription>
              </DialogHeader>

              {managers.length > 1 ? (
                <div className="grid gap-1.5">
                  <span className="text-sm font-medium">Manager</span>
                  <div className="grid gap-1">
                    {managers.map((manager) => (
                      <Button
                        key={manager.id}
                        type="button"
                        variant={selectedId === manager.id ? 'default' : 'outline'}
                        aria-pressed={selectedId === manager.id}
                        className="h-11 justify-start"
                        onClick={() => setSelectedId(manager.id)}
                      >
                        {manager.name || manager.staffId}
                      </Button>
                    ))}
                  </div>
                </div>
              ) : (
                <p className="text-sm text-muted-foreground">
                  Enter {managers[0]?.name || managers[0]?.staffId}&rsquo;s PIN.
                </p>
              )}

              <PinPad
                value={pin}
                onChange={setPin}
                onSubmit={() => void authorise()}
                busy={busy}
                label="Manager PIN"
                submitLabel="Authorise"
                autoFocus={managers.length === 1}
              />

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
              </DialogFooter>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Reset this terminal?</DialogTitle>
                <DialogDescription>
                  This deletes every local sale, held cart, cached product and staff record, and the
                  device credential. Sales that have not synced yet will be lost. Use it only after
                  the server database was reset or when this machine is being reassigned.
                </DialogDescription>
              </DialogHeader>

              {error ? (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              ) : null}

              <DialogFooter>
                <Button type="button" variant="outline" onClick={() => setOpen(false)}>
                  Cancel
                </Button>
                <Button type="button" variant="destructive" onClick={reset} disabled={busy}>
                  {busy ? 'Resetting…' : 'Reset terminal'}
                </Button>
              </DialogFooter>
            </>
          )}
        </DialogContent>
      </Dialog>
    </>
  )
}
