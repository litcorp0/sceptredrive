import { db } from '@gikautos/db'
import { eq, inArray } from 'drizzle-orm'
import { decodeJwt } from 'jose'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { hashPassword } from '../../auth/password.ts'
import { env } from '../../config/env.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { terminalEnrollment } from '../org/enrollment.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { posStaffBinding } from '../pos/pos.schema.ts'
import type { PosSessionPayload, PowersyncTokenPayload } from './sync.types.ts'

interface StaffBindingResponse {
  bindingId: string
  bindingToken: string
  expiresAt: string
  staff: { userId: string; staffId: string; name: string; role: string }
  pinVersion: number
  mustChangePin: boolean
}

interface BindingValidationResponse {
  valid: boolean
  staff: { userId: string; staffId: string; name: string; role: string } | null
  pinVersion: number | null
  mustChangePin: boolean
  bindingId: string | null
}

const available = await databaseAvailable()
if (!available) console.warn('[sync.test] database unavailable; integration tests skipped')

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('POS device session and PowerSync token', () => {
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  let adminCookie = ''
  let branchId = ''
  let terminalId = ''
  let deviceToken = ''
  const suffix = randomToken(3)

  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierEmail = ''
  let managerEmail = ''
  let otherBranchCashierEmail = ''
  let deviceId = ''
  let cashierBindingToken = ''

  async function enroll(): Promise<{
    deviceToken: string
    terminalId: string
    branchId: string
  }> {
    const enrollmentResponse = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(enrollmentResponse.status).toBe(201)
    const { enrollment } = await readJson<{ enrollment: { code: string } }>(enrollmentResponse)

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, fingerprint: 'sync-suite' }),
    })
    expect(redeem.status).toBe(201)
    return readJson(redeem)
  }

  function sessionRequest(token: string) {
    return app.request('/api/pos/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${token}` },
    })
  }

  function powersyncRequest(accessToken: string) {
    return app.request('/api/pos/powersync/token', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}` },
    })
  }

  async function createStaffForPin(payload: {
    email: string
    name: string
    role: 'CASHIER' | 'MANAGER'
    branchId: string
  }): Promise<{ id: string; staffId: string; email: string }> {
    const response = await app.request('/api/staff', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(payload),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ staff: { id: string; staffId: string; email: string } }>(response)
    createdUserIds.push(body.staff.id)
    return body.staff
  }

  /** The PIN endpoint is Plan 04 Task 1; this suite only needs the hash present. */
  async function seedPin(userId: string, pin: string, version = 1): Promise<void> {
    const pinHash = await hashPassword(pin)
    await db
      .update(userTable)
      .set({ pinHash, pinVersion: version, pinMustChange: true })
      .where(eq(userTable.id, userId))
  }

  function authorizeRequest(
    accessToken: string,
    body: { staffCode?: string; email?: string; pin: string },
  ) {
    return app.request('/api/pos/staff/authorize', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${accessToken}` },
      body: JSON.stringify(body),
    })
  }

  function changePinRequest(
    accessToken: string,
    bindingToken: string,
    body: { currentPin: string; newPin: string },
  ) {
    return app.request('/api/pos/staff/change-pin', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${accessToken}`,
        'x-pos-binding': bindingToken,
      },
      body: JSON.stringify(body),
    })
  }

  function validateBindingRequest(accessToken: string, bindingToken: string) {
    return app.request('/api/pos/staff/binding/validate', {
      method: 'POST',
      headers: { authorization: `Bearer ${accessToken}`, 'x-pos-binding': bindingToken },
    })
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const branchResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `S${suffix}`,
        name: `Sync ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchResponse.status).toBe(201)
    branchId = (await readJson<{ branch: { id: string } }>(branchResponse)).branch.id
    createdBranchIds.push(branchId)

    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, name: 'Sync Counter' }),
    })
    expect(terminalResponse.status).toBe(201)
    terminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal.id
    createdTerminalIds.push(terminalId)

    deviceToken = (await enroll()).deviceToken

    const deviceRows = await db
      .select({ id: device.id })
      .from(device)
      .where(eq(device.terminalId, terminalId))
      .limit(1)
    deviceId = deviceRows[0]?.id ?? ''

    const cashier = await createStaffForPin({
      email: `pos-cashier-${suffix}@gikautos.test`,
      name: 'POS Cashier',
      role: 'CASHIER',
      branchId,
    })
    cashierUserId = cashier.id
    cashierStaffId = cashier.staffId
    cashierEmail = cashier.email
    await seedPin(cashierUserId, '2468')

    const manager = await createStaffForPin({
      email: `pos-manager-${suffix}@gikautos.test`,
      name: 'POS Manager',
      role: 'MANAGER',
      branchId,
    })
    managerEmail = manager.email
    await seedPin(manager.id, '1357')

    const otherBranchResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `O${suffix}`,
        name: `Other ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(otherBranchResponse.status).toBe(201)
    const otherBranchId = (await readJson<{ branch: { id: string } }>(otherBranchResponse)).branch
      .id
    createdBranchIds.push(otherBranchId)

    const otherCashier = await createStaffForPin({
      email: `pos-other-${suffix}@gikautos.test`,
      name: 'Other Branch Cashier',
      role: 'CASHIER',
      branchId: otherBranchId,
    })
    otherBranchCashierEmail = otherCashier.email
    await seedPin(otherCashier.id, '2468')
  })

  afterAll(async () => {
    // Bindings reference devices with RESTRICT; delete them first.
    const deviceRows = await db
      .select({ id: device.id })
      .from(device)
      .where(inArray(device.terminalId, createdTerminalIds))
    if (deviceRows.length > 0) {
      await db.delete(posStaffBinding).where(
        inArray(
          posStaffBinding.deviceId,
          deviceRows.map((row) => row.id),
        ),
      )
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(device).where(inArray(device.terminalId, createdTerminalIds))
      await db
        .delete(terminalEnrollment)
        .where(inArray(terminalEnrollment.terminalId, createdTerminalIds))
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('exchanges the device token for a JWT and the offline config snapshot', async () => {
    const response = await sessionRequest(deviceToken)
    expect(response.status).toBe(200)
    const body = await readJson<PosSessionPayload>(response)

    expect(body.deviceId).toBeTruthy()
    expect(body.terminal.id).toBe(terminalId)
    expect(body.terminal.code).toBe(`S${suffix}-T01`)
    expect(body.branch.id).toBe(branchId)
    expect(body.accessToken.split('.')).toHaveLength(3)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(Date.now())

    expect(body.config.taxMode).toBe('INCLUSIVE')
    expect(body.config.loyalty).toMatchObject({ earnPointsPerCedi: 1, pointsPerCedi: 100 })
    expect(body.config.pos).toMatchObject({
      pinMaxAttempts: 5,
      pinLockMinutes: 5,
      syncBatchSize: 25,
      salesRequireOpenShift: true,
    })
    expect(body.config.pos.receiptFooter.length).toBeGreaterThan(0)
    expect(body.config.receiptHeader.length).toBeGreaterThan(0)
    expect(body.config.serverTimeZone).toBe('Africa/Accra')
    expect(Number.isNaN(Date.parse(body.config.serverTime))).toBe(false)
  })

  it('never leaks credentials or staff data in the session payload', async () => {
    const body = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const serialized = JSON.stringify(body)

    expect(serialized).not.toContain(deviceToken)
    expect(serialized).not.toMatch(/pinHash|pin_hash/i)
    expect(serialized).not.toMatch(/staff/i)
    expect(serialized).not.toMatch(/password/i)
  })

  it('rejects an unknown device token', async () => {
    const response = await sessionRequest('not-a-real-token')
    expect(response.status).toBe(401)
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      'DEVICE_TOKEN_INVALID',
    )
  })

  it('rejects a missing bearer credential', async () => {
    const response = await app.request('/api/pos/session', { method: 'POST' })
    expect(response.status).toBe(401)
  })

  it('rejects a revoked device and a stale JWT', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const deviceRow = await db
      .select()
      .from(device)
      .where(eq(device.terminalId, terminalId))
      .limit(1)

    await db
      .update(device)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokedBy: 'test' })
      .where(eq(device.id, deviceRow[0]?.id ?? ''))

    try {
      // Revoked is a policy failure, not a bad credential: 403 with a code the
      // POS can act on (route back to enrolment) rather than a generic 401.
      const revoked = await sessionRequest(deviceToken)
      expect(revoked.status).toBe(403)
      expect((await readJson<{ error: { code: string } }>(revoked)).error.code).toBe(
        'DEVICE_REVOKED',
      )

      const tokenAfterRevoke = await powersyncRequest(session.accessToken)
      expect(tokenAfterRevoke.status).toBe(403)
      expect((await readJson<{ error: { code: string } }>(tokenAfterRevoke)).error.code).toBe(
        'DEVICE_REVOKED',
      )
    } finally {
      await db
        .update(device)
        .set({ status: 'ACTIVE', revokedAt: null, revokedBy: null })
        .where(eq(device.id, deviceRow[0]?.id ?? ''))
    }
  })

  it('rejects an inactive terminal', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    await db.update(terminal).set({ isActive: false }).where(eq(terminal.id, terminalId))

    try {
      const response = await powersyncRequest(session.accessToken)
      expect(response.status).toBe(403)
      expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
        'TERMINAL_INACTIVE',
      )
      expect((await sessionRequest(deviceToken)).status).toBe(403)
    } finally {
      await db.update(terminal).set({ isActive: true }).where(eq(terminal.id, terminalId))
    }
  })

  it('rejects a warehouse branch', async () => {
    const warehouse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `W${suffix}`,
        name: `Sync warehouse ${suffix}`,
        type: 'WAREHOUSE',
        city: 'Accra',
      }),
    })
    expect(warehouse.status).toBe(201)
    const warehouseId = (await readJson<{ branch: { id: string } }>(warehouse)).branch.id
    createdBranchIds.push(warehouseId)

    const warehouseTerminal = await db
      .insert(terminal)
      .values({ branchId: warehouseId, code: `W${suffix}-T01`, name: 'Warehouse Terminal' })
      .returning()
    const warehouseTerminalId = warehouseTerminal[0]?.id ?? ''
    createdTerminalIds.push(warehouseTerminalId)

    const code = `WHSE${randomToken(4)}`
    const { hashEnrollmentCode } = await import('../org/enrollment.service.ts')
    await db.insert(terminalEnrollment).values({
      terminalId: warehouseTerminalId,
      codeHash: hashEnrollmentCode(code),
      expiresAt: new Date(Date.now() + 300_000),
    })

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(redeem.status).toBe(409)
  })

  it('mints a PowerSync JWT bound to the terminal branch', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const response = await powersyncRequest(session.accessToken)
    expect(response.status).toBe(200)

    const body = await readJson<PowersyncTokenPayload>(response)
    expect(body.endpoint).toBe(env.POWERSYNC_URL)

    const claims = decodeJwt(body.token)
    expect(claims.aud).toBe(env.POWERSYNC_AUDIENCE ?? env.POWERSYNC_URL)
    expect(claims.sub).toBe(session.deviceId)
    expect(claims.branch_id).toBe(branchId)
    expect(claims.terminal_id).toBe(terminalId)
    expect(claims.device_id).toBe(session.deviceId)
    expect(Number(claims.exp) - Number(claims.iat)).toBe(env.POS_JWT_TTL_SECONDS)
    expect(body.token).not.toContain(deviceToken)
  })

  it('rejects a request without a device JWT', async () => {
    const response = await app.request('/api/pos/powersync/token', { method: 'POST' })
    expect(response.status).toBe(401)
    expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
      'DEVICE_TOKEN_MISSING',
    )
  })

  it('answers 503 when the PowerSync URL is not configured', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const original = env.POWERSYNC_URL
    // `env` is a plain object: this mirrors a deployment without sync.
    ;(env as { POWERSYNC_URL?: string }).POWERSYNC_URL = undefined

    try {
      const response = await powersyncRequest(session.accessToken)
      expect(response.status).toBe(503)
      expect((await readJson<{ error: { code: string } }>(response)).error.code).toBe(
        'POWERSYNC_NOT_CONFIGURED',
      )
    } finally {
      ;(env as { POWERSYNC_URL?: string }).POWERSYNC_URL = original
    }
  })

  it('authorizes a cashier PIN and stores only the binding hash', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const response = await authorizeRequest(session.accessToken, {
      staffCode: cashierStaffId,
      pin: '2468',
    })
    expect(response.status).toBe(201)

    const body = await readJson<StaffBindingResponse>(response)
    cashierBindingToken = body.bindingToken
    expect(body.staff).toMatchObject({
      userId: cashierUserId,
      staffId: cashierStaffId,
      role: 'CASHIER',
    })
    expect(body.pinVersion).toBe(1)
    expect(body.mustChangePin).toBe(true)
    expect(body.bindingToken.length).toBeGreaterThanOrEqual(40)
    expect(new Date(body.expiresAt).getTime()).toBeGreaterThan(
      Date.now() + 80 * 24 * 60 * 60 * 1000,
    )
    expect(JSON.stringify(body)).not.toMatch(/pinHash|pin_hash|argon2|2468/)

    const rows = await db
      .select()
      .from(posStaffBinding)
      .where(eq(posStaffBinding.id, body.bindingId))
    expect(rows[0]?.bindingTokenHash).not.toBe(body.bindingToken)
    expect(rows[0]?.bindingTokenHash).toBe(hashDeviceToken(body.bindingToken))
    expect(rows[0]?.deviceId).toBe(deviceId)

    const auditRows = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, 'pos.staff.binding.created'))
    const mine = auditRows.find(
      (row) => (row.after as { deviceId?: string } | null)?.deviceId === deviceId,
    )
    expect(mine).toBeTruthy()
    expect(JSON.stringify(mine)).not.toContain(body.bindingToken)
  })

  it('answers one generic error for a wrong PIN or an unknown staff member', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))

    const wrongPin = await authorizeRequest(session.accessToken, {
      staffCode: cashierStaffId,
      pin: '9999',
    })
    expect(wrongPin.status).toBe(401)
    expect((await readJson<{ error: { code: string } }>(wrongPin)).error.code).toBe('PIN_INVALID')

    const unknown = await authorizeRequest(session.accessToken, {
      email: `nobody-${suffix}@gikautos.test`,
      pin: '2468',
    })
    expect(unknown.status).toBe(401)
    const unknownBody = await readJson<{ error: { code: string; message: string } }>(unknown)
    expect(unknownBody.error.code).toBe('PIN_INVALID')

    const failures = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(eq(auditLog.action, 'pos.staff.authorize.failed'))
    expect(failures.length).toBeGreaterThanOrEqual(2)
    expect(JSON.stringify(failures)).not.toMatch(/2468|9999/)
  })

  it('validates a live binding without accepting a PIN', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const response = await validateBindingRequest(session.accessToken, cashierBindingToken)
    expect(response.status).toBe(200)

    const body = await readJson<BindingValidationResponse>(response)
    expect(body.valid).toBe(true)
    expect(body.staff?.userId).toBe(cashierUserId)
    expect(body.pinVersion).toBe(1)
    expect(body.mustChangePin).toBe(true)

    const garbage = await validateBindingRequest(session.accessToken, randomToken(32))
    expect(garbage.status).toBe(200)
    expect((await readJson<BindingValidationResponse>(garbage)).valid).toBe(false)
  })

  it('changes the PIN, bumps its version, and replaces every binding', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const response = await changePinRequest(session.accessToken, cashierBindingToken, {
      currentPin: '2468',
      newPin: '5791',
    })
    expect(response.status).toBe(200)

    const body = await readJson<StaffBindingResponse>(response)
    expect(body.pinVersion).toBe(2)
    expect(body.mustChangePin).toBe(false)
    expect(body.bindingToken).not.toBe(cashierBindingToken)
    cashierBindingToken = body.bindingToken

    const rows = await db
      .select({ pinHash: userTable.pinHash, pinMustChange: userTable.pinMustChange })
      .from(userTable)
      .where(eq(userTable.id, cashierUserId))
    expect(rows[0]?.pinMustChange).toBe(false)
    expect(rows[0]?.pinHash).toMatch(/^\$argon2id\$/)

    const oldBinding = await db
      .select({ revokedAt: posStaffBinding.revokedAt })
      .from(posStaffBinding)
      .where(eq(posStaffBinding.bindingTokenHash, hashDeviceToken(body.bindingToken)))
    expect(oldBinding).toHaveLength(1)
    expect(oldBinding[0]?.revokedAt).toBeNull()

    const oldPin = await authorizeRequest(session.accessToken, {
      staffCode: cashierStaffId,
      pin: '2468',
    })
    expect(oldPin.status).toBe(401)

    const newPin = await authorizeRequest(session.accessToken, {
      email: cashierEmail,
      pin: '5791',
    })
    expect(newPin.status).toBe(201)
    cashierBindingToken = (await readJson<StaffBindingResponse>(newPin)).bindingToken

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(eq(auditLog.action, 'staff.pin.changed'))
    expect(auditRows.some((row) => row.entityId === cashierUserId)).toBe(true)
  })

  it('replaces the previous binding when the same staff re-authorizes', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))
    const before = await db
      .select({ id: posStaffBinding.id })
      .from(posStaffBinding)
      .where(eq(posStaffBinding.bindingTokenHash, hashDeviceToken(cashierBindingToken)))
      .limit(1)
    expect(before[0]?.id).toBeTruthy()

    const response = await authorizeRequest(session.accessToken, {
      staffCode: cashierStaffId,
      pin: '5791',
    })
    expect(response.status).toBe(201)
    const body = await readJson<StaffBindingResponse>(response)
    cashierBindingToken = body.bindingToken

    const oldRows = await db
      .select({ revokedAt: posStaffBinding.revokedAt })
      .from(posStaffBinding)
      .where(eq(posStaffBinding.id, before[0]?.id ?? ''))
    expect(oldRows[0]?.revokedAt).not.toBeNull()

    const activeRows = await db
      .select({ id: posStaffBinding.id })
      .from(posStaffBinding)
      .where(eq(posStaffBinding.id, body.bindingId))
    expect(activeRows).toHaveLength(1)
  })

  it('rejects a binding whose PIN version is stale', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))

    await db.update(userTable).set({ pinVersion: 99 }).where(eq(userTable.id, cashierUserId))

    try {
      const response = await validateBindingRequest(session.accessToken, cashierBindingToken)
      expect(response.status).toBe(200)
      expect((await readJson<BindingValidationResponse>(response)).valid).toBe(false)

      const change = await changePinRequest(session.accessToken, cashierBindingToken, {
        currentPin: '5791',
        newPin: '8642',
      })
      expect(change.status).toBe(403)
      expect((await readJson<{ error: { code: string } }>(change)).error.code).toBe(
        'STALE_CREDENTIALS',
      )
    } finally {
      await db.update(userTable).set({ pinVersion: 2 }).where(eq(userTable.id, cashierUserId))
    }
  })

  it('lets a manager authorize in the branch but not a cashier from another branch', async () => {
    const session = await readJson<PosSessionPayload>(await sessionRequest(deviceToken))

    const manager = await authorizeRequest(session.accessToken, {
      email: managerEmail,
      pin: '1357',
    })
    expect(manager.status).toBe(201)
    expect((await readJson<StaffBindingResponse>(manager)).staff.role).toBe('MANAGER')

    const otherCashier = await authorizeRequest(session.accessToken, {
      email: otherBranchCashierEmail,
      pin: '2468',
    })
    expect(otherCashier.status).toBe(401)
    expect((await readJson<{ error: { code: string } }>(otherCashier)).error.code).toBe(
      'PIN_INVALID',
    )
  })

  it('rate limits PIN attempts per device', async () => {
    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, name: 'Rate Limit Counter' }),
    })
    expect(terminalResponse.status).toBe(201)
    const rateTerminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal
      .id
    createdTerminalIds.push(rateTerminalId)

    const enrollmentResponse = await app.request(`/api/terminals/${rateTerminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(enrollmentResponse.status).toBe(201)
    const { enrollment } = await readJson<{ enrollment: { code: string } }>(enrollmentResponse)

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, fingerprint: 'rate-limit-suite' }),
    })
    expect(redeem.status).toBe(201)
    const rateToken = (await readJson<{ deviceToken: string }>(redeem)).deviceToken

    const rateSession = await readJson<PosSessionPayload>(await sessionRequest(rateToken))

    let lastStatus = 0
    for (let attempt = 0; attempt < 11; attempt += 1) {
      const response = await authorizeRequest(rateSession.accessToken, {
        staffCode: cashierStaffId,
        pin: '1111',
      })
      lastStatus = response.status
    }
    expect(lastStatus).toBe(429)
  })
})
