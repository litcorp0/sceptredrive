import { db } from '@gikautos/db'
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
import { hashEnrollmentCode } from './enrollment.service.ts'
import { terminal } from './terminals.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[terminals.test] database unavailable; integration tests skipped')

interface TerminalRecord {
  id: string
  code: string
  name: string
  isActive: boolean
  branchId: string
}

interface TerminalResponse {
  terminal: TerminalRecord
}

interface EnrollmentResponse {
  enrollment: { code: string; expiresAt: string }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('terminal and enrollment API', () => {
  const createdTerminalIds: string[] = []
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let ownBranchId = ''
  let ownBranchCode = ''
  let otherBranchId = ''
  let warehouseBranchId = ''
  const suffix = randomToken(3)

  async function createBranchAsAdmin(
    code: string,
    name: string,
    type: 'RETAIL' | 'WAREHOUSE' = 'RETAIL',
  ): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ code, name, type, city: 'Accra' }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    ownBranchCode = `T${suffix}-A`
    ownBranchId = await createBranchAsAdmin(ownBranchCode, 'Terminal Branch A')
    otherBranchId = await createBranchAsAdmin(`T${suffix}-B`, 'Terminal Branch B')
    warehouseBranchId = await createBranchAsAdmin(`T${suffix}-W`, 'Terminal Warehouse', 'WAREHOUSE')

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: ownBranchId,
      name: 'Terminal Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)
  })

  afterAll(async () => {
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('creates sequential terminal codes per branch as a manager', async () => {
    const first = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: ownBranchId, name: 'Front Counter' }),
    })
    expect(first.status).toBe(201)
    const firstBody = await readJson<TerminalResponse>(first)
    expect(firstBody.terminal.code).toBe(`${ownBranchCode}-T01`)
    createdTerminalIds.push(firstBody.terminal.id)

    const second = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: ownBranchId, name: 'Back Counter' }),
    })
    expect(second.status).toBe(201)
    const secondBody = await readJson<TerminalResponse>(second)
    expect(secondBody.terminal.code).toBe(`${ownBranchCode}-T02`)
    createdTerminalIds.push(secondBody.terminal.id)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'terminal'), eq(auditLog.entityId, firstBody.terminal.id)))
    expect(auditRows.some((row) => row.action === 'terminal.created')).toBe(true)
  })

  it('forbids managers from adding terminals to another branch', async () => {
    const response = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: otherBranchId, name: 'Sneaky Terminal' }),
    })

    expect(response.status).toBe(403)
  })

  it('refuses to create terminals on warehouse branches', async () => {
    const response = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: warehouseBranchId, name: 'Warehouse POS' }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  it('rejects unauthenticated listing', async () => {
    const response = await app.request('/api/terminals')
    expect(response.status).toBe(401)
  })

  it('scopes terminal listing for managers', async () => {
    const response = await app.request('/api/terminals?includeInactive=true', {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ terminals: TerminalRecord[] }>(response)
    expect(body.terminals.length).toBeGreaterThanOrEqual(2)
    expect(body.terminals.every((item) => item.branchId === ownBranchId)).toBe(true)
  })

  it('creates one-time enrollment codes stored only as hashes', async () => {
    const terminalId = createdTerminalIds[0] ?? ''
    const response = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(201)
    const body = await readJson<EnrollmentResponse>(response)
    const code = body.enrollment.code

    expect(code).toMatch(/^[A-HJ-NP-Z2-9]{8}$/)
    expect(new Date(body.enrollment.expiresAt).getTime()).toBeGreaterThan(Date.now())

    const rows = await db
      .select()
      .from(terminalEnrollment)
      .where(eq(terminalEnrollment.terminalId, terminalId))
    expect(rows.length).toBeGreaterThanOrEqual(1)
    expect(rows.every((row) => row.codeHash !== code)).toBe(true)
    expect(rows.some((row) => row.codeHash === hashEnrollmentCode(code))).toBe(true)
  })

  it('expires earlier unused codes when a new one is created', async () => {
    const terminalId = createdTerminalIds[0] ?? ''

    const first = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })
    const firstCode = (await readJson<EnrollmentResponse>(first)).enrollment.code

    const second = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })
    expect(second.status).toBe(201)

    const redeemOld = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: firstCode }),
    })
    expect(redeemOld.status).toBe(400)
  })

  it('redeems a valid code once and returns the Phase 6 placeholder', async () => {
    const terminalId = createdTerminalIds[0] ?? ''
    const created = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })
    const code = (await readJson<EnrollmentResponse>(created)).enrollment.code

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(redeem.status).toBe(501)
    expect(await redeem.json()).toMatchObject({ error: { code: 'NOT_IMPLEMENTED' } })

    const reuse = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code }),
    })
    expect(reuse.status).toBe(400)
    expect(await reuse.json()).toMatchObject({ error: { code: 'ENROLLMENT_INVALID' } })
  })

  it('rejects unknown and expired codes', async () => {
    const unknown = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: 'ZZZZZZZZ' }),
    })
    expect(unknown.status).toBe(400)

    const terminalId = createdTerminalIds[0] ?? ''
    const expiredCode = 'EXPIRED9'
    await db.insert(terminalEnrollment).values({
      terminalId,
      codeHash: hashEnrollmentCode(expiredCode),
      expiresAt: new Date(Date.now() - 60_000),
    })

    const expired = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: expiredCode }),
    })
    expect(expired.status).toBe(400)
  })

  it('forbids managers from enrolling another branch terminal', async () => {
    const created = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: otherBranchId, name: 'Other Terminal' }),
    })
    expect(created.status).toBe(201)
    const otherTerminalId = (await readJson<TerminalResponse>(created)).terminal.id
    createdTerminalIds.push(otherTerminalId)

    const response = await app.request(`/api/terminals/${otherTerminalId}/enrollment`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(403)
  })

  it('lists devices for a terminal and audits redeems', async () => {
    const terminalId = createdTerminalIds[0] ?? ''
    const response = await app.request(`/api/terminals/${terminalId}/devices`, {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ devices: unknown[] }>(response)
    expect(Array.isArray(body.devices)).toBe(true)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'terminal'),
          eq(auditLog.entityId, terminalId),
          eq(auditLog.action, 'terminal.enrollment.redeemed'),
        ),
      )
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
  })

  it('renames terminals and forbids cross-branch updates', async () => {
    const terminalId = createdTerminalIds[1] ?? ''
    const rename = await app.request(`/api/terminals/${terminalId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: 'Renamed Counter' }),
    })
    expect(rename.status).toBe(200)
    expect((await readJson<TerminalResponse>(rename)).terminal.name).toBe('Renamed Counter')

    const otherTerminalId = createdTerminalIds[createdTerminalIds.length - 1] ?? ''
    const cross = await app.request(`/api/terminals/${otherTerminalId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: 'Nope' }),
    })
    expect(cross.status).toBe(403)
  })
})
