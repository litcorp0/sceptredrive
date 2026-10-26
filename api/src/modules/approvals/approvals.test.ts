import { randomUUID } from 'node:crypto'
import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  signIn,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { product } from '../products/products.schema.ts'
import { approval } from './approvals.schema.ts'
import { requestApproval } from './approvals.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[approvals.test] database unavailable; integration tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

let branchAId = ''
let branchBId = ''
let categoryId = ''
let uomId = ''
let adminId = ''
let managerAId = ''
let managerBId = ''
let adminCookie = ''
let managerACookie = ''
let managerBCookie = ''
const productNames: string[] = []

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function submission(name: string) {
  return {
    name,
    categoryId,
    uomId,
    proposedBasePriceMinor: 12_500,
    description: 'Proposed by a branch manager',
    note: 'We keep selling out',
  }
}

/** A service-level actor, for the request paths no HTTP route exposes directly. */
function testActor(id: string): AuditActor {
  return { actorId: id, actorStaffId: null, ip: null, userAgent: null, requestId: null }
}

beforeAll(async () => {
  if (!available) return

  const branches = await db
    .insert(branch)
    .values([
      { code: `AA${suffix.slice(-6)}`, name: `Approval A ${suffix}`, city: 'Accra' },
      { code: `BB${suffix.slice(-6)}`, name: `Approval B ${suffix}`, city: 'Kumasi' },
    ])
    .returning({ id: branch.id })
  branchAId = branches[0]?.id ?? ''
  branchBId = branches[1]?.id ?? ''

  const [unit] = await db
    .insert(uom)
    .values({ code: `U${suffix.slice(-5)}`, name: `Unit ${suffix}` })
    .returning({ id: uom.id })
  uomId = unit?.id ?? ''

  const [categoryRow] = await db
    .insert(category)
    .values({ name: `Approval category ${suffix}` })
    .returning({ id: category.id })
  categoryId = categoryRow?.id ?? ''

  const admin = await createTestUser({ role: 'ADMIN', email: `ap-admin-${suffix}@test.local` })
  const managerA = await createTestUser({
    role: 'MANAGER',
    branchId: branchAId,
    email: `ap-mgr-a-${suffix}@test.local`,
  })
  const managerB = await createTestUser({
    role: 'MANAGER',
    branchId: branchBId,
    email: `ap-mgr-b-${suffix}@test.local`,
  })
  adminId = admin.id
  managerAId = managerA.id
  managerBId = managerB.id

  adminCookie = await signIn(admin.email)
  managerACookie = await signIn(managerA.email)
  managerBCookie = await signIn(managerB.email)
})

afterAll(async () => {
  if (!available) return
  if (categoryId) {
    await db.delete(product).where(eq(product.categoryId, categoryId))
  } else if (productNames.length > 0) {
    await db.delete(product).where(inArray(product.name, productNames))
  }
  await db.delete(approval).where(inArray(approval.branchId, [branchAId, branchBId]))
  await db.delete(category).where(eq(category.id, categoryId))
  await db.delete(uom).where(eq(uom.id, uomId))
  for (const id of [adminId, managerAId, managerBId]) {
    if (id) await deleteTestUser(id)
  }
  await db.delete(branch).where(inArray(branch.id, [branchAId, branchBId]))
})

describe.skipIf(!available)('approvals', () => {
  let approvalId = ''
  const firstName = `Submitted ${suffix}`

  it('lets a manager submit a product without creating one', async () => {
    const response = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify(submission(firstName)),
    })
    expect(response.status).toBe(201)

    const body = await readJson<{ approvalId: string; status: string }>(response)
    expect(body.status).toBe('PENDING')
    approvalId = body.approvalId

    const rows = await db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.name, firstName))
    expect(rows).toHaveLength(0)
  })

  it('shows the pending request to its branch, and to nobody else', async () => {
    const own = await app.request('/api/approvals?status=PENDING', {
      headers: authedHeaders(managerACookie),
    })
    expect(own.status).toBe(200)
    const ownBody = await readJson<{ approvals: { id: string }[]; branchId: string | null }>(own)
    expect(ownBody.branchId).toBe(branchAId)
    expect(ownBody.approvals.map((row) => row.id)).toContain(approvalId)

    const other = await app.request('/api/approvals?status=PENDING', {
      headers: authedHeaders(managerBCookie),
    })
    const otherBody = await readJson<{ approvals: { id: string }[] }>(other)
    expect(otherBody.approvals.map((row) => row.id)).not.toContain(approvalId)

    const smuggled = await app.request(`/api/approvals?branchId=${branchAId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(smuggled.status).toBe(403)

    const detail = await app.request(`/api/approvals/${approvalId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(detail.status).toBe(403)
  })

  it('refuses a manager the decision', async () => {
    const response = await app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(403)
  })

  it('creates the product only when an admin approves it', async () => {
    const before = await app.request(`/api/approvals/${approvalId}`, {
      headers: authedHeaders(adminCookie),
    })
    const beforeBody = await readJson<{ canDecide: boolean; subject: { kind: string } }>(before)
    expect(beforeBody.canDecide).toBe(true)
    expect(beforeBody.subject.kind).toBe('product')

    const response = await app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(200)

    const body = await readJson<{ approval: { status: string; entityId: string | null } }>(response)
    expect(body.approval.status).toBe('APPROVED')
    expect(body.approval.entityId).toBeTruthy()

    const rows = await db.select().from(product).where(eq(product.name, firstName))
    expect(rows).toHaveLength(1)
    expect(rows[0]?.basePriceMinor).toBe(12_500)
    expect(rows[0]?.costPriceMinor).toBe(0)
    expect(rows[0]?.id).toBe(body.approval.entityId)
  })

  it('refuses a second decision', async () => {
    const response = await app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'REJECTED', reasonCode: 'DUPLICATE' }),
    })
    expect(response.status).toBe(409)

    const rows = await db
      .select({ id: product.id })
      .from(product)
      .where(eq(product.name, firstName))
    expect(rows).toHaveLength(1)
  })

  it('requires a reason to reject, and creates nothing when rejected', async () => {
    const name = `Rejected ${suffix}`
    const submitted = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify(submission(name)),
    })
    const { approvalId: rejectedId } = await readJson<{ approvalId: string }>(submitted)

    const missingReason = await app.request(`/api/approvals/${rejectedId}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'REJECTED' }),
    })
    expect(missingReason.status).toBe(400)

    const rejected = await app.request(`/api/approvals/${rejectedId}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        decision: 'REJECTED',
        reasonCode: 'PRICE_TOO_HIGH',
        note: 'Buy it cheaper first',
      }),
    })
    expect(rejected.status).toBe(200)

    const rows = await db.select({ id: product.id }).from(product).where(eq(product.name, name))
    expect(rows).toHaveLength(0)
  })

  it('refuses self-approval even for an admin', async () => {
    const [owned] = await db
      .insert(approval)
      .values({
        type: 'PURCHASE_ORDER',
        entityId: randomUUID(),
        branchId: branchAId,
        requestedBy: adminId,
        amountMinor: 2_000_000,
      })
      .returning({ id: approval.id })

    const response = await app.request(`/api/approvals/${owned?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(403)
  })

  it('lets only the requester withdraw a pending request', async () => {
    const name = `Withdrawn ${suffix}`
    const submitted = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify(submission(name)),
    })
    const { approvalId: withdrawnId } = await readJson<{ approvalId: string }>(submitted)

    const notMine = await app.request(`/api/approvals/${withdrawnId}/withdraw`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })
    expect(notMine.status).toBe(403)

    const mine = await app.request(`/api/approvals/${withdrawnId}/withdraw`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(mine.status, await mine.clone().text()).toBe(200)

    const body = await readJson<{ approval: { status: string } }>(mine)
    expect(body.approval.status).toBe('WITHDRAWN')
  })

  it('sends an admin to the catalogue instead of submitting to themselves', async () => {
    const response = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(submission(`Admin ${suffix}`)),
    })
    expect(response.status).toBe(400)
  })

  it('rejects an unknown field', async () => {
    const response = await app.request('/api/products/submissions', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ ...submission(`Strict ${suffix}`), costPriceMinor: 100 }),
    })
    expect(response.status).toBe(400)
  })

  it('records the requester on the audit trail', async () => {
    const pending = await db
      .select({ id: approval.id, requestedBy: approval.requestedBy })
      .from(approval)
      .where(and(eq(approval.branchId, branchAId), eq(approval.status, 'PENDING')))
    expect(pending.length).toBeGreaterThan(0)
    expect(pending[0]?.requestedBy).toBeTruthy()
  })

  it('lets an admin decide an admin-authority row raised in another branch', async () => {
    const name = `Cross branch ${suffix}`
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchBId,
        requestedBy: managerBId,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
        amountMinor: 12_500,
        payload: submission(name),
      })
      .returning({ id: approval.id })

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status, await response.clone().text()).toBe(200)

    const rows = await db.select().from(product).where(eq(product.name, name))
    expect(rows).toHaveLength(1)
  })

  it('refuses a manager an admin-authority row, even in their own branch', async () => {
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchAId,
        requestedBy: managerBId,
        deciderRole: 'ADMIN',
        deciderBranchId: null,
        payload: submission(`Admin authority ${suffix}`),
      })
      .returning({ id: approval.id })

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(403)
  })

  it('lets the branch manager decide a manager-authority row', async () => {
    const name = `Manager authority ${suffix}`
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchAId,
        requestedBy: managerBId,
        deciderRole: 'MANAGER',
        deciderBranchId: branchAId,
        amountMinor: 12_500,
        payload: submission(name),
      })
      .returning({ id: approval.id })

    const detail = await app.request(`/api/approvals/${row?.id}`, {
      headers: authedHeaders(managerACookie),
    })
    expect(detail.status).toBe(200)
    expect((await readJson<{ canDecide: boolean }>(detail)).canDecide).toBe(true)

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status, await response.clone().text()).toBe(200)

    const rows = await db.select().from(product).where(eq(product.name, name))
    expect(rows).toHaveLength(1)
  })

  it('refuses the same row to a manager from another branch', async () => {
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchAId,
        requestedBy: adminId,
        deciderRole: 'MANAGER',
        deciderBranchId: branchAId,
        payload: submission(`Other branch ${suffix}`),
      })
      .returning({ id: approval.id })

    const detail = await app.request(`/api/approvals/${row?.id}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(detail.status).toBe(403)

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(403)
  })

  it('refuses self-approval by a manager', async () => {
    const name = `Own request ${suffix}`
    const [row] = await db
      .insert(approval)
      .values({
        type: 'PRODUCT_CREATE',
        branchId: branchAId,
        requestedBy: managerAId,
        deciderRole: 'MANAGER',
        deciderBranchId: branchAId,
        payload: submission(name),
      })
      .returning({ id: approval.id })

    const response = await app.request(`/api/approvals/${row?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(response.status).toBe(403)

    const rows = await db.select({ id: product.id }).from(product).where(eq(product.name, name))
    expect(rows).toHaveLength(0)
  })

  it('defaults the authority from the shared table when a request omits it', async () => {
    const adminRow = await requestApproval(
      testActor(managerAId),
      { type: 'PURCHASE_ORDER', entityId: randomUUID(), branchId: branchAId, amountMinor: 1_000 },
      db,
    )
    expect(adminRow.deciderRole).toBe('ADMIN')
    expect(adminRow.deciderBranchId).toBeNull()

    const managerRow = await requestApproval(
      testActor(managerBId),
      { type: 'SHIFT_VARIANCE_REVIEW', branchId: branchAId },
      db,
    )
    expect(managerRow.deciderRole).toBe('MANAGER')
    expect(managerRow.deciderBranchId).toBe(branchAId)
  })

  it('refuses a malformed decider pairing at request time', async () => {
    await expect(
      requestApproval(
        testActor(managerAId),
        {
          type: 'TRANSFER_REQUEST',
          branchId: branchAId,
          deciderRole: 'MANAGER',
          deciderBranchId: null,
        },
        db,
      ),
    ).rejects.toMatchObject({ statusCode: 500 })

    await expect(
      requestApproval(
        testActor(managerAId),
        {
          type: 'PURCHASE_ORDER',
          branchId: branchAId,
          deciderRole: 'ADMIN',
          deciderBranchId: branchAId,
        },
        db,
      ),
    ).rejects.toMatchObject({ statusCode: 500 })
  })
})
