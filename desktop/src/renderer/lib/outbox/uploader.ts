import type { SyncClient } from '../api/sync-client'
import type { UploadItemResult } from '../api/types'
import { uuidv7 } from '../id'
import type { UploadStatusSnapshot } from '../sync/sync-status-store'
import { subscribeOutboxChanges } from './outbox-events'
import type { OutboxStore } from './outbox-repository'
import {
  backoffDelay,
  errorSummary,
  isRetryableShape,
  type OutboxRow,
  RETRY_AFTER_CAP_MS,
  toUploadTransaction,
} from './outbox-types'

/**
 * The outbox uploader (Plan 08 Task 2).
 *
 * Drains one terminal's queue in strict FIFO order, one server transaction per
 * item, until the queue is empty. A crash at any point is safe: rows are marked
 * `in_flight` before the request, reset on the next drain, and the server's
 * `(terminal_id, client_transaction_id)` key turns the replay into `REPLAYED`.
 *
 * The uploader never touches the sale path synchronously. Services fire an
 * outbox-change event; this module debounces, schedules, and backs off.
 */

export interface UploaderDevice {
  deviceId: string
  terminalId: string
}

export interface UploaderDeps {
  store: OutboxStore
  client: SyncClient
  /** Null while signed out/revoked; no request is made without it. */
  device: () => UploaderDevice | null
  batchSize: () => number
  /** `navigator.onLine !== false`: a strong offline hint, not proof of reach. */
  online: () => boolean
  now?: () => Date
  random?: () => number
  onStatus: (patch: Partial<UploadStatusSnapshot>) => void
  /** Routes a revoked device back to enrolment. Must be idempotent. */
  onRevoked: () => Promise<void>
  /** Refresh the conflict cache after results that changed server state. */
  afterAck?: (results: UploadItemResult[]) => Promise<void>
  log?: (message: string) => void
  /** Test seam for timers; defaults to the window/global timer functions. */
  setTimeout?: (handler: () => void, ms: number) => ReturnType<typeof setTimeout>
  clearTimeout?: (handle: ReturnType<typeof setTimeout>) => void
  setInterval?: (handler: () => void, ms: number) => ReturnType<typeof setInterval>
  clearInterval?: (handle: ReturnType<typeof setInterval>) => void
}

export type DrainStopReason =
  | 'EMPTY'
  | 'OFFLINE'
  | 'NO_SESSION'
  | 'PAUSED'
  | 'AUTH'
  | 'REVOKED'
  | 'THROTTLED'
  | 'SERVER'
  | 'BAD_REQUEST'
  | 'AMBIGUOUS'
  | 'STOPPED'

export interface DrainResult {
  acked: number
  rejected: number
  stopReason: DrainStopReason
}

export interface Uploader {
  drain(options?: { manual?: boolean }): Promise<DrainResult>
  syncNow(): Promise<DrainResult>
  schedule(delayMs?: number): void
  start(): void
  stop(): void
  isDraining(): boolean
}

const AUTH_PAUSE_MS = 60_000
const DEFAULT_THROTTLE_MS = 60_000
const AMBIGUOUS_RETRY_MS = 2_000
const MAX_LOOPS = 100
const MAX_BATCH = 50

/**
 * One drain at a time **per app process**, not just per uploader instance.
 * A route transition can briefly have two providers/uploaders over the same
 * database; the server would replay duplicates harmlessly, but there is no
 * reason to send them.
 */
let activeDrain: Promise<DrainResult> | null = null

function emptyResult(stopReason: DrainStopReason): DrainResult {
  return { acked: 0, rejected: 0, stopReason }
}

function clampBatch(size: number): number {
  if (!Number.isFinite(size)) return 25
  return Math.min(MAX_BATCH, Math.max(1, Math.floor(size)))
}

export function createUploader(deps: UploaderDeps): Uploader {
  const nowDate = deps.now ?? (() => new Date())
  const random = deps.random ?? Math.random
  const setTimer = deps.setTimeout ?? ((handler, ms) => setTimeout(handler, ms))
  const clearTimer = deps.clearTimeout ?? ((handle) => clearTimeout(handle))
  const setIntervalFn = deps.setInterval ?? ((handler, ms) => setInterval(handler, ms))
  const clearIntervalFn = deps.clearInterval ?? ((handle) => clearInterval(handle))
  const log = deps.log ?? (() => {})

  let stopped = false
  let revoked = false
  let drainPromise: Promise<DrainResult> | null = null
  let debounce: ReturnType<typeof setTimeout> | null = null
  let interval: ReturnType<typeof setInterval> | null = null
  let pausedUntil = 0
  let unsubscribers: Array<() => void> = []
  let pendingCount = 0

  const clockMs = () => nowDate().getTime()

  const isBrowser = typeof window !== 'undefined' && typeof window.addEventListener === 'function'

  async function refreshCounts(): Promise<void> {
    try {
      const counts = await deps.store.counts()
      pendingCount = counts.pending
      deps.onStatus({ pending: counts.pending, deadLetters: counts.deadLetters })
    } catch (error) {
      log(`outbox: counts failed (${error instanceof Error ? error.name : 'error'})`)
    }
  }

  function checkOnline(): boolean {
    try {
      return deps.online()
    } catch {
      return true
    }
  }

  function schedule(delayMs = 200): void {
    if (stopped) return
    if (revoked) return
    if (debounce) clearTimer(debounce)
    const wait =
      pausedUntil && pausedUntil > clockMs() ? Math.max(delayMs, pausedUntil - clockMs()) : delayMs
    debounce = setTimer(() => {
      debounce = null
      void drain()
    }, wait)
  }

  async function start(): Promise<void> {
    stopped = false
    revoked = false
    pausedUntil = 0
    deps.onStatus({ online: checkOnline() })

    const last = await deps.store.readLastSuccessAt().catch(() => null)
    if (stopped) return
    if (last) deps.onStatus({ lastSuccessAt: last })

    // A crash mid-request leaves in_flight rows; the server will replay them.
    const reset = await deps.store.resetInFlight(nowDate().toISOString()).catch(() => 0)
    if (stopped) return
    if (reset > 0) log(`outbox: reset ${reset} interrupted row(s) to pending`)

    // Keep the local queue small without losing the audit trail for a month.
    const cutoff = new Date(nowDate().getTime() - 30 * 24 * 60 * 60 * 1000).toISOString()
    const pruned = await deps.store.pruneAcked(cutoff).catch(() => 0)
    if (stopped) return
    if (pruned > 0) log(`outbox: pruned ${pruned} acknowledged row(s)`)

    await refreshCounts()
    if (stopped) return

    unsubscribers.push(
      subscribeOutboxChanges(() => {
        void refreshCounts().then(() => schedule())
      }),
    )

    if (isBrowser) {
      const onOnline = () => {
        deps.onStatus({ online: true, pauseReason: null })
        schedule(0)
      }
      const onOffline = () => {
        deps.onStatus({ online: false, pauseReason: 'OFFLINE' })
      }
      window.addEventListener('online', onOnline)
      window.addEventListener('offline', onOffline)
      unsubscribers.push(() => {
        window.removeEventListener('online', onOnline)
        window.removeEventListener('offline', onOffline)
      })
    }

    if (stopped) return

    // A pending queue gets a heartbeat even if an event was missed.
    interval = setIntervalFn(() => {
      if (stopped || revoked) return
      void refreshCounts().then(() => {
        if (getPending() > 0) schedule(0)
      })
    }, 15_000)

    if (getPending() > 0) schedule(0)
  }

  function getPending(): number {
    return pendingCount
  }

  function stop(): void {
    stopped = true
    if (debounce) clearTimer(debounce)
    if (interval) clearIntervalFn(interval)
    debounce = null
    interval = null
    for (const unsubscribe of unsubscribers) unsubscribe()
    unsubscribers = []
  }

  async function runDrain(manual: boolean): Promise<DrainResult> {
    const online = checkOnline()
    deps.onStatus({ online })

    if (!online && !manual) {
      deps.onStatus({ pauseReason: 'OFFLINE', draining: false })
      return emptyResult('OFFLINE')
    }

    const device = deps.device()
    if (!device) {
      deps.onStatus({ pauseReason: 'NO_SESSION', draining: false })
      return emptyResult('NO_SESSION')
    }

    if (!manual && pausedUntil > clockMs()) {
      return emptyResult('PAUSED')
    }
    if (manual) pausedUntil = 0

    deps.onStatus({
      draining: true,
      lastAttemptAt: nowDate().toISOString(),
      pauseReason: null,
      lastError: null,
    })

    let acked = 0
    let rejected = 0
    let ackedAny = false
    let refreshed = false
    const refreshResults: UploadItemResult[] = []

    try {
      // Covers rows left in_flight by a crash and an ambiguous response.
      await deps.store.resetInFlight(nowDate().toISOString())
      await refreshCounts()

      for (let loop = 0; loop < MAX_LOOPS; loop += 1) {
        if (stopped) return { acked, rejected, stopReason: 'STOPPED' }

        const limit = clampBatch(deps.batchSize())
        const rows = await deps.store.nextBatch(limit, nowDate().toISOString())
        if (rows.length === 0) {
          return { acked, rejected, stopReason: 'EMPTY' }
        }

        // A corrupt row can never be uploaded; dead-letter it and keep the queue
        // moving. It is an integrity failure, not a sale to silently drop.
        const corrupt = rows.filter((row) => row.payload === null)
        if (corrupt.length > 0) {
          await deps.store.deadLetterBatch(
            corrupt,
            'INVALID_PAYLOAD',
            'The queued transaction payload is corrupt',
            nowDate().toISOString(),
          )
          rejected += corrupt.length
        }

        const valid = rows.filter((row) => row.payload !== null)
        if (valid.length === 0) {
          if (rows.length < limit) return { acked, rejected, stopReason: 'EMPTY' }
          continue
        }

        const request = {
          batchId: uuidv7(),
          deviceId: device.deviceId,
          terminalId: device.terminalId,
          transactions: valid.map(toUploadTransaction),
        }

        let response: Awaited<ReturnType<SyncClient['upload']>>
        try {
          response = await deps.client.upload(request)
        } catch (error) {
          return handleUploadError(error, valid, acked, rejected)
        }

        if (!Array.isArray(response.results)) {
          deps.onStatus({
            lastError: 'The server returned an unreadable batch; retrying safely',
            pauseReason: 'SERVER',
          })
          schedule(AMBIGUOUS_RETRY_MS)
          return { acked, rejected, stopReason: 'AMBIGUOUS' }
        }

        const byId = new Map<string, UploadItemResult>()
        for (const result of response.results) {
          byId.set(result.clientTransactionId, result)
        }

        const missing = valid.filter((row) => !byId.has(row.clientTransactionId))
        if (missing.length > 0) {
          // The server applied an unknown subset. Leave the whole batch claimed
          // (in_flight); the next drain resets and replays safely.
          deps.onStatus({
            lastError: 'The server returned an incomplete batch; retrying safely',
            pauseReason: 'SERVER',
          })
          log(`outbox: ambiguous batch (${missing.length} result(s) missing)`)
          schedule(AMBIGUOUS_RETRY_MS)
          return { acked, rejected, stopReason: 'AMBIGUOUS' }
        }

        const results: UploadItemResult[] = []
        for (const row of valid) {
          const result = byId.get(row.clientTransactionId)
          if (!result) break
          results.push(result)
          const at = nowDate().toISOString()
          if (result.status === 'APPLIED' || result.status === 'REPLAYED') {
            await deps.store.markAcked(row, result, at)
            acked += 1
            ackedAny = true
          } else if (result.status === 'REJECTED') {
            await deps.store.markRejected(row, result, at)
            rejected += 1
          } else {
            // Unknown status: leave this row and the rest for the next drain.
            log('outbox: unknown server status')
            schedule(AMBIGUOUS_RETRY_MS)
            return { acked, rejected, stopReason: 'AMBIGUOUS' }
          }
        }

        if (results.length > 0) {
          refreshResults.push(...results)
          refreshed = true
        }

        await refreshCounts()
        if (rows.length < limit) {
          return { acked, rejected, stopReason: 'EMPTY' }
        }
        // A full batch was consumed; keep going immediately.
      }

      return { acked, rejected, stopReason: 'EMPTY' }
    } finally {
      if (refreshed && deps.afterAck) {
        await deps.afterAck(refreshResults).catch((error: unknown) => {
          log(`outbox: conflict refresh failed (${error instanceof Error ? error.name : 'error'})`)
        })
      }
      const finishedAt = nowDate().toISOString()
      if (ackedAny) {
        deps.onStatus({
          lastSuccessAt: finishedAt,
          pauseReason: null,
          lastError: null,
          draining: false,
        })
        await deps.store.writeLastSuccessAt(finishedAt).catch(() => {})
      } else {
        deps.onStatus({ draining: false })
      }
      await refreshCounts()
    }
  }

  async function handleUploadError(
    error: unknown,
    rows: OutboxRow[],
    acked: number,
    rejected: number,
  ): Promise<DrainResult> {
    const shape = isRetryableShape(error) ? error : {}
    const status = typeof shape.status === 'number' ? shape.status : 0
    const code = typeof shape.code === 'string' ? shape.code : 'UPLOAD_FAILED'
    const message =
      typeof shape.message === 'string' ? shape.message : 'The upload could not be sent'
    const at = nowDate().toISOString()

    if (status === 401) {
      // The shared client already used its one refresh; the device needs a new
      // session. Keep every row and retry after a pause.
      await deps.store.releaseRows(rows, at).catch(() => {})
      pausedUntil = clockMs() + AUTH_PAUSE_MS
      deps.onStatus({
        pauseReason: 'AUTH',
        lastError: 'Session expired — waiting for a fresh sign-in',
      })
      schedule(AUTH_PAUSE_MS)
      return { acked, rejected, stopReason: 'AUTH' }
    }

    if (status === 403) {
      await deps.store.releaseRows(rows, at).catch(() => {})
      revoked = true
      pausedUntil = Number.POSITIVE_INFINITY
      deps.onStatus({
        pauseReason: 'REVOKED',
        lastError: 'This terminal was revoked. Enrol it again to resume syncing.',
      })
      await deps.onRevoked().catch(() => {})
      return { acked, rejected, stopReason: 'REVOKED' }
    }

    if (status === 429) {
      const delay =
        typeof shape.retryAfterSeconds === 'number'
          ? Math.min(Math.max(0, shape.retryAfterSeconds) * 1_000, RETRY_AFTER_CAP_MS)
          : DEFAULT_THROTTLE_MS
      pausedUntil = clockMs() + delay
      await deps.store
        .delayRows(rows, new Date(clockMs() + delay).toISOString(), at)
        .catch(() => {})
      deps.onStatus({
        pauseReason: 'THROTTLED',
        lastError: 'The server asked us to slow down; retrying shortly',
      })
      schedule(delay)
      return { acked, rejected, stopReason: 'THROTTLED' }
    }

    if (status >= 400 && status < 500 && status !== 408) {
      await deps.store.deadLetterBatch(rows, code, message, at).catch(() => {})
      deps.onStatus({
        pauseReason: null,
        lastError: errorSummary(code, message),
      })
      return { acked, rejected: rejected + rows.length, stopReason: 'BAD_REQUEST' }
    }

    // Network, timeout, or 5xx: exponential backoff with jitter.
    const attempts = rows.reduce((max, row) => Math.max(max, row.attempts), 0)
    const delay = backoffDelay(attempts, random)
    await deps.store.backoffRows(rows, delay, code, message, at).catch(() => {})
    deps.onStatus({
      pauseReason: 'SERVER',
      lastError: errorSummary(code, message),
    })
    schedule(delay)
    return { acked, rejected, stopReason: 'SERVER' }
  }

  function drain(options: { manual?: boolean } = {}): Promise<DrainResult> {
    if (activeDrain) return activeDrain
    const promise = runDrain(options.manual === true).finally(() => {
      if (activeDrain === promise) activeDrain = null
      if (drainPromise === promise) drainPromise = null
    })
    activeDrain = promise
    drainPromise = promise
    return promise
  }

  return {
    drain,
    syncNow: () => {
      pausedUntil = 0
      return drain({ manual: true })
    },
    schedule,
    start: () => {
      void start()
    },
    stop,
    isDraining: () => drainPromise !== null,
  }
}
