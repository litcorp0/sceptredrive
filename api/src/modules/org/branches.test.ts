import { db } from '@sceptre/db'
import { suggestBranchCode } from '@sceptre/shared'
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

const available = await databaseAvailable()
if (!available) console.warn('[branches.test] database unavailable; integration tests skipped')

interface BranchRecord {
  id: string
  code: string
  name: string
  isActive: boolean
}

interface BranchResponse {
  branch: BranchRecord
}

interface BranchListResponse {
  branches: BranchRecord[]
}

interface BranchDirectoryEntry {
  id: string
  code: string
  name: string
  type: string
}

interface BranchDirectoryResponse {
  branches: BranchDirectoryEntry[]
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('branch API', () => {
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''
  let adminId = ''
  let primaryBranchId = ''
  let otherBranchId = ''
  const suffix = randomToken(3)

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    adminId = admin.id
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const primary = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `T${suffix}-A`,
        name: 'Test Branch A',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(primary.status).toBe(201)
    primaryBranchId = (await readJson<BranchResponse>(primary)).branch.id
    createdBranchIds.push(primaryBranchId)

    const other = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `T${suffix}-B`,
        name: 'Test Branch B',
        type: 'WAREHOUSE',
        city: 'Kumasi',
      }),
    })
    expect(other.status).toBe(201)
    otherBranchId = (await readJson<BranchResponse>(other)).branch.id
    createdBranchIds.push(otherBranchId)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: primaryBranchId,
      name: 'Test Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const cashier = await createTestUser({
      role: 'CASHIER',
      branchId: primaryBranchId,
      name: 'Test Cashier',
    })
    createdUserIds.push(cashier.id)
    cashierCookie = await signIn(cashier.email)
  })

  afterAll(async () => {
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('rejects unauthenticated requests', async () => {
    const response = await app.request('/api/branches')
    expect(response.status).toBe(401)
  })

  it('creates a branch with a normalized code and audits it', async () => {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `t${suffix}-c`,
        name: 'Audit Branch',
        type: 'RETAIL',
        city: 'Takoradi',
        area: 'Market Circle',
      }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<BranchResponse>(response)
    expect(body.branch.code).toBe(`T${suffix}-C`)
    createdBranchIds.push(body.branch.id)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'branch'), eq(auditLog.entityId, body.branch.id)))
    expect(
      auditRows.some((row) => row.action === 'branch.created' && row.actorId === adminId),
    ).toBe(true)
  })

  it('generates a retail code from city and area when none is supplied', async () => {
    const city = `Q${suffix}`
    const area = `A${suffix}`
    const existing = await db.select({ code: branch.code }).from(branch)
    const expected = suggestBranchCode({
      city,
      area,
      type: 'RETAIL',
      existingCodes: existing.map((row) => row.code),
    })

    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name: 'Auto Retail', type: 'RETAIL', city, area }),
    })

    expect(response.status).toBe(201)
    const body = await readJson<BranchResponse>(response)
    expect(body.branch.code).toBe(expected.code)
    createdBranchIds.push(body.branch.id)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'branch'), eq(auditLog.entityId, body.branch.id)))
    expect(JSON.stringify(auditRows[0]?.after)).toContain(expected.code)
  })

  it('numbers auto-generated warehouse codes per city', async () => {
    const city = `W${suffix}`

    const before = await db.select({ code: branch.code }).from(branch)
    const expectedFirst = suggestBranchCode({
      city,
      type: 'WAREHOUSE',
      existingCodes: before.map((row) => row.code),
    }).code

    const first = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name: 'Auto Warehouse One', type: 'WAREHOUSE', city }),
    })
    expect(first.status).toBe(201)
    const firstBody = await readJson<BranchResponse>(first)
    expect(firstBody.branch.code).toBe(expectedFirst)
    createdBranchIds.push(firstBody.branch.id)

    const afterFirst = await db.select({ code: branch.code }).from(branch)
    const expectedSecond = suggestBranchCode({
      city,
      type: 'WAREHOUSE',
      existingCodes: afterFirst.map((row) => row.code),
    }).code

    const second = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name: 'Auto Warehouse Two', type: 'WAREHOUSE', city }),
    })
    expect(second.status).toBe(201)
    const secondBody = await readJson<BranchResponse>(second)
    expect(secondBody.branch.code).toBe(expectedSecond)
    expect(secondBody.branch.code).not.toBe(firstBody.branch.code)
    createdBranchIds.push(secondBody.branch.id)
  })

  it('adds a suffix when an auto-generated retail code is taken', async () => {
    const city = `V${suffix}`
    const area = `B${suffix}`
    const base = suggestBranchCode({ city, area, type: 'RETAIL' }).code

    const explicit = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: base,
        name: 'Explicit Base',
        type: 'RETAIL',
        city,
        area,
      }),
    })
    expect(explicit.status).toBe(201)
    createdBranchIds.push((await readJson<BranchResponse>(explicit)).branch.id)

    const auto = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name: 'Auto Collision', type: 'RETAIL', city, area }),
    })
    expect(auto.status).toBe(201)
    const autoBody = await readJson<BranchResponse>(auto)
    createdBranchIds.push(autoBody.branch.id)
    expect(autoBody.branch.code).toBe(`${base}-2`)
  })

  it('rejects a duplicate branch code with 409', async () => {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `T${suffix}-A`,
        name: 'Duplicate',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })

    expect(response.status).toBe(409)
    expect(await response.json()).toMatchObject({ error: { code: 'CONFLICT' } })
  })

  it('rejects an invalid branch code with 400', async () => {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: 'not a code!',
        name: 'Bad Code',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })

    expect(response.status).toBe(400)
  })

  it('lists only their own branch for managers', async () => {
    const response = await app.request('/api/branches', {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<BranchListResponse>(response)
    expect(body.branches).toHaveLength(1)
    expect(body.branches[0]?.id).toBe(primaryBranchId)
  })

  it('returns every active branch in the directory to a manager', async () => {
    const response = await app.request('/api/branches/directory', {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<BranchDirectoryResponse>(response)
    const ids = body.branches.map((entry) => entry.id)
    expect(ids).toContain(primaryBranchId)
    expect(ids).toContain(otherBranchId)

    // A picker needs a name and a type, nothing else.
    for (const entry of body.branches) {
      expect(Object.keys(entry).sort()).toEqual(['code', 'id', 'name', 'type'])
    }
  })

  it('excludes a deactivated branch from the directory', async () => {
    const created = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `T${suffix}-E`,
        name: 'Deactivated Source',
        type: 'WAREHOUSE',
        city: 'Tema',
      }),
    })
    expect(created.status).toBe(201)
    const deactivatedBranchId = (await readJson<BranchResponse>(created)).branch.id
    createdBranchIds.push(deactivatedBranchId)

    const before = await app.request('/api/branches/directory', {
      headers: authedHeaders(managerCookie),
    })
    expect(before.status).toBe(200)
    expect(
      (await readJson<BranchDirectoryResponse>(before)).branches.map((entry) => entry.id),
    ).toContain(deactivatedBranchId)

    const deactivated = await app.request(`/api/branches/${deactivatedBranchId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(deactivated.status).toBe(200)

    const after = await app.request('/api/branches/directory', {
      headers: authedHeaders(managerCookie),
    })
    expect(after.status).toBe(200)
    expect(
      (await readJson<BranchDirectoryResponse>(after)).branches.map((entry) => entry.id),
    ).not.toContain(deactivatedBranchId)
  })

  it('rejects unauthenticated directory requests', async () => {
    const response = await app.request('/api/branches/directory')
    expect(response.status).toBe(401)
  })

  it('forbids callers without branch.read from the directory', async () => {
    const response = await app.request('/api/branches/directory', {
      headers: authedHeaders(cashierCookie),
    })

    expect(response.status).toBe(403)
  })

  it('keeps /api/branches scoped to the manager branch after a directory read', async () => {
    const directory = await app.request('/api/branches/directory', {
      headers: authedHeaders(managerCookie),
    })
    expect(directory.status).toBe(200)

    const response = await app.request('/api/branches', {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<BranchListResponse>(response)
    expect(body.branches.map((item) => item.id)).toEqual([primaryBranchId])
  })

  it('lets admins list all active branches', async () => {
    const response = await app.request('/api/branches', {
      headers: authedHeaders(adminCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<BranchListResponse>(response)
    const ids = body.branches.map((item) => item.id)
    expect(ids).toContain(primaryBranchId)
    expect(ids).toContain(otherBranchId)
  })

  it('forbids managers from creating branches', async () => {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        code: `T${suffix}-D`,
        name: 'Manager Branch',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })

    expect(response.status).toBe(403)
  })

  it('lets managers update their own branch name', async () => {
    const response = await app.request(`/api/branches/${primaryBranchId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: 'Test Branch A (Renamed)' }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<BranchResponse>(response)
    expect(body.branch.name).toBe('Test Branch A (Renamed)')
  })

  it('forbids managers from updating another branch', async () => {
    const response = await app.request(`/api/branches/${otherBranchId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ name: 'Should Not Apply' }),
    })

    expect(response.status).toBe(403)
  })

  it('forbids managers from changing admin-only branch fields', async () => {
    const response = await app.request(`/api/branches/${primaryBranchId}`, {
      method: 'PATCH',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ city: 'Kumasi' }),
    })

    expect(response.status).toBe(403)
  })

  it('forbids managers from reading another branch', async () => {
    const response = await app.request(`/api/branches/${otherBranchId}`, {
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(403)
  })

  it('deactivates a branch as admin and audits it', async () => {
    const response = await app.request(`/api/branches/${otherBranchId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })

    expect(response.status).toBe(200)
    const body = await readJson<BranchResponse>(response)
    expect(body.branch.isActive).toBe(false)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'branch'), eq(auditLog.entityId, otherBranchId)))
    expect(auditRows.some((row) => row.action === 'branch.deactivated')).toBe(true)
  })

  it('forbids managers from deactivating branches', async () => {
    const response = await app.request(`/api/branches/${primaryBranchId}/deactivate`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
    })

    expect(response.status).toBe(403)
  })

  it('suggests branch codes from existing branches', async () => {
    const response = await app.request(
      '/api/branches/suggest-code?city=Accra&area=Spintex&type=RETAIL',
      {
        headers: authedHeaders(adminCookie),
      },
    )

    expect(response.status).toBe(200)
    const body = await readJson<{ code: string; adjusted: boolean }>(response)
    expect(typeof body.code).toBe('string')
    expect(body.code.startsWith('ACC-SPX')).toBe(true)
  })
})
