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
import { env } from '../../config/env.ts'
import { branch } from '../org/branches.schema.ts'
import { terminalEnrollment } from '../org/enrollment.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import type { PosSessionPayload, PowersyncTokenPayload } from './sync.types.ts'

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
  })

  afterAll(async () => {
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
})
