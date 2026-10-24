import { db } from '@sceptre/db'
import { eq, inArray } from 'drizzle-orm'
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
import { transfer, transferLine } from './transfers.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[transfers.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'transfer-test',
  actorStaffId: 'GA-TRANSFER',
  ip: null,
  userAgent: null,
  requestId: null,
}

interface TransferLineResponse {
  productId: string
  quantityRequested: number
  quantityDispatched: number
  quantityReceived: number
  unitCostMinor: number
  pending: number
}

interface TransferResponse {
  id: string
  number: string
  status: string
  fromBranchId: string
  toBranchId: string
  lineCount: number
  unitsDispatched: number
  unitsReceived: number
  lines: TransferLineResponse[]
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('transfers API', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  const createdTransferIds: string[] = []
  const createdProductIds: string[] = []
  let adminCookie = ''
  let managerACookie = ''
  let managerBCookie = ''
  let managerCCookie = ''
  let branchAId = ''
  let branchBId = ''
  let branchCId = ''
  let productAId = ''
  let productBId = ''
  let categoryId = ''
  let uomId = ''
  let transferOneId = ''
  let transferTwoId = ''
  let transferThreeId = ''

  async function createBranch(label: string): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `TR${randomToken(2)}-${label}`,
        name: `Transfer Branch ${label}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function createTransfer(
    cookie: string,
    fromBranchId: string,
    toBranchId: string,
    lines: { productId: string; quantityRequested: number }[],
  ): Promise<TransferResponse> {
    const response = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ fromBranchId, toBranchId, lines }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ transfer: TransferResponse }>(response)
    createdTransferIds.push(body.transfer.id)
    return body.transfer
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    branchAId = await createBranch('A')
    branchBId = await createBranch('B')
    branchCId = await createBranch('C')

    const managerA = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Transfer Manager A',
    })
    createdUserIds.push(managerA.id)
    managerACookie = await signIn(managerA.email)

    const managerB = await createTestUser({
      role: 'MANAGER',
      branchId: branchBId,
      name: 'Transfer Manager B',
    })
    createdUserIds.push(managerB.id)
    managerBCookie = await signIn(managerB.email)

    const managerC = await createTestUser({
      role: 'MANAGER',
      branchId: branchCId,
      name: 'Transfer Manager C',
    })
    createdUserIds.push(managerC.id)
    managerCCookie = await signIn(managerC.email)

    const units = await db
      .insert(uom)
      .values({ code: `T${suffix}`.toUpperCase(), name: `Transfer Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''
    const categories = await db
      .insert(category)
      .values({ name: `Transfer Cat ${suffix}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `TRF-${suffix}-1`,
          name: `Transfer Product One ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_000,
        },
        {
          sku: `TRF-${suffix}-2`,
          name: `Transfer Product Two ${suffix}`,
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
        quantityDelta: 20,
        unitCostMinor: 1_000,
        referenceType: 'RECEIPT',
      },
      {
        productId: productBId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 10,
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
    if (createdTransferIds.length > 0) {
      await db.delete(transferLine).where(inArray(transferLine.transferId, createdTransferIds))
      await db.delete(transfer).where(inArray(transfer.id, createdTransferIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('creates drafts in either direction and validates the edges', async () => {
    const outgoing = await createTransfer(managerACookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 8 },
      { productId: productBId, quantityRequested: 4 },
    ])
    expect(outgoing.number).toMatch(/^TRF-\d{5}$/)
    expect(outgoing.status).toBe('DRAFT')
    expect(outgoing.lineCount).toBe(2)
    transferOneId = outgoing.id

    const incoming = await createTransfer(managerACookie, branchBId, branchAId, [
      { productId: productAId, quantityRequested: 3 },
    ])
    expect(incoming.fromBranchId).toBe(branchBId)
    expect(incoming.toBranchId).toBe(branchAId)
    await app.request(`/api/transfers/${incoming.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const sameBranch = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        fromBranchId: branchAId,
        toBranchId: branchAId,
        lines: [{ productId: productAId, quantityRequested: 1 }],
      }),
    })
    expect(sameBranch.status).toBe(409)

    const unrelated = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(managerCCookie),
      body: JSON.stringify({
        fromBranchId: branchAId,
        toBranchId: branchBId,
        lines: [{ productId: productAId, quantityRequested: 1 }],
      }),
    })
    expect(unrelated.status).toBe(403)

    const foreignRead = await app.request(`/api/transfers/${transferOneId}`, {
      headers: authedHeaders(managerCCookie),
    })
    expect(foreignRead.status).toBe(403)

    const foreignList = await app.request('/api/transfers', {
      headers: authedHeaders(managerCCookie),
    })
    expect(foreignList.status).toBe(200)
    const foreignBody = await readJson<{ transfers: TransferResponse[] }>(foreignList)
    expect(foreignBody.transfers).toHaveLength(0)
  })

  it('replaces draft lines and cancels a draft', async () => {
    const replace = await app.request(`/api/transfers/${transferOneId}/lines`, {
      method: 'PUT',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantityRequested: 8 },
          { productId: productBId, quantityRequested: 4 },
        ],
      }),
    })
    expect(replace.status).toBe(200)

    const detail = await app.request(`/api/transfers/${transferOneId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(detail.status).toBe(200)
    const body = await readJson<{ transfer: TransferResponse }>(detail)
    expect(body.transfer.lineCount).toBe(2)

    const cancelDraft = await createTransfer(managerACookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 1 },
    ])
    const cancelled = await app.request(`/api/transfers/${cancelDraft.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelled.status).toBe(200)

    const editCancelled = await app.request(`/api/transfers/${cancelDraft.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ note: 'too late' }),
    })
    expect(editCancelled.status).toBe(409)
  })

  it('dispatches from the source only and deducts stock atomically', async () => {
    const wrongSide = await app.request(`/api/transfers/${transferOneId}/dispatch`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantityDispatched: 8 },
          { productId: productBId, quantityDispatched: 4 },
        ],
      }),
    })
    expect(wrongSide.status).toBe(403)

    const dispatched = await app.request(`/api/transfers/${transferOneId}/dispatch`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantityDispatched: 8 },
          { productId: productBId, quantityDispatched: 4 },
        ],
      }),
    })
    expect(dispatched.status).toBe(200)
    const body = await readJson<{ transfer: TransferResponse }>(dispatched)
    expect(body.transfer.status).toBe('DISPATCHED')
    expect(body.transfer.lines.find((line) => line.productId === productAId)?.unitCostMinor).toBe(
      1_000,
    )

    const sourceA = await findLevel(productAId, branchAId)
    expect(sourceA?.quantityOnHand).toBe(12)
    const sourceB = await findLevel(productBId, branchAId)
    expect(sourceB?.quantityOnHand).toBe(6)

    const redispatch = await app.request(`/api/transfers/${transferOneId}/dispatch`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantityDispatched: 1 },
          { productId: productBId, quantityDispatched: 0 },
        ],
      }),
    })
    expect(redispatch.status).toBe(409)

    const oversizeDraft = await createTransfer(managerACookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 100 },
    ])
    transferThreeId = oversizeDraft.id
    const oversize = await app.request(`/api/transfers/${transferThreeId}/dispatch`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityDispatched: 100 }] }),
    })
    expect(oversize.status).toBe(409)

    const unchanged = await findLevel(productAId, branchAId)
    expect(unchanged?.quantityOnHand).toBe(12)
  })

  it('receives partially at the destination and completes later', async () => {
    const wrongSide = await app.request(`/api/transfers/${transferOneId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityReceived: 1 }] }),
    })
    expect(wrongSide.status).toBe(403)

    const partial = await app.request(`/api/transfers/${transferOneId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantityReceived: 3 },
          { productId: productBId, quantityReceived: 4 },
        ],
      }),
    })
    expect(partial.status).toBe(200)
    const partialBody = await readJson<{ transfer: TransferResponse }>(partial)
    expect(partialBody.transfer.status).toBe('DISPATCHED')

    const destinationA = await findLevel(productAId, branchBId)
    expect(destinationA?.quantityOnHand).toBe(3)
    const destinationB = await findLevel(productBId, branchBId)
    expect(destinationB?.quantityOnHand).toBe(4)

    const overReceive = await app.request(`/api/transfers/${transferOneId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityReceived: 6 }] }),
    })
    expect(overReceive.status).toBe(409)

    const remainder = await app.request(`/api/transfers/${transferOneId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityReceived: 5 }] }),
    })
    expect(remainder.status).toBe(200)
    const remainderBody = await readJson<{ transfer: TransferResponse }>(remainder)
    expect(remainderBody.transfer.status).toBe('RECEIVED')
    expect(remainderBody.transfer.unitsDispatched).toBe(12)
    expect(remainderBody.transfer.unitsReceived).toBe(12)

    const received = await findLevel(productAId, branchBId)
    expect(received?.quantityOnHand).toBe(8)
    expect(await inventoryService.reconcileBranch(branchBId)).toEqual([])
  })

  it('short-closes a short transfer and refuses further receipts', async () => {
    const created = await createTransfer(managerACookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 5 },
    ])
    transferTwoId = created.id

    const dispatched = await app.request(`/api/transfers/${transferTwoId}/dispatch`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityDispatched: 5 }] }),
    })
    expect(dispatched.status).toBe(200)

    const partial = await app.request(`/api/transfers/${transferTwoId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityReceived: 2 }] }),
    })
    expect(partial.status).toBe(200)

    const shortClose = await app.request(`/api/transfers/${transferTwoId}/short-close`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ note: 'Two units missing from the carton' }),
    })
    expect(shortClose.status).toBe(200)
    const body = await readJson<{ transfer: TransferResponse }>(shortClose)
    expect(body.transfer.status).toBe('SHORT_CLOSED')

    const lateReceive = await app.request(`/api/transfers/${transferTwoId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityReceived: 3 }] }),
    })
    expect(lateReceive.status).toBe(409)

    const shortClosedLevel = await findLevel(productAId, branchBId)
    expect(shortClosedLevel?.quantityOnHand).toBe(10)

    const sourceLevel = await findLevel(productAId, branchAId)
    expect(sourceLevel?.quantityOnHand).toBe(7)
    expect(await inventoryService.reconcileBranch(branchAId)).toEqual([])
    expect(await inventoryService.reconcileBranch(branchBId)).toEqual([])
  })

  it('lists transfers with manager scoping and status filters', async () => {
    const managerList = await app.request('/api/transfers?status=RECEIVED', {
      headers: authedHeaders(managerACookie),
    })
    expect(managerList.status).toBe(200)
    const body = await readJson<{ transfers: TransferResponse[] }>(managerList)
    expect(body.transfers.every((row) => row.status === 'RECEIVED')).toBe(true)
    expect(
      body.transfers.every((row) => row.fromBranchId === branchAId || row.toBranchId === branchAId),
    ).toBe(true)

    const destinationList = await app.request('/api/transfers', {
      headers: authedHeaders(managerBCookie),
    })
    const destinationBody = await readJson<{ transfers: TransferResponse[] }>(destinationList)
    expect(destinationBody.transfers.length).toBeGreaterThanOrEqual(2)

    const outgoingOnly = await app.request('/api/transfers?direction=from', {
      headers: authedHeaders(managerACookie),
    })
    expect(outgoingOnly.status).toBe(200)
    const outgoingBody = await readJson<{ transfers: TransferResponse[] }>(outgoingOnly)
    expect(outgoingBody.transfers.length).toBeGreaterThan(0)
    expect(outgoingBody.transfers.every((row) => row.fromBranchId === branchAId)).toBe(true)

    const incomingOnly = await app.request('/api/transfers?direction=to', {
      headers: authedHeaders(managerBCookie),
    })
    expect(incomingOnly.status).toBe(200)
    const incomingBody = await readJson<{ transfers: TransferResponse[] }>(incomingOnly)
    expect(incomingBody.transfers.length).toBeGreaterThan(0)
    expect(incomingBody.transfers.every((row) => row.toBranchId === branchBId)).toBe(true)

    const adminList = await app.request('/api/transfers', {
      headers: authedHeaders(adminCookie),
    })
    expect(adminList.status).toBe(200)
    const adminBody = await readJson<{ total: number }>(adminList)
    expect(adminBody.total).toBeGreaterThanOrEqual(4)
  })
})
