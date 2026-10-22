import { PowerSyncContext } from '@powersync/react'
import type { PowerSyncDatabase } from '@powersync/web'
import { createContext, type ReactNode, useContext, useEffect, useState } from 'react'
import type { PosSessionPayload } from '../api/types'
import { ensureSession, initSession, type SessionState, subscribeSession } from '../auth/session'
import { posConnector } from './connector'
import { getDatabase } from './database'
import { applyPowerSyncStatus, resetSyncStatus, updateSyncStatus } from './status'

interface PosContextValue {
  db: PowerSyncDatabase | null
  session: PosSessionPayload | null
  sessionState: SessionState
}

const PosContext = createContext<PosContextValue>({
  db: null,
  session: null,
  sessionState: 'unknown',
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
        statusChanged: (status) => applyPowerSyncStatus(status),
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

  return (
    <PosContext.Provider value={{ db, session, sessionState }}>
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
