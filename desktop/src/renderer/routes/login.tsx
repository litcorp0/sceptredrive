import { PIN_PROBLEM_MESSAGES, pinProblem } from '@gikautos/shared'
import type { PowerSyncDatabase } from '@powersync/web'
import { useCallback, useEffect, useState } from 'react'
import { ManagerUnlock } from '../components/auth/manager-unlock'
import { PinPad } from '../components/auth/pin-pad'
import { redeemEnrollment } from '../lib/api/client'
import {
  activateBinding,
  BindingError,
  changePinOnline,
  type LocalStaffBinding,
  listBindings,
  validateBindingOnline,
  verifyOfflinePin,
} from '../lib/auth/bindings'
import type { LockoutPolicy } from '../lib/auth/pin'
import { establishSession } from '../lib/auth/session'
import { startStaffSession } from '../lib/auth/staff-session'
import { desktopApi, isDesktopAvailable } from '../lib/desktop-api'
import { lockoutPolicyFor, readCachedConfig } from '../lib/pos-config'
import { usePos } from '../lib/powersync/provider'
import { cn } from '../lib/utils'

type Phase = 'loading' | 'select' | 'pin' | 'activate' | 'change'

function goToShift(): void {
  window.location.hash = '#shift'
}

/**
 * Terminal sign-in.
 *
 * The device session and the PIN are independent: the terminal is enrolled
 * once, then each cashier authorizes with their staff code/email + PIN online.
 * After that the PIN works offline against the device-bound verifier.
 */
export function LoginRoute() {
  const { db, session, sessionState } = usePos()
  const [phase, setPhase] = useState<Phase>('loading')
  const [bindings, setBindings] = useState<LocalStaffBinding[]>([])
  const [selectedId, setSelectedId] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [policy, setPolicy] = useState<LockoutPolicy>(lockoutPolicyFor(null))
  const [pendingChange, setPendingChange] = useState<{
    binding: LocalStaffBinding
    currentPin: string
  } | null>(null)
  const [lockedTarget, setLockedTarget] = useState<LocalStaffBinding | null>(null)
  const [identity, setIdentity] = useState<{ branch: string; terminal: string } | null>(null)

  const refresh = useCallback(async (database: PowerSyncDatabase) => {
    const rows = await listBindings(database)
    setBindings(rows)
    setPhase(rows.length === 0 ? 'activate' : 'select')
    return rows
  }, [])

  useEffect(() => {
    if (!db) return
    let cancelled = false
    void (async () => {
      const config = await readCachedConfig(db)
      if (cancelled) return
      setPolicy(lockoutPolicyFor(config))
      const row = await db.getOptional<{ branch_code: string; terminal_code: string }>(
        'SELECT branch_code, terminal_code FROM pos_config WHERE id = ?',
        ['current'],
      )
      if (!cancelled && row) setIdentity({ branch: row.branch_code, terminal: row.terminal_code })
      await refresh(db)
    })()
    return () => {
      cancelled = true
    }
  }, [db, refresh])

  const selected = bindings.find((binding) => binding.id === selectedId) ?? null

  // An enrolled device whose sync is unreachable is still usable offline; only
  // a missing or revoked credential forces enrolment.
  const needsEnrollment = sessionState === 'missing' || sessionState === 'revoked'

  async function signIn() {
    if (!db || !selected) return
    setBusy(true)
    setError(null)
    try {
      const binding = await verifyOfflinePin(db, selected.id, pin, policy)

      // Best effort: a dead binding is caught here; offline is allowed to proceed.
      const live = await validateBindingOnline(db, binding.id)
      if (live === false) {
        setPin('')
        setError('This terminal binding is out of date. Authorize again online.')
        await refresh(db)
        return
      }

      if (binding.pinMustChange) {
        setPendingChange({ binding, currentPin: pin })
        setPin('')
        setPhase('change')
        return
      }

      startStaffSession(binding)
      goToShift()
    } catch (signInError) {
      handlePinError(signInError)
    } finally {
      setBusy(false)
    }
  }

  function handlePinError(signInError: unknown) {
    setPin('')
    if (!(signInError instanceof BindingError)) {
      setError('Could not check the PIN')
      return
    }
    if (signInError.code === 'LOCKED' && selected) {
      setLockedTarget(selected)
      setError('Too many wrong PINs. A manager can unlock this terminal.')
      return
    }
    if (signInError.code === 'INVALID') {
      setError(
        signInError.remainingAttempts === null
          ? 'Wrong PIN'
          : `Wrong PIN — ${signInError.remainingAttempts} attempt${signInError.remainingAttempts === 1 ? '' : 's'} left`,
      )
      return
    }
    if (signInError.code === 'EXPIRED' || signInError.code === 'INACTIVE') {
      if (db) void refresh(db)
    }
    setError(signInError.message)
  }

  if (phase === 'loading') {
    return (
      <main className="flex min-h-screen items-center justify-center bg-background text-sm text-muted-foreground">
        Starting the terminal…
      </main>
    )
  }

  if (needsEnrollment) {
    return (
      <EnrollmentScreen
        onEnrolled={async () => {
          if (db) await refresh(db)
        }}
      />
    )
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-1/3 flex-col justify-between bg-zinc-900 p-8 text-zinc-50 lg:flex">
        <div>
          <p className="text-xs font-medium tracking-widest text-zinc-400 uppercase">
            GikAutos POS
          </p>
          <h1 className="mt-3 text-2xl font-semibold">Terminal sign-in</h1>
          <p className="mt-2 text-sm text-zinc-400">
            PINs work offline. Stock, credit, and sales sync when the connection returns.
          </p>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4 border-b border-zinc-700 pb-2">
            <dt className="text-zinc-400">Branch</dt>
            <dd className="font-mono">{identity?.branch ?? session?.branch.code ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-zinc-700 pb-2">
            <dt className="text-zinc-400">Terminal</dt>
            <dd className="font-mono">{identity?.terminal ?? session?.terminal.code ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-zinc-400">Device</dt>
            <dd
              className={cn(
                'font-medium',
                sessionState === 'active' ? 'text-emerald-400' : 'text-amber-400',
              )}
            >
              {sessionState === 'active' ? 'Enrolled' : 'Offline'}
            </dd>
          </div>
        </dl>
      </aside>

      <section className="flex flex-1 items-center justify-center p-6">
        <div className="w-full max-w-md">
          {phase === 'select' ? (
            <div>
              <h2 className="text-lg font-semibold">Who is signing in?</h2>
              <p className="mt-1 text-sm text-muted-foreground">
                Choose your name, then enter your PIN.
              </p>
              <ul className="mt-4 divide-y divide-border rounded-lg border border-border">
                {bindings.map((binding) => (
                  <li key={binding.id}>
                    <button
                      type="button"
                      onClick={() => {
                        setSelectedId(binding.id)
                        setPin('')
                        setError(null)
                        setPhase('pin')
                      }}
                      className="flex w-full items-center justify-between gap-4 px-4 py-3 text-left hover:bg-muted"
                    >
                      <span>
                        <span className="block text-sm font-medium">{binding.name}</span>
                        <span className="block font-mono text-xs text-muted-foreground">
                          {binding.staffId} · {binding.role}
                        </span>
                      </span>
                      <span className="text-xs text-muted-foreground">Enter PIN</span>
                    </button>
                  </li>
                ))}
              </ul>
              <button
                type="button"
                onClick={() => {
                  setPin('')
                  setError(null)
                  setPhase('activate')
                }}
                className="mt-4 text-sm font-medium text-muted-foreground underline-offset-4 hover:underline"
              >
                Authorize another staff member
              </button>
            </div>
          ) : null}

          {phase === 'pin' && selected ? (
            <div>
              <button
                type="button"
                onClick={() => {
                  setPhase('select')
                  setPin('')
                  setError(null)
                }}
                className="mb-4 text-sm text-muted-foreground hover:underline"
              >
                ← Back
              </button>
              <h2 className="text-lg font-semibold">Hello, {selected.name}</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Enter your {policy.maxAttempts}-attempt PIN. It works without a network.
              </p>
              <PinPad value={pin} onChange={setPin} onSubmit={signIn} busy={busy} />
            </div>
          ) : null}

          {phase === 'change' && pendingChange ? (
            <ChangePinForm
              db={db}
              binding={pendingChange.binding}
              currentPin={pendingChange.currentPin}
              onCancel={() => {
                setPendingChange(null)
                setPhase('select')
              }}
              onDone={(updated) => {
                startStaffSession(updated)
                goToShift()
              }}
            />
          ) : null}

          {phase === 'activate' ? (
            <ActivateForm
              db={db}
              onCancel={bindings.length > 0 ? () => setPhase('select') : undefined}
              onAuthorized={(binding, usedPin) => {
                setSelectedId(binding.id)
                if (binding.pinMustChange) {
                  setPendingChange({ binding, currentPin: usedPin })
                  setPhase('change')
                  return
                }
                startStaffSession(binding)
                goToShift()
              }}
              onRefresh={async () => {
                if (db) await refresh(db)
              }}
            />
          ) : null}

          {error ? (
            <p
              role="alert"
              className="mt-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
            >
              {error}
            </p>
          ) : null}

          {lockedTarget && db ? (
            <ManagerUnlock
              db={db}
              target={lockedTarget}
              policy={policy}
              onClose={() => setLockedTarget(null)}
              onUnlocked={() => {
                setLockedTarget(null)
                setError(null)
                setPin('')
                if (db) void refresh(db)
              }}
            />
          ) : null}
        </div>
      </section>
    </main>
  )
}

function ActivateForm({
  db,
  onAuthorized,
  onCancel,
  onRefresh,
}: {
  db: PowerSyncDatabase | null
  onAuthorized: (binding: LocalStaffBinding, pin: string) => void
  onCancel?: () => void
  onRefresh: () => Promise<void>
}) {
  const [identity, setIdentity] = useState('')
  const [pin, setPin] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function authorize() {
    if (!db) return
    if (!identity.trim()) {
      setError('Enter a staff code or email')
      return
    }
    if (pin.length < 4) {
      setError('Enter the PIN given to you by your manager')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const binding = await activateBinding(db, { staffCodeOrEmail: identity, pin })
      onAuthorized(binding, pin)
    } catch (activateError) {
      if (activateError instanceof BindingError) {
        setError(activateError.message)
      } else {
        setError(activateError instanceof Error ? activateError.message : 'Could not authorize')
      }
      setPin('')
      await onRefresh()
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      {onCancel ? (
        <button
          type="button"
          onClick={onCancel}
          className="mb-4 text-sm text-muted-foreground hover:underline"
        >
          ← Back
        </button>
      ) : null}
      <h2 className="text-lg font-semibold">Authorize this terminal</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        A manager sets a temporary PIN in the console. Enter your staff code (or email) and that PIN
        once while connected.
      </p>

      <label htmlFor="staff-identity" className="mt-4 block text-sm font-medium">
        Staff code or email
      </label>
      <input
        id="staff-identity"
        value={identity}
        onChange={(event) => setIdentity(event.target.value)}
        autoComplete="username"
        className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
        placeholder="GA-0004 or you@gikautos.com"
      />

      <p className="mt-4 mb-2 text-sm font-medium">PIN</p>
      <PinPad
        value={pin}
        onChange={setPin}
        onSubmit={authorize}
        busy={busy}
        submitLabel="Authorize"
      />

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

function ChangePinForm({
  db,
  binding,
  currentPin,
  onCancel,
  onDone,
}: {
  db: PowerSyncDatabase | null
  binding: LocalStaffBinding
  currentPin: string
  onCancel: () => void
  onDone: (binding: LocalStaffBinding) => void
}) {
  const [pin, setPin] = useState('')
  const [confirm, setConfirm] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function submit() {
    if (!db) return
    const problem = pinProblem(pin)
    if (problem) {
      setError(PIN_PROBLEM_MESSAGES[problem])
      return
    }
    if (pin !== confirm) {
      setError('The PINs do not match')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const updated = await changePinOnline(db, binding.id, currentPin, pin)
      onDone(updated)
    } catch (changeError) {
      if (changeError instanceof BindingError) {
        setError(changeError.message)
      } else {
        setError(changeError instanceof Error ? changeError.message : 'Could not change the PIN')
      }
    } finally {
      setBusy(false)
    }
  }

  return (
    <div>
      <h2 className="text-lg font-semibold">Choose your own PIN</h2>
      <p className="mt-1 text-sm text-muted-foreground">
        {binding.name}, replace the temporary PIN with one only you know. This needs the network
        once; afterwards it works offline.
      </p>

      <label htmlFor="new-pin" className="mt-4 block text-sm font-medium">
        New PIN
      </label>
      <input
        id="new-pin"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={pin}
        onChange={(event) => setPin(event.target.value.replace(/\D/g, ''))}
        className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
      />

      <label htmlFor="confirm-pin" className="mt-3 block text-sm font-medium">
        Confirm PIN
      </label>
      <input
        id="confirm-pin"
        type="password"
        inputMode="numeric"
        autoComplete="new-password"
        maxLength={6}
        value={confirm}
        onChange={(event) => setConfirm(event.target.value.replace(/\D/g, ''))}
        className="mt-1 h-11 w-full rounded-md border border-border bg-background px-3 text-sm"
      />

      <div className="mt-4 flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="h-11 flex-1 rounded-md border border-border text-sm font-medium hover:bg-muted"
        >
          Not now
        </button>
        <button
          type="button"
          onClick={submit}
          disabled={busy}
          className="h-11 flex-[2] rounded-md bg-primary text-sm font-semibold text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? 'Saving…' : 'Save PIN'}
        </button>
      </div>

      {error ? (
        <p
          role="alert"
          className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {error}
        </p>
      ) : null}
    </div>
  )
}

/** Stable per-device identifier for enrollment (kept in the keychain, not the DB). */
async function deviceFingerprint(): Promise<string> {
  if (!isDesktopAvailable()) return crypto.randomUUID()
  const existing = await desktopApi.getSecret('deviceId')
  if (existing) return existing
  const created = crypto.randomUUID()
  await desktopApi.setSecret('deviceId', created)
  return created
}

/**
 * Enrolment happens once per terminal: the console issues a short-lived code,
 * the POS redeems it for the long-lived device token. Staff PINs are separate.
 */
function EnrollmentScreen({ onEnrolled }: { onEnrolled: () => Promise<void> }) {
  const [code, setCode] = useState('')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  async function enroll() {
    const normalized = code.replace(/[\s-]/g, '').toUpperCase()
    if (normalized.length < 6) {
      setError('Enter the enrolment code from the console')
      return
    }
    setBusy(true)
    setError(null)
    try {
      const enrolled = await redeemEnrollment(normalized, await deviceFingerprint())
      await establishSession(enrolled.deviceToken)
      await onEnrolled()
    } catch (enrollError) {
      setError(
        enrollError instanceof Error
          ? enrollError.message
          : 'Could not enrol this terminal. Check the code and the network.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground">
      <div className="w-full max-w-md">
        <p className="text-xs font-medium tracking-widest text-muted-foreground uppercase">
          GikAutos POS
        </p>
        <h1 className="mt-2 text-2xl font-semibold">Enrol this terminal</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          In the console, open the terminal and create an enrolment code. The code works once and
          expires after 15 minutes.
        </p>

        <label htmlFor="enrollment-code" className="mt-6 block text-sm font-medium">
          Enrolment code
        </label>
        <input
          id="enrollment-code"
          value={code}
          onChange={(event) => setCode(event.target.value.toUpperCase())}
          autoComplete="one-time-code"
          className="mt-1 h-12 w-full rounded-md border border-border bg-background px-3 font-mono text-lg tracking-[0.3em] uppercase"
          placeholder="ABCD2345"
        />

        {error ? (
          <p
            role="alert"
            className="mt-3 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
          >
            {error}
          </p>
        ) : null}

        <button
          type="button"
          onClick={enroll}
          disabled={busy}
          className="mt-4 h-12 w-full rounded-lg bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50"
        >
          {busy ? 'Enrolling…' : 'Enrol terminal'}
        </button>
        <p className="mt-3 text-xs text-muted-foreground">
          Enrolment needs the network once. After that, cash and credit sales work offline.
        </p>
      </div>
    </main>
  )
}
