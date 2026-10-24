import { useQuery } from '@powersync/react'
import { formatTime } from '@sceptre/shared'
import { usePos } from '../../lib/powersync/provider'
import { useSyncStatus } from '../../lib/powersync/status'
import { navigate } from '../../lib/router'
import { useOutboxSummary } from '../../lib/sync/outbox-summary'
import { useUploadStatus } from '../../lib/sync/sync-status-store'

/**
 * The always-visible sync badge (Plan 08 Task 3).
 *
 * It is a button, never a modal: tapping it opens the sync screen, and nothing
 * here can block or slow down a sale. Colour is driven by what a cashier can act
 * on — pending work, being offline, or a dead letter/HIGH conflict.
 */

type BadgeState = 'action' | 'offline' | 'pending' | 'synced' | 'idle'

const STYLES: Record<BadgeState, string> = {
  action: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  offline: 'bg-red-50 text-red-700 ring-1 ring-red-200',
  pending: 'bg-amber-50 text-amber-800 ring-1 ring-amber-200',
  synced: 'bg-emerald-50 text-emerald-700 ring-1 ring-emerald-200',
  idle: 'bg-muted text-muted-foreground ring-1 ring-border',
}

function shortTime(iso: string | null): string {
  if (!iso) return '—'
  return formatTime(iso)
}

export function SyncBadge() {
  const { sessionState } = usePos()
  const upload = useUploadStatus()
  const download = useSyncStatus()
  const outbox = useOutboxSummary()
  const conflicts = useQuery<{ high: number; open: number }>(
    `SELECT
       COALESCE(SUM(CASE WHEN status = 'OPEN' AND severity = 'HIGH' THEN 1 ELSE 0 END), 0) AS high,
       COALESCE(SUM(CASE WHEN status = 'OPEN' THEN 1 ELSE 0 END), 0) AS open
       FROM sync_conflict_local`,
  )

  const highOpen = conflicts.data?.[0]?.high ?? 0
  const pending = outbox.pending
  const needsAction = outbox.failed > 0 || highOpen > 0 || upload.deadLetters > 0
  const offline = !upload.online || upload.pauseReason === 'OFFLINE'
  const revoked = upload.pauseReason === 'REVOKED'
  const auth = upload.pauseReason === 'AUTH'

  let state: BadgeState
  let label: string
  if (sessionState === 'revoked') {
    // Revocation can be discovered by the sync credential fetch before (or
    // instead of) an upload, so the badge owns this state too.
    state = 'action'
    label = 'Enrol again'
  } else if (needsAction) {
    state = 'action'
    label = highOpen > 0 ? `${highOpen} conflict${highOpen === 1 ? '' : 's'}` : 'Action needed'
  } else if (revoked) {
    state = 'action'
    label = 'Enrol again'
  } else if (auth) {
    state = 'action'
    label = 'Sign in again'
  } else if (offline) {
    state = 'offline'
    label = pending > 0 ? `Offline — ${pending} pending` : 'Offline'
  } else if (pending > 0) {
    state = 'pending'
    label = `${pending} pending`
  } else if (upload.lastSuccessAt) {
    state = 'synced'
    label = `Synced ${shortTime(upload.lastSuccessAt)}`
  } else if (download.lastSyncedAt) {
    state = 'synced'
    label = `Downloaded ${shortTime(download.lastSyncedAt)}`
  } else {
    state = 'idle'
    label = 'Waiting to sync'
  }

  const detail = upload.lastError
    ? `${label} — ${upload.lastError}`
    : `${label} · ${download.online ? 'PowerSync connected' : 'PowerSync offline'}`

  return (
    <button
      type="button"
      onClick={() => navigate('pos/sync')}
      data-testid="sync-badge"
      data-state={state}
      title={detail}
      aria-label={`Sync status: ${label}. Open sync details`}
      className={`rounded-full px-2.5 py-1 text-xs font-medium transition-colors ${STYLES[state]} ${
        state === 'pending' && upload.draining ? 'animate-pulse' : ''
      }`}
    >
      {label}
    </button>
  )
}
