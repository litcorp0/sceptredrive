import { requireDeviceJwt } from '../../http/device-auth.ts'
import { factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import * as syncController from './sync.controller.ts'

/**
 * Device-facing POS endpoints.
 *
 * These are **not** Better Auth routes: a terminal has no browser session. The
 * session call authenticates with the device token; everything after it uses the
 * short-lived device JWT.
 */
export const syncRoutes = factory.createApp()

syncRoutes.post(
  '/api/pos/session',
  // A terminal retries this on every reconnect; allow normal retry storms but
  // stop a token-guessing loop.
  rateLimit({ windowMs: 60_000, max: 30, keyPrefix: 'pos:session' }),
  (c) => syncController.createSession(c),
)

syncRoutes.post(
  '/api/pos/powersync/token',
  requireDeviceJwt,
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'pos:powersync-token' }),
  (c) => syncController.powersyncToken(c),
)
