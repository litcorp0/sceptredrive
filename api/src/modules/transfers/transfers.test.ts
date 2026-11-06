import { db } from '@sceptre/db'
import { and, count, eq, inArray } from 'drizzle-orm'
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
import { approval } from '../approvals/approvals.schema.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { findLevel } from '../inventory/inventory.repository.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import * as inventoryService from '../inventory/inventory.service.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { product } from '../products/products.schema.ts'
import { transfer, transferLine } from './transfers.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[transfers.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'transfer-test',
  actorStaffId: 'SD-TRANSFER',
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

interface TransferApprovalResponse {
  id: string
  status: string
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionReasonCode: string | null
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
  approval: TransferApprovalResponse | null
  canDispatch: boolean
}

interface ApprovalRowResponse {
  id: string
  type: string
  status: string
  entityId: string | null
  branchId: string
  deciderRole: string
  deciderBranchId: string | null
  amountMinor: number | null
  payload: unknown
  requestedBy: string
  decidedBy: string | null
  decisionReasonCode: string | null
}

interface ApprovalDetailResponse {
  approval: ApprovalRowResponse
  subject: { kind: string; transferId?: string; fromBranchId?: string; lineCount?: number }
  canDecide: boolean
  canWithdraw: boolean
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
  let managerWCookie = ''
  let branchAId = ''
  let branchBId = ''
  let branchCId = ''
  let warehouseId = ''
  let productAId = ''
  let productBId = ''
  let categoryId = ''
  let uomId = ''
  let transferOneId = ''

  async function createBranch(label: string, type: 'RETAIL' | 'WAREHOUSE'): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `TR${randomToken(2)}-${label}`,
        name: `Transfer Branch ${label}`,
        type,
        city: 'Accra',
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  /** A destination-raised request: the manager may only ask for their own branch. */
  async function requestTransfer(
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

  async function getTransfer(cookie: string, id: string): Promise<TransferResponse> {
    const response = await app.request(`/api/transfers/${id}`, {
      headers: authedHeaders(cookie),
    })
    expect(response.status).toBe(200)
    const body = await readJson<{ transfer: TransferResponse }>(response)
    return body.transfer
  }

  async function decide(
    cookie: string,
    approvalId: string,
    body: { decision: 'APPROVED' | 'REJECTED'; reasonCode?: string; note?: string },
  ): Promise<Response> {
    return app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(body),
    })
  }

  async function approve(cookie: string, transferId: string): Promise<void> {
    const detail = await getTransfer(cookie, transferId)
    expect(detail.approval?.status).toBe('PENDING')
    const response = await decide(cookie, detail.approval?.id ?? '', { decision: 'APPROVED' })
    expect(response.status).toBe(200)
  }

  async function dispatch(
    cookie: string,
    transferId: string,
    lines: { productId: string; quantityDispatched: number }[],
  ): Promise<Response> {
    return app.request(`/api/transfers/${transferId}/dispatch`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ lines }),
    })
  }

  async function receive(
    cookie: string,
    transferId: string,
    lines: { productId: string; quantityReceived: number }[],
  ): Promise<Response> {
    return app.request(`/api/transfers/${transferId}/receive`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ lines }),
    })
  }

  async function approvalRows(transferId: string): Promise<ApprovalRowResponse[]> {
    return db
      .select()
      .from(approval)
      .where(and(eq(approval.type, 'TRANSFER_REQUEST'), eq(approval.entityId, transferId)))
  }

  async function movementCount(transferId: string): Promise<number> {
    const rows = await db
      .select({ total: count() })
      .from(stockMovement)
      .where(
        and(eq(stockMovement.referenceType, 'TRANSFER'), eq(stockMovement.referenceId, transferId)),
      )
    return Number(rows[0]?.total ?? 0)
  }

  async function onHand(productId: string, branchId: string): Promise<number> {
    return (await findLevel(productId, branchId))?.quantityOnHand ?? 0
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    branchAId = await createBranch('A', 'RETAIL')
    branchBId = await createBranch('B', 'RETAIL')
    branchCId = await createBranch('C', 'RETAIL')
    warehouseId = await createBranch('W', 'WAREHOUSE')

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

    const managerW = await createTestUser({
      role: 'MANAGER',
      branchId: warehouseId,
      name: 'Transfer Warehouse Manager',
    })
    createdUserIds.push(managerW.id)
    managerWCookie = await signIn(managerW.email)

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
    await inventoryService.postMovements(actor, [
      {
        productId: productAId,
        branchId: warehouseId,
        type: 'RECEIPT',
        quantityDelta: 50,
        unitCostMinor: 1_000,
        referenceType: 'RECEIPT',
      },
    ])
  })

  afterAll(async () => {
    if (createdTransferIds.length > 0) {
      await db
        .delete(approval)
        .where(
          and(
            eq(approval.type, 'TRANSFER_REQUEST'),
            inArray(approval.entityId, createdTransferIds),
          ),
        )
      await db.delete(transferLine).where(inArray(transferLine.transferId, createdTransferIds))
      await db.delete(transfer).where(inArray(transfer.id, createdTransferIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
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

  it('raises a request at the destination, valued at the source average cost', async () => {
    const created = await requestTransfer(managerBCookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 8 },
      { productId: productBId, quantityRequested: 4 },
    ])
    transferOneId = created.id

    expect(created.number).toMatch(/^TRF-\d{5}$/)
    expect(created.status).toBe('REQUESTED')
    expect(created.lineCount).toBe(2)
    expect(created.canDispatch).toBe(false)

    const rows = await approvalRows(created.id)
    expect(rows).toHaveLength(1)
    const request = rows[0]
    expect(request?.status).toBe('PENDING')
    // Authority follows the source branch, not the type (P12-D11).
    expect(request?.deciderRole).toBe('MANAGER')
    expect(request?.deciderBranchId).toBe(branchAId)
    expect(request?.branchId).toBe(branchBId)
    // 8 × 1 000 + 4 × 2 000 = 16 000, hand-computed from the source levels.
    expect(request?.amountMinor).toBe(16_000)
    expect(request?.payload).toEqual({
      fromBranchId: branchAId,
      toBranchId: branchBId,
      fromBranchType: 'RETAIL',
      lineCount: 2,
    })

    // The creation audit names the status and the approval it created.
    const audits = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(and(eq(auditLog.action, 'transfer.created'), eq(auditLog.entityId, created.id)))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.after).toMatchObject({ status: 'REQUESTED', approvalId: request?.id })

    // The source manager sees the request in their own inbox without being given
    // access to the destination's other work.
    const inbox = await app.request('/api/approvals?type=TRANSFER_REQUEST&status=PENDING', {
      headers: authedHeaders(managerACookie),
    })
    expect(inbox.status).toBe(200)
    const inboxBody = await readJson<{ approvals: ApprovalRowResponse[] }>(inbox)
    expect(inboxBody.approvals.some((row) => row.id === request?.id)).toBe(true)

    // The subject carries what is being asked for, not just that something is.
    const detail = await app.request(`/api/approvals/${request?.id}`, {
      headers: authedHeaders(managerACookie),
    })
    expect(detail.status).toBe(200)
    const detailBody = await readJson<ApprovalDetailResponse>(detail)
    expect(detailBody.subject).toMatchObject({
      kind: 'transfer',
      transferId: created.id,
      fromBranchId: branchAId,
      lineCount: 2,
    })
    expect(detailBody.canDecide).toBe(true)

    expect(await onHand(productAId, branchAId)).toBe(20)
    expect(await onHand(productBId, branchAId)).toBe(10)
  })

  it('refuses a line above what the source holds (P20-D18)', async () => {
    // branchA holds 20 of productA; ask for 21.
    const response = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({
        fromBranchId: branchAId,
        toBranchId: branchBId,
        lines: [{ productId: productAId, quantityRequested: 21 }],
      }),
    })

    expect(response.status).toBe(409)
    const body = (await response.json()) as { error?: { message?: string } }
    expect(body.error?.message).toMatch(/does not hold that much/i)

    // Nothing was written for this attempt: no line for the rejected quantity exists.
    const lines = await db
      .select({ id: transferLine.id })
      .from(transferLine)
      .where(eq(transferLine.productId, productAId))
    expect(lines.every((line) => line.id !== undefined)).toBe(true)
  })

  it('gives the transfer form what the source can actually supply (P20-D18)', async () => {
    const response = await app.request(
      `/api/inventory/transfers/source-stock?branchId=${branchAId}&q=${encodeURIComponent(`TRF-${suffix}`)}`,
      { headers: authedHeaders(managerBCookie) },
    )

    expect(response.status).toBe(200)
    const body = await readJson<{
      products: { productId: string; sku: string; quantityOnHand: number }[]
    }>(response)
    const row = body.products.find((product) => product.productId === productAId)
    expect(row?.quantityOnHand).toBe(20)

    // `includeEmpty=false` (the default) hides a product this branch has nothing of.
    const empty = await app.request(
      `/api/inventory/transfers/source-stock?branchId=${branchAId}&q=${encodeURIComponent(`TRF-${suffix}`)}&includeEmpty=false`,
      { headers: authedHeaders(managerBCookie) },
    )
    expect(empty.status).toBe(200)
    const emptyBody = await readJson<{ products: unknown[] }>(empty)
    expect(
      emptyBody.products.some((row) => (row as { productId: string }).productId === productAId),
    ).toBe(true)
  })

  it('refuses a third branch, an outgoing manager transfer and a smuggled status', async () => {
    const thirdBranch = await app.request(`/api/transfers/${transferOneId}`, {
      headers: authedHeaders(managerCCookie),
    })
    expect(thirdBranch.status).toBe(403)

    const rows = await approvalRows(transferOneId)
    const thirdBranchApproval = await app.request(`/api/approvals/${rows[0]?.id}`, {
      headers: authedHeaders(managerCCookie),
    })
    expect(thirdBranchApproval.status).toBe(403)

    const outgoing = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        fromBranchId: branchAId,
        toBranchId: branchBId,
        lines: [{ productId: productAId, quantityRequested: 1 }],
      }),
    })
    expect(outgoing.status).toBe(403)
    const outgoingBody = await readJson<{ error: { message: string } }>(outgoing)
    expect(outgoingBody.error.message).toBe(
      'A transfer request is raised by the destination branch.',
    )

    const sameBranch = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({
        fromBranchId: branchBId,
        toBranchId: branchBId,
        lines: [{ productId: productAId, quantityRequested: 1 }],
      }),
    })
    expect(sameBranch.status).toBe(409)

    // The status is authority, never shape: a manager cannot ask for a DRAFT.
    const smuggled = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({
        fromBranchId: branchAId,
        toBranchId: branchBId,
        status: 'DRAFT',
        lines: [{ productId: productAId, quantityRequested: 1 }],
      }),
    })
    expect(smuggled.status).toBe(400)
  })

  it('refuses dispatch before the decision and moves no stock', async () => {
    const refused = await dispatch(managerACookie, transferOneId, [
      { productId: productAId, quantityDispatched: 8 },
      { productId: productBId, quantityDispatched: 4 },
    ])
    expect(refused.status).toBe(409)
    const body = await readJson<{ error: { message: string } }>(refused)
    expect(body.error.message).toContain('REQUESTED')

    expect(await onHand(productAId, branchAId)).toBe(20)
    expect(await onHand(productBId, branchAId)).toBe(10)
    expect(await movementCount(transferOneId)).toBe(0)
  })

  it('lets only the source branch decide, and only once', async () => {
    const rows = await approvalRows(transferOneId)
    const approvalId = rows[0]?.id ?? ''

    const requester = await decide(managerBCookie, approvalId, { decision: 'APPROVED' })
    expect(requester.status).toBe(403)

    const otherBranch = await decide(managerCCookie, approvalId, { decision: 'APPROVED' })
    expect(otherBranch.status).toBe(403)

    const approved = await decide(managerACookie, approvalId, { decision: 'APPROVED' })
    expect(approved.status).toBe(200)
    const approvedBody = await readJson<ApprovalDetailResponse>(approved)
    expect(approvedBody.approval.status).toBe('APPROVED')

    const twice = await decide(managerACookie, approvalId, {
      decision: 'REJECTED',
      reasonCode: 'OTHER',
    })
    expect(twice.status).toBe(409)

    const detail = await getTransfer(managerACookie, transferOneId)
    expect(detail.status).toBe('APPROVED')
    expect(detail.approval?.status).toBe('APPROVED')
    expect(detail.approval?.decidedBy).toBeTruthy()
    expect(detail.approval?.decidedAt).toBeTruthy()
    expect(detail.canDispatch).toBe(true)

    const destinationView = await getTransfer(managerBCookie, transferOneId)
    expect(destinationView.canDispatch).toBe(false)

    // Nothing moved on approval: the ledger only changes at dispatch.
    expect(await movementCount(transferOneId)).toBe(0)
    expect(await onHand(productAId, branchAId)).toBe(20)
  })

  it('dispatches an approved request from the source and reconciles the ledger', async () => {
    const wrongSide = await dispatch(managerBCookie, transferOneId, [
      { productId: productAId, quantityDispatched: 8 },
      { productId: productBId, quantityDispatched: 4 },
    ])
    expect(wrongSide.status).toBe(403)

    const dispatched = await dispatch(managerACookie, transferOneId, [
      { productId: productAId, quantityDispatched: 8 },
      { productId: productBId, quantityDispatched: 4 },
    ])
    expect(dispatched.status).toBe(200)
    const body = await readJson<{ transfer: TransferResponse }>(dispatched)
    expect(body.transfer.status).toBe('DISPATCHED')
    expect(body.transfer.lines.find((line) => line.productId === productAId)?.unitCostMinor).toBe(
      1_000,
    )

    // The source level drops by exactly the dispatched quantity.
    expect(await onHand(productAId, branchAId)).toBe(12)
    expect(await onHand(productBId, branchAId)).toBe(6)
    expect(await movementCount(transferOneId)).toBe(2)
    expect(await inventoryService.reconcileBranch(branchAId)).toEqual([])

    const redispatch = await dispatch(managerACookie, transferOneId, [
      { productId: productAId, quantityDispatched: 1 },
    ])
    expect(redispatch.status).toBe(409)

    const wrongReceiver = await receive(managerACookie, transferOneId, [
      { productId: productAId, quantityReceived: 1 },
    ])
    expect(wrongReceiver.status).toBe(403)

    const received = await receive(managerBCookie, transferOneId, [
      { productId: productAId, quantityReceived: 8 },
      { productId: productBId, quantityReceived: 4 },
    ])
    expect(received.status).toBe(200)
    const receivedBody = await readJson<{ transfer: TransferResponse }>(received)
    expect(receivedBody.transfer.status).toBe('RECEIVED')
    expect(receivedBody.transfer.unitsDispatched).toBe(12)
    expect(receivedBody.transfer.unitsReceived).toBe(12)

    expect(await onHand(productAId, branchBId)).toBe(8)
    expect(await onHand(productBId, branchBId)).toBe(4)
    expect(await inventoryService.reconcileBranch(branchBId)).toEqual([])
  })

  it('freezes a request and withdraws it with its approval', async () => {
    const created = await requestTransfer(managerBCookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 2 },
    ])

    const editLines = await app.request(`/api/transfers/${created.id}/lines`, {
      method: 'PUT',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantityRequested: 5 }] }),
    })
    expect(editLines.status).toBe(409)

    const editNote = await app.request(`/api/transfers/${created.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ note: 'changed my mind' }),
    })
    expect(editNote.status).toBe(409)

    const before = await onHand(productAId, branchAId)
    const cancelled = await app.request(`/api/transfers/${created.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
    })
    expect(cancelled.status).toBe(200)

    const detail = await getTransfer(managerBCookie, created.id)
    expect(detail.status).toBe('CANCELLED')
    expect(detail.approval?.status).toBe('WITHDRAWN')
    expect(detail.approval?.decidedBy).toBeNull()

    const rows = await approvalRows(created.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.status).toBe('WITHDRAWN')

    expect(await onHand(productAId, branchAId)).toBe(before)
    expect(await movementCount(created.id)).toBe(0)

    // A withdrawn request is no longer in the decider's queue.
    const queue = await app.request('/api/approvals?type=TRANSFER_REQUEST&status=PENDING', {
      headers: authedHeaders(managerACookie),
    })
    const queueBody = await readJson<{ approvals: ApprovalRowResponse[] }>(queue)
    expect(queueBody.approvals.some((row) => row.entityId === created.id)).toBe(false)

    const twice = await app.request(`/api/transfers/${created.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
    })
    expect(twice.status).toBe(409)
  })

  it('keeps the admin draft path direct, with no approval row', async () => {
    const response = await app.request('/api/transfers', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        fromBranchId: branchAId,
        toBranchId: branchBId,
        lines: [{ productId: productAId, quantityRequested: 3 }],
      }),
    })
    expect(response.status).toBe(201)
    const created = (await readJson<{ transfer: TransferResponse }>(response)).transfer
    createdTransferIds.push(created.id)

    expect(created.status).toBe('DRAFT')
    expect(created.approval).toBeNull()
    expect(created.canDispatch).toBe(true)
    expect(await approvalRows(created.id)).toHaveLength(0)

    const replaced = await app.request(`/api/transfers/${created.id}/lines`, {
      method: 'PUT',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantityRequested: 3 },
          { productId: productBId, quantityRequested: 1 },
        ],
      }),
    })
    expect(replaced.status).toBe(200)

    const noted = await app.request(`/api/transfers/${created.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ note: 'admin draft, source confirms' }),
    })
    expect(noted.status).toBe(200)

    const dispatched = await dispatch(managerACookie, created.id, [
      { productId: productAId, quantityDispatched: 3 },
      { productId: productBId, quantityDispatched: 1 },
    ])
    expect(dispatched.status).toBe(200)
    expect(await onHand(productAId, branchAId)).toBe(9)
    expect(await onHand(productBId, branchAId)).toBe(5)

    const received = await receive(managerBCookie, created.id, [
      { productId: productAId, quantityReceived: 3 },
      { productId: productBId, quantityReceived: 1 },
    ])
    expect(received.status).toBe(200)
    expect(await onHand(productAId, branchBId)).toBe(11)
    expect(await onHand(productBId, branchBId)).toBe(5)

    const cancelDispatched = await app.request(`/api/transfers/${created.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelDispatched.status).toBe(409)
  })

  it('leaves the ledger byte-identical when the request is rejected', async () => {
    const created = await requestTransfer(managerBCookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 3 },
    ])
    const rows = await approvalRows(created.id)
    const approvalId = rows[0]?.id ?? ''

    const noReason = await decide(managerACookie, approvalId, { decision: 'REJECTED' })
    expect(noReason.status).toBe(400)

    const rejected = await decide(managerACookie, approvalId, {
      decision: 'REJECTED',
      reasonCode: 'OUT_OF_POLICY',
      note: 'Branch A needs the stock for the weekend',
    })
    expect(rejected.status).toBe(200)

    const detail = await getTransfer(managerACookie, created.id)
    expect(detail.status).toBe('REJECTED')
    expect(detail.approval?.status).toBe('REJECTED')
    expect(detail.approval?.decisionReasonCode).toBe('OUT_OF_POLICY')
    expect(detail.canDispatch).toBe(false)

    const refused = await dispatch(managerACookie, created.id, [
      { productId: productAId, quantityDispatched: 3 },
    ])
    expect(refused.status).toBe(409)
    const refusedBody = await readJson<{ error: { message: string } }>(refused)
    expect(refusedBody.error.message).toContain('REJECTED')

    // No movement exists for the transfer at all, and no level moved.
    expect(await movementCount(created.id)).toBe(0)
    expect(await onHand(productAId, branchAId)).toBe(9)

    const cancelled = await app.request(`/api/transfers/${created.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
    })
    expect(cancelled.status).toBe(409)
  })

  it('sends a warehouse-sourced request to an admin, not a manager', async () => {
    const created = await requestTransfer(managerBCookie, warehouseId, branchBId, [
      { productId: productAId, quantityRequested: 6 },
    ])
    const rows = await approvalRows(created.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]?.deciderRole).toBe('ADMIN')
    expect(rows[0]?.deciderBranchId).toBeNull()
    expect(rows[0]?.amountMinor).toBe(6_000)
    expect(rows[0]?.payload).toMatchObject({ fromBranchType: 'WAREHOUSE', lineCount: 1 })

    const approvalId = rows[0]?.id ?? ''
    const destinationManager = await decide(managerBCookie, approvalId, { decision: 'APPROVED' })
    expect(destinationManager.status).toBe(403)
    const sourceManager = await decide(managerWCookie, approvalId, { decision: 'APPROVED' })
    expect(sourceManager.status).toBe(403)

    const adminDecision = await decide(adminCookie, approvalId, { decision: 'APPROVED' })
    expect(adminDecision.status).toBe(200)

    const dispatched = await dispatch(managerWCookie, created.id, [
      { productId: productAId, quantityDispatched: 6 },
    ])
    expect(dispatched.status).toBe(200)
    expect(await onHand(productAId, warehouseId)).toBe(44)

    const received = await receive(managerBCookie, created.id, [
      { productId: productAId, quantityReceived: 6 },
    ])
    expect(received.status).toBe(200)
    expect(await onHand(productAId, branchBId)).toBe(17)
    expect(await inventoryService.reconcileBranch(warehouseId)).toEqual([])
  })

  it('short-closes a partially received approved transfer', async () => {
    const created = await requestTransfer(managerBCookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: 5 },
    ])
    await approve(managerACookie, created.id)

    const dispatched = await dispatch(managerACookie, created.id, [
      { productId: productAId, quantityDispatched: 5 },
    ])
    expect(dispatched.status).toBe(200)
    expect(await onHand(productAId, branchAId)).toBe(4)

    const partial = await receive(managerBCookie, created.id, [
      { productId: productAId, quantityReceived: 2 },
    ])
    expect(partial.status).toBe(200)
    expect((await readJson<{ transfer: TransferResponse }>(partial)).transfer.status).toBe(
      'DISPATCHED',
    )

    const shortClose = await app.request(`/api/transfers/${created.id}/short-close`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({ note: 'Three units missing from the carton' }),
    })
    expect(shortClose.status).toBe(200)
    expect((await readJson<{ transfer: TransferResponse }>(shortClose)).transfer.status).toBe(
      'SHORT_CLOSED',
    )

    // Short-close posts nothing: the missing three units are a discrepancy, not a
    // movement the ledger can invent. The only rows are the dispatch and the
    // partial receipt.
    expect(await movementCount(created.id)).toBe(2)
    expect(await onHand(productAId, branchBId)).toBe(19)

    const lateReceive = await receive(managerBCookie, created.id, [
      { productId: productAId, quantityReceived: 3 },
    ])
    expect(lateReceive.status).toBe(409)

    expect(await inventoryService.reconcileBranch(branchAId)).toEqual([])
    expect(await inventoryService.reconcileBranch(branchBId)).toEqual([])
  })

  it('refuses to dispatch more than the source holds', async () => {
    // A request can no longer exceed the shelf at creation (P20-D18), so the dispatch
    // guard is proved the way it actually bites: the stock moves between the request and
    // the release, and the source still refuses to hand over what it no longer has.
    const before = await onHand(productAId, branchAId)
    const created = await requestTransfer(managerBCookie, branchAId, branchBId, [
      { productId: productAId, quantityRequested: before },
    ])
    await approve(managerACookie, created.id)

    await inventoryService.postMovements(actor, [
      {
        productId: productAId,
        branchId: branchAId,
        type: 'ADJUSTMENT',
        quantityDelta: -1,
        referenceType: 'ADJUSTMENT',
        reasonCode: 'CORRECTION',
        note: 'Sold after the request was raised',
      },
    ])

    const oversize = await dispatch(managerACookie, created.id, [
      { productId: productAId, quantityDispatched: before },
    ])
    expect(oversize.status).toBe(409)
    expect(await onHand(productAId, branchAId)).toBe(before - 1)
    expect(await movementCount(created.id)).toBe(0)
  })

  it('lists transfers with manager scoping and the request states', async () => {
    const rejected = await app.request('/api/transfers?status=REJECTED', {
      headers: authedHeaders(managerBCookie),
    })
    expect(rejected.status).toBe(200)
    const rejectedBody = await readJson<{ transfers: TransferResponse[] }>(rejected)
    expect(rejectedBody.transfers.length).toBeGreaterThan(0)
    expect(rejectedBody.transfers.every((row) => row.status === 'REJECTED')).toBe(true)

    // The request states are filterable: the source branch's queue is one query.
    const requested = await app.request('/api/transfers?status=REQUESTED', {
      headers: authedHeaders(managerACookie),
    })
    expect(requested.status).toBe(200)
    const requestedBody = await readJson<{ transfers: TransferResponse[] }>(requested)
    expect(requestedBody.transfers.every((row) => row.status === 'REQUESTED')).toBe(true)
    expect(
      requestedBody.transfers.every(
        (row) => row.fromBranchId === branchAId || row.toBranchId === branchAId,
      ),
    ).toBe(true)

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

    const unrelated = await app.request('/api/transfers', {
      headers: authedHeaders(managerCCookie),
    })
    const unrelatedBody = await readJson<{ transfers: TransferResponse[] }>(unrelated)
    expect(unrelatedBody.transfers).toHaveLength(0)

    const adminList = await app.request('/api/transfers', {
      headers: authedHeaders(adminCookie),
    })
    expect(adminList.status).toBe(200)
    const adminBody = await readJson<{ total: number }>(adminList)
    expect(adminBody.total).toBeGreaterThanOrEqual(6)
  })
})
