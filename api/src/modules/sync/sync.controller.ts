import type { Context } from 'hono'
import { readBearerToken } from '../../http/device-auth.ts'
import { AppError } from '../../http/errors.ts'
import type { AppEnv } from '../../http/factory.ts'
import * as posService from '../pos/pos.service.ts'
import * as syncService from './sync.service.ts'
import type {
  AuthorizeStaffBody,
  ChangePinBody,
  ConflictsQuery,
  UploadBody,
} from './sync.validation.ts'

/** The binding credential travels in its own header; it is never a URL or body value. */
export const BINDING_HEADER = 'x-pos-binding'
const BINDING_PATTERN = /^[A-Za-z0-9_-]{20,128}$/

function deviceAuth(c: Context<AppEnv>) {
  const auth = c.get('device')
  if (!auth) {
    // Unreachable behind `requireDeviceJwt`; fail closed if the wiring changes.
    throw new AppError(401, 'DEVICE_TOKEN_MISSING', 'Device authentication required')
  }
  return auth
}

function readBindingToken(c: Context<AppEnv>): string {
  const token = c.req.header(BINDING_HEADER)
  if (!token || !BINDING_PATTERN.test(token)) {
    throw new AppError(401, 'BINDING_INVALID', 'A terminal binding is required')
  }
  return token
}

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
  const payload = await syncService.issuePowersyncToken(deviceAuth(c))
  return c.json(payload)
}

/** Authorizes a staff PIN on this terminal; returns a binding token exactly once. */
export async function authorizeStaff(c: Context<AppEnv>, body: AuthorizeStaffBody) {
  const payload = await posService.authorizeStaff(deviceAuth(c), body)
  return c.json(payload, 201)
}

/** Changes the staff PIN and replaces the binding (the current device stays signed in). */
export async function changeStaffPin(c: Context<AppEnv>, body: ChangePinBody) {
  const payload = await posService.changeStaffPin(deviceAuth(c), readBindingToken(c), body)
  return c.json(payload)
}

/** Boot-time binding check: 200 with `valid: false` for a dead binding. */
export async function validateStaffBinding(c: Context<AppEnv>) {
  const payload = await posService.validateStaffBinding(deviceAuth(c), readBindingToken(c))
  return c.json(payload)
}

/** Ordered batch of offline transactions; business conflicts stay HTTP 200. */
export async function upload(c: Context<AppEnv>, body: UploadBody) {
  const payload = await syncService.applyUpload(deviceAuth(c), body)
  return c.json(payload)
}

export async function listConflicts(c: Context<AppEnv>, query: ConflictsQuery) {
  const payload = await syncService.listDeviceConflicts(deviceAuth(c), query)
  return c.json(payload)
}

export async function syncState(c: Context<AppEnv>) {
  const payload = await syncService.getDeviceSyncState(deviceAuth(c))
  return c.json(payload)
}

/**
 * The shift report (Plan 13-07). `Z` reads the close's snapshot and refuses to
 * invent one; `X` computes the same figures live and writes nothing (P13-D32,
 * P13-D33). Both are the device's own shift, resolved from the token.
 */
export async function shiftReport(c: Context<AppEnv>, id: string, kind: 'X' | 'Z') {
  const device = deviceAuth(c)
  const report =
    kind === 'Z' ? await posService.getZReport(device, id) : await posService.getXReport(device, id)
  return c.json({ report })
}
