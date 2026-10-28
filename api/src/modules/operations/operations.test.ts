import { db } from '@sceptre/db'
import { APPROVAL_TYPES } from '@sceptre/shared'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest'
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
import type { SessionUser } from '../../http/factory.ts'
import { approval } from '../approvals/approvals.schema.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { stockCount, stockCountLine } from '../counts/counts.schema.ts'
import { creditProfile } from '../credit/credit.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { stockLevel, stockThreshold } from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { shift } from '../pos/pos.schema.ts'
import { product } from '../products/products.schema.ts'
import { transfer } from '../transfers/transfers.schema.ts'
import { stockWriteOff } from '../writeoffs/writeoffs.schema.ts'
import { getOperationsSummary } from './operations.service.ts'
import type { OperationsSummary } from './operations.types.ts'

/**
 * The manager's branch view (Plan 12-10, P12-D37).
 *
 * Two properties are load-bearing and this file proves both:
 *
 * 1. **Every number equals the list it links to.** The parity test walks all six
 *    queues against the endpoints the console opens, so a summary that drifts
 *    from its own list fails here and not in front of a manager.
 * 2. **A section the caller may not see is absent, not zero.** A zero is a
 *    statement about the branch; absence is a statement about the caller.
 *
 * Branch scoping is checked twice over: the manager's `?branchId=` of another
 * branch is a 403, and the service would refuse it even if the route let the
 * request through (`resolveBranchFilter`, P11-D17).
 */

const available = await databaseAvailable()
if (!available) console.warn('[operations.test] database unavailable; tests skipped')

/**
 * A future permission matrix: a role that may read approvals but not credit.
 *
 * `can()` derives permissions from the role alone today (every role that reads
 * approvals also reads credit), so the only honest way to exercise the filter is
 * to revoke one permission, exactly as a per-user permission set would. The flag
 * is mutable and off by default, so every other test in this file sees the real
 * matrix.
 */
const flags = vi.hoisted(() => ({ revokeCreditRead: false }))

vi.mock('@sceptre/shared', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@sceptre/shared')>()
  return {
    ...actual,
    can: (role: Parameters<typeof actual.can>[0], permission: Parameters<typeof actual.can>[1]) =>
      permission === 'credit.read' && flags.revokeCreditRead ? false : actual.can(role, permission),
  }
})

function makeUser(overrides: Partial<SessionUser>): SessionUser {
  return {
    id: 'operations-stub-user',
    email: 'operations-stub@sceptre.test',
    name: 'Operations Stub',
    emailVerified: false,
    createdAt: new Date(),
    updatedAt: new Date(),
    role: 'MANAGER',
    branchId: null,
    staffId: null,
    phone: null,
    isActive: true,
    mustChangePassword: false,
    image: null,
    ...overrides,
  } as SessionUser
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

/** The six list endpoints the summary's numbers must equal. */
interface QueueTotals {
  approvals: number
  transferRequests: number
  writeOffs: number
  lowStock: number
  overLimitCredit: number
}

describe.skipIf(!available)('operations summary', () => {
  const suffix = uniqueSuffix().toUpperCase()
  const branchIds: string[] = []
  const userIds: string[] = []
  const productIds: string[] = []
  const terminalIds: string[] = []
  const deviceIds: string[] = []
  const shiftIds: string[] = []
  const writeOffIds: string[] = []
  const transferIds: string[] = []
  const approvalIds: string[] = []
  const countIds: string[] = []
  const customerIds: string[] = []

  let branchAId = ''
  let branchBId = ''
  let branchCId = ''
  let categoryId = ''
  let uomId = ''

  let adminCookie = ''
  let managerACookie = ''
  let managerBCookie = ''
  let managerCCookie = ''
  let cashierCookie = ''

  /** The oldest pending approval in branch A: the one `oldest` must name. */
  let oldestApprovalId = ''
  let oldestRequestedAt = new Date()

  async function summaryOf(cookie: string, query = ''): Promise<OperationsSummary> {
    const response = await app.request(`/api/operations/summary${query}`, {
      headers: authedHeaders(cookie),
    })
    expect(response.status).toBe(200)
    return readJson<OperationsSummary>(response)
  }

  /** Every list the summary counts, read through the endpoint the console opens. */
  async function listTotals(cookie: string, scope = ''): Promise<QueueTotals> {
    const read = async (path: string, query: string): Promise<number> => {
      const suffixQuery = scope ? `&${scope}` : ''
      const response = await app.request(`${path}?${query}${suffixQuery}`, {
        headers: authedHeaders(cookie),
      })
      expect(response.status).toBe(200)
      return (await readJson<{ total: number }>(response)).total
    }

    return {
      approvals: await read('/api/approvals', 'status=PENDING&limit=1'),
      transferRequests: await read('/api/transfers', 'status=REQUESTED&limit=1'),
      writeOffs: await read('/api/write-offs', 'status=PENDING_APPROVAL&limit=1'),
      // An admin with no branch chosen reads every branch's low stock; a manager
      // is scoped to their own branch by the service. Both are one `total`.
      lowStock: await read('/api/inventory/low-stock', 'limit=1'),
      overLimitCredit: await read('/api/credit/over-limit', 'limit=1'),
    }
  }

  async function createShiftRow(
    label: string,
    branchId: string,
    reviewStatus: 'NONE' | 'REQUIRED',
  ) {
    const terminalRows = await db
      .insert(terminal)
      .values({ branchId, code: `OPS-${suffix}-${label}`, name: `Ops Counter ${label}` })
      .returning({ id: terminal.id })
    const terminalId = terminalRows[0]?.id ?? ''
    terminalIds.push(terminalId)

    const deviceRows = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `ops-${suffix}-${label}`,
        tokenHash: hashDeviceToken(randomToken(40)),
      })
      .returning({ id: device.id })
    const deviceId = deviceRows[0]?.id ?? ''
    deviceIds.push(deviceId)

    const shiftRows = await db
      .insert(shift)
      .values({
        number: `OPS-${suffix}-${label}`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId: 'ops-fixture-cashier',
        cashierStaffId: 'OPS-CASHIER',
        status: 'CLOSED',
        openedAt: new Date(Date.now() - 6 * 60 * 60 * 1000),
        closedAt: new Date(Date.now() - 60 * 60 * 1000),
        openingFloatMinor: 20_000,
        countedCashMinor: 20_000,
        serverExpectedCashMinor: 20_000,
        varianceMinor: 0,
        reviewStatus,
      })
      .returning({ id: shift.id })
    const shiftId = shiftRows[0]?.id ?? ''
    shiftIds.push(shiftId)
    return shiftId
  }

  beforeAll(async () => {
    if (!available) return

    const branchRows = await db
      .insert(branch)
      .values([
        { code: `OA${suffix.slice(-6)}`, name: `Ops A ${suffix}`, city: 'Accra' },
        { code: `OB${suffix.slice(-6)}`, name: `Ops B ${suffix}`, city: 'Kumasi' },
        { code: `OC${suffix.slice(-6)}`, name: `Ops C ${suffix}`, city: 'Tema' },
      ])
      .returning({ id: branch.id })
    branchAId = branchRows[0]?.id ?? ''
    branchBId = branchRows[1]?.id ?? ''
    branchCId = branchRows[2]?.id ?? ''
    branchIds.push(branchAId, branchBId, branchCId)

    const admin = await createTestUser({ role: 'ADMIN' })
    const managerA = await createTestUser({ role: 'MANAGER', branchId: branchAId })
    const managerB = await createTestUser({ role: 'MANAGER', branchId: branchBId })
    const managerC = await createTestUser({ role: 'MANAGER', branchId: branchCId })
    const cashier = await createTestUser({ role: 'CASHIER', branchId: branchAId })
    userIds.push(admin.id, managerA.id, managerB.id, managerC.id, cashier.id)
    adminCookie = await signIn(admin.email)
    managerACookie = await signIn(managerA.email)
    managerBCookie = await signIn(managerB.email)
    managerCCookie = await signIn(managerC.email)
    cashierCookie = await signIn(cashier.email)

    const units = await db
      .insert(uom)
      .values({ code: `OU${suffix.slice(-6)}`, name: `Ops Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''
    const categories = await db
      .insert(category)
      .values({ name: `Ops Category ${suffix}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values(
        ['A1', 'A2', 'B1'].map((label) => ({
          sku: `OPS-${suffix}-${label}`,
          name: `Ops Product ${label} ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_000,
        })),
      )
      .returning({ id: product.id })
    const [productA1Id = '', productA2Id = '', productB1Id = ''] = products.map((row) => row.id)
    productIds.push(productA1Id, productA2Id, productB1Id)

    // Low stock: on hand at or below the threshold, in each of two branches.
    await db.insert(stockLevel).values([
      { productId: productA1Id, branchId: branchAId, quantityOnHand: 3, avgCostMinor: 1_000 },
      { productId: productA2Id, branchId: branchAId, quantityOnHand: 4, avgCostMinor: 1_000 },
      { productId: productB1Id, branchId: branchBId, quantityOnHand: 1, avgCostMinor: 1_000 },
    ])
    await db.insert(stockThreshold).values([
      { productId: productA1Id, branchId: branchAId, threshold: 10 },
      { productId: productA2Id, branchId: branchAId, threshold: 10 },
      { productId: productB1Id, branchId: branchBId, threshold: 5 },
    ])

    // One requested transfer and one pending write-off per branch: the queue the
    // manager decides, not a draft.
    const transferRows = await db
      .insert(transfer)
      .values({
        number: `OPS-TRF-${suffix}`,
        fromBranchId: branchAId,
        toBranchId: branchBId,
        status: 'REQUESTED',
        note: 'Ops transfer fixture',
      })
      .returning({ id: transfer.id })
    if (transferRows[0]?.id) transferIds.push(transferRows[0].id)

    const writeOffRows = await db
      .insert(stockWriteOff)
      .values([
        { number: `OPS-WO-A-${suffix}`, branchId: branchAId, requestedBy: 'ops-fixture' },
        { number: `OPS-WO-B-${suffix}`, branchId: branchBId, requestedBy: 'ops-fixture' },
        // Decided: it must not be counted as waiting.
        {
          number: `OPS-WO-A2-${suffix}`,
          branchId: branchAId,
          requestedBy: 'ops-fixture',
          status: 'APPROVED',
        },
      ])
      .returning({ id: stockWriteOff.id })
    writeOffIds.push(...writeOffRows.map((row) => row.id))

    // Two shifts awaiting review (one per branch) plus one already reviewed.
    const shiftAId = await createShiftRow('A', branchAId, 'REQUIRED')
    await createShiftRow('B', branchBId, 'REQUIRED')
    await createShiftRow('A2', branchAId, 'NONE')

    // Over-limit credit: the analytics predicate, `limit > 0 AND balance > limit`.
    const customerRows = await db
      .insert(customer)
      .values([
        { name: `Ops Credit A ${suffix}`, createdBranchId: branchAId },
        { name: `Ops Credit B ${suffix}`, createdBranchId: branchBId },
      ])
      .returning({ id: customer.id })
    const [customerAId = '', customerBId = ''] = customerRows.map((row) => row.id)
    customerIds.push(customerAId, customerBId)
    await db.insert(creditProfile).values([
      { customerId: customerAId, branchId: branchAId, limitMinor: 5_000, balanceMinor: 7_500 },
      { customerId: customerBId, branchId: branchBId, limitMinor: 1_000, balanceMinor: 3_000 },
    ])

    // A posted count this month with every line matched: accuracy is 100%.
    const countRows = await db
      .insert(stockCount)
      .values({
        number: `OPS-CNT-${suffix}`,
        branchId: branchAId,
        status: 'POSTED',
        postedAt: new Date(),
        postedBy: 'ops-fixture',
      })
      .returning({ id: stockCount.id })
    const countId = countRows[0]?.id ?? ''
    if (countId) {
      countIds.push(countId)
      await db.insert(stockCountLine).values({
        countId,
        productId: productA1Id,
        snapshotQty: 3,
        countedQty: 3,
      })
    }

    oldestRequestedAt = new Date(Date.now() - 3 * 60 * 60 * 1000)
    const approvalRows = await db
      .insert(approval)
      .values([
        {
          type: 'PRODUCT_CREATE',
          branchId: branchAId,
          status: 'PENDING',
          requestedBy: 'ops-fixture-manager-a',
          requestedAt: oldestRequestedAt,
          deciderRole: 'ADMIN',
          amountMinor: 12_500,
        },
        {
          type: 'SHIFT_VARIANCE_REVIEW',
          entityId: shiftAId,
          branchId: branchAId,
          status: 'PENDING',
          requestedBy: 'ops-fixture-manager-a',
          requestedAt: new Date(Date.now() - 60 * 60 * 1000),
          deciderRole: 'MANAGER',
          deciderBranchId: branchAId,
        },
        {
          type: 'PRODUCT_CREATE',
          branchId: branchBId,
          status: 'PENDING',
          requestedBy: 'ops-fixture-manager-b',
          requestedAt: new Date(Date.now() - 2 * 60 * 60 * 1000),
          deciderRole: 'ADMIN',
          amountMinor: 4_000,
        },
      ])
      .returning({ id: approval.id })
    approvalIds.push(...approvalRows.map((row) => row.id))
    oldestApprovalId = approvalRows[0]?.id ?? ''
  })

  afterAll(async () => {
    if (!available) return

    if (writeOffIds.length > 0) {
      await db.delete(stockWriteOff).where(inArray(stockWriteOff.id, writeOffIds))
    }
    if (transferIds.length > 0) {
      await db.delete(transfer).where(inArray(transfer.id, transferIds))
    }
    if (approvalIds.length > 0) {
      await db.delete(approval).where(inArray(approval.id, approvalIds))
    }
    if (shiftIds.length > 0) {
      await db.delete(shift).where(inArray(shift.id, shiftIds))
    }
    if (deviceIds.length > 0) {
      await db.delete(device).where(inArray(device.id, deviceIds))
    }
    if (terminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, terminalIds))
    }
    if (countIds.length > 0) {
      await db.delete(stockCountLine).where(inArray(stockCountLine.countId, countIds))
      await db.delete(stockCount).where(inArray(stockCount.id, countIds))
    }
    if (productIds.length > 0) {
      await db.delete(stockThreshold).where(inArray(stockThreshold.productId, productIds))
      await db.delete(stockLevel).where(inArray(stockLevel.productId, productIds))
    }
    if (customerIds.length > 0) {
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, customerIds))
      await db.delete(customer).where(inArray(customer.id, customerIds))
    }
    if (productIds.length > 0) {
      await db.delete(product).where(inArray(product.id, productIds))
    }
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    for (const userId of userIds) {
      await deleteTestUser(userId)
    }
    if (branchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, branchIds))
    }
  })

  it('counts every queue for the manager and zero-fills the approval types', async () => {
    const summary = await summaryOf(managerACookie)

    expect(summary.branchId).toBe(branchAId)
    // Hand-counted from the fixture: two pending approvals, one requested
    // transfer, one pending write-off, one shift awaiting review, two low-stock
    // parts, one over-limit customer.
    expect(summary.approvals?.count).toBe(2)
    expect(summary.transferRequests?.count).toBe(1)
    expect(summary.writeOffs?.count).toBe(1)
    expect(summary.shiftVariances?.count).toBe(1)
    expect(summary.lowStock?.count).toBe(2)
    expect(summary.overLimitCredit?.count).toBe(1)

    // Every type is answered, zero included: a client never guesses whether a
    // missing key means "none" or "not asked".
    const byType = summary.approvals?.byType
    for (const type of APPROVAL_TYPES) {
      expect(typeof byType?.[type]).toBe('number')
    }
    expect(byType?.PRODUCT_CREATE).toBe(1)
    expect(byType?.SHIFT_VARIANCE_REVIEW).toBe(1)
    expect(byType?.TRANSFER_REQUEST).toBe(0)
    expect(byType?.STOCK_WRITE_OFF).toBe(0)
    expect(byType?.PRICE_CHANGE).toBe(0)
    expect(byType?.CREDIT_LIMIT_CHANGE).toBe(0)
    expect(byType?.PURCHASE_ORDER).toBe(0)
    expect(byType?.REFUND).toBe(0)

    // The month's one posted count matched on every line, so accuracy is exact.
    expect(summary.countAccuracyBp).toBe(10_000)
  })

  it('names the oldest pending approval, not the newest', async () => {
    const summary = await summaryOf(managerACookie)
    expect(summary.approvals?.oldest?.id).toBe(oldestApprovalId)
    expect(summary.approvals?.oldest?.type).toBe('PRODUCT_CREATE')
    expect(summary.approvals?.oldest?.requestedAt).toBe(oldestRequestedAt.toISOString())
    expect(summary.approvals?.oldest?.amountMinor).toBe(12_500)
  })

  it('keeps each count equal to the list endpoint it links to', async () => {
    const manager = await summaryOf(managerACookie)
    const managerTotals = await listTotals(managerACookie)
    expect(manager.approvals?.count).toBe(managerTotals.approvals)
    expect(manager.transferRequests?.count).toBe(managerTotals.transferRequests)
    expect(manager.writeOffs?.count).toBe(managerTotals.writeOffs)
    expect(manager.lowStock?.count).toBe(managerTotals.lowStock)
    expect(manager.overLimitCredit?.count).toBe(managerTotals.overLimitCredit)

    // The shift queue has no list endpoint of its own; its rows are the pending
    // `SHIFT_VARIANCE_REVIEW` approvals, so the two counts must agree.
    expect(manager.shiftVariances?.count).toBe(manager.approvals?.byType.SHIFT_VARIANCE_REVIEW)

    // A second branch agrees with its own lists too, so the parity is not a
    // property of the first fixture.
    const other = await summaryOf(managerBCookie)
    const otherTotals = await listTotals(managerBCookie)
    expect(other.approvals?.count).toBe(otherTotals.approvals)
    expect(other.transferRequests?.count).toBe(otherTotals.transferRequests)
    expect(other.writeOffs?.count).toBe(otherTotals.writeOffs)
    expect(other.lowStock?.count).toBe(otherTotals.lowStock)
    expect(other.overLimitCredit?.count).toBe(otherTotals.overLimitCredit)
  })

  it('refuses another branch’s queue to a manager', async () => {
    const foreign = await app.request(`/api/operations/summary?branchId=${branchBId}`, {
      headers: authedHeaders(managerACookie),
    })
    expect(foreign.status).toBe(403)

    // The service refuses it again on its own, without the route's permission
    // gate in the way (P11-D17).
    const managerAUser = makeUser({ role: 'MANAGER', branchId: branchAId })
    await expect(getOperationsSummary(managerAUser, { branchId: branchBId })).rejects.toThrow(
      /own branch/,
    )
  })

  it('gives an admin every branch when no branch is chosen', async () => {
    const admin = await summaryOf(adminCookie)
    expect(admin.branchId).toBeNull()

    const totals = await listTotals(adminCookie)
    expect(admin.approvals?.count).toBe(totals.approvals)
    expect(admin.transferRequests?.count).toBe(totals.transferRequests)
    expect(admin.writeOffs?.count).toBe(totals.writeOffs)
    expect(admin.overLimitCredit?.count).toBe(totals.overLimitCredit)

    // Both fixture branches are in the global figures, not just the admin's own.
    const managerA = await summaryOf(managerACookie)
    const managerB = await summaryOf(managerBCookie)
    expect(admin.approvals?.count).toBeGreaterThanOrEqual(
      (managerA.approvals?.count ?? 0) + (managerB.approvals?.count ?? 0),
    )
    expect(admin.writeOffs?.count).toBeGreaterThanOrEqual(
      (managerA.writeOffs?.count ?? 0) + (managerB.writeOffs?.count ?? 0),
    )

    // An admin who has chosen no branch still gets a low-stock figure: the
    // unscoped list reads every branch and the summary count is exactly its
    // `total`. The same part at two branches is two rows, which is the honest
    // answer to "what is low anywhere".
    expect(admin.lowStock).toBeDefined()
    expect(admin.lowStock?.count).toBe(totals.lowStock)
    expect(admin.lowStock?.count).toBeGreaterThanOrEqual(
      (managerA.lowStock?.count ?? 0) + (managerB.lowStock?.count ?? 0),
    )

    // Choosing a branch narrows the same read.
    const scoped = await summaryOf(adminCookie, `?branchId=${branchAId}`)
    expect(scoped.branchId).toBe(branchAId)
    expect(scoped.lowStock?.count).toBe(2)
  })

  it('omits a section the caller may not read instead of reporting zero', async () => {
    const managerAUser = makeUser({ role: 'MANAGER', branchId: branchAId })

    flags.revokeCreditRead = true
    try {
      const restricted = await getOperationsSummary(managerAUser, {})
      // Present: the queues `approval.read` and `inventory.read` cover.
      expect(restricted.approvals?.count).toBe(2)
      expect(restricted.transferRequests?.count).toBe(1)
      expect(restricted.lowStock?.count).toBe(2)
      // Absent — not `{ count: 0 }`, which would claim the branch has no exposure.
      expect(restricted.overLimitCredit).toBeUndefined()
      expect('overLimitCredit' in restricted).toBe(false)
    } finally {
      flags.revokeCreditRead = false
    }

    const restored = await getOperationsSummary(managerAUser, {})
    expect(restored.overLimitCredit?.count).toBe(1)
  })

  it('defaults to no sections at all for a role with no permissions', async () => {
    const cashierUser = makeUser({ role: 'CASHIER', branchId: branchAId })
    const summary = await getOperationsSummary(cashierUser, {})
    expect(summary).toEqual({ branchId: branchAId })
  })

  it('reports no count accuracy for a branch with no posted count this month', async () => {
    const summary = await summaryOf(managerCCookie)
    expect(summary.branchId).toBe(branchCId)
    expect(summary.countAccuracyBp).toBeNull()
    // A branch with nothing in it is still answered: zero, not absent.
    expect(summary.lowStock?.count).toBe(0)
    expect(summary.shiftVariances?.count).toBe(0)
  })

  it('requires a session and the approval permission', async () => {
    const anonymous = await app.request('/api/operations/summary')
    expect(anonymous.status).toBe(401)

    const cashier = await app.request('/api/operations/summary', {
      headers: authedHeaders(cashierCookie),
    })
    expect(cashier.status).toBe(403)
  })

  it('rejects an unknown query parameter instead of ignoring it', async () => {
    const smuggled = await app.request('/api/operations/summary?branchIds=all', {
      headers: authedHeaders(managerACookie),
    })
    expect(smuggled.status).toBe(400)
  })
})
