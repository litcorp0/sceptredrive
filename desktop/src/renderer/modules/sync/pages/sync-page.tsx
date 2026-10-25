import { useQuery } from '@powersync/react'
import { useEffect, useState } from 'react'
import { ScreenHeader, StatusNote } from '@/components/common'
import { AppHeader } from '@/components/layout'
import { Button } from '@/components/ui/button'
import { httpSyncClient } from '@/lib/api/sync-client'
import type { StaffSession } from '@/lib/auth/staff-session'
import { posRuntimeConfig } from '@/lib/config'
import { createOutboxStore } from '@/lib/outbox/outbox-repository'
import type { OpenShiftSummary, PosIdentityRow } from '@/lib/pos-runtime'
import { usePos } from '@/lib/powersync/provider'
import { useSyncStatus } from '@/lib/powersync/status'
import { navigate } from '@/lib/router'
import { refreshConflicts } from '@/lib/sync/conflicts'
import { useOutboxSummary } from '@/lib/sync/outbox-summary'
import { useUploadStatus } from '@/lib/sync/sync-status-store'
import { ConflictList } from '../components/conflict-list'
import { SyncLog } from '../components/sync-log'

/**
 * `/sync` — the honest, non-blocking sync screen (Plan 08 Task 3).
 *
 * Cashiers may open it to see whether their sales reached the server; managers
 * additionally get Retry on a dead letter. Resolution itself is Phase 8. Nothing
 * on this page can stop the till, and no payload, token, or PII is rendered.
 */

function stamp(iso: string | null): string {
  if (!iso) return 'Never'
  const date = new Date(iso)
  return Number.isNaN(date.getTime()) ? '—' : date.toISOString().replace('T', ' ').slice(0, 16)
}

const PAUSE_TEXT: Record<string, string> = {
  OFFLINE: 'Offline — uploads resume when the network returns',
  AUTH: 'Session expired — sign in again or wait for the token refresh',
  REVOKED: 'This terminal was revoked — enrol it again',
  THROTTLED: 'The server asked us to slow down',
  SERVER: 'The server could not accept the last batch — retrying with backoff',
  NO_SESSION: 'No device session — enrol this terminal',
}

function Card({
  label,
  value,
  detail,
  testId,
}: {
  label: string
  value: string
  detail?: string
  testId?: string
}) {
  return (
    <div className="rounded-lg border border-border bg-card p-4">
      <p className="text-xs font-medium tracking-wide text-muted-foreground uppercase">{label}</p>
      <p className="mt-1 font-mono text-lg font-semibold tabular-nums" data-testid={testId}>
        {value}
      </p>
      {detail ? <p className="mt-1 text-xs text-muted-foreground">{detail}</p> : null}
    </div>
  )
}

export function SyncScreen({
  identity,
  shift,
  staff,
}: {
  identity: PosIdentityRow
  shift: OpenShiftSummary | null
  staff: StaffSession
}) {
  const { db, session, syncNow, sessionState } = usePos()
  const upload = useUploadStatus()
  const download = useSyncStatus()
  const outbox = useOutboxSummary()
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState<string | null>(null)
  const [conflictError, setConflictError] = useState<string | null>(null)
  const high = useQuery<{ high: number; open: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'OPEN' AND severity = 'HIGH' THEN 1 ELSE 0 END), 0) AS high,
       COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open
       FROM sync_conflict_local`,
  )
  const highOpen = high.data?.[0]?.high ?? 0
  const openConflicts = high.data?.[0]?.open ?? 0
  const canRetry = staff.role === 'MANAGER' || staff.role === 'ADMIN'

  async function pullConflicts(): Promise<void> {
    if (!db || !session) return
    try {
      await refreshConflicts(db, httpSyncClient)
      setConflictError(null)
    } catch (error) {
      setConflictError(error instanceof Error ? error.message : 'Conflicts could not be refreshed')
    }
  }

  useEffect(() => {
    void pullConflicts()
    // One fetch on open is enough; the uploader refreshes after each drain.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db, session])

  async function syncNowClicked(): Promise<void> {
    setBusy(true)
    setMessage(null)
    try {
      await syncNow()
      await pullConflicts()
      setMessage('Upload finished. Any remaining rows show their next retry below.')
    } catch (error) {
      setMessage(error instanceof Error ? error.message : 'Sync could not be started')
    } finally {
      setBusy(false)
    }
  }

  async function retry(id: string): Promise<void> {
    if (!db) return
    await createOutboxStore(db).retryDeadLetter(id, new Date().toISOString())
    await syncNowClicked()
  }

  return (
    <div className="min-h-screen bg-background text-foreground">
      <AppHeader
        identity={identity}
        shift={shift}
        staff={staff}
        onLock={() => navigate('pos')}
        lockNote="Back to selling"
      />

      <main className="mx-auto max-w-5xl p-6">
        <ScreenHeader
          title="Sync"
          description={
            <>
              {identity.branchName} · {identity.terminalCode} · app {posRuntimeConfig.appVersion}
            </>
          }
          actions={
            <>
              <Button
                type="button"
                onClick={() => void syncNowClicked()}
                disabled={busy || upload.draining}
                className="h-11"
                data-testid="sync-now"
              >
                {busy || upload.draining ? 'Syncing…' : 'Sync now'}
              </Button>
              <Button
                type="button"
                variant="outline"
                onClick={() => navigate('pos')}
                className="h-11"
                data-testid="back-to-selling"
              >
                Back to selling
              </Button>
            </>
          }
        />

        {upload.pauseReason || sessionState === 'revoked' ? (
          <StatusNote tone="notice" className="mb-3" data-testid="sync-pause">
            {PAUSE_TEXT[upload.pauseReason ?? 'REVOKED'] ?? upload.pauseReason}
            {upload.lastError ? ` — ${upload.lastError}` : ''}
          </StatusNote>
        ) : null}

        {highOpen > 0 ? (
          <StatusNote tone="danger" className="mb-3" data-testid="high-conflict-banner">
            <span className="font-semibold text-foreground">
              {highOpen} high-severity conflict{highOpen === 1 ? '' : 's'}
            </span>{' '}
            need{highOpen === 1 ? 's' : ''} manager review. The sale
            {highOpen === 1 ? ' is' : 's are'} recorded and the till keeps selling.
          </StatusNote>
        ) : null}

        {message ? (
          <StatusNote tone="info" role="status" className="mb-3" data-testid="sync-message">
            {message}
          </StatusNote>
        ) : null}

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Card
            label="Connection"
            value={upload.online ? 'Online' : 'Offline'}
            detail={
              download.online
                ? `PowerSync connected · download ${stamp(download.lastSyncedAt)}`
                : 'PowerSync disconnected; local reads are unaffected'
            }
          />
          <Card
            label="Last upload"
            value={upload.lastSuccessAt ? stamp(upload.lastSuccessAt) : 'Never'}
            detail={upload.draining ? 'Draining now…' : 'Each batch is acknowledged once'}
          />
          <Card
            label="Waiting"
            value={String(outbox.pending)}
            testId="sync-waiting-count"
            detail={`Batch size ${session?.config.pos.syncBatchSize ?? '—'} · oldest first`}
          />
          <Card
            label="Needs review"
            value={String(outbox.failed)}
            detail={`${openConflicts} open conflict${openConflicts === 1 ? '' : 's'} cached locally`}
          />
        </div>

        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Outbox</h2>
            <p className="text-xs text-muted-foreground">
              Newest first. Acknowledged rows are pruned after 30 days.
            </p>
          </div>
          {db ? <SyncLog canRetry={canRetry} onRetry={retry} /> : null}
        </section>

        <section className="mt-6">
          <div className="mb-2 flex items-baseline justify-between">
            <h2 className="text-sm font-semibold">Conflicts</h2>
            <Button
              type="button"
              variant="link"
              onClick={() => void pullConflicts()}
              className="h-11 px-2 text-xs text-muted-foreground"
              data-testid="refresh-conflicts"
            >
              Refresh
            </Button>
          </div>
          {conflictError ? (
            <StatusNote tone="notice" className="mb-2">
              {conflictError}
            </StatusNote>
          ) : null}
          <ConflictList />
        </section>

        <p className="mt-6 text-xs text-muted-foreground">
          Syncing never blocks a sale. Offline sales wait here and upload in order when the network
          returns; a dead letter needs a manager and never drops the sale.
        </p>
      </main>
    </div>
  )
}
