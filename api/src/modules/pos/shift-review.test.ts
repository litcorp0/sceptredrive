import { db } from '@sceptre/db'
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
import { approval } from '../approvals/approvals.schema.ts'
import { requestApproval } from '../approvals/approvals.service.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { reconcileShifts } from './pos.reconciliation.ts'
import { type ShiftReviewPatch, updateShiftReview } from './pos.repository.ts'
import { cashMovement, posSyncTransaction, shift, shiftReport, syncConflict } from './pos.schema.ts'
import { closeShift, openShift } from './pos.service.ts'
import type { ShiftClosePayload } from './pos.types.ts'

/**
 * A drawer that does not balance beyond the branch tolerance (Plan 12-08).
 *
 * Two facts must hold at once: the close raises a decision for a manager, and
 * the shift's money columns are byte-identical before and after that decision.
 * The upload response is the third: the till never learns a review exists
 * (APR-06), so the terminal keeps selling on Phase 11's contract.
 */

const available = await databaseAvailable()
if (!available) console.warn('[shift-review.test] database unavailable; integration tests skipped')

describe.skipIf(!available)('shift variance review', () => {
  const suffix = randomToken(4)
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdShiftIds: string[] = []
  const createdUserIds: string[] = []

  const floatMinor = 20_000
  let branchId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let managerUserId = ''
  let managerStaffId = ''
  let adminUserId = ''
  let adminStaffId = ''
  let managerCookie = ''
  let adminCookie = ''
  let tolerance = 0
  let terminalCount = 0

  interface TestTerminal {
    auth: DeviceAuthContext
    deviceToken: string
    terminalName: string
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  async function createTerminal(): Promise<TestTerminal> {
    terminalCount += 1
    const label = `${suffix}${terminalCount}`
    const terminalName = `Review Counter ${label}`
    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `RV${label}`, name: terminalName })
      .returning()
    const terminalId = terminalRow[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const deviceToken = randomToken(40)
    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `shift-review-${label}`,
        tokenHash: hashDeviceToken(deviceToken),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    return { auth: { deviceId, terminalId, branchId }, deviceToken, terminalName }
  }

  /** One open shift on its own terminal (one open shift per terminal). */
  async function openReviewShift(
    options: { terminal?: TestTerminal; cashierUserId?: string; cashierStaffId?: string } = {},
  ): Promise<TestTerminal & { shiftId: string; number: string }> {
    const created = options.terminal ?? (await createTerminal())
    const shiftId = crypto.randomUUID()
    createdShiftIds.push(shiftId)
    const number = `${suffix}-S-${createdShiftIds.length}`

    await openShift(created.auth, {
      shiftId,
      number,
      openingFloatMinor: floatMinor,
      cashierUserId: options.cashierUserId ?? cashierUserId,
      cashierStaffId: options.cashierStaffId ?? cashierStaffId,
      occurredAt: new Date('2026-10-26T08:00:00Z').toISOString(),
    })

    return { ...created, shiftId, number }
  }

  function closePayload(
    shiftId: string,
    varianceMinor: number,
    extra: Partial<ShiftClosePayload> = {},
  ): ShiftClosePayload {
    return {
      shiftId,
      countedCashMinor: floatMinor + varianceMinor,
      clientExpectedCashMinor: floatMinor,
      ...extra,
      occurredAt: new Date('2026-10-26T18:00:00Z').toISOString(),
    }
  }

  async function shiftRow(shiftId: string) {
    const rows = await db.select().from(shift).where(eq(shift.id, shiftId))
    const row = rows[0]
    if (!row) throw new Error('the shift was not written')
    return row
  }

  function reviewsFor(shiftId: string) {
    return db
      .select()
      .from(approval)
      .where(and(eq(approval.type, 'SHIFT_VARIANCE_REVIEW'), eq(approval.entityId, shiftId)))
  }

  function decide(approvalId: string, body: unknown, cookie = managerCookie) {
    return app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(body),
    })
  }

  /** Closes a fresh shift beyond tolerance and returns its pending review. */
  async function shiftAwaitingReview(closeNote?: string) {
    const created = await openReviewShift()
    await closeShift(
      created.auth,
      closePayload(created.shiftId, tolerance + 1, closeNote ? { closeNote } : {}),
    )
    const [pending] = await reviewsFor(created.shiftId)
    if (!pending) throw new Error('the close did not raise a review')
    return { ...created, approval: pending }
  }

  beforeAll(async () => {
    const [created] = await db
      .insert(branch)
      .values({
        code: `R${suffix}`,
        name: `Review Branch ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning()
    branchId = created?.id ?? ''
    createdBranchIds.push(branchId)

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    const manager = await createTestUser({ role: 'MANAGER', branchId })
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(cashier.id, manager.id, admin.id)

    cashierUserId = cashier.id
    cashierStaffId = `${suffix}CS`
    managerUserId = manager.id
    managerStaffId = `${suffix}MG`
    adminUserId = admin.id
    adminStaffId = `${suffix}AD`

    // `requested_by` is the staff label, so the users must carry one for the
    // no-self-approval rule to mean anything (P12-D26).
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId })
      .where(eq(userTable.id, cashierUserId))
    await db
      .update(userTable)
      .set({ staffId: managerStaffId })
      .where(eq(userTable.id, managerUserId))
    await db.update(userTable).set({ staffId: adminStaffId }).where(eq(userTable.id, adminUserId))

    managerCookie = await signIn(manager.email)
    adminCookie = await signIn(admin.email)

    tolerance = await getSettingValue('pos.shiftVarianceToleranceMinor', { branchId })
    expect(tolerance).toBe(2_000)
  })

  afterAll(async () => {
    if (!available) return
    await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
    await db
      .delete(posSyncTransaction)
      .where(inArray(posSyncTransaction.terminalId, createdTerminalIds))
    await db.delete(syncConflict).where(inArray(syncConflict.branchId, createdBranchIds))
    await db.delete(cashMovement).where(inArray(cashMovement.branchId, createdBranchIds))
    // The Z-report is immutable history and the shift FK is RESTRICT, so the
    // test removes the snapshots before the shifts they belong to.
    await db.delete(shiftReport).where(inArray(shiftReport.branchId, createdBranchIds))
    await db.delete(shift).where(inArray(shift.branchId, createdBranchIds))
    if (createdDeviceIds.length > 0) {
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('raises nothing when the variance is exactly the tolerance', async () => {
    const created = await openReviewShift()
    const result = await closeShift(created.auth, closePayload(created.shiftId, tolerance))

    expect(result).toEqual({
      shiftId: created.shiftId,
      serverExpectedCashMinor: floatMinor,
      varianceMinor: tolerance,
    })
    expect(await reviewsFor(created.shiftId)).toHaveLength(0)
    expect((await shiftRow(created.shiftId)).reviewStatus).toBe('NONE')
  })

  it('raises one manager review one pesewa beyond the tolerance', async () => {
    const created = await openReviewShift()
    await closeShift(
      created.auth,
      closePayload(created.shiftId, tolerance + 1, { closeNote: 'Drawer short' }),
    )

    const row = await shiftRow(created.shiftId)
    expect(row.reviewStatus).toBe('REQUIRED')
    expect(row.reviewedBy).toBeNull()

    const reviews = await reviewsFor(created.shiftId)
    expect(reviews).toHaveLength(1)
    const review = reviews[0]
    if (!review) throw new Error('no approval row')
    expect(review).toMatchObject({
      type: 'SHIFT_VARIANCE_REVIEW',
      status: 'PENDING',
      branchId,
      requestedBy: cashierStaffId,
      deciderRole: 'MANAGER',
      deciderBranchId: branchId,
      amountMinor: tolerance + 1,
      requestNote: 'Drawer short',
    })
    expect(review.payload).toMatchObject({
      shiftId: created.shiftId,
      shiftNumber: created.number,
      terminalName: created.terminalName,
      cashierName: 'Test User',
      saleCount: 0,
      expectedMinor: floatMinor,
      clientExpectedMinor: floatMinor,
      countedMinor: floatMinor + tolerance + 1,
      varianceMinor: tolerance + 1,
    })

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'approval.requested'), eq(auditLog.entityId, review.id)))
    expect(audits).toHaveLength(1)
  })

  it('renders the variance subject with the close-time facts, not the payload shape', async () => {
    const created = await shiftAwaitingReview()

    const response = await app.request(`/api/approvals/${created.approval.id}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(response.status).toBe(200)
    const body = await readJson<{ subject: Record<string, unknown> }>(response)

    expect(body.subject).toEqual({
      kind: 'shift_variance',
      shiftId: created.shiftId,
      terminalName: created.terminalName,
      expectedMinor: floatMinor,
      countedMinor: floatMinor + tolerance + 1,
      varianceMinor: tolerance + 1,
      shiftNumber: created.number,
      cashierName: 'Test User',
      openedAt: '2026-10-26T08:00:00.000Z',
      closedAt: '2026-10-26T18:00:00.000Z',
      saleCount: 0,
      clientExpectedMinor: floatMinor,
    })
  })

  it('triggers on a shortfall too, and records the absolute value as the amount', async () => {
    const created = await openReviewShift()
    const shortfall = -(tolerance + 1)
    await closeShift(created.auth, closePayload(created.shiftId, shortfall))

    const row = await shiftRow(created.shiftId)
    expect(row.reviewStatus).toBe('REQUIRED')
    expect(row.varianceMinor).toBe(shortfall)

    const [review] = await reviewsFor(created.shiftId)
    expect(review?.amountMinor).toBe(tolerance + 1)
    expect(review?.payload).toMatchObject({
      varianceMinor: shortfall,
      countedMinor: floatMinor + shortfall,
    })
  })

  it('records the reviewer and leaves every money column untouched', async () => {
    const created = await shiftAwaitingReview('Evening count')
    const before = await shiftRow(created.shiftId)
    const note = 'Drawer recounted with the cashier; GH₵15 was in the wrong slot'

    const response = await decide(created.approval.id, { decision: 'APPROVED', note })
    expect(response.status).toBe(200)

    const after = await shiftRow(created.shiftId)
    expect(after.reviewStatus).toBe('REVIEWED')
    expect(after.reviewedBy).toBe(managerStaffId)
    expect(after.reviewNote).toBe(note)
    expect(after.reviewedAt).toBeInstanceOf(Date)

    // Column by column: a review records an outcome, never a figure (P12-D25).
    expect(after.countedCashMinor).toBe(before.countedCashMinor)
    expect(after.serverExpectedCashMinor).toBe(before.serverExpectedCashMinor)
    expect(after.varianceMinor).toBe(before.varianceMinor)
    expect(after.clientExpectedCashMinor).toBe(before.clientExpectedCashMinor)

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'pos.shift.reviewed'), eq(auditLog.entityId, created.shiftId)))
    expect(audits).toHaveLength(1)
    expect(audits[0]?.actorStaffId).toBe(managerStaffId)
    expect(audits[0]?.after).toMatchObject({
      reviewStatus: 'REVIEWED',
      reviewNote: note,
      approvalId: created.approval.id,
    })

    // The reconciliation check still proves the arithmetic after the review.
    const divergences = await reconcileShifts(branchId)
    expect(divergences.filter((row) => row.shiftId === created.shiftId)).toHaveLength(0)
  })

  it('blocks the closing manager from signing off their own drawer', async () => {
    // The manager counted this drawer, so the request is theirs (P12-D26).
    const created = await shiftAwaitingReview()
    expect(created.approval.requestedBy).toBe(cashierStaffId)

    const selfShut = await openReviewShift({
      cashierUserId: managerUserId,
      cashierStaffId: managerStaffId,
    })
    await closeShift(selfShut.auth, closePayload(selfShut.shiftId, tolerance + 1))
    const [ownReview] = await reviewsFor(selfShut.shiftId)
    if (!ownReview) throw new Error('the close did not raise a review')
    expect(ownReview.requestedBy).toBe(managerStaffId)

    const refused = await decide(ownReview.id, { decision: 'APPROVED', note: 'All good' })
    expect(refused.status).toBe(403)
    expect((await shiftRow(selfShut.shiftId)).reviewStatus).toBe('REQUIRED')

    const byAdmin = await decide(
      ownReview.id,
      { decision: 'APPROVED', note: 'Recounted with the manager present' },
      adminCookie,
    )
    expect(byAdmin.status).toBe(200)

    const reviewed = await shiftRow(selfShut.shiftId)
    expect(reviewed.reviewStatus).toBe('REVIEWED')
    expect(reviewed.reviewedBy).toBe(adminStaffId)
  })

  it('refuses to reject a variance with a 400', async () => {
    const created = await shiftAwaitingReview()

    const response = await decide(created.approval.id, {
      decision: 'REJECTED',
      reasonCode: 'OTHER',
      note: 'The money is fine',
    })
    expect(response.status).toBe(400)
    const body = await readJson<{ error: { code: string; message: string } }>(response)
    expect(body.error.code).toBe('VALIDATION_ERROR')
    expect(body.error.message).toMatch(/cannot be rejected/)

    expect((await shiftRow(created.shiftId)).reviewStatus).toBe('REQUIRED')
    const [stillPending] = await reviewsFor(created.shiftId)
    expect(stillPending?.status).toBe('PENDING')
  })

  it('requires a note that says what was found', async () => {
    const created = await shiftAwaitingReview()

    const missing = await decide(created.approval.id, { decision: 'APPROVED' })
    expect(missing.status).toBe(400)

    const tooShort = await decide(created.approval.id, { decision: 'APPROVED', note: '  ok ' })
    expect(tooShort.status).toBe(400)

    expect((await shiftRow(created.shiftId)).reviewStatus).toBe('REQUIRED')

    const recorded = await decide(created.approval.id, {
      decision: 'APPROVED',
      note: '  counted  ',
    })
    expect(recorded.status).toBe(200)
    expect((await shiftRow(created.shiftId)).reviewNote).toBe('counted')
  })

  it('refuses a second decision on the same review', async () => {
    const created = await shiftAwaitingReview()

    const first = await decide(created.approval.id, { decision: 'APPROVED', note: 'First count' })
    expect(first.status).toBe(200)

    const second = await decide(created.approval.id, {
      decision: 'APPROVED',
      note: 'Second count',
    })
    expect(second.status).toBe(409)
    expect((await shiftRow(created.shiftId)).reviewNote).toBe('First count')
  })

  it('refuses a review of an open shift or of a shift that is not awaiting one', async () => {
    const actor: AuditActor = {
      actorId: cashierUserId,
      actorStaffId: cashierStaffId,
      ip: null,
      userAgent: null,
      requestId: null,
    }

    const openShiftRow = await openReviewShift()
    const openReview = await requestApproval(
      actor,
      {
        type: 'SHIFT_VARIANCE_REVIEW',
        entityId: openShiftRow.shiftId,
        branchId,
        amountMinor: tolerance + 1,
        deciderRole: 'MANAGER',
        deciderBranchId: branchId,
      },
      db,
    )
    const onOpen = await decide(openReview.id, { decision: 'APPROVED', note: 'Not closed yet' })
    expect(onOpen.status).toBe(409)

    // Closed inside tolerance: no review is raised, and a stray approval cannot
    // turn one into a review of nothing.
    const clean = await openReviewShift()
    await closeShift(clean.auth, closePayload(clean.shiftId, 0))
    expect((await shiftRow(clean.shiftId)).reviewStatus).toBe('NONE')

    const strayReview = await requestApproval(
      actor,
      {
        type: 'SHIFT_VARIANCE_REVIEW',
        entityId: clean.shiftId,
        branchId,
        amountMinor: 0,
        deciderRole: 'MANAGER',
        deciderBranchId: branchId,
      },
      db,
    )
    const notAwaiting = await decide(strayReview.id, {
      decision: 'APPROVED',
      note: 'Nothing to review',
    })
    expect(notAwaiting.status).toBe(409)
    expect((await shiftRow(clean.shiftId)).reviewStatus).toBe('NONE')
  })

  it('refuses a money column in the review patch', async () => {
    const created = await openReviewShift()
    await closeShift(created.auth, closePayload(created.shiftId, 0))
    const before = await shiftRow(created.shiftId)

    const smuggled = {
      reviewStatus: 'REQUIRED',
      countedCashMinor: (before.countedCashMinor ?? 0) + 1,
    } as unknown as ShiftReviewPatch
    await expect(updateShiftReview(created.shiftId, smuggled)).rejects.toThrow(/non-review column/)

    const after = await shiftRow(created.shiftId)
    expect(after.countedCashMinor).toBe(before.countedCashMinor)
    expect(after.reviewStatus).toBe('NONE')
  })

  it('keeps the SHIFT_CLOSE upload response byte-identical while raising the review', async () => {
    const created = await createTerminal()
    const sessionResponse = await app.request('/api/pos/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${created.deviceToken}` },
    })
    expect(sessionResponse.status).toBe(200)
    const session = await readJson<{ accessToken: string }>(sessionResponse)

    const shiftId = crypto.randomUUID()
    createdShiftIds.push(shiftId)
    const openTransactionId = crypto.randomUUID()
    const closeTransactionId = crypto.randomUUID()

    const response = await app.request('/api/pos/sync/upload', {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        authorization: `Bearer ${session.accessToken}`,
      },
      body: JSON.stringify({
        batchId: crypto.randomUUID(),
        deviceId: created.auth.deviceId,
        terminalId: created.auth.terminalId,
        transactions: [
          {
            clientTransactionId: openTransactionId,
            type: 'SHIFT_OPEN',
            occurredAt: new Date().toISOString(),
            payloadVersion: 1,
            payload: {
              shiftId,
              number: `${suffix}-U-1`,
              openingFloatMinor: floatMinor,
              cashierUserId,
              cashierStaffId,
              occurredAt: new Date().toISOString(),
            },
          },
          {
            clientTransactionId: closeTransactionId,
            type: 'SHIFT_CLOSE',
            occurredAt: new Date().toISOString(),
            payloadVersion: 1,
            payload: {
              shiftId,
              countedCashMinor: floatMinor + tolerance + 1,
              clientExpectedCashMinor: floatMinor,
              closeNote: 'Ten cedis unaccounted',
              occurredAt: new Date().toISOString(),
            },
          },
        ],
      }),
    })

    expect(response.status).toBe(200)
    const body = await readJson<{ results: unknown[] }>(response)
    // Phase 11's fixture, exactly: no approval id, no review state, no new key.
    expect(body.results[0]).toEqual({
      clientTransactionId: openTransactionId,
      status: 'APPLIED',
      serverId: shiftId,
      conflicts: [],
      resolved: { shiftId },
    })
    expect(body.results[1]).toEqual({
      clientTransactionId: closeTransactionId,
      status: 'APPLIED',
      serverId: shiftId,
      conflicts: [],
      resolved: { shiftId },
    })
    expect(JSON.stringify(body)).not.toMatch(/approval|review/i)

    // The review was raised inside the same upload transaction.
    expect((await shiftRow(shiftId)).reviewStatus).toBe('REQUIRED')
    expect(await reviewsFor(shiftId)).toHaveLength(1)
  })
})
