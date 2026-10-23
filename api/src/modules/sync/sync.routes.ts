import type { Context } from 'hono'
import { requireDeviceJwt } from '../../http/device-auth.ts'
import { type AppEnv, factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import * as syncController from './sync.controller.ts'
import {
  validateAuthorizeStaff,
  validateChangePin,
  validateConflictsQuery,
  validateUpload,
} from './sync.validation.ts'

/**
 * Device-facing POS endpoints.
 *
 * These are **not** Better Auth routes: a terminal has no browser session. The
 * session call authenticates with the device token; everything after it uses the
 * short-lived device JWT.
 */
export const syncRoutes = factory.createApp()

/** One bucket per terminal: a shared shop IP must not throttle every till at once. */
const perDevice = (c: Context<AppEnv>) => c.get('device')?.deviceId ?? null

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

// PIN attempts are the brute-force surface: 10 per minute per device, whether
// the PIN is right or wrong. `requireDeviceJwt` runs first so the bucket is the
// terminal, not the network address.
syncRoutes.post(
  '/api/pos/staff/authorize',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: 'pos:staff:authorize',
    keyForRequest: perDevice,
  }),
  validateAuthorizeStaff,
  (c) => syncController.authorizeStaff(c, c.req.valid('json')),
)

syncRoutes.post(
  '/api/pos/staff/change-pin',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 10,
    keyPrefix: 'pos:staff:change-pin',
    keyForRequest: perDevice,
  }),
  validateChangePin,
  (c) => syncController.changeStaffPin(c, c.req.valid('json')),
)

syncRoutes.post(
  '/api/pos/staff/binding/validate',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 60,
    keyPrefix: 'pos:staff:validate',
    keyForRequest: perDevice,
  }),
  (c) => syncController.validateStaffBinding(c),
)

// Upload is authenticated by the device JWT and rate limited per terminal:
// 60 transactions per minute is far above a busy till's sale rate but stops a
// runaway retry loop. Business conflicts are 200s, so the uploader never stalls.
syncRoutes.post(
  '/api/pos/sync/upload',
  requireDeviceJwt,
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'pos:sync:upload', keyForRequest: perDevice }),
  validateUpload,
  (c) => syncController.upload(c, c.req.valid('json')),
)

syncRoutes.get(
  '/api/pos/sync/conflicts',
  requireDeviceJwt,
  rateLimit({
    windowMs: 60_000,
    max: 60,
    keyPrefix: 'pos:sync:conflicts',
    keyForRequest: perDevice,
  }),
  validateConflictsQuery,
  (c) => syncController.listConflicts(c, c.req.valid('query')),
)

syncRoutes.get(
  '/api/pos/sync/state',
  requireDeviceJwt,
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'pos:sync:state', keyForRequest: perDevice }),
  (c) => syncController.syncState(c),
)
