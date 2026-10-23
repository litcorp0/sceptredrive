import { useSyncExternalStore } from 'react'

/**
 * Uploader-owned status for the POS header and `/sync` screen (Plan 08 Task 3).
 *
 * Kept separate from the PowerSync download status so a download problem and an
 * upload problem are both visible and never confused. Deliberately a small
 * external store: the 15-second timer and every batch update it, and a context
 * re-render of the whole shell would be wasteful.
 */

export type UploadPauseReason =
  | 'OFFLINE'
  | 'AUTH'
  | 'REVOKED'
  | 'THROTTLED'
  | 'SERVER'
  | 'NO_SESSION'
  | null

export interface UploadStatusSnapshot {
  /** `navigator.onLine !== false`; a hint, not proof of reachability. */
  online: boolean
  draining: boolean
  /** Rows still owed to the server (pending + in_flight). */
  pending: number
  deadLetters: number
  /** Last batch that reached at least one ACK (persisted across restarts). */
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  pauseReason: UploadPauseReason
  /** Human text only; never a payload, token, receipt line, or customer PII. */
  lastError: string | null
}

const initial: UploadStatusSnapshot = {
  online: true,
  draining: false,
  pending: 0,
  deadLetters: 0,
  lastSuccessAt: null,
  lastAttemptAt: null,
  pauseReason: null,
  lastError: null,
}

let snapshot: UploadStatusSnapshot = initial
const listeners = new Set<() => void>()

export function getUploadStatus(): UploadStatusSnapshot {
  return snapshot
}

export function setUploadStatus(patch: Partial<UploadStatusSnapshot>): void {
  snapshot = { ...snapshot, ...patch }
  for (const listener of listeners) listener()
}

export function resetUploadStatus(): void {
  snapshot = initial
  for (const listener of listeners) listener()
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener)
  return () => listeners.delete(listener)
}

export function useUploadStatus(): UploadStatusSnapshot {
  return useSyncExternalStore(subscribe, getUploadStatus, getUploadStatus)
}
