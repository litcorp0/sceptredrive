import { PowerSyncContext } from '@powersync/react'
import type { PowerSyncDatabase } from '@powersync/web'
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
} from 'react'
import { httpSyncClient } from '../api/sync-client'
import type { PosSessionPayload } from '../api/types'
import {
  ensureSession,
  getCurrentSession,
  initSession,
  markDeviceRevoked,
  type SessionState,
  subscribeSession,
} from '../auth/session'
import { createOutboxStore } from '../outbox/outbox-repository'
import { createUploader, type Uploader } from '../outbox/uploader'
import { refreshConflicts } from '../sync/conflicts'
import { resetUploadStatus, setUploadStatus } from '../sync/sync-status-store'
import { posConnector } from './connector'
import { getDatabase } from './database'
import { applyPowerSyncStatus, resetSyncStatus, updateSyncStatus } from './status'

interface PosContextValue {
  db: PowerSyncDatabase | null
  session: PosSessionPayload | null
  sessionState: SessionState
  /** Manual "Sync now": bypasses the online hint and drains immediately. */
  syncNow: () => Promise<void>
}

const PosContext = createContext<PosContextValue>({
  db: null,
  session: null,
  sessionState: 'unknown',
  syncNow: async () => {},
})

/**
 * Opens the encrypted local database, restores the device session, and connects
 * to PowerSync once. Wrapped in a provider rather than module scope so React can
 * render a "starting" state and errors stay visible.
 */
export function PosProvider({ children }: { children: ReactNode }) {
  const [db, setDb] = useState<PowerSyncDatabase | null>(null)
  const [session, setSession] = useState<PosSessionPayload | null>(null)
  const [sessionState, setSessionState] = useState<SessionState>('unknown')
  const uploaderRef = useRef<Uploader | null>(null)

  useEffect(() => {
    initSession()
    const unsubscribe = subscribeSession((nextSession, nextState) => {
      setSession(nextSession)
      setSessionState(nextState)
    })

    let cancelled = false
    let unregisterListener: (() => void) | undefined

    void (async () => {
      const database = await getDatabase()
      if (cancelled) return

      unregisterListener = database.registerListener({
        statusChanged: (status) => {
          applyPowerSyncStatus(status)
          // A successful download means the network is back; give the uploader
          // an extra nudge beyond its own timer.
          if (status.connected && status.lastSyncedAt) uploaderRef.current?.schedule()
        },
      })
      setDb(database)

      const active = await ensureSession()
      if (active && !cancelled) {
        await database.connect(posConnector)
      }
    })().catch((error: unknown) => {
      updateSyncStatus({
        error: error instanceof Error ? error.message : 'The local database failed to open',
      })
    })

    return () => {
      cancelled = true
      unsubscribe()
      unregisterListener?.()
      resetSyncStatus()
    }
  }, [])

  // A session adopted after enrolment (or after a refresh) starts syncing too.
  useEffect(() => {
    if (!db || !session || db.currentStatus?.connected) return
    void db.connect(posConnector).catch((error: unknown) => {
      updateSyncStatus({
        error: error instanceof Error ? error.message : 'Could not connect to sync',
      })
    })
  }, [db, session])

  /**
   * An offline start leaves the session `unknown` and PowerSync disconnected.
   * When the network returns (or a terminal that booted without the API becomes
   * reachable), re-establish the device session and connect; the session effect
   * above then starts the uploader. Without this, a terminal that launched
   * offline could never upload until the app restarted.
   */
  useEffect(() => {
    if (!db) return
    const database = db
    let cancelled = false

    async function resume() {
      if (getCurrentSession()) return
      const active = await ensureSession()
      if (cancelled || !active) return
      if (!database.currentStatus?.connected) {
        await database.connect(posConnector).catch((error: unknown) => {
          updateSyncStatus({
            error: error instanceof Error ? error.message : 'Could not connect to sync',
          })
        })
      }
    }

    const onOnline = () => {
      void resume()
    }
    window.addEventListener('online', onOnline)
    if (typeof navigator === 'undefined' || navigator.onLine !== false) void resume()

    return () => {
      cancelled = true
      window.removeEventListener('online', onOnline)
    }
  }, [db])

  /**
   * One uploader per open database. It starts only when a device session is
   * active; a token refresh changes the session object but not this effect, so
   * an in-flight drain is never restarted. Revocation flips `session` to null,
   * which stops the loop (the uploader itself pauses first).
   */
  const sessionActive = Boolean(session)
  useEffect(() => {
    if (!db || !sessionActive || uploaderRef.current) return

    const uploader = createUploader({
      store: createOutboxStore(db),
      client: httpSyncClient,
      device: () => {
        const current = getCurrentSession()
        return current ? { deviceId: current.deviceId, terminalId: current.terminal.id } : null
      },
      batchSize: () => getCurrentSession()?.config.pos.syncBatchSize ?? 25,
      online: () => (typeof navigator === 'undefined' ? true : navigator.onLine !== false),
      onStatus: setUploadStatus,
      onRevoked: markDeviceRevoked,
      afterAck: async () => {
        await refreshConflicts(db, httpSyncClient)
      },
      // Counts and codes only: never a payload, receipt line, or customer name.
      log: (message) => console.warn(`[outbox] ${message}`),
    })

    uploaderRef.current = uploader
    uploader.start()

    return () => {
      uploader.stop()
      uploaderRef.current = null
      resetUploadStatus()
    }
  }, [db, sessionActive])

  const syncNow = useCallback(async () => {
    // A manual sync must also recover from an offline start: re-establish the
    // device session first, then drain. The uploader starts its own drain when
    // the session arrives, so a null ref here is not a lost sale.
    if (!getCurrentSession()) {
      const active = await ensureSession()
      if (active && db && !db.currentStatus?.connected) {
        await db.connect(posConnector).catch(() => {})
      }
    }
    await uploaderRef.current?.syncNow()
  }, [db])

  return (
    <PosContext.Provider value={{ db, session, sessionState, syncNow }}>
      {db ? <PowerSyncContext.Provider value={db}>{children}</PowerSyncContext.Provider> : children}
    </PosContext.Provider>
  )
}

export function usePos(): PosContextValue {
  return useContext(PosContext)
}

export function usePosDatabase(): PowerSyncDatabase {
  const db = useContext(PowerSyncContext)
  if (!db) {
    throw new Error('usePosDatabase must be used inside <PosProvider> once the database is open')
  }
  return db
}
