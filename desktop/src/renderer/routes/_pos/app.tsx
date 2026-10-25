import { HomePage } from '@/modules/home'
import { ReceiptScreen } from '@/modules/receipt'
import { SalesScreen } from '@/modules/sales'
import { SellScreen } from '@/modules/sell'
import { SettingsScreen } from '@/modules/settings'
import { SyncScreen } from '@/modules/sync'
import { TenderScreen } from '@/modules/tender'
import { useStaffSession } from '../../lib/auth/staff-session'
import { CartProvider } from '../../lib/cart/cart-store'
import type { PosIdentityRow } from '../../lib/pos-runtime'
import { usePosRuntime } from '../../lib/pos-runtime'
import { usePos } from '../../lib/powersync/provider'
import { screenForRoute, useHashRoute, useRedirect } from '../../lib/router'

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
 * `#home` and `#pos` mount this same shell (P10-D6). The guard ladder is identical for both:
 * home is a counter screen, so a cashier with no open shift is still sent to `#shift`, one hop,
 * exactly as before. The only difference is which page the shell renders once the gates pass.
 *
 * The shell keeps the same chrome for every screen so the sync badge and the
 * cashier identity never disappear mid-sale.
 */

function Centered({ title, detail }: { title: string; detail?: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background p-8">
      <div className="max-w-sm text-center">
        <div
          aria-hidden="true"
          className="mx-auto mb-4 flex size-10 items-center justify-center rounded-md bg-primary font-display text-base font-semibold text-primary-foreground"
        >
          SD
        </div>
        <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
          Sceptre Drive POS
        </p>
        <h1 className="mt-2 font-display text-lg font-semibold">{title}</h1>
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
  // `#home` sits beside `#pos`; nothing else changes meaning (P10-D6). On `#pos` the second
  // segment is the sell sub-screen, defaulting to selling.
  const screen = screenForRoute(route)

  // Receipts and today's sales must be reachable after the shift is closed, so
  // a manager can reprint yesterday evening's sale while opening the next one.
  const shiftOptional = screen === 'sales' || screen === 'receipt' || screen === 'sync'
  const needsShift =
    Boolean(runtime.config?.pos.salesRequireOpenShift) && !runtime.shift && !shiftOptional

  const redirectTo = !staff
    ? 'login'
    : runtime.status !== 'ready'
      ? null
      : !runtime.config
        ? 'login'
        : needsShift
          ? 'shift'
          : screen === 'settings' && staff.role === 'CASHIER'
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

  // Home is a counter screen, not a selling screen: it renders outside the cart provider so a
  // cart left mid-sale is not rebuilt (and its queries are not re-run) just by looking at the
  // day's figures.
  if (screen === 'home') {
    return <HomePage identity={identity} shift={runtime.shift} staff={staff} />
  }

  if (screen === 'settings') {
    return (
      <SettingsScreen
        identity={identity}
        config={runtime.config}
        shift={runtime.shift}
        staff={staff}
      />
    )
  }

  if (screen === 'sales') {
    return <SalesScreen identity={identity} shift={runtime.shift} staff={staff} />
  }

  if (screen === 'sync') {
    return <SyncScreen identity={identity} shift={runtime.shift} staff={staff} />
  }

  if (screen === 'receipt') {
    const saleId = route.segments[2]
    if (!saleId) {
      return <SalesScreen identity={identity} shift={runtime.shift} staff={staff} />
    }
    return <ReceiptScreen identity={identity} shift={runtime.shift} staff={staff} saleId={saleId} />
  }

  return (
    <CartProvider
      key={runtime.shift?.id ?? 'no-shift'}
      db={db}
      shiftId={runtime.shift?.id ?? ''}
      config={runtime.config}
    >
      {screen === 'tender' ? (
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
