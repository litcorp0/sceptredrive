import { useSyncExternalStore } from 'react'

/**
 * Observable sync status for the POS header (Plan 08 renders it).
 *
 * Deliberately a small store rather than React context: PowerSync emits status
 * changes several times per second during a first sync, and re-rendering the
 * whole tree for each one is wasteful.
 */

export interface SyncStatusSnapshot {
  /** Transport connected to the PowerSync service. */
  online: boolean
  /** At least one full sync completed since the database opened. */
  hasSynced: boolean
  lastSyncedAt: string | null
  /** Initial download or a catch-up stream is running. */
  downloading: boolean
  /** Always null today: the connector has no upload path (Plan 08 adds ours). */
  uploadError: string | null
  /** Last error surfaced by the SDK or the connector, if any. */
  error: string | null
  lastAttemptAt: string | null
}

const initial: SyncStatusSnapshot = {
  online: false,
  hasSynced: false,
  lastSyncedAt: null,
  downloading: false,
  uploadError: null,
  error: null,
  lastAttemptAt: null,
}

let snapshot: SyncStatusSnapshot = initial
const listeners = new Set<() => void>()

export function getSyncStatus(): SyncStatusSnapshot {
  return snapshot
}

export function updateSyncStatus(patch: Partial<SyncStatusSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function resetSyncStatus(): void {
  snapshot = initial
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useSyncStatus(): SyncStatusSnapshot {
  return useSyncExternalStore(subscribe, getSyncStatus, getSyncStatus)
}

/** Maps a PowerSync status event onto our snapshot. */
export function applyPowerSyncStatus(status: {
  connected?: boolean
  hasSynced?: boolean
  lastSyncedAt?: Date | null
  downloading?: boolean
  dataFlowStatus?: { downloading?: boolean }
}): void {
  updateSyncStatus({
    online: status.connected ?? snapshot.online,
    hasSynced: status.hasSynced ?? snapshot.hasSynced,
    downloading: status.downloading ?? status.dataFlowStatus?.downloading ?? snapshot.downloading,
    lastSyncedAt:
      status.lastSyncedAt instanceof Date
        ? status.lastSyncedAt.toISOString()
        : (status.lastSyncedAt ?? snapshot.lastSyncedAt),
    lastAttemptAt: new Date().toISOString(),
  })
}
