import type { ReactNode } from 'react'
import { useSyncStatus } from '../../lib/powersync/status'

/**
 * Minimal POS shell. Plan 06 replaces the body with the selling UI; what exists
 * here is the chrome every POS screen needs: branch/terminal identity and an
 * always-visible sync indicator.
 */
export function PosShell({ children }: { children: ReactNode }) {
  const status = useSyncStatus()

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <header className="flex items-center justify-between border-b border-border px-6 py-3">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            GikAutos POS
          </p>
          <p className="text-sm font-semibold" data-testid="pos-shell">
            Terminal shell
          </p>
        </div>
        <div className="flex items-center gap-3 text-xs">
          {status.downloading ? (
            <span className="text-muted-foreground" data-testid="sync-downloading">
              Syncing…
            </span>
          ) : null}
          <span
            data-testid="sync-badge"
            className={`rounded-full px-2 py-1 font-medium ${
              status.online ? 'bg-emerald-50 text-emerald-700' : 'bg-amber-50 text-amber-700'
            }`}
          >
            {status.online ? 'Online' : 'Offline'}
          </span>
        </div>
      </header>
      <div className="flex-1 p-6">{children}</div>
    </div>
  )
}

/** Placeholder until Plan 06 lands the catalog, cart, and tender screens. */
export function PosRoute() {
  return (
    <PosShell>
      <div className="rounded-lg border border-border p-6">
        <h1 className="text-lg font-semibold">Selling UI arrives in Plan 06</h1>
        <p className="mt-2 text-sm text-muted-foreground">
          The device session, local database, and branch-scoped sync are live. Open{' '}
          <span className="font-mono">#dev/sync</span> to inspect what has synced.
        </p>
      </div>
    </PosShell>
  )
}
