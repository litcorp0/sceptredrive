import { randomUUID } from 'node:crypto'
import { db } from '@sceptre/db'
import { inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { branch } from '../org/branches.schema.ts'
import { approval } from './approvals.schema.ts'

/**
 * The inbox as a client sees it: who may read it, what it is ordered by, and the
 * one count endpoint behind the nav badge (P12-D5).
 */

const available = await databaseAvailable()
if (!available) console.warn('[approvals.api.test] database unavailable; tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

let branchCId = ''
let branchDId = ''
let branchEId = ''
let branchFId = ''
let adminId = ''
let managerCId = ''
let managerEId = ''
let cashierId = ''
let adminCookie = ''
let managerCCookie = ''
let managerECookie = ''
let cashierCookie = ''

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function listOf(cookie: string, query = '') {
  return app.request(`/api/approvals${query}`, { headers: authedHeaders(cookie) })
}

beforeAll(async () => {
  if (!available) return

  const branches = await db
    .insert(branch)
    .values([
      { code: `CC${suffix.slice(-6)}`, name: `Inbox C ${suffix}`, city: 'Accra' },
      { code: `DD${suffix.slice(-6)}`, name: `Inbox D ${suffix}`, city: 'Kumasi' },
      { code: `EE${suffix.slice(-6)}`, name: `Inbox E ${suffix}`, city: 'Tema' },
      { code: `FF${suffix.slice(-6)}`, name: `Inbox F ${suffix}`, city: 'Takoradi' },
    ])
    .returning({ id: branch.id })
  branchCId = branches[0]?.id ?? ''
  branchDId = branches[1]?.id ?? ''
  branchEId = branches[2]?.id ?? ''
  branchFId = branches[3]?.id ?? ''

  const admin = await createTestUser({ role: 'ADMIN', email: `inbox-admin-${suffix}@test.local` })
  const managerC = await createTestUser({
    role: 'MANAGER',
    branchId: branchCId,
    email: `inbox-mgr-c-${suffix}@test.local`,
  })
  const managerE = await createTestUser({
    role: 'MANAGER',
    branchId: branchEId,
    email: `inbox-mgr-e-${suffix}@test.local`,
  })
  const cashier = await createTestUser({
    role: 'CASHIER',
    branchId: branchCId,
    email: `inbox-cashier-${suffix}@test.local`,
  })
  adminId = admin.id
  managerCId = managerC.id
  managerEId = managerE.id
  cashierId = cashier.id

  adminCookie = await signIn(admin.email)
  managerCCookie = await signIn(managerC.email)
  managerECookie = await signIn(managerE.email)
  cashierCookie = await signIn(cashier.email)
})

afterAll(async () => {
  if (!available) return
  await db
    .delete(approval)
    .where(inArray(approval.branchId, [branchCId, branchDId, branchEId, branchFId]))
  for (const id of [adminId, managerCId, managerEId, cashierId]) {
    if (id) await deleteTestUser(id)
  }
  await db.delete(branch).where(inArray(branch.id, [branchCId, branchDId, branchEId, branchFId]))
})

describe.skipIf(!available)('approval routes', () => {
  it('requires a session and approval.read', async () => {
    const anonymous = await app.request('/api/approvals')
    expect(anonymous.status).toBe(401)

    const cashier = await listOf(cashierCookie)
    expect(cashier.status).toBe(403)
  })

  it('serves the inbox to an admin and to a manager', async () => {
    const admin = await listOf(adminCookie)
    expect(admin.status).toBe(200)
    expect((await readJson<{ branchId: string | null }>(admin)).branchId).toBeNull()

    const manager = await listOf(managerCCookie)
    expect(manager.status).toBe(200)
    expect((await readJson<{ branchId: string | null }>(manager)).branchId).toBe(branchCId)
  })

  it('shows a manager both sides of a request and refuses a foreign branch filter', async () => {
    const [own] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchCId,
        requestedBy: managerEId,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
      })
      .returning({ id: approval.id })

    const [other] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchDId,
        requestedBy: managerEId,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
      })
      .returning({ id: approval.id })

    // Raised at D, decided by C: the source manager must see it (P12-D11).
    const [twoSided] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchDId,
        requestedBy: managerEId,
        deciderRole: 'MANAGER',
        deciderBranchId: branchCId,
        payload: {},
      })
      .returning({ id: approval.id })

    const list = await listOf(managerCCookie, '?limit=200')
    const ids = (await readJson<{ approvals: { id: string }[] }>(list)).approvals.map(
      (row) => row.id,
    )
    expect(ids).toContain(own?.id)
    expect(ids).toContain(twoSided?.id)
    expect(ids).not.toContain(other?.id)

    const detail = await app.request(`/api/approvals/${twoSided?.id}`, {
      headers: authedHeaders(managerCCookie),
    })
    expect(detail.status).toBe(200)
    const detailBody = await readJson<{ canDecide: boolean; subject: { kind: string } }>(detail)
    expect(detailBody.canDecide).toBe(true)
    expect(detailBody.subject.kind).toBe('product')

    const smuggled = await listOf(managerCCookie, `?branchId=${branchDId}`)
    expect(smuggled.status).toBe(403)
  })

  it('refuses a manager the decision on an admin-authority row', async () => {
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchCId,
        requestedBy: managerEId,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
      })
      .returning({ id: approval.id })

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(managerCCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(403)
  })

  it('orders the inbox oldest first by default and newest on request', async () => {
    const base = Date.now() - 60_000
    const inserted = await db
      .insert(approval)
      .values([
        {
          type: 'PRODUCT_CREATE',
          branchId: branchCId,
          requestedBy: managerEId,
          requestedAt: new Date(base),
        },
        {
          type: 'PRODUCT_CREATE',
          branchId: branchCId,
          requestedBy: managerEId,
          requestedAt: new Date(base + 1_000),
        },
        {
          type: 'PRODUCT_CREATE',
          branchId: branchCId,
          requestedBy: managerEId,
          requestedAt: new Date(base + 2_000),
        },
      ])
      .returning({ id: approval.id })
    const [first, second, third] = inserted.map((row) => row.id)

    const oldest = await listOf(managerCCookie, '?limit=200')
    const oldestIds = (await readJson<{ approvals: { id: string }[] }>(oldest)).approvals.map(
      (row) => row.id,
    )
    expect(oldestIds.filter((id) => inserted.some((row) => row.id === id))).toEqual([
      first,
      second,
      third,
    ])

    const newest = await listOf(managerCCookie, '?limit=200&sort=newest')
    const newestIds = (await readJson<{ approvals: { id: string }[] }>(newest)).approvals.map(
      (row) => row.id,
    )
    expect(newestIds.filter((id) => inserted.some((row) => row.id === id))).toEqual([
      third,
      second,
      first,
    ])
  })

  it('filters the inbox by entity', async () => {
    const entityId = randomUUID()
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRICE_CHANGE',
        entityId,
        branchId: branchCId,
        requestedBy: managerEId,
        payload: { productId: entityId },
      })
      .returning({ id: approval.id })

    const response = await listOf(adminCookie, `?entityId=${entityId}`)
    expect(response.status).toBe(200)

    const body = await readJson<{ approvals: { id: string }[]; total: number }>(response)
    expect(body.total).toBe(1)
    expect(body.approvals.map((item) => item.id)).toEqual([row?.id])
  })

  it('summarises pending work by type, and is not shadowed by the id route', async () => {
    await db.insert(approval).values([
      { type: 'PRODUCT_CREATE', branchId: branchEId, requestedBy: managerCId },
      { type: 'PRODUCT_CREATE', branchId: branchEId, requestedBy: managerCId },
      {
        type: 'PURCHASE_ORDER',
        branchId: branchEId,
        requestedBy: managerCId,
        status: 'APPROVED',
      },
      { type: 'PRODUCT_CREATE', branchId: branchFId, requestedBy: managerCId },
    ])

    const response = await app.request(`/api/approvals/summary?branchId=${branchEId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)

    const body = await readJson<{
      pending: number
      byType: Record<string, number>
      branchId: string | null
    }>(response)
    expect(body.pending).toBe(2)
    expect(body.byType.PRODUCT_CREATE).toBe(2)
    expect(body.byType.PURCHASE_ORDER).toBe(0)
    expect(body.byType.REFUND).toBe(0)
    expect(Object.keys(body.byType)).toHaveLength(8)
    expect(body.branchId).toBe(branchEId)

    // A manager's badge is their own branch, without asking for it.
    const manager = await app.request('/api/approvals/summary', {
      headers: authedHeaders(managerECookie),
    })
    expect(manager.status).toBe(200)
    const managerBody = await readJson<{ pending: number; branchId: string | null }>(manager)
    expect(managerBody.pending).toBe(2)
    expect(managerBody.branchId).toBe(branchEId)

    // `summary` reaches its handler instead of the uuid param validator's 400.
    const shadowed = await app.request('/api/approvals/summary', {
      headers: authedHeaders(adminCookie),
    })
    expect(shadowed.status).toBe(200)
  })

  it('refuses a manager another branch in the summary query', async () => {
    const response = await app.request(`/api/approvals/summary?branchId=${branchFId}`, {
      headers: authedHeaders(managerECookie),
    })
    expect(response.status).toBe(403)
  })

  it('exposes the subject discriminator on every list row', async () => {
    const response = await listOf(adminCookie, `?branchId=${branchEId}`)
    const body = await readJson<{ approvals: { type: string; subjectKind: string }[] }>(response)
    expect(body.approvals.length).toBeGreaterThan(0)
    for (const row of body.approvals) {
      expect(row.subjectKind).toBe(row.type === 'PRODUCT_CREATE' ? 'product' : 'purchase_order')
    }
  })
})
