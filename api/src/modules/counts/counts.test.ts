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
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { findLevel } from '../inventory/inventory.repository.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import { branch } from '../org/branches.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { product } from '../products/products.schema.ts'
import { stockCount, stockCountLine } from './counts.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[counts.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'count-test',
  actorStaffId: 'GA-COUNT',
  ip: null,
  userAgent: null,
  requestId: null,
}

interface CountLineResponse {
  productId: string
  sku: string
  productName: string
  snapshotQty: number
  countedQty: number | null
  variance: number | null
}

interface CountResponse {
  id: string
  number: string
  status: string
  branchId: string
  lineCount: number
  countedCount: number
  varianceUnits: number
  lines: CountLineResponse[]
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('stock counts API', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  const createdCountIds: string[] = []
  const createdProductIds: string[] = []
  let adminCookie = ''
  let managerACookie = ''
  let managerBCookie = ''
  let branchAId = ''
  let branchBId = ''
  let productAId = ''
  let productBId = ''
  let categoryId = ''
  let emptyCategoryId = ''
  let uomId = ''
  let countOneId = ''

  async function createBranch(label: string): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `CT${randomToken(2)}-${label}`,
        name: `Count Branch ${label}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function createCount(
    cookie: string,
    branchId: string,
    categoryIdOption?: string,
  ): Promise<CountResponse> {
    const response = await app.request('/api/counts', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({
        branchId,
        ...(categoryIdOption ? { categoryId: categoryIdOption } : {}),
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ count: CountResponse }>(response)
    createdCountIds.push(body.count.id)
    return body.count
  }

  async function setCounted(
    cookie: string,
    countId: string,
    lines: { productId: string; countedQty: number | null }[],
  ): Promise<Response> {
    return app.request(`/api/counts/${countId}/lines`, {
      method: 'PATCH',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ lines }),
    })
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    branchAId = await createBranch('A')
    branchBId = await createBranch('B')

    const managerA = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Count Manager A',
    })
    createdUserIds.push(managerA.id)
    managerACookie = await signIn(managerA.email)

    const managerB = await createTestUser({
      role: 'MANAGER',
      branchId: branchBId,
      name: 'Count Manager B',
    })
    createdUserIds.push(managerB.id)
    managerBCookie = await signIn(managerB.email)

    const units = await db
      .insert(uom)
      .values({ code: `C${suffix}`.toUpperCase(), name: `Count Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''

    const categories = await db
      .insert(category)
      .values([{ name: `Count Cat ${suffix}` }, { name: `Empty Cat ${suffix}` }])
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''
    emptyCategoryId = categories[1]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `CNT-${suffix}-1`,
          name: `Count Product One ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_000,
        },
        {
          sku: `CNT-${suffix}-2`,
          name: `Count Product Two ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 2_000,
          basePriceMinor: 4_000,
        },
      ])
      .returning({ id: product.id })
    productAId = products[0]?.id ?? ''
    productBId = products[1]?.id ?? ''
    createdProductIds.push(productAId, productBId)

    await inventoryService.postMovements(actor, [
      {
        productId: productAId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 10,
        unitCostMinor: 1_000,
        referenceType: 'RECEIPT',
      },
      {
        productId: productBId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 6,
        unitCostMinor: 2_000,
        referenceType: 'RECEIPT',
      },
    ])
  })

  afterAll(async () => {
    if (createdBranchIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
    }
    if (createdCountIds.length > 0) {
      await db.delete(stockCountLine).where(inArray(stockCountLine.countId, createdCountIds))
      await db.delete(stockCount).where(inArray(stockCount.id, createdCountIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (emptyCategoryId) await db.delete(category).where(eq(category.id, emptyCategoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('opens a count with a frozen snapshot and enforces access', async () => {
    const count = await createCount(managerACookie, branchAId)
    countOneId = count.id
    expect(count.number).toMatch(/^CNT-\d{5}$/)
    expect(count.status).toBe('OPEN')
    expect(count.lineCount).toBe(2)
    const first = count.lines.find((line) => line.productId === productAId)
    expect(first?.snapshotQty).toBe(10)
    const second = count.lines.find((line) => line.productId === productBId)
    expect(second?.snapshotQty).toBe(6)

    const foreignCreate = await app.request('/api/counts', {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ branchId: branchAId }),
    })
    expect(foreignCreate.status).toBe(403)

    const foreignRead = await app.request(`/api/counts/${countOneId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(foreignRead.status).toBe(403)

    const emptyFilter = await app.request('/api/counts', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ branchId: branchAId, categoryId: emptyCategoryId }),
    })
    expect(emptyFilter.status).toBe(409)

    const filtered = await createCount(managerACookie, branchAId, categoryId)
    expect(filtered.lineCount).toBe(2)
    const cancelFiltered = await app.request(`/api/counts/${filtered.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelFiltered.status).toBe(200)
  })

  it('records counted quantities and posts variances as movements', async () => {
    const update = await setCounted(managerACookie, countOneId, [
      { productId: productAId, countedQty: 7 },
      { productId: productBId, countedQty: 8 },
    ])
    expect(update.status).toBe(200)
    const updatedBody = await readJson<{ count: CountResponse }>(update)
    expect(updatedBody.count.countedCount).toBe(2)
    expect(updatedBody.count.varianceUnits).toBe(-3 + 2)

    const unknown = await setCounted(managerACookie, countOneId, [
      { productId: '00000000-0000-4000-8000-000000000000', countedQty: 1 },
    ])
    expect(unknown.status).toBe(400)

    const posted = await app.request(`/api/counts/${countOneId}/post`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(posted.status).toBe(200)
    const postedBody = await readJson<{ count: CountResponse }>(posted)
    expect(postedBody.count.status).toBe('POSTED')

    const levelA = await findLevel(productAId, branchAId)
    expect(levelA?.quantityOnHand).toBe(7)
    const levelB = await findLevel(productBId, branchAId)
    expect(levelB?.quantityOnHand).toBe(8)

    const movements = await db
      .select()
      .from(stockMovement)
      .where(and(eq(stockMovement.branchId, branchAId), eq(stockMovement.type, 'COUNT_VARIANCE')))
    expect(movements).toHaveLength(2)
    expect(movements.every((row) => row.referenceNumber === postedBody.count.number)).toBe(true)
    expect(await inventoryService.reconcileBranch(branchAId)).toEqual([])

    const doublePost = await app.request(`/api/counts/${countOneId}/post`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(doublePost.status).toBe(409)

    const editPosted = await setCounted(managerACookie, countOneId, [
      { productId: productAId, countedQty: 1 },
    ])
    expect(editPosted.status).toBe(409)
  })

  it('refuses a post that would make stock negative', async () => {
    const count = await createCount(managerACookie, branchAId)

    await inventoryService.postMovements(actor, [
      {
        productId: productAId,
        branchId: branchAId,
        type: 'TRANSFER_OUT',
        quantityDelta: -6,
        referenceType: 'TRANSFER',
      },
    ])
    expect((await findLevel(productAId, branchAId))?.quantityOnHand).toBe(1)

    const update = await setCounted(managerACookie, count.id, [
      { productId: productAId, countedQty: 0 },
    ])
    expect(update.status).toBe(200)

    const blocked = await app.request(`/api/counts/${count.id}/post`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(blocked.status).toBe(409)
    const blockedBody = await readJson<{ error: { message: string } }>(blocked)
    expect(blockedBody.error.message).toContain('Count Product One')

    expect((await findLevel(productAId, branchAId))?.quantityOnHand).toBe(1)
    const stillOpen = await app.request(`/api/counts/${count.id}`, {
      headers: authedHeaders(managerACookie),
    })
    const stillOpenBody = await readJson<{ count: CountResponse }>(stillOpen)
    expect(stillOpenBody.count.status).toBe('OPEN')

    const cancel = await app.request(`/api/counts/${count.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancel.status).toBe(200)
  })

  it('refuses to post a count with no counted lines', async () => {
    const count = await createCount(managerACookie, branchAId)
    const blocked = await app.request(`/api/counts/${count.id}/post`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(blocked.status).toBe(409)
    await app.request(`/api/counts/${count.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
  })

  it('lists counts with branch scoping', async () => {
    const managerList = await app.request('/api/counts', {
      headers: authedHeaders(managerACookie),
    })
    expect(managerList.status).toBe(200)
    const body = await readJson<{ counts: CountResponse[]; total: number }>(managerList)
    expect(body.total).toBeGreaterThanOrEqual(4)
    expect(body.counts.every((row) => row.branchId === branchAId)).toBe(true)

    const foreignList = await app.request('/api/counts', {
      headers: authedHeaders(managerBCookie),
    })
    const foreignBody = await readJson<{ counts: CountResponse[] }>(foreignList)
    expect(foreignBody.counts).toHaveLength(0)

    const adminList = await app.request(`/api/counts?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(adminList.status).toBe(200)
  })
})
