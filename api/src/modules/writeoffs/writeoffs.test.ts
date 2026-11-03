import { db } from '@sceptre/db'
import { and, count, eq, inArray, sum } from 'drizzle-orm'
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
import { documentSequence } from '../platform/sequences.schema.ts'
import { product } from '../products/products.schema.ts'
import { stockWriteOff, stockWriteOffLine } from './writeoffs.schema.ts'

/**
 * The write-off document, its decision and the posted movement.
 *
 * Every assertion that matters is a reconciliation: the approved value equals
 * the ledger value, Σ movements equals the on-hand projection, and a rejection
 * leaves both untouched.
 */

const available = await databaseAvailable()
if (!available) console.warn('[writeoffs.test] database unavailable; integration tests skipped')

const actor: AuditActor = {
  actorId: 'writeoff-test',
  actorStaffId: 'SD-WRITEOFF',
  ip: null,
  userAgent: null,
  requestId: null,
}

interface WriteOffLineResponse {
  productId: string
  quantity: number
  unitCostMinor: number
  reason: string
  note: string | null
  sku: string
  productName: string
}

interface WriteOffHeaderResponse {
  id: string
  number: string
  branchId: string
  status: string
  note: string | null
  valueMinor: number
  approvalId: string | null
  requestedBy: string
  postedAt: string | null
  lineCount: number
}

interface WriteOffApprovalResponse {
  id: string
  status: string
  requestedBy: string
  decidedBy: string | null
  decidedAt: string | null
  decisionReasonCode: string | null
}

interface WriteOffDetailResponse {
  writeOff: WriteOffHeaderResponse
  lines: WriteOffLineResponse[]
  approval: WriteOffApprovalResponse | null
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

interface MovementRowResponse {
  id: string
  productId: string
  type: string
  quantityDelta: number
  unitCostMinor: number
  referenceType: string
  referenceId: string | null
  referenceNumber: string | null
  reasonCode: string | null
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('stock write-offs API', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  const createdWriteOffIds: string[] = []
  const createdProductIds: string[] = []
  let adminCookie = ''
  let managerACookie = ''
  let colleagueACookie = ''
  let managerBCookie = ''
  let branchAId = ''
  let branchBId = ''
  let productAId = ''
  let productBId = ''
  let productCId = ''
  let productDId = ''
  let productDName = ''
  let categoryId = ''
  let uomId = ''
  let writeOffOneId = ''

  async function createBranch(label: string): Promise<string> {
    const response = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `WO${randomToken(2)}-${label}`,
        name: `Write-off Branch ${label}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{ branch: { id: string } }>(response)
    createdBranchIds.push(body.branch.id)
    return body.branch.id
  }

  async function createWriteOff(
    cookie: string,
    body: {
      lines: { productId: string; quantity: number; reason: string; note?: string }[]
      note?: string
    },
  ): Promise<WriteOffDetailResponse> {
    const response = await app.request('/api/write-offs', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(201)
    const detail = await readJson<WriteOffDetailResponse>(response)
    createdWriteOffIds.push(detail.writeOff.id)
    return detail
  }

  async function getWriteOff(cookie: string, id: string): Promise<Response> {
    return app.request(`/api/write-offs/${id}`, { headers: authedHeaders(cookie) })
  }

  async function readWriteOff(cookie: string, id: string): Promise<WriteOffDetailResponse> {
    const response = await getWriteOff(cookie, id)
    expect(response.status).toBe(200)
    return readJson<WriteOffDetailResponse>(response)
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

  async function approvalRows(writeOffId: string): Promise<ApprovalRowResponse[]> {
    return db
      .select()
      .from(approval)
      .where(and(eq(approval.type, 'STOCK_WRITE_OFF'), eq(approval.entityId, writeOffId)))
  }

  async function movementRows(writeOffId: string): Promise<MovementRowResponse[]> {
    return db
      .select()
      .from(stockMovement)
      .where(
        and(
          eq(stockMovement.referenceType, 'WRITE_OFF'),
          eq(stockMovement.referenceId, writeOffId),
        ),
      )
  }

  async function movementCount(writeOffId: string): Promise<number> {
    const rows = await db
      .select({ total: count() })
      .from(stockMovement)
      .where(
        and(
          eq(stockMovement.referenceType, 'WRITE_OFF'),
          eq(stockMovement.referenceId, writeOffId),
        ),
      )
    return Number(rows[0]?.total ?? 0)
  }

  async function onHand(productId: string, branchId: string): Promise<number> {
    return (await findLevel(productId, branchId))?.quantityOnHand ?? 0
  }

  /**
   * The branch's ledger and projection in four numbers. Two snapshots that are
   * equal prove a rejection moved nothing; `movementQuantity === levelQuantity`
   * is the reconciliation the phase is judged on.
   */
  async function branchLedgerSnapshot(branchId: string) {
    const [movements, levels] = await Promise.all([
      db
        .select({ rows: count(), quantity: sum(stockMovement.quantityDelta) })
        .from(stockMovement)
        .where(eq(stockMovement.branchId, branchId)),
      db
        .select({ rows: count(), quantity: sum(stockLevel.quantityOnHand) })
        .from(stockLevel)
        .where(eq(stockLevel.branchId, branchId)),
    ])
    return {
      movementRows: Number(movements[0]?.rows ?? 0),
      movementQuantity: Number(movements[0]?.quantity ?? 0),
      levelRows: Number(levels[0]?.rows ?? 0),
      levelQuantity: Number(levels[0]?.quantity ?? 0),
    }
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
      name: 'Write-off Manager A',
    })
    createdUserIds.push(managerA.id)
    managerACookie = await signIn(managerA.email)

    const colleague = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Write-off Colleague A',
    })
    createdUserIds.push(colleague.id)
    colleagueACookie = await signIn(colleague.email)

    const managerB = await createTestUser({
      role: 'MANAGER',
      branchId: branchBId,
      name: 'Write-off Manager B',
    })
    createdUserIds.push(managerB.id)
    managerBCookie = await signIn(managerB.email)

    const units = await db
      .insert(uom)
      .values({ code: `W${suffix}`.toUpperCase(), name: `Write-off Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''
    const categories = await db
      .insert(category)
      .values({ name: `Write-off Cat ${suffix}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `WO-${suffix}-1`,
          name: `Write-off Product One ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 500,
          basePriceMinor: 1_000,
        },
        {
          sku: `WO-${suffix}-2`,
          name: `Write-off Product Two ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 300,
          basePriceMinor: 600,
        },
        {
          sku: `WO-${suffix}-3`,
          name: `Write-off Product Three ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 400,
          basePriceMinor: 800,
        },
        {
          sku: `WO-${suffix}-4`,
          name: `Write-off Product Four ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 100,
          basePriceMinor: 200,
        },
      ])
      .returning({ id: product.id, name: product.name })
    productAId = products[0]?.id ?? ''
    productBId = products[1]?.id ?? ''
    productCId = products[2]?.id ?? ''
    productDId = products[3]?.id ?? ''
    productDName = products[3]?.name ?? ''
    createdProductIds.push(productAId, productBId, productCId, productDId)

    await inventoryService.postMovements(actor, [
      {
        productId: productAId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 10,
        unitCostMinor: 500,
        referenceType: 'RECEIPT',
      },
      {
        productId: productBId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 10,
        unitCostMinor: 300,
        referenceType: 'RECEIPT',
      },
      {
        productId: productCId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 2,
        unitCostMinor: 400,
        referenceType: 'RECEIPT',
      },
      {
        productId: productDId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 1,
        unitCostMinor: 100,
        referenceType: 'RECEIPT',
      },
    ])
  })

  afterAll(async () => {
    // The document points at the approval with `onDelete: restrict`, and the
    // lines point at the products, so the order is lines → headers → approvals.
    if (createdWriteOffIds.length > 0) {
      await db
        .delete(stockWriteOffLine)
        .where(inArray(stockWriteOffLine.writeOffId, createdWriteOffIds))
      await db.delete(stockWriteOff).where(inArray(stockWriteOff.id, createdWriteOffIds))
      await db
        .delete(approval)
        .where(
          and(eq(approval.type, 'STOCK_WRITE_OFF'), inArray(approval.entityId, createdWriteOffIds)),
        )
    }
    if (createdBranchIds.length > 0) {
      await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
      // The write-off number consumed a `document_sequence` row, which holds the
      // branch with `restrict`.
      await db.delete(documentSequence).where(inArray(documentSequence.branchId, createdBranchIds))
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

  it('raises a pending document with a value frozen at the branch average cost', async () => {
    const detail = await createWriteOff(managerACookie, {
      lines: [
        { productId: productAId, quantity: 3, reason: 'DAMAGE' },
        { productId: productBId, quantity: 2, reason: 'EXPIRY' },
      ],
      note: 'Pallet dropped in the yard',
    })
    writeOffOneId = detail.writeOff.id

    expect(detail.writeOff.number).toMatch(/^WO-[A-Z0-9-]+-\d{6}-\d{4}$/)
    expect(detail.writeOff.status).toBe('PENDING_APPROVAL')
    expect(detail.writeOff.branchId).toBe(branchAId)
    expect(detail.writeOff.lineCount).toBe(2)
    // 3 × 500 + 2 × 300 = 2 100, hand-computed from the branch levels.
    expect(detail.writeOff.valueMinor).toBe(2_100)
    expect(detail.writeOff.postedAt).toBeNull()
    expect(detail.lines.find((line) => line.productId === productAId)?.unitCostMinor).toBe(500)
    expect(detail.lines.find((line) => line.productId === productBId)?.unitCostMinor).toBe(300)
    expect(detail.lines.find((line) => line.productId === productAId)?.quantity).toBe(3)

    const rows = await approvalRows(detail.writeOff.id)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toMatchObject({
      status: 'PENDING',
      branchId: branchAId,
      // Every write-off is decided by an admin, in any branch (P12-D2).
      deciderRole: 'ADMIN',
      deciderBranchId: null,
      amountMinor: 2_100,
    })
    expect(rows[0]?.payload).toEqual({
      number: detail.writeOff.number,
      lineCount: 2,
      reasons: ['DAMAGE', 'EXPIRY'],
    })

    // Asking is not moving: no ledger row exists yet.
    expect(await movementCount(detail.writeOff.id)).toBe(0)
    expect(await onHand(productAId, branchAId)).toBe(10)
    expect(await onHand(productBId, branchAId)).toBe(10)

    const audits = await db
      .select({ after: auditLog.after })
      .from(auditLog)
      .where(
        and(
          eq(auditLog.action, 'stock_write_off.requested'),
          eq(auditLog.entityId, detail.writeOff.id),
        ),
      )
    expect(audits).toHaveLength(1)
    expect(audits[0]?.after).toMatchObject({
      number: detail.writeOff.number,
      valueMinor: 2_100,
      approvalId: rows[0]?.id,
    })

    // The decider's subject carries the number and the line count, not just an id.
    const subject = await app.request(`/api/approvals/${rows[0]?.id}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(subject.status).toBe(200)
    const subjectBody = await readJson<{
      subject: { kind: string; writeOffId?: string; number?: string; lineCount?: number }
    }>(subject)
    expect(subjectBody.subject).toMatchObject({
      kind: 'stock_write_off',
      writeOffId: detail.writeOff.id,
      number: detail.writeOff.number,
      lineCount: 2,
    })

    // The branch's own list shows it; the other branch's does not.
    const ownList = await app.request('/api/write-offs', { headers: authedHeaders(managerACookie) })
    expect(ownList.status).toBe(200)
    const ownBody = await readJson<{ writeOffs: WriteOffHeaderResponse[] }>(ownList)
    expect(ownBody.writeOffs.some((row) => row.id === detail.writeOff.id)).toBe(true)

    const otherList = await app.request('/api/write-offs', {
      headers: authedHeaders(managerBCookie),
    })
    expect(otherList.status).toBe(200)
    const otherBody = await readJson<{ writeOffs: WriteOffHeaderResponse[] }>(otherList)
    expect(otherBody.writeOffs.some((row) => row.id === detail.writeOff.id)).toBe(false)
  })

  it('values three units at the branch average cost and withdraws cleanly', async () => {
    // The plan's arithmetic, stated once: 3 × 500 = 1 500.
    const detail = await createWriteOff(managerACookie, {
      lines: [{ productId: productAId, quantity: 3, reason: 'DAMAGE' }],
    })
    expect(detail.writeOff.valueMinor).toBe(1_500)
    expect(detail.lines).toHaveLength(1)
    expect(detail.lines[0]?.unitCostMinor).toBe(500)
    expect(detail.lines[0]?.quantity).toBe(3)
    expect(await movementCount(detail.writeOff.id)).toBe(0)

    const cancelled = await app.request(`/api/write-offs/${detail.writeOff.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelled.status).toBe(200)
    const after = await readWriteOff(managerACookie, detail.writeOff.id)
    expect(after.writeOff.status).toBe('CANCELLED')
    expect(after.approval?.status).toBe('WITHDRAWN')
    expect(await movementCount(detail.writeOff.id)).toBe(0)
    expect(await onHand(productAId, branchAId)).toBe(10)
  })

  it('refuses an admin raising a write-off', async () => {
    const adminAttempt = await app.request('/api/write-offs', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        lines: [{ productId: productAId, quantity: 1, reason: 'DAMAGE' }],
      }),
    })
    expect(adminAttempt.status).toBe(400)
    const adminBody = await readJson<{ error: { message: string } }>(adminAttempt)
    expect(adminBody.error.message).toContain('negative adjustment')
  })

  it('refuses a duplicate line and an unexplained theft', async () => {
    const duplicate = await app.request('/api/write-offs', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantity: 1, reason: 'DAMAGE' },
          { productId: productAId, quantity: 1, reason: 'DAMAGE' },
        ],
      }),
    })
    expect(duplicate.status).toBe(400)

    const theft = await app.request('/api/write-offs', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ lines: [{ productId: productAId, quantity: 1, reason: 'THEFT' }] }),
    })
    expect(theft.status).toBe(400)
    const theftBody = await readJson<{ error: { message: string } }>(theft)
    expect(theftBody.error.message).toContain('Write-off Product One')

    // With a note, the same line is a valid document (P12-D16).
    const noted = await createWriteOff(managerACookie, {
      lines: [
        {
          productId: productBId,
          quantity: 1,
          reason: 'THEFT',
          note: 'Missing from the locked cage',
        },
      ],
    })
    expect(noted.writeOff.status).toBe('PENDING_APPROVAL')
    expect(noted.writeOff.valueMinor).toBe(300)
  })

  it('posts the approved movement at the stored cost and reconciles the branch', async () => {
    const beforeA = await onHand(productAId, branchAId)
    const beforeB = await onHand(productBId, branchAId)
    const rows = await approvalRows(writeOffOneId)
    const approvalId = rows[0]?.id ?? ''

    const approved = await decide(adminCookie, approvalId, { decision: 'APPROVED' })
    expect(approved.status).toBe(200)

    const detail = await readWriteOff(managerACookie, writeOffOneId)
    expect(detail.writeOff.status).toBe('APPROVED')
    expect(detail.writeOff.postedAt).toBeTruthy()
    expect(detail.approval?.status).toBe('APPROVED')
    expect(detail.approval?.decidedBy).toBeTruthy()

    const movements = await movementRows(writeOffOneId)
    expect(movements).toHaveLength(2)
    expect(movements.every((row) => row.type === 'WRITE_OFF')).toBe(true)
    expect(movements.every((row) => row.referenceType === 'WRITE_OFF')).toBe(true)
    expect(movements.every((row) => row.referenceNumber === detail.writeOff.number)).toBe(true)

    const lineA = movements.find((row) => row.productId === productAId)
    expect(lineA).toMatchObject({ quantityDelta: -3, unitCostMinor: 500, reasonCode: 'DAMAGE' })
    const lineB = movements.find((row) => row.productId === productBId)
    // The form says EXPIRY; the ledger's vocabulary says EXPIRED (P12-D15).
    expect(lineB).toMatchObject({ quantityDelta: -2, unitCostMinor: 300, reasonCode: 'EXPIRED' })

    expect(await onHand(productAId, branchAId)).toBe(beforeA - 3)
    expect(await onHand(productBId, branchAId)).toBe(beforeB - 2)

    // Σ movements = on-hand, for the whole branch, not just these products.
    const snapshot = await branchLedgerSnapshot(branchAId)
    expect(snapshot.movementQuantity).toBe(snapshot.levelQuantity)
    expect(await inventoryService.reconcileBranch(branchAId)).toEqual([])

    // The approved value and the ledger value are the same number.
    const ledgerValue = movements.reduce(
      (total, row) => total + Math.abs(row.quantityDelta) * row.unitCostMinor,
      0,
    )
    expect(ledgerValue).toBe(detail.writeOff.valueMinor)

    // Decided is decided, and an approved document cannot be withdrawn.
    const twice = await decide(adminCookie, approvalId, {
      decision: 'REJECTED',
      reasonCode: 'OTHER',
    })
    expect(twice.status).toBe(409)

    const cancelApproved = await app.request(`/api/write-offs/${writeOffOneId}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelApproved.status).toBe(409)
  })

  it('leaves the ledger byte-identical when the write-off is rejected', async () => {
    const detail = await createWriteOff(managerACookie, {
      lines: [{ productId: productAId, quantity: 1, reason: 'DAMAGE' }],
    })
    const before = await branchLedgerSnapshot(branchAId)
    const rows = await approvalRows(detail.writeOff.id)
    const approvalId = rows[0]?.id ?? ''

    const noReason = await decide(adminCookie, approvalId, { decision: 'REJECTED' })
    expect(noReason.status).toBe(400)

    const rejected = await decide(adminCookie, approvalId, {
      decision: 'REJECTED',
      reasonCode: 'OUT_OF_POLICY',
      note: 'Recount before writing this off',
    })
    expect(rejected.status).toBe(200)

    const after = await readWriteOff(managerACookie, detail.writeOff.id)
    expect(after.writeOff.status).toBe('REJECTED')
    expect(after.writeOff.postedAt).toBeNull()
    expect(after.approval?.status).toBe('REJECTED')
    expect(after.approval?.decisionReasonCode).toBe('OUT_OF_POLICY')

    expect(await movementCount(detail.writeOff.id)).toBe(0)
    expect(await branchLedgerSnapshot(branchAId)).toEqual(before)
  })

  it('refuses an approval that would drive stock negative and rolls back', async () => {
    const detail = await createWriteOff(managerACookie, {
      lines: [{ productId: productDId, quantity: 5, reason: 'DAMAGE' }],
    })
    expect(detail.writeOff.valueMinor).toBe(500)

    const rows = await approvalRows(detail.writeOff.id)
    const refused = await decide(adminCookie, rows[0]?.id ?? '', { decision: 'APPROVED' })
    expect(refused.status).toBe(409)
    const body = await readJson<{ error: { message: string } }>(refused)
    expect(body.error.message).toContain(productDName)
    expect(body.error.message).toContain('Re-raise')

    const still = await readWriteOff(managerACookie, detail.writeOff.id)
    expect(still.writeOff.status).toBe('PENDING_APPROVAL')
    expect(still.writeOff.postedAt).toBeNull()
    expect(await movementCount(detail.writeOff.id)).toBe(0)
    expect(await onHand(productDId, branchAId)).toBe(1)

    // The failed decision rolled the approval back to PENDING, so it can be withdrawn.
    const cancelled = await app.request(`/api/write-offs/${detail.writeOff.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelled.status).toBe(200)
    const cancelledDetail = await readWriteOff(managerACookie, detail.writeOff.id)
    expect(cancelledDetail.writeOff.status).toBe('CANCELLED')
    expect(cancelledDetail.approval?.status).toBe('WITHDRAWN')
  })

  it("refuses another branch's manager the document", async () => {
    const foreign = await getWriteOff(managerBCookie, writeOffOneId)
    expect(foreign.status).toBe(403)

    const list = await app.request('/api/write-offs', { headers: authedHeaders(managerBCookie) })
    expect(list.status).toBe(200)
    const body = await readJson<{ writeOffs: WriteOffHeaderResponse[] }>(list)
    expect(body.writeOffs.every((row) => row.branchId === branchBId)).toBe(true)
  })

  it('cancels only for the requester, and only while pending', async () => {
    const own = await createWriteOff(managerACookie, {
      lines: [{ productId: productAId, quantity: 1, reason: 'OBSOLESCENCE' }],
    })
    const cancelPath = `/api/write-offs/${own.writeOff.id}/cancel`

    // A colleague at the same branch passes the branch check and fails the
    // requester check; another branch fails the branch check (P12-D7).
    const colleague = await app.request(cancelPath, {
      method: 'POST',
      headers: authedHeaders(colleagueACookie),
    })
    expect(colleague.status).toBe(403)

    const otherBranch = await app.request(cancelPath, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
    })
    expect(otherBranch.status).toBe(403)

    const cancelled = await app.request(cancelPath, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(cancelled.status).toBe(200)

    const detail = await readWriteOff(managerACookie, own.writeOff.id)
    expect(detail.writeOff.status).toBe('CANCELLED')
    expect(detail.approval?.status).toBe('WITHDRAWN')
    expect(await movementCount(own.writeOff.id)).toBe(0)

    // A withdrawn request is no longer in the decider's queue.
    const queue = await app.request('/api/approvals?type=STOCK_WRITE_OFF&status=PENDING', {
      headers: authedHeaders(adminCookie),
    })
    expect(queue.status).toBe(200)
    const queueBody = await readJson<{ approvals: ApprovalRowResponse[] }>(queue)
    expect(queueBody.approvals.some((row) => row.entityId === own.writeOff.id)).toBe(false)
  })

  it('posts the stored line cost even after a receipt moves the average', async () => {
    const detail = await createWriteOff(managerACookie, {
      lines: [{ productId: productBId, quantity: 2, reason: 'DAMAGE' }],
    })
    const storedCost = detail.lines[0]?.unitCostMinor ?? 0
    expect(detail.writeOff.valueMinor).toBe(storedCost * 2)

    const before = await onHand(productBId, branchAId)
    // A receipt between request and decision re-averages the branch projection.
    await inventoryService.postMovements(actor, [
      {
        productId: productBId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: 10,
        unitCostMinor: storedCost + 900,
        referenceType: 'RECEIPT',
      },
    ])
    const afterReceipt = await findLevel(productBId, branchAId)
    expect(afterReceipt?.avgCostMinor).not.toBe(storedCost)

    const rows = await approvalRows(detail.writeOff.id)
    const approved = await decide(adminCookie, rows[0]?.id ?? '', { decision: 'APPROVED' })
    expect(approved.status).toBe(200)

    const movements = await movementRows(detail.writeOff.id)
    expect(movements).toHaveLength(1)
    expect(movements[0]?.quantityDelta).toBe(-2)
    // The approved cost, not today's average: P12-D17.
    expect(movements[0]?.unitCostMinor).toBe(storedCost)
    expect(await onHand(productBId, branchAId)).toBe(before + 10 - 2)

    const ledgerValue =
      Math.abs(movements[0]?.quantityDelta ?? 0) * (movements[0]?.unitCostMinor ?? 0)
    expect(ledgerValue).toBe(detail.writeOff.valueMinor)
    expect(await inventoryService.reconcileBranch(branchAId)).toEqual([])
  })

  it("routes a manager's shrinkage to the form and keeps the admin path direct", async () => {
    const shrinkage = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productCId,
        quantityDelta: -1,
        reasonCode: 'DAMAGE',
      }),
    })
    expect(shrinkage.status).toBe(400)
    const shrinkageBody = await readJson<{ error: { message: string } }>(shrinkage)
    expect(shrinkageBody.error.message).toContain('Inventory → Write-offs')

    const loss = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productCId,
        quantityDelta: -1,
        reasonCode: 'LOSS',
      }),
    })
    expect(loss.status).toBe(400)
    expect(await onHand(productCId, branchAId)).toBe(2)

    // The guard is a role rule: an admin posts the same adjustment directly.
    const adminDamage = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productCId,
        quantityDelta: -1,
        reasonCode: 'DAMAGE',
      }),
    })
    expect(adminDamage.status).toBe(201)
    expect(await onHand(productCId, branchAId)).toBe(1)

    // A negative CORRECTION stays direct on purpose (a data fix, not a loss).
    const correction = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productCId,
        quantityDelta: -1,
        reasonCode: 'CORRECTION',
      }),
    })
    expect(correction.status).toBe(201)
    expect(await onHand(productCId, branchAId)).toBe(0)

    // Positive adjustments are unaffected for everyone.
    const found = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productCId,
        quantityDelta: 2,
        reasonCode: 'FOUND',
      }),
    })
    expect(found.status).toBe(201)
    expect(await onHand(productCId, branchAId)).toBe(2)
  })
})
