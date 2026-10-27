import type { Context } from 'hono'
import { z } from 'zod'
import { requireDeviceJwt } from '../../http/device-auth.ts'
import { type AppEnv, factory } from '../../http/factory.ts'
import { rateLimit } from '../../http/rate-limit.ts'
import { validateParam, validateQuery } from '../../http/validation.ts'
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

/**
 * The report's whole query is one enum and one uuid, so the schema sits beside
 * the route instead of in `sync.validation.ts`, which owns the upload wire
 * contract a till and a server must agree on.
 */
const shiftReportParamSchema = z.object({ id: z.uuid() })
const shiftReportQuerySchema = z.object({ kind: z.enum(['X', 'Z']) })
const validateShiftReportParam = validateParam(shiftReportParamSchema)
const validateShiftReportQuery = validateQuery(shiftReportQuerySchema)

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

// `kind` selects the two reports (Plan 13-07): `Z` is the close's snapshot, `X`
// is the same arithmetic computed live. 60 a minute is a manager asking
// repeatedly, not a till polling.
syncRoutes.get(
  '/api/pos/shifts/:id/report',
  requireDeviceJwt,
  rateLimit({ windowMs: 60_000, max: 60, keyPrefix: 'pos:shift:report', keyForRequest: perDevice }),
  validateShiftReportParam,
  validateShiftReportQuery,
  (c) => syncController.shiftReport(c, c.req.valid('param').id, c.req.valid('query').kind),
)
