import { ApiError, DeviceRevokedError } from '../api/client'

/**
 * Device-session states, and what a failure actually means.
 *
 * `missing` is the only state that means "this terminal has never been enrolled". A token the
 * server refuses is **not** a first install: the database may have been reset, a backup restored,
 * or the device deleted in the console. Treating that as `missing` threw a working terminal back
 * to the enrolment screen with no explanation and made a transient server error look like a
 * wiped device.
 */
export type SessionState = 'unknown' | 'active' | 'missing' | 'revoked' | 'rejected'

export type SessionFailure = Exclude<SessionState, 'active' | 'missing'>

/**
 * Classifies a failed `POST /api/pos/session`.
 *
 * - `revoked`  — the server said so (403 `DEVICE_REVOKED`). Terminal.
 * - `rejected` — the token is not recognised (401, or another 403). The credential is dead, but
 *                the terminal's local data is not; re-enrolment must be an explicit choice.
 * - `unknown`  — no verdict: offline, timeout, 5xx, or a local keychain failure. The terminal
 *                stays usable and must never be sent to enrolment on this basis.
 */
export function classifySessionFailure(error: unknown): SessionFailure {
  if (error instanceof DeviceRevokedError) return 'revoked'
  if (error instanceof ApiError) {
    if (error.status === 0) return 'unknown'
    if (error.status === 401 || error.status === 403) return 'rejected'
    return 'unknown'
  }
  return 'unknown'
}

/** Which blocking screen the sign-in route must show, if any. */
export function credentialProblemFor(state: SessionState): 'revoked' | 'rejected' | null {
  if (state === 'revoked') return 'revoked'
  if (state === 'rejected') return 'rejected'
  return null
}
