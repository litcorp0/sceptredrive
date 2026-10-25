import { useQuery } from '@powersync/react'
import type { StaffSession } from '../../lib/auth/staff-session'
import { formatGhs } from '../../lib/format'
import type { OpenShiftSummary, PosIdentityRow } from '../../lib/pos-runtime'
import { navigate } from '../../lib/router'
import { SyncBadge } from './sync-badge'

/**
 * The POS top bar: where you are, who you are, whether the sale in front of you
 * has reached the server, and the two actions a cashier needs at a counter
 * (settings for a manager, lock to walk away).
 *
 * Offline is a normal state, not an error: the badge is informational and never
 * blocks selling (POS-14).
 *
 * The header is the counter-scale version of the admin fascia: a charcoal strip
 * that visually separates chrome from the selling surface. The POS has no theme
 * toggle, so the light-mode semantic tokens are too dark to read as text here —
 * they carry the small status dot instead and the label stays in
 * `--topbar-foreground`. Every control is at least 44×44 px for a touch till.
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
  const unprinted = useQuery<{ count: number }>(
    `SELECT COUNT(*) AS count FROM sale
      WHERE print_status IN ('PENDING', 'FAILED', 'PRINTING')`,
  )
  const unprintedCount = unprinted.data?.[0]?.count ?? 0

  return (
    <header className="flex h-(--layout-topbar-height) shrink-0 items-center justify-between gap-4 bg-topbar px-5 text-topbar-foreground">
      <div className="flex min-w-0 items-baseline gap-3">
        <div className="min-w-0">
          <p className="text-[11px] font-medium tracking-wide text-topbar-muted uppercase">
            {identity?.branchName ?? 'Sceptre Drive'} · {identity?.branchCode ?? '—'}
          </p>
          <p
            className="truncate text-sm font-semibold text-topbar-foreground"
            data-testid="pos-terminal"
          >
            {identity?.terminalCode ?? 'Terminal not configured'}
            {shift ? (
              <span className="ml-2 font-normal text-topbar-muted">
                Shift {shift.number} · float {formatGhs(shift.openingFloatMinor)}
              </span>
            ) : (
              <span className="ml-2 inline-flex items-center gap-1.5 rounded-full bg-white/10 px-2 py-0.5 align-middle text-xs font-medium text-topbar-foreground">
                <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warn" />
                No open shift
              </span>
            )}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-3">
        <div className="flex items-center gap-2 text-xs" data-testid="sync-cluster">
          <SyncBadge />
          {unprintedCount > 0 ? (
            <button
              type="button"
              onClick={() => navigate('pos/sales')}
              data-testid="unprinted-count"
              className="inline-flex min-h-11 items-center gap-1.5 rounded-full bg-white/10 px-3 text-xs font-medium text-topbar-foreground transition-colors hover:bg-white/15"
              title="Receipts that still need printing"
            >
              <span aria-hidden="true" className="size-1.5 shrink-0 rounded-full bg-warn" />
              {unprintedCount} to print
            </button>
          ) : null}
        </div>

        <div className="text-right">
          <p
            className="text-sm leading-tight font-medium text-topbar-foreground"
            data-testid="pos-cashier"
          >
            {staff.name}
          </p>
          <p className="font-mono text-[11px] leading-tight text-topbar-muted">
            {staff.staffId} · {staff.role}
          </p>
        </div>

        {onSettings ? (
          <button
            type="button"
            onClick={onSettings}
            className="h-11 min-h-11 min-w-11 rounded-md border border-white/40 px-3 text-xs font-medium text-topbar-foreground transition-colors hover:bg-white/10"
            data-testid="open-settings"
          >
            Settings
          </button>
        ) : null}

        <button
          type="button"
          onClick={onLock}
          className="h-11 min-h-11 min-w-11 rounded-md border border-white/40 px-3 text-xs font-medium text-topbar-foreground transition-colors hover:bg-white/10"
          data-testid="lock-terminal"
          title={lockNote ?? 'Sign out of this terminal'}
        >
          Lock
        </button>
      </div>
    </header>
  )
}
