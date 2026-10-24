import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
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
import { auditLog } from '../platform/audit.schema.ts'
import { branch } from './branches.schema.ts'
import { terminalEnrollment } from './enrollment.schema.ts'
import {
  generateEnrollmentCode,
  hashDeviceToken,
  hashEnrollmentCode,
} from './enrollment.service.ts'
import { findActiveDeviceByTokenHash } from './terminals.repository.ts'
import { device, terminal } from './terminals.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[enrollment.test] database unavailable; integration tests skipped')

interface RedeemedBody {
  deviceId: string
  deviceToken: string
  terminalId: string
  terminalCode: string
  branchId: string
  branchName: string
  branchCode: string
}

interface EnrollmentBody {
  enrollment: { code: string; expiresAt: string }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('enrollment redemption', () => {
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdCodes: string[] = []
  let adminCookie = ''
  let retailBranchId = ''
  let retailTerminalId = ''
  const suffix = randomToken(3)

  async function createBranch(code: string, type: 'RETAIL' | 'WAREHOUSE'): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ code, name: `Enrollment ${code}`, type, city: 'Accra' }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function createTerminal(branchId: string, name: string): Promise<string> {
    const response = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId, name }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ terminal: { id: string } }>(response)
    createdTerminalIds.push(body.terminal.id)
    return body.terminal.id
  }

  async function requestEnrollment(terminalId: string): Promise<string> {
    const response = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(201)
    const body = await readJson<EnrollmentBody>(response)
    createdCodes.push(hashEnrollmentCode(body.enrollment.code))
    return body.enrollment.code
  }

  /** Seeds an enrollment row directly, for states the API will not produce. */
  async function seedEnrollment(options: {
    terminalId: string
    code: string
    expiresAt: Date
  }): Promise<void> {
    const codeHash = hashEnrollmentCode(options.code)
    createdCodes.push(codeHash)
    await db.insert(terminalEnrollment).values({
      terminalId: options.terminalId,
      codeHash,
      expiresAt: options.expiresAt,
    })
  }

  function redeem(code: string, fingerprint?: string) {
    return app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(fingerprint ? { code, fingerprint } : { code }),
    })
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    retailBranchId = await createBranch(`E${suffix}`, 'RETAIL')
    retailTerminalId = await createTerminal(retailBranchId, 'Enrollment Counter')
  })

  afterAll(async () => {
    if (createdTerminalIds.length > 0) {
      await db.delete(device).where(inArray(device.terminalId, createdTerminalIds))
    }
    if (createdCodes.length > 0) {
      await db.delete(terminalEnrollment).where(inArray(terminalEnrollment.codeHash, createdCodes))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('issues a device token once and stores only its hash', async () => {
    const code = await requestEnrollment(retailTerminalId)

    const response = await redeem(code, 'machine-abc')
    expect(response.status).toBe(201)
    const body = await readJson<RedeemedBody>(response)

    expect(body.deviceToken).toMatch(/^[A-Za-z0-9_-]{43}$/)
    expect(body.terminalId).toBe(retailTerminalId)
    expect(body.branchId).toBe(retailBranchId)
    expect(body.branchCode).toBe(`E${suffix}`)
    expect(body.terminalCode).toBe(`E${suffix}-T01`)

    const rows = await db.select().from(device).where(eq(device.id, body.deviceId))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('ACTIVE')
    expect(rows[0]?.fingerprint).toBe('machine-abc')
    expect(rows[0]?.tokenHash).not.toBe(body.deviceToken)
    expect(rows[0]?.tokenHash).toBe(hashDeviceToken(body.deviceToken))

    const active = await findActiveDeviceByTokenHash(hashDeviceToken(body.deviceToken))
    expect(active?.id).toBe(body.deviceId)
  })

  it('never puts the device token in the audit log or the response envelope', async () => {
    const code = await requestEnrollment(retailTerminalId)
    const response = await redeem(code)
    const body = await readJson<RedeemedBody>(response)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'device.token.issued'), eq(auditLog.entityId, body.deviceId)))

    expect(auditRows).toHaveLength(1)
    expect(auditRows[0]?.branchId).toBe(retailBranchId)
    expect(JSON.stringify(auditRows[0]?.after)).not.toContain(body.deviceToken)
    // The response carries the token exactly once and never its stored hash.
    expect(JSON.stringify(body)).not.toContain(hashDeviceToken(body.deviceToken))
  })

  it('refuses a second redemption of the same code', async () => {
    const code = await requestEnrollment(retailTerminalId)
    expect((await redeem(code)).status).toBe(201)

    const second = await redeem(code)
    expect(second.status).toBe(400)
    const body = await readJson<{ error: { code: string } }>(second)
    expect(body.error.code).toBe('ENROLLMENT_INVALID')

    const devices = await db.select().from(device).where(eq(device.terminalId, retailTerminalId))
    expect(devices.filter((row) => row.status === 'ACTIVE').length).toBeGreaterThanOrEqual(1)
  })

  it('rejects an unknown code', async () => {
    const response = await redeem(generateEnrollmentCode())
    expect(response.status).toBe(400)
  })

  it('rejects an expired code', async () => {
    const code = generateEnrollmentCode()
    await seedEnrollment({
      terminalId: retailTerminalId,
      code,
      expiresAt: new Date(Date.now() - 60_000),
    })

    const response = await redeem(code)
    expect(response.status).toBe(400)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe('ENROLLMENT_INVALID')
  })

  it('rejects an inactive terminal', async () => {
    const code = await requestEnrollment(retailTerminalId)
    await db.update(terminal).set({ isActive: false }).where(eq(terminal.id, retailTerminalId))

    try {
      const response = await redeem(code)
      expect(response.status).toBe(409)
      const body = await readJson<{ error: { code: string } }>(response)
      expect(body.error.code).toBe('TERMINAL_INACTIVE')
    } finally {
      await db.update(terminal).set({ isActive: true }).where(eq(terminal.id, retailTerminalId))
    }
  })

  it('rejects a terminal attached to a warehouse branch', async () => {
    const warehouseBranchId = await createBranch(`W${suffix}`, 'WAREHOUSE')
    // The API refuses to create a terminal in a warehouse, so insert the fixture
    // directly to prove the redemption guard stands on its own.
    const inserted = await db
      .insert(terminal)
      .values({ branchId: warehouseBranchId, code: `W${suffix}-T01`, name: 'Warehouse Terminal' })
      .returning()
    const warehouseTerminalId = inserted[0]?.id ?? ''
    createdTerminalIds.push(warehouseTerminalId)

    const code = generateEnrollmentCode()
    await seedEnrollment({
      terminalId: warehouseTerminalId,
      code,
      expiresAt: new Date(Date.now() + 300_000),
    })

    const response = await redeem(code)
    expect(response.status).toBe(409)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe('BRANCH_NOT_RETAIL')
  })

  it('does not resolve a revoked device token', async () => {
    const code = await requestEnrollment(retailTerminalId)
    const body = await readJson<RedeemedBody>(await redeem(code))

    await db
      .update(device)
      .set({ status: 'REVOKED', revokedAt: new Date(), revokedBy: 'test' })
      .where(eq(device.id, body.deviceId))

    expect(await findActiveDeviceByTokenHash(hashDeviceToken(body.deviceToken))).toBeNull()
    // ...and the same enrollment cannot be reused to obtain a fresh token.
    expect((await redeem(code)).status).toBe(400)
  })
})
