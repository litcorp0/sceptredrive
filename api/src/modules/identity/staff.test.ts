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
  TEST_PASSWORD,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { verifyPassword } from '../../auth/password.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { posStaffBinding } from '../pos/pos.schema.ts'
import { session, user as userTable } from './staff.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[staff.test] database unavailable; integration tests skipped')

interface StaffRecord {
  id: string
  email: string
  name: string
  role: string
  branchId: string | null
  staffId: string | null
  isActive: boolean
  mustChangePassword: boolean
  pinVersion: number
  pinMustChange: boolean
}

interface StaffResponse {
  staff: StaffRecord
}

interface CreateStaffResponse extends StaffResponse {
  temporaryPassword: string
  invitationSent: boolean
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('staff management API', () => {
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let adminId = ''
  let branchAId = ''
  let branchBId = ''
  let cashierId = ''
  let cashierEmail = ''
  let cashierTempPassword = ''
  let admin2Id = ''
  const suffix = randomToken(3)

  async function createBranchAsAdmin(code: string, name: string): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ code, name, type: 'RETAIL', city: 'Accra' }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function createStaffViaApi(
    cookie: string,
    payload: Record<string, unknown>,
  ): Promise<{ status: number; body: CreateStaffResponse & { error?: { code: string } } }> {
    const response = await app.request('/api/staff', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(payload),
    })
    const body = await readJson<CreateStaffResponse & { error?: { code: string } }>(response)
    if (response.status === 201 && body.staff?.id) {
      createdUserIds.push(body.staff.id)
    }
    return { status: response.status, body }
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN', name: 'Staff Admin' })
    createdUserIds.push(admin.id)
    adminId = admin.id
    adminCookie = await signIn(admin.email)

    branchAId = await createBranchAsAdmin(`T${suffix}-A`, 'Staff Branch A')
    branchBId = await createBranchAsAdmin(`T${suffix}-B`, 'Staff Branch B')

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Staff Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)
  })

  afterAll(async () => {
    for (const id of createdUserIds) await deleteTestUser(id)
    if (createdDeviceIds.length > 0) {
      await db.delete(posStaffBinding).where(inArray(posStaffBinding.deviceId, createdDeviceIds))
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('creates a cashier with a sequential staff ID and a temporary password', async () => {
    cashierEmail = `cashier-${suffix}@gikautos.test`
    const { status, body } = await createStaffViaApi(adminCookie, {
      email: cashierEmail.toUpperCase(),
      name: 'Test Cashier',
      role: 'CASHIER',
      branchId: branchAId,
      phone: '0200000000',
    })

    cashierId = body.staff?.id ?? ''
    cashierTempPassword = body.temporaryPassword

    expect(status).toBe(201)
    expect(body.staff.staffId).toMatch(/^GA-\d{4}$/)
    expect(body.staff.email).toBe(cashierEmail.toLowerCase())
    expect(body.staff.mustChangePassword).toBe(true)
    expect(body.staff.isActive).toBe(true)
    expect(body.temporaryPassword).toHaveLength(16)
    expect(body.invitationSent).toBe(true)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'user'), eq(auditLog.entityId, cashierId)))
    expect(auditRows.some((row) => row.action === 'staff.created')).toBe(true)
  })

  it('rejects duplicate emails', async () => {
    const { status } = await createStaffViaApi(adminCookie, {
      email: cashierEmail,
      name: 'Duplicate',
      role: 'CASHIER',
      branchId: branchAId,
    })
    expect(status).toBe(409)
  })

  it('lets managers create staff in their own branch only', async () => {
    const own = await createStaffViaApi(managerCookie, {
      email: `manager-cashier-${suffix}@gikautos.test`,
      name: 'Manager Cashier',
      role: 'CASHIER',
      branchId: branchAId,
    })
    expect(own.status).toBe(201)

    const cross = await createStaffViaApi(managerCookie, {
      email: `cross-${suffix}@gikautos.test`,
      name: 'Cross Branch',
      role: 'CASHIER',
      branchId: branchBId,
    })
    expect(cross.status).toBe(403)

    const asAdmin = await createStaffViaApi(managerCookie, {
      email: `wannabe-admin-${suffix}@gikautos.test`,
      name: 'Wannabe Admin',
      role: 'ADMIN',
    })
    expect(asAdmin.status).toBe(403)
  })

  it('rejects admin accounts assigned to a branch', async () => {
    const { status } = await createStaffViaApi(adminCookie, {
      email: `bad-admin-${suffix}@gikautos.test`,
      name: 'Bad Admin',
      role: 'ADMIN',
      branchId: branchAId,
    })
    expect(status).toBe(400)
  })

  it('scopes the staff list for managers', async () => {
    const response = await app.request('/api/staff?includeInactive=true', {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ staff: StaffRecord[]; total: number }>(response)
    expect(body.staff.length).toBeGreaterThanOrEqual(2)
    expect(body.staff.every((item) => item.branchId === branchAId)).toBe(true)

    const filtered = await app.request('/api/staff?role=CASHIER&includeInactive=true', {
      headers: authedHeaders(adminCookie),
    })
    const filteredBody = await readJson<{ staff: StaffRecord[] }>(filtered)
    expect(filteredBody.staff.some((item) => item.id === cashierId)).toBe(true)
    expect(filteredBody.staff.every((item) => item.role === 'CASHIER')).toBe(true)
  })

  it('lets managers rename their cashiers but not change roles', async () => {
    const rename = await app.request(`/api/staff/${cashierId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: 'Renamed Cashier' }),
    })
    expect(rename.status).toBe(200)
    expect((await readJson<StaffResponse>(rename)).staff.name).toBe('Renamed Cashier')

    const roleChange = await app.request(`/api/staff/${cashierId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ role: 'MANAGER' }),
    })
    expect(roleChange.status).toBe(403)
  })

  it('resets cashier passwords as a manager and revokes their sessions', async () => {
    const cashierCookie = await signIn(cashierEmail, cashierTempPassword)
    expect(cashierCookie.length).toBeGreaterThan(0)

    const response = await app.request(`/api/staff/${cashierId}/reset-password`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ temporaryPassword: string }>(response)
    expect(body.temporaryPassword).not.toBe(cashierTempPassword)
    expect(body.temporaryPassword).toHaveLength(16)

    const sessions = await db.select().from(session).where(eq(session.userId, cashierId))
    expect(sessions).toHaveLength(0)

    const managerTarget = createdUserIds.find((id) => id !== adminId && id !== cashierId) ?? ''
    const forbidden = await app.request(`/api/staff/${managerTarget}/reset-password`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })
    expect([403, 404]).toContain(forbidden.status)

    cashierTempPassword = body.temporaryPassword
  })

  it('changes the signed-in user password and clears mustChangePassword', async () => {
    const cashierCookie = await signIn(cashierEmail, cashierTempPassword)
    const wrong = await app.request('/api/me/password', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({
        currentPassword: 'wrong-password-123',
        newPassword: 'fresh-password-123',
      }),
    })
    expect(wrong.status).toBe(400)

    const response = await app.request('/api/me/password', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({
        currentPassword: cashierTempPassword,
        newPassword: 'fresh-password-456',
      }),
    })
    expect(response.status).toBe(200)

    const rows = await db
      .select({ mustChangePassword: userTable.mustChangePassword })
      .from(userTable)
      .where(eq(userTable.id, cashierId))
    expect(rows[0]?.mustChangePassword).toBe(false)

    const sessions = await db.select().from(session).where(eq(session.userId, cashierId))
    expect(sessions).toHaveLength(1)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'user'),
          eq(auditLog.entityId, cashierId),
          eq(auditLog.action, 'auth.password.changed'),
        ),
      )
    expect(auditRows.length).toBe(1)
  })

  it('authorizes from fresh data after a password change, not the cookie cache', async () => {
    const { id, email } = await createTestUser({ role: 'MANAGER', branchId: branchAId })
    await db.update(userTable).set({ mustChangePassword: true }).where(eq(userTable.id, id))

    const jar = await signIn(email, TEST_PASSWORD)

    const locked = await app.request('/api/branches', { headers: authedHeaders(jar) })
    expect(locked.status).toBe(403)

    const changed = await app.request('/api/me/password', {
      method: 'POST',
      headers: authedHeaders(jar),
      body: JSON.stringify({
        currentPassword: TEST_PASSWORD,
        newPassword: 'regression-password-2026',
      }),
    })
    expect(changed.status).toBe(200)

    // Regression: a cached session kept mustChangePassword true for up to
    // five minutes; authorization must use fresh data instead.
    const after = await app.request('/api/branches', { headers: authedHeaders(jar) })
    expect(after.status).toBe(200)

    await deleteTestUser(id)
  })

  it('lets a manager set a temporary cashier PIN and revokes live bindings', async () => {
    const cashierRows = await db
      .select({ staffId: userTable.staffId })
      .from(userTable)
      .where(eq(userTable.id, cashierId))
    const cashierStaffId = cashierRows[0]?.staffId ?? ''
    expect(cashierStaffId).toMatch(/^GA-\d{4}$/)

    // A real terminal + device so the revocation has something to revoke.
    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, name: 'PIN Counter' }),
    })
    expect(terminalResponse.status).toBe(201)
    const terminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal.id
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: 'pin-suite',
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    const bindingRow = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: cashierId,
        staffStaffId: cashierStaffId,
        role: 'CASHIER',
        branchId: branchAId,
        pinVersion: 0,
        bindingTokenHash: randomToken(32),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning()
    const bindingId = bindingRow[0]?.id ?? ''

    const response = await app.request(`/api/staff/${cashierId}/pin`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ pin: '2468' }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<{ staffId: string; pinVersion: number }>(response)
    expect(body.staffId).toBe(cashierStaffId)
    expect(body.pinVersion).toBe(1)
    expect(JSON.stringify(body)).not.toMatch(/pinHash|pin_hash|2468/)

    const rows = await db
      .select({
        pinHash: userTable.pinHash,
        pinVersion: userTable.pinVersion,
        pinMustChange: userTable.pinMustChange,
      })
      .from(userTable)
      .where(eq(userTable.id, cashierId))
    expect(rows[0]?.pinVersion).toBe(1)
    expect(rows[0]?.pinMustChange).toBe(true)
    expect(rows[0]?.pinHash).toMatch(/^\$argon2id\$/)
    expect(await verifyPassword({ hash: rows[0]?.pinHash ?? '', password: '2468' })).toBe(true)

    const bindings = await db
      .select({ revokedAt: posStaffBinding.revokedAt })
      .from(posStaffBinding)
      .where(eq(posStaffBinding.id, bindingId))
    expect(bindings[0]?.revokedAt).not.toBeNull()

    const auditRows = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.entity, 'user'),
          eq(auditLog.entityId, cashierId),
          eq(auditLog.action, 'staff.pin.reset'),
        ),
      )
    expect(auditRows).toHaveLength(1)
    expect(JSON.stringify(auditRows[0]?.after)).not.toContain('2468')
  })

  it('enforces PIN reset scope and the PIN policy', async () => {
    const otherBranch = await createStaffViaApi(adminCookie, {
      email: `pin-branch-b-${suffix}@gikautos.test`,
      name: 'Branch B Cashier',
      role: 'CASHIER',
      branchId: branchBId,
    })
    expect(otherBranch.status).toBe(201)
    const otherId = otherBranch.body.staff.id

    const crossBranch = await app.request(`/api/staff/${otherId}/pin`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ pin: '2468' }),
    })
    expect(crossBranch.status).toBe(403)

    const cashierCookie = await signIn(cashierEmail, 'fresh-password-456')
    const cashierAttempt = await app.request(`/api/staff/${cashierId}/pin`, {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({ pin: '2468' }),
    })
    expect(cashierAttempt.status).toBe(403)

    for (const pin of ['123', '1234567', 'abcd', '0000', '1234', '987654']) {
      const invalid = await app.request(`/api/staff/${cashierId}/pin`, {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ pin }),
      })
      expect(invalid.status, `PIN ${pin} should be rejected`).toBe(400)
    }
  })

  it('bumps the PIN version and revokes bindings when a role changes', async () => {
    const created = await createStaffViaApi(adminCookie, {
      email: `pin-role-${suffix}@gikautos.test`,
      name: 'PIN Role Change',
      role: 'CASHIER',
      branchId: branchAId,
    })
    const id = created.body.staff.id
    const staffId = created.body.staff.staffId ?? ''

    const setPin = await app.request(`/api/staff/${id}/pin`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ pin: '246813' }),
    })
    expect(setPin.status).toBe(201)

    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, name: 'Role Change Counter' }),
    })
    const terminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal.id
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: 'pin-role-suite',
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    const bindingRow = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: id,
        staffStaffId: staffId,
        role: 'CASHIER',
        branchId: branchAId,
        pinVersion: 1,
        bindingTokenHash: randomToken(32),
        expiresAt: new Date(Date.now() + 86_400_000),
      })
      .returning()

    const change = await app.request(`/api/staff/${id}`, {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ role: 'MANAGER' }),
    })
    expect(change.status).toBe(200)

    const rows = await db
      .select({ pinVersion: userTable.pinVersion })
      .from(userTable)
      .where(eq(userTable.id, id))
    expect(rows[0]?.pinVersion).toBe(2)

    const bindings = await db
      .select({ revokedAt: posStaffBinding.revokedAt })
      .from(posStaffBinding)
      .where(eq(posStaffBinding.id, bindingRow[0]?.id ?? ''))
    expect(bindings[0]?.revokedAt).not.toBeNull()
  })

  it('reports PIN metadata without ever returning the hash', async () => {
    const response = await app.request(`/api/staff/${cashierId}/pin-status`, {
      headers: authedHeaders(managerCookie),
    })
    expect(response.status).toBe(200)

    const body = await readJson<{
      hasPin: boolean
      pinVersion: number
      pinMustChange: boolean
      activeBindings: number
    }>(response)
    expect(body).toEqual({
      hasPin: true,
      pinVersion: 1,
      pinMustChange: true,
      activeBindings: 0,
    })
    expect(JSON.stringify(body)).not.toMatch(/pinHash|pin_hash|argon2/i)

    const list = await app.request('/api/staff?role=CASHIER&includeInactive=true', {
      headers: authedHeaders(managerCookie),
    })
    expect(list.status).toBe(200)
    const listBody = await readJson<{ staff: StaffRecord[] }>(list)
    expect(listBody.staff.every((row) => 'pinVersion' in row && 'pinMustChange' in row)).toBe(true)
    expect(JSON.stringify(listBody)).not.toMatch(/pinHash|pin_hash|argon2/i)
  })

  it('deactivates and reactivates staff, blocking sign-in while inactive', async () => {
    const off = await app.request(`/api/staff/${cashierId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(off.status).toBe(200)

    const blockedSignIn = await app.request('/api/auth/sign-in/email', {
      method: 'POST',
      headers: { 'content-type': 'application/json', origin: 'http://localhost:3000' },
      body: JSON.stringify({ email: cashierEmail, password: 'fresh-password-456' }),
    })
    expect(blockedSignIn.status).not.toBe(200)

    const selfDeactivate = await app.request(`/api/staff/${adminId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(selfDeactivate.status).toBe(409)

    const on = await app.request(`/api/staff/${cashierId}/reactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(on.status).toBe(200)

    const cashierCookie = await signIn(cashierEmail, 'fresh-password-456')
    expect(cashierCookie.length).toBeGreaterThan(0)
  })

  it('protects the last active admin', async () => {
    const demote = await app.request(`/api/staff/${adminId}`, {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ role: 'CASHIER', branchId: branchAId }),
    })
    expect(demote.status).toBe(409)

    const deactivate = await app.request(`/api/staff/${adminId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(deactivate.status).toBe(409)

    const secondAdmin = await createStaffViaApi(adminCookie, {
      email: `admin2-${suffix}@gikautos.test`,
      name: 'Second Admin',
      role: 'ADMIN',
    })
    expect(secondAdmin.status).toBe(201)
    admin2Id = secondAdmin.body.staff.id

    const deactivateSecond = await app.request(`/api/staff/${admin2Id}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(deactivateSecond.status).toBe(200)

    const stillLast = await app.request(`/api/staff/${adminId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(stillLast.status).toBe(409)
  })
})
