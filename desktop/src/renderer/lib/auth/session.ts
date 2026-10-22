import {
  ApiError,
  DeviceRevokedError,
  fetchSession,
  setAccessToken,
  setTokenRefresher,
} from '../api/client'
import type { PosSessionPayload } from '../api/types'
import { desktopApi, isDesktopAvailable } from '../desktop-api'
import { getDatabase } from '../powersync/database'

/**
 * Device session lifecycle.
 *
 * The long-lived **device token** lives only in the OS keychain. The short-lived
 * **device JWT** is held in memory (never persisted) and refreshed on demand —
 * the token endpoint is the same `/api/pos/session` call, so there is one path
 * for enrolment, startup, and refresh.
 */

export type SessionState = 'unknown' | 'active' | 'missing' | 'revoked'

let current: PosSessionPayload | null = null
let state: SessionState = 'unknown'
let refreshInFlight: Promise<string | null> | null = null
const listeners = new Set<(session: PosSessionPayload | null, state: SessionState) => void>()

function emit(): void {
  for (const listener of listeners) listener(current, state)
}

export function subscribeSession(
  listener: (session: PosSessionPayload | null, state: SessionState) => void,
): () => void {
  listeners.add(listener)
  listener(current, state)
  return () => listeners.delete(listener)
}

export function getCurrentSession(): PosSessionPayload | null {
  return current
}

export function getSessionState(): SessionState {
  return state
}

export async function getDeviceToken(): Promise<string | null> {
  if (!isDesktopAvailable()) return null
  return desktopApi.getSecret('deviceToken')
}

/** Stores the token issued at redemption. Never logged, never in the database. */
export async function persistDeviceToken(deviceToken: string): Promise<void> {
  if (!isDesktopAvailable())
    throw new Error('The desktop bridge is required to store the device token')
  await desktopApi.setSecret('deviceToken', deviceToken)
}

async function persistSession(session: PosSessionPayload): Promise<void> {
  const db = await getDatabase()
  const now = new Date().toISOString()
  const offsetMs = Date.parse(session.config.serverTime) - Date.now()

  await db.writeTransaction(async (tx) => {
    await tx.execute(
      `INSERT OR REPLACE INTO pos_config
         (id, device_id, terminal_id, terminal_code, branch_id, branch_code, branch_name,
          tax_mode, receipt_header, receipt_footer, sync_batch_size, config_json,
          server_time_offset_ms, updated_at)
       VALUES ('current', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      [
        session.deviceId,
        session.terminal.id,
        session.terminal.code,
        session.branch.id,
        session.branch.code,
        session.branch.name,
        session.config.taxMode,
        session.config.receiptHeader,
        session.config.pos.receiptFooter,
        session.config.pos.syncBatchSize,
        JSON.stringify(session.config),
        offsetMs,
        now,
      ],
    )

    await tx.execute(
      `INSERT OR REPLACE INTO pos_session
         (id, device_id, status, access_token_expires_at, last_sync_at, updated_at)
       VALUES ('current', ?, 'ACTIVE', ?, COALESCE((SELECT last_sync_at FROM pos_session WHERE id = 'current'), NULL), ?)`,
      [session.deviceId, session.expiresAt, now],
    )
  })
}

function adopt(session: PosSessionPayload): PosSessionPayload {
  current = session
  state = 'active'
  setAccessToken(session.accessToken)
  emit()
  return session
}

/**
 * Exchanges the stored device token for a fresh JWT + config snapshot and
 * caches the terminal configuration locally.
 */
export async function establishSession(deviceToken: string): Promise<PosSessionPayload> {
  const session = await fetchSession(deviceToken)
  await persistSession(session)
  return adopt(session)
}

/** Startup path: no token → `missing`; revoked → `revoked`. */
export async function ensureSession(): Promise<PosSessionPayload | null> {
  if (current) return current

  const deviceToken = await getDeviceToken()
  if (!deviceToken) {
    state = 'missing'
    emit()
    return null
  }

  try {
    return await establishSession(deviceToken)
  } catch (error) {
    if (error instanceof DeviceRevokedError) {
      await markDeviceRevoked()
      return null
    }
    // Offline start: keep the last known state and let the caller decide.
    if (error instanceof ApiError && error.status === 0) {
      state = 'unknown'
      emit()
      return null
    }
    state = 'missing'
    emit()
    return null
  }
}

/**
 * Used by the API client on a 401. Coalesces concurrent refreshes so a burst of
 * requests produces one session call.
 */
export async function refreshAccessToken(): Promise<string | null> {
  if (refreshInFlight) return refreshInFlight

  refreshInFlight = (async () => {
    const deviceToken = await getDeviceToken()
    if (!deviceToken) return null
    try {
      const session = await establishSession(deviceToken)
      return session.accessToken
    } catch {
      return null
    }
  })()

  try {
    return await refreshInFlight
  } finally {
    refreshInFlight = null
  }
}

export async function markDeviceRevoked(): Promise<void> {
  current = null
  state = 'revoked'
  setAccessToken(null)
  emit()

  try {
    const db = await getDatabase()
    await db.execute(
      `UPDATE pos_session SET status = 'REVOKED', updated_at = ? WHERE id = 'current'`,
      [new Date().toISOString()],
    )
  } catch {
    // The database may not be open yet; the in-memory state is authoritative.
  }
}

/** Forgets the device token (re-enrolment) without touching local sales data. */
export async function signOut(): Promise<void> {
  current = null
  state = 'missing'
  setAccessToken(null)
  if (isDesktopAvailable()) {
    await desktopApi.deleteSecret('deviceToken')
  }
  emit()
}

/** Wires the client's refresh hook. Call once before any API request. */
export function initSession(): void {
  setTokenRefresher(refreshAccessToken)
}
