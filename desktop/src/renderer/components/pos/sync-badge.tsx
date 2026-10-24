import { useQuery } from '@powersync/react'
import { formatTime } from '@sceptre/shared'
import { Check, Clock, CloudOff, type LucideIcon, TriangleAlert, Upload } from 'lucide-react'
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
 *
 * The badge sits on the charcoal fascia, where the light-mode semantic colours
 * are too dark to read as text: the colour is a dot, backed by an icon and the
 * word, so the state never depends on colour alone.
 */

type BadgeState = 'action' | 'offline' | 'pending' | 'synced' | 'idle'

const DOT: Record<BadgeState, string> = {
  action: 'bg-danger',
  offline: 'bg-danger',
  pending: 'bg-warn',
  synced: 'bg-ok',
  idle: 'bg-topbar-muted',
}

const ICON: Record<BadgeState, LucideIcon> = {
  action: TriangleAlert,
  offline: CloudOff,
  pending: Upload,
  synced: Check,
  idle: Clock,
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
  /*
   * A terminal is offline when the uploader says so, **or** when it has synced before and the
   * PowerSync transport is down now. Without the second clause a till that is launched with no
   * network reports `Downloaded 14:02` from its persisted state and looks current while it is
   * not — the cashier would keep believing stock and prices are fresh. The `lastSyncedAt` guard
   * keeps a first-ever boot from flashing "Offline" before the first connection is attempted.
   */
  const transportDown = download.lastSyncedAt !== null && !download.online
  const offline = !upload.online || upload.pauseReason === 'OFFLINE' || transportDown
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

  const Icon = ICON[state]

  return (
    <button
      type="button"
      onClick={() => navigate('pos/sync')}
      data-testid="sync-badge"
      data-state={state}
      title={detail}
      aria-label={`Sync status: ${label}. Open sync details`}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border border-white/15 bg-white/10 px-2.5 py-1 text-xs font-medium text-topbar-foreground transition-colors hover:bg-white/15 ${
        state === 'pending' && upload.draining ? 'animate-pulse' : ''
      }`}
    >
      <span aria-hidden="true" className={`size-1.5 shrink-0 rounded-full ${DOT[state]}`} />
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      <span>{label}</span>
    </button>
  )
}
