import { useStaffSession } from '../../lib/auth/staff-session'
import { CartProvider } from '../../lib/cart/cart-store'
import type { PosIdentityRow } from '../../lib/pos-runtime'
import { usePosRuntime } from '../../lib/pos-runtime'
import { usePos } from '../../lib/powersync/provider'
import { useHashRoute, useRedirect } from '../../lib/router'
import { SellScreen } from './sell'
import { SettingsScreen } from './settings'
import { TenderScreen } from './tender'

/**
 * The POS application shell and its guards (Plan 06 Task 1).
 *
 * Order of gates — each one is a real state the terminal can be in, and each
 * has somewhere to go:
 *
 * 1. no local database yet → a starting screen (the DB opens encrypted);
 * 2. no staff session → `#login` (PIN is offline-capable);
 * 3. no cached terminal config → `#login` (enrolment);
 * 4. no open shift while `pos.salesRequireOpenShift` → `#shift`;
 * 5. settings needs a manager/admin binding.
 *
 * The shell keeps the same chrome for every screen so the sync badge and the
 * cashier identity never disappear mid-sale.
 */

function Centered({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-sm text-center">
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          GikAutos POS
        </p>
        <h1 className="mt-2 text-lg font-semibold">{title}</h1>
        {detail ? <p className="mt-1 text-sm text-muted-foreground">{detail}</p> : null}
      </div>
    </main>
  )
}

export function PosRoutes() {
  const { db } = usePos()
  if (!db) return <Centered title="Opening the terminal…" detail="Encrypted local database" />
  return <PosBoot />
}

function PosBoot() {
  const { db } = usePos()
  const route = useHashRoute()
  const staff = useStaffSession()
  const runtime = usePosRuntime()
  const sub = route.segments[1] ?? 'sell'

  const needsShift = Boolean(runtime.config?.pos.salesRequireOpenShift) && !runtime.shift

  const redirectTo = !staff
    ? 'login'
    : runtime.status !== 'ready'
      ? null
      : !runtime.config
        ? 'login'
        : needsShift
          ? 'shift'
          : sub === 'settings' && staff.role === 'CASHIER'
            ? 'pos'
            : null

  useRedirect(redirectTo !== null, redirectTo ?? 'pos')

  if (redirectTo) {
    return <Centered title="Redirecting…" detail={redirectTo === 'login' ? 'Sign in' : 'Shift'} />
  }
  if (!staff || !runtime.config || !runtime.identity) {
    return <Centered title="Opening the terminal…" />
  }

  // The provider only renders behind a guarded screen, so the database exists.
  if (!db) return <Centered title="Opening the terminal…" />

  // No shift but the policy allows selling: stay, but a completed sale still
  // needs a shift id, so the tender screen refuses without one.
  const identity: PosIdentityRow = runtime.identity

  if (sub === 'settings') {
    return (
      <SettingsScreen
        identity={identity}
        config={runtime.config}
        shift={runtime.shift}
        staff={staff}
      />
    )
  }

  return (
    <CartProvider
      key={runtime.shift?.id ?? 'no-shift'}
      db={db}
      shiftId={runtime.shift?.id ?? ''}
      config={runtime.config}
    >
      {sub === 'tender' ? (
        <TenderScreen
          identity={identity}
          shift={runtime.shift}
          staff={staff}
          config={runtime.config}
        />
      ) : (
        <SellScreen
          identity={identity}
          shift={runtime.shift}
          staff={staff}
          config={runtime.config}
        />
      )}
    </CartProvider>
  )
}
