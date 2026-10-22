import { touchDeviceLastSeen } from '../modules/org/terminals.repository.ts'
import { verifyDeviceJwt } from '../modules/sync/sync.jwt.ts'
import { findSessionByDeviceId } from '../modules/sync/sync.repository.ts'
import { assertTerminalUsable } from '../modules/sync/sync.service.ts'
import { AppError } from './errors.ts'
import { factory } from './factory.ts'

/** Bearer scheme, case-insensitive, single space, token bounded to 4 KiB. */
const BEARER_PATTERN = /^Bearer\s+([A-Za-z0-9._~+/-]{1,4096})$/i

/** Returns the bearer credential or null. Never logs the value. */
export function readBearerToken(header: string | undefined): string | null {
  if (!header) return null
  const match = BEARER_PATTERN.exec(header.trim())
  return match?.[1] ?? null
}

/** `last_seen_at` is metadata, not an audit trail: update at most once a minute. */
const LAST_SEEN_THROTTLE_MS = 60_000

/**
 * Authenticates a POS request with a device JWT.
 *
 * Fail closed at every step: a token that verifies is still rejected when the
 * device, terminal, or branch is no longer live, and when the claims disagree
 * with the database (a terminal moved to another branch, say).
 */
export const requireDeviceJwt = factory.createMiddleware(async (c, next) => {
  const token = readBearerToken(c.req.header('authorization'))
  if (!token) {
    throw new AppError(401, 'DEVICE_TOKEN_MISSING', 'A device token is required')
  }

  const claims = await verifyDeviceJwt(token)
  const session = await findSessionByDeviceId(claims.device_id)
  if (!session) {
    throw new AppError(403, 'DEVICE_NOT_ENROLLED', 'Device is not enrolled')
  }

  assertTerminalUsable(session)

  if (
    claims.terminal_id !== session.terminal.id ||
    claims.branch_id !== session.branch.id ||
    claims.device_id !== session.device.id
  ) {
    // The token predates a move/re-assignment: force a session refresh.
    throw new AppError(401, 'DEVICE_TOKEN_STALE', 'Device token is out of date')
  }

  c.set('device', {
    deviceId: session.device.id,
    terminalId: session.terminal.id,
    branchId: session.branch.id,
  })

  const lastSeen = session.device.lastSeenAt?.getTime() ?? 0
  if (Date.now() - lastSeen > LAST_SEEN_THROTTLE_MS) {
    await touchDeviceLastSeen(session.device.id, new Date())
  }

  await next()
})
