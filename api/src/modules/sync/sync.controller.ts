import type { Context } from 'hono'
import { readBearerToken } from '../../http/device-auth.ts'
import { AppError } from '../../http/errors.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as syncService from './sync.service.ts'

/**
 * `POST /api/pos/session` is authenticated by the **device token** (not a JWT):
 * it is the call that mints the short-lived JWT, and also the refresh path.
 */
export async function createSession(c: Context<AppEnv>) {
  const deviceToken = readBearerToken(c.req.header('authorization'))
  if (!deviceToken) {
    throw new AppError(401, 'DEVICE_TOKEN_MISSING', 'A device token is required')
  }

  const payload = await syncService.createSession(deviceToken)
  return c.json(payload)
}

export async function powersyncToken(c: Context<AppEnv>) {
  const auth = c.get('device')
  if (!auth) {
    // Unreachable behind `requireDeviceJwt`; fail closed if the wiring changes.
    throw new AppError(401, 'DEVICE_TOKEN_INVALID', 'Device authentication required')
  }

  const payload = await syncService.issuePowersyncToken(auth)
  return c.json(payload)
}
