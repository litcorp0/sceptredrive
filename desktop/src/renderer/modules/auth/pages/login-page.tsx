import type { PowerSyncDatabase } from '@powersync/web'
import { formatBranchLabel, PIN_PROBLEM_MESSAGES, pinProblem } from '@sceptre/shared'
import { cn } from 'cn'
import { useCallback, useEffect, useState } from 'react'
import { PinPad, StatusNote } from '@/components/common'
import { Button } from '@/components/ui/button'
import { redeemEnrollment } from '@/lib/api/client'
import {
  activateBinding,
  BindingError,
  changePinOnline,
  type LocalStaffBinding,
  listBindings,
  validateBindingOnline,
  verifyOfflinePin,
} from '@/lib/auth/bindings'
import type { LockoutPolicy } from '@/lib/auth/pin'
import { establishSession, persistDeviceToken, signOut } from '@/lib/auth/session'
import { credentialProblemFor } from '@/lib/auth/session-state'
import { startStaffSession } from '@/lib/auth/staff-session'
import { desktopApi, isDesktopAvailable } from '@/lib/desktop-api'
import { lockoutPolicyFor, readCachedConfig } from '@/lib/pos-config'
import { usePos } from '@/lib/powersync/provider'
import { ManagerUnlock } from '../components/manager-unlock'
import { ResetTerminalButton } from '../components/reset-terminal'
import { lockoutMessage } from '../utils/lockout-copy'

type Phase = 'loading' | 'select' | 'pin' | 'activate' | 'change'

function goHome(): void {
  window.location.hash = '#home'
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
  const [identity, setIdentity] = useState<{
    branch: string
    branchName: string
    terminal: string
  } | null>(null)

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
      const row = await db.getOptional<{
        branch_code: string
        branch_name: string
        terminal_code: string
      }>('SELECT branch_code, branch_name, terminal_code FROM pos_config WHERE id = ?', ['current'])
      if (!cancelled && row) {
        setIdentity({
          branch: row.branch_code,
          branchName: row.branch_name,
          terminal: row.terminal_code,
        })
      }
      await refresh(db)
    })()
    return () => {
      cancelled = true
    }
  }, [db, refresh])

  const selected = bindings.find((binding) => binding.id === selectedId) ?? null

  // Only a terminal with no credential at all is unenrolled. A token the server refuses is a
  // different state with its own screen: the local data is still valid and re-enrolment is a
  // choice, not something a transient error can force.
  const needsEnrollment = sessionState === 'missing'
  const credentialProblem = credentialProblemFor(sessionState)

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
      goHome()
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
      setError(lockoutMessage(signInError.lockedUntil))
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

  if (credentialProblem) {
    return (
      <CredentialProblemScreen
        kind={credentialProblem}
        onReenrol={async () => {
          await signOut()
        }}
      />
    )
  }

  return (
    <main className="flex min-h-screen bg-background text-foreground">
      <aside className="hidden w-1/3 flex-col justify-between bg-topbar p-8 text-topbar-foreground lg:flex">
        <div>
          <img
            src="/logo-inverse.png"
            alt="Sceptre Drive"
            className="h-11 w-auto"
            draggable={false}
            decoding="async"
          />
          <p className="mt-4 text-xs font-medium tracking-widest text-topbar-muted uppercase">
            Point of sale
          </p>
          <h1 className="mt-3 font-display text-2xl font-semibold">Terminal sign-in</h1>
          <p className="mt-2 text-sm text-topbar-muted">
            PINs work offline. Stock, credit, and sales sync when the connection returns.
          </p>
        </div>
        <dl className="space-y-2 text-sm">
          <div className="flex justify-between gap-4 border-b border-white/15 pb-2">
            <dt className="text-topbar-muted">Branch</dt>
            <dd className="font-mono">
              {session
                ? formatBranchLabel(session.branch)
                : identity
                  ? formatBranchLabel({ name: identity.branchName, code: identity.branch })
                  : '—'}
            </dd>
          </div>
          <div className="flex justify-between gap-4 border-b border-white/15 pb-2">
            <dt className="text-topbar-muted">Terminal</dt>
            <dd className="font-mono">{identity?.terminal ?? session?.terminal.code ?? '—'}</dd>
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-topbar-muted">Device</dt>
            <dd className="flex items-center gap-2 font-medium">
              <span
                aria-hidden="true"
                className={cn(
                  'size-1.5 shrink-0 rounded-full',
                  sessionState === 'active' ? 'bg-ok' : 'bg-warn',
                )}
              />
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
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  setPin('')
                  setError(null)
                  setPhase('activate')
                }}
                className="mt-2 h-11 px-0 text-sm text-muted-foreground"
              >
                Authorize another staff member
              </Button>
            </div>
          ) : null}

          {phase === 'pin' && selected ? (
            <div>
              <Button
                type="button"
                variant="link"
                onClick={() => {
                  setPhase('select')
                  setPin('')
                  setError(null)
                }}
                className="mb-2 h-11 px-0 text-sm text-muted-foreground"
              >
                ← Back
              </Button>
              <h2 className="text-lg font-semibold">Hello, {selected.name}</h2>
              <p className="mt-1 mb-4 text-sm text-muted-foreground">
                Enter your PIN. It works without a network.
              </p>
              <PinPad value={pin} onChange={setPin} onSubmit={signIn} busy={busy} autoFocus />
            </div>
          ) : null}

          {phase === 'change' && pendingChange ? (
            <ChangePinForm
              db={db}
              binding={pendingChange.binding}
              currentPin={pendingChange.currentPin}
              onCancel={() => {
                if (pendingChange.binding.pinMustChange) {
                  // Offline fallback: the temporary PIN still sells. `pinMustChange` stays set
                  // on the binding, so the POS asks again at the next sign-in.
                  startStaffSession(pendingChange.binding)
                  goHome()
                  return
                }
                setPendingChange(null)
                setPhase('select')
              }}
              onDone={(updated) => {
                startStaffSession(updated)
                goHome()
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
                goHome()
              }}
              onRefresh={async () => {
                if (db) await refresh(db)
              }}
            />
          ) : null}

          {error ? (
            <StatusNote tone="danger" role="alert" className="mt-4">
              {error}
            </StatusNote>
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

          <div className="mt-6 border-t border-border pt-4 text-center">
            <ResetTerminalButton />
          </div>
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
        <Button
          type="button"
          variant="link"
          onClick={onCancel}
          className="mb-2 h-11 px-0 text-sm text-muted-foreground"
        >
          ← Back
        </Button>
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
        placeholder="GA-0004 or you@sceptre.local"
      />

      <p className="mt-4 mb-2 text-sm font-medium">PIN</p>
      {/* No autofocus: the staff code above is the first thing to type. */}
      <PinPad
        value={pin}
        onChange={setPin}
        onSubmit={authorize}
        busy={busy}
        submitLabel="Authorize"
      />

      {error ? (
        <StatusNote tone="danger" role="alert" className="mt-3">
          {error}
        </StatusNote>
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
        <Button type="button" variant="outline" onClick={onCancel} className="h-11 flex-1">
          {binding.pinMustChange ? 'Use temporary PIN' : 'Not now'}
        </Button>
        <Button type="button" onClick={submit} disabled={busy} className="h-11 flex-[2]">
          {busy ? 'Saving…' : 'Save PIN'}
        </Button>
      </div>

      {error ? (
        <StatusNote tone="danger" role="alert" className="mt-3">
          {error}
        </StatusNote>
      ) : null}
    </div>
  )
}

/**
 * A terminal whose credential the server refuses.
 *
 * This is **not** a first install: the encrypted local database, the sales in it and the staff
 * bindings are intact. Re-enrolment deletes the dead token, and the enrolment screen follows.
 * The copy names the likely cause because "enrol this terminal" on a terminal that was enrolled
 * yesterday is the message that produced this fix.
 */
function CredentialProblemScreen({
  kind,
  onReenrol,
}: {
  kind: 'revoked' | 'rejected'
  onReenrol: () => Promise<void>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const revoked = kind === 'revoked'

  async function reenrol() {
    setBusy(true)
    setError(null)
    try {
      await onReenrol()
    } catch (reenrolError) {
      setError(
        reenrolError instanceof Error ? reenrolError.message : 'Could not reset this terminal',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <main
      className="flex min-h-screen items-center justify-center bg-background p-6 text-foreground"
      data-testid="credential-problem"
      data-kind={kind}
    >
      <div className="w-full max-w-md">
        <img
          src="/logo.png"
          alt="Sceptre Drive"
          className="h-10 w-auto"
          draggable={false}
          decoding="async"
        />
        <p className="mt-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Point of sale
        </p>
        <h1 className="mt-2 text-2xl font-semibold">
          {revoked ? 'This terminal was revoked' : 'This terminal is not recognised'}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          {revoked
            ? 'An administrator revoked this terminal’s access. Ask for a new enrolment code only if the console still expects this till.'
            : 'The server no longer knows this terminal’s credential — the database may have been reset or restored. Re-enrol to keep selling here.'}
        </p>
        <p className="mt-2 text-sm text-muted-foreground">
          Sales already saved on this terminal are not deleted.
        </p>

        {error ? (
          <StatusNote tone="danger" role="alert" className="mt-3">
            {error}
          </StatusNote>
        ) : null}

        <Button type="button" onClick={reenrol} disabled={busy} className="mt-4 h-12 w-full">
          {busy ? 'Resetting…' : 'Re-enrol this terminal'}
        </Button>
        <div className="mt-4 text-center">
          <ResetTerminalButton label="Reset local data instead" />
        </div>
      </div>
    </main>
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
      // Persist the long-lived credential before the session: without this the
      // terminal forgets its device token on quit and forces re-enrolment,
      // breaking the whole offline story after a restart.
      await persistDeviceToken(enrolled.deviceToken)
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
        <img
          src="/logo.png"
          alt="Sceptre Drive"
          className="h-10 w-auto"
          draggable={false}
          decoding="async"
        />
        <p className="mt-3 text-xs font-medium tracking-widest text-muted-foreground uppercase">
          Point of sale
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
          <StatusNote tone="danger" role="alert" className="mt-3">
            {error}
          </StatusNote>
        ) : null}

        <Button type="button" onClick={enroll} disabled={busy} className="mt-4 h-12 w-full">
          {busy ? 'Enrolling…' : 'Enrol terminal'}
        </Button>
        <p className="mt-3 text-xs text-muted-foreground">
          Enrolment needs the network once. After that, cash and credit sales work offline.
        </p>
        <div className="mt-6 text-center">
          <ResetTerminalButton label="Reset local data" />
        </div>
      </div>
    </main>
  )
}
