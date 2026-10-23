import { AppHeader } from '../../components/pos/app-header'
import type { PosConfigSnapshot } from '../../lib/api/types'
import { endStaffSession, type StaffSession } from '../../lib/auth/staff-session'
import { posRuntimeConfig } from '../../lib/config'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { navigate } from '../../lib/router'

/**
 * Terminal settings (Plan 06 Task 1; printer setup lands in Plan 07).
 *
 * Manager-only: it exposes the policy the till enforces (discount caps, PIN
 * lockout, shift requirement) so a supervisor can confirm what the terminal
 * believes without opening the admin console. Values are the last synced
 * snapshot and are read-only here — the server owns them.
 */

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-baseline justify-between gap-6 border-b border-border py-2 text-sm last:border-0">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right font-mono text-xs">{value}</span>
    </div>
  )
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-border bg-card p-5">
      <h2 className="mb-3 text-sm font-semibold">{title}</h2>
      {children}
    </section>
  )
}

export function SettingsScreen({
  identity,
  config,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  config: PosConfigSnapshot
  shift: OpenShiftSummary | null
  staff: StaffSession
}) {
  function lock() {
    if (shift) return
    endStaffSession()
    navigate('login')
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={lock}
        lockNote={shift ? 'Close the shift before locking' : 'Sign out of this terminal'}
      />

      <main className="mx-auto max-w-4xl p-6">
        <div className="mb-4 flex items-center justify-between">
          <h1 className="text-lg font-semibold">Terminal settings</h1>
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => {
                window.location.hash = '#dev/sync'
              }}
              className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
            >
              Sync diagnostics
            </button>
            <button
              type="button"
              onClick={() => navigate('pos')}
              className="h-9 rounded-md border border-border px-3 text-sm font-medium hover:bg-muted"
              data-testid="back-to-selling"
            >
              Back to selling
            </button>
          </div>
        </div>

        <div className="grid gap-4 md:grid-cols-2">
          <Section title="Terminal">
            <Row label="Branch" value={`${identity.branchName} (${identity.branchCode})`} />
            <Row label="Terminal" value={identity.terminalCode} />
            <Row label="Device" value={identity.deviceId.slice(0, 8)} />
            <Row label="Tax mode" value={config.taxMode} />
            <Row label="Server time zone" value={config.serverTimeZone} />
            <Row label="App version" value={posRuntimeConfig.appVersion} />
          </Section>

          <Section title="Selling policy">
            <Row
              label="Cashier discount cap"
              value={`${config.pos.maxCashierDiscountPercent}% of gross`}
            />
            <Row
              label="Manager discount cap"
              value={`${config.pos.maxManagerDiscountPercent}% of gross`}
            />
            <Row
              label="Open shift required"
              value={config.pos.salesRequireOpenShift ? 'yes' : 'no'}
            />
            <Row
              label="Clock skew tolerance"
              value={`${config.pos.clockSkewToleranceMinutes} min`}
            />
          </Section>

          <Section title="Loyalty">
            <Row
              label="Points earned"
              value={`${config.loyalty.earnPointsPerCedi} per GHS 1 base`}
            />
            <Row label="Points per GHS 1" value={String(config.loyalty.pointsPerCedi)} />
            <Row
              label="Minimum redemption"
              value={`${config.loyalty.minimumRedeemPoints} points`}
            />
            <Row label="Lot expiry" value={`${config.loyalty.expiryMonths} months`} />
          </Section>

          <Section title="PIN and receipt">
            <Row label="PIN attempts" value={String(config.pos.pinMaxAttempts)} />
            <Row label="Lockout" value={`${config.pos.pinLockMinutes} min`} />
            <Row label="Receipt header" value={config.receiptHeader || '—'} />
            <Row label="Receipt footer" value={config.pos.receiptFooter || '—'} />
          </Section>
        </div>

        <p className="mt-6 text-xs text-muted-foreground">
          These values come from the last device session and update on the next sync. Change them in
          the back office.
        </p>
      </main>
    </div>
  )
}
