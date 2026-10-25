import { useQuery } from '@powersync/react'
import type { PowerSyncDatabase } from '@powersync/web'
import { useEffect, useState } from 'react'
import { posConnector } from '../../lib/powersync/connector'
import { usePos } from '../../lib/powersync/provider'
import { SYNCED_TABLES, type SyncedTable } from '../../lib/powersync/schema'
import type { SchemaMigrationReport } from '../../lib/powersync/schema-migration'
import { resolveDatabaseKey } from '../../lib/powersync/spike'
import { useSyncStatus } from '../../lib/powersync/status'

/**
 * Phase 6 development view (`#dev/sync`).
 *
 * Shows what actually landed on the terminal: row counts per synced table, the
 * local config snapshot, and the live sync status. It only reads local data —
 * it is a diagnostic, not an operator screen (Plan 08 builds the real one).
 */

/**
 * `refreshKey` re-runs the counts after each completed sync: the local database
 * changes underneath a one-shot query, and a diagnostic that never refreshes
 * looks like "sync did nothing".
 */
function useTableCounts(db: PowerSyncDatabase | null, refreshKey: string | null) {
  const [counts, setCounts] = useState<Record<string, number>>({})

  useEffect(() => {
    if (!db) return
    let cancelled = false

    const count = async () => {
      const next: Record<string, number> = {}
      for (const table of SYNCED_TABLES) {
        const row = await db.getOptional<{ total: number }>(
          `SELECT count(*) AS total FROM "${table}"`,
        )
        next[table] = row?.total ?? 0
      }
      if (!cancelled) setCounts(next)
    }

    void count()
    return () => {
      cancelled = true
    }
  }, [db, refreshKey])

  return counts
}

function CountRow({ table, label, value }: { table: SyncedTable; label: string; value?: number }) {
  return (
    <div
      className="flex items-baseline justify-between border-b border-border py-1.5 text-sm last:border-0"
      data-testid={`count-${table.replace(/_/g, '-')}`}
    >
      <span className="text-muted-foreground">{label}</span>
      <span className="font-mono text-xs" data-count={value ?? 0}>
        {value ?? 0}
      </span>
    </div>
  )
}

/**
 * P10-D15 — the local schema change, proven on a database that already holds
 * sales, from inside the real renderer.
 *
 * It lives on the diagnostics page rather than a screen of its own so
 * `desktop/test/e2e/schema-migration.mjs` can drive it through the real
 * `app://` renderer, worker, and VFS (`#spike` is the same pattern). It opens
 * its own throw-away database file, so the terminal's database is never touched.
 */
function SchemaMigrationProof() {
  const [report, setReport] = useState<SchemaMigrationReport | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [running, setRunning] = useState(false)

  const run = async () => {
    setRunning(true)
    setError(null)
    try {
      // Loaded on demand: the proof's fixtures and previous schema have no place
      // in the bundle a till loads to sell.
      const { runSchemaMigrationProof } = await import('../../lib/powersync/schema-migration')
      const encryptionKey = await resolveDatabaseKey()
      setReport(await runSchemaMigrationProof({ encryptionKey }))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setRunning(false)
    }
  }

  return (
    <section className="mt-6 rounded-lg border border-border p-5" data-testid="schema-migration">
      <h2 className="mb-1 text-sm font-semibold">Local schema migration</h2>
      <p className="mb-3 text-sm text-muted-foreground">
        Opens a database with the previous schema, writes a day of trading into it, reopens it with
        the schema this build ships, and checks that every sale, line, tender, cash movement, and
        pending upload still reads and that the home query plans through the new index.
      </p>
      <button
        type="button"
        data-testid="run-schema-migration"
        disabled={running}
        className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted disabled:opacity-60"
        onClick={() => {
          void run()
        }}
      >
        {running ? 'Running…' : 'Run schema migration proof'}
      </button>
      {error ? (
        <p data-testid="schema-migration-error" className="mt-3 text-sm text-destructive">
          {error}
        </p>
      ) : null}
      {report ? (
        <>
          <p
            data-testid="schema-migration-ok"
            className={`mt-3 text-sm font-semibold ${report.ok ? 'text-emerald-600' : 'text-destructive'}`}
          >
            {report.ok ? 'OK' : 'FAIL'}
          </p>
          <pre
            data-testid="schema-migration-report"
            className="mt-2 max-h-72 overflow-auto rounded-md bg-muted p-3 font-mono text-xs"
          >
            {JSON.stringify(report, null, 2)}
          </pre>
        </>
      ) : null}
    </section>
  )
}

export function DevSyncRoute() {
  const { db } = usePos()

  if (!db) {
    return (
      <main className="min-h-screen bg-background p-8 text-foreground">
        <h1 className="text-2xl font-semibold">Opening local database…</h1>
      </main>
    )
  }

  return <DevSyncPanel database={db} />
}

function DevSyncPanel({ database }: { database: PowerSyncDatabase }) {
  const { session, sessionState } = usePos()
  const status = useSyncStatus()
  const counts = useTableCounts(database, status.lastSyncedAt)
  const local = useQuery<{ id: string; branch_code: string | null; terminal_code: string | null }>(
    'SELECT id, branch_code, terminal_code FROM pos_config WHERE id = ?',
    ['current'],
  )

  return (
    <main className="min-h-screen bg-background p-8 text-foreground">
      <header className="mb-6 flex items-start justify-between">
        <div>
          <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">
            Phase 6 diagnostics
          </p>
          <h1 className="mt-1 text-2xl font-semibold">
            Sync status{' '}
            <span
              data-testid="sync-online"
              className={status.online ? 'text-emerald-600' : 'text-muted-foreground'}
            >
              {status.online ? 'online' : 'offline'}
            </span>
          </h1>
        </div>
        <div className="text-right text-sm">
          <p data-testid="sync-has-synced" className="font-mono text-xs">
            hasSynced={String(status.hasSynced)}
          </p>
          <p data-testid="session-state" className="font-mono text-xs">
            session={sessionState}
          </p>
        </div>
      </header>

      {status.error ? (
        <p
          data-testid="sync-error"
          className="mb-4 rounded-md border border-destructive/40 bg-destructive/5 px-3 py-2 text-sm text-destructive"
        >
          {status.error}
        </p>
      ) : null}

      <div className="grid gap-6 lg:grid-cols-2">
        <section className="rounded-lg border border-border p-5" data-testid="synced-tables">
          <h2 className="mb-3 text-sm font-semibold">Synced rows</h2>
          <CountRow table="product" label="Products" value={counts.product} />
          <CountRow table="barcode" label="Barcodes" value={counts.barcode} />
          <CountRow table="product_price" label="Branch prices" value={counts.product_price} />
          <CountRow table="stock_level" label="Stock levels" value={counts.stock_level} />
          <CountRow table="customer" label="Customers" value={counts.customer} />
          <CountRow table="credit_profile" label="Credit profiles" value={counts.credit_profile} />
          <CountRow
            table="loyalty_account"
            label="Loyalty accounts"
            value={counts.loyalty_account}
          />
          <CountRow table="loyalty_lot" label="Loyalty lots" value={counts.loyalty_lot} />
        </section>

        <section className="rounded-lg border border-border p-5">
          <h2 className="mb-3 text-sm font-semibold">Terminal</h2>
          <div className="flex items-baseline justify-between border-b border-border py-1.5 text-sm">
            <span className="text-muted-foreground">Branch</span>
            <span className="font-mono text-xs" data-testid="config-branch">
              {local.data?.[0]?.branch_code ?? '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-b border-border py-1.5 text-sm">
            <span className="text-muted-foreground">Terminal</span>
            <span className="font-mono text-xs" data-testid="config-terminal">
              {local.data?.[0]?.terminal_code ?? '—'}
            </span>
          </div>
          <div className="flex items-baseline justify-between border-b border-border py-1.5 text-sm">
            <span className="text-muted-foreground">Device</span>
            <span className="font-mono text-xs">{session?.deviceId.slice(0, 8) ?? '—'}</span>
          </div>
          <div className="flex items-baseline justify-between py-1.5 text-sm">
            <span className="text-muted-foreground">Last synced</span>
            <span className="font-mono text-xs" data-testid="last-synced">
              {status.lastSyncedAt ?? 'never'}
            </span>
          </div>
          <div className="mt-4 flex gap-2">
            <button
              type="button"
              data-testid="go-offline"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              onClick={() => {
                void database.disconnect()
              }}
            >
              Go offline
            </button>
            <button
              type="button"
              data-testid="reconnect"
              className="rounded-md border border-border px-3 py-1.5 text-sm font-medium hover:bg-muted"
              onClick={() => {
                void database.disconnect().then(() => database.connect(posConnector))
              }}
            >
              Reconnect
            </button>
          </div>
        </section>
      </div>

      <SchemaMigrationProof />
    </main>
  )
}
