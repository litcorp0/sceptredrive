import { useQuery } from '@powersync/react'
import type { StaffSession } from '../../lib/auth/staff-session'
import { formatGhs } from '../../lib/format'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { useSyncStatus } from '../../lib/powersync/status'
import { navigate } from '../../lib/router'
import { useOutboxSummary } from '../../lib/sync/outbox-summary'

/**
 * The POS top bar: where you are, who you are, whether the sale in front of you
 * has reached the server, and the two actions a cashier needs at a counter
 * (settings for a manager, lock to walk away).
 *
 * Offline is a normal state, not an error: the badge is informational and never
 * blocks selling (POS-14).
 */
export function AppHeader({
  identity,
  shift,
  staff,
  onLock,
  onSettings,
  lockNote,
}: {
  identity: PosIdentityRow | null
  shift: OpenShiftSummary | null
  staff: StaffSession
  onLock: () => void
  onSettings?: (() => void) | undefined
  lockNote?: string | null
}) {
  const status = useSyncStatus()
  const outbox = useOutboxSummary()
  const unprinted = useQuery<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sale
      WHERE print_status IN ('PENDING', 'FAILED', 'PRINTING')`,
  )
  const unprintedCount = unprinted.data?.[0]?.count ?? 0

  return (
    <header className="flex items-center justify-between gap-6 border-b border-border bg-card px-5 py-2.5">
      <div className="flex min-w-0 items-baseline gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-muted-foreground uppercase">
            {identity?.branchName ?? 'GikAutos'} · {identity?.branchCode ?? '—'}
          </p>
          <p className="truncate text-sm font-semibold" data-testid="pos-terminal">
            {identity?.terminalCode ?? 'Terminal not configured'}
            {shift ? (
              <span className="ml-2 font-normal text-muted-foreground">
                Shift {shift.number} · float {formatGhs(shift.openingFloatMinor)}
              </span>
            ) : (
              <span className="ml-2 font-normal text-amber-700">No open shift</span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs" data-testid="sync-cluster">
          <span
            data-testid="pos-sync-badge"
            className={`rounded-full px-2 py-1 font-medium ${
              status.online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-800'
            }`}
          >
            {status.online ? 'Online' : 'Offline'}
          </span>
          {outbox.pending > 0 ? (
            <span
              data-testid="pending-count"
              className="rounded-full bg-muted px-2 py-1 font-medium text-muted-foreground"
            >
              {outbox.pending} waiting
            </span>
          ) : null}
          {outbox.failed > 0 ? (
            <span
              data-testid="failed-count"
              className="rounded-full bg-red-50 px-2 py-1 font-medium text-red-700"
            >
              {outbox.failed} to review
            </span>
          ) : null}
          {unprintedCount > 0 ? (
            <button
              type="button"
              onClick={() => navigate('pos/sales')}
              data-testid="unprinted-count"
              className="rounded-full bg-amber-100 px-2 py-1 font-medium text-amber-900"
              title="Receipts that still need printing"
            >
              {unprintedCount} to print
            </button>
          ) : null}
        </div>

        <div className="text-right">
          <p className="text-sm leading-tight font-medium" data-testid="pos-cashier">
            {staff.name}
          </p>
          <p className="font-mono text-[11px] leading-tight text-muted-foreground">
            {staff.staffId} · {staff.role}
          </p>
        </div>

        {onSettings ? (
          <button
            type="button"
            onClick={onSettings}
            className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
            data-testid="open-settings"
          >
            Settings
          </button>
        ) : null}

        <button
          type="button"
          onClick={onLock}
          className="h-9 rounded-md border border-border px-3 text-xs font-medium hover:bg-muted"
          data-testid="lock-terminal"
          title={lockNote ?? 'Sign out of this terminal'}
        >
          Lock
        </button>
      </div>
    </header>
  )
}
