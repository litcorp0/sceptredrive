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
import { creditLedgerEntry } from '../credit/credit.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockMovement } from '../inventory/inventory.schema.ts'
import { loyaltyLedgerEntry } from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { getSettingValue } from '../platform/settings.service.ts'
import { signDeviceJwt } from '../sync/sync.jwt.ts'
import { applyUpload } from '../sync/sync.service.ts'
import type {
  CartVoidPayload,
  DeviceAuthContext,
  DeviceStaffProof,
  PosUploadBody,
  PosUploadResponse,
} from '../sync/sync.types.ts'
import {
  cartVoid,
  posStaffBinding,
  posSyncTransaction,
  shift,
  shiftReport,
  syncConflict,
} from './pos.schema.ts'
import { applyCartVoid, closeShift, type ShiftCloseWithCloser } from './pos.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.cart-void.test] database unavailable; integration tests skipped')

/**
 * A cart that never became a sale (P13-D28), and the close that now names the
 * person who closed the drawer (P13-D41).
 *
 * A void needs a reason and no PIN, because a void that needed a manager is a
 * void that never gets recorded. It moves no stock, credit or loyalty: nothing
 * was ever sold.
 */
describe.skipIf(!available)('POS cart void', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdShiftIds: string[] = []

  const floatMinor = 20_000
  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let otherTerminalId = ''
  let otherDeviceId = ''
  let shiftId = ''
  let deviceToken = ''
  let otherDeviceToken = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let managerUserId = ''
  let managerStaffId = ''
  let managerBindingId = ''
  let managerToken = ''
  let managerCookie = ''
  let tolerance = 0
  let shiftCount = 0

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })
  const otherContext = (): DeviceAuthContext => ({
    deviceId: otherDeviceId,
    terminalId: otherTerminalId,
    branchId,
  })

  function cartVoidContext() {
    return {
      clientTransactionId: crypto.randomUUID(),
      device: deviceContext(),
      receivedAt: new Date(),
      clockSkewToleranceMinutes: 10,
    }
  }

  function cartVoidPayload(overrides: Partial<CartVoidPayload> = {}): CartVoidPayload {
    return {
      shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      reasonCode: 'WRONG_ITEM',
      note: null,
      itemCount: 2,
      grossMinor: 4_500,
      label: null,
      lines: [
        {
          productId: crypto.randomUUID(),
          name: 'Test item',
          quantity: 2,
          unitPriceMinor: 2_250,
        },
      ],
      occurredAt: new Date().toISOString(),
      ...overrides,
    }
  }

  async function applyCartVoidNow(payload: CartVoidPayload) {
    const ctx = cartVoidContext()
    const result = await db.transaction((tx) => applyCartVoid(ctx, payload, tx))
    return { ...result, clientTransactionId: ctx.clientTransactionId }
  }

  function uploadRequest(transactions: unknown[], token = deviceToken) {
    return app.request('/api/pos/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${token}` },
      body: JSON.stringify({ batchId: crypto.randomUUID(), deviceId, terminalId, transactions }),
    })
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  /** A fresh open shift on this device, so each close case owns its own drawer. */
  async function freshShift(): Promise<string> {
    // `shift_one_open_per_terminal` is a database invariant; the previous
    // fixture shift is closed first rather than deleted (the row is history).
    await db
      .update(shift)
      .set({ status: 'CLOSED', closedAt: new Date('2026-10-27T17:00:00Z') })
      .where(and(eq(shift.terminalId, terminalId), eq(shift.status, 'OPEN')))

    shiftCount += 1
    const id = crypto.randomUUID()
    createdShiftIds.push(id)
    await db.insert(shift).values({
      id,
      number: `CV-${suffix}-S-${shiftCount}`,
      branchId,
      terminalId,
      deviceId,
      cashierUserId,
      cashierStaffId,
      status: 'OPEN',
      openedAt: new Date('2026-10-27T08:00:00Z'),
      openingFloatMinor: floatMinor,
      openedBy: cashierStaffId,
    })
    return id
  }

  function managerClosedBy(overrides: Partial<DeviceStaffProof> = {}): DeviceStaffProof {
    return {
      userId: managerUserId,
      staffId: managerStaffId,
      bindingId: managerBindingId,
      bindingToken: managerToken,
      pinVersion: 1,
      ...overrides,
    }
  }

  function closePayload(
    id: string,
    varianceMinor: number,
    extra: Partial<ShiftCloseWithCloser> = {},
  ): ShiftCloseWithCloser {
    return {
      shiftId: id,
      countedCashMinor: floatMinor + varianceMinor,
      clientExpectedCashMinor: floatMinor,
      ...extra,
      occurredAt: new Date('2026-10-27T18:00:00Z').toISOString(),
    }
  }

  function reviewsFor(id: string) {
    return db
      .select()
      .from(approval)
      .where(and(eq(approval.type, 'SHIFT_VARIANCE_REVIEW'), eq(approval.entityId, id)))
  }

  function decide(approvalId: string, cookie = managerCookie) {
    return app.request(`/api/approvals/${approvalId}/decide`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({ decision: 'APPROVED', note: 'Recounted with the manager present' }),
    })
  }

  async function shiftRow(id: string) {
    const rows = await db.select().from(shift).where(eq(shift.id, id))
    const row = rows[0]
    if (!row) throw new Error('the shift was not written')
    return row
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `V${suffix}`, name: `Void ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''
    createdBranchIds.push(branchId)

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `V${suffix}-T01`, name: 'Void Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const otherTerminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `V${suffix}-T02`, name: 'Void Counter 2' })
      .returning()
    otherTerminalId = otherTerminalRow[0]?.id ?? ''
    createdTerminalIds.push(otherTerminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `void-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    const otherDeviceRow = await db
      .insert(device)
      .values({
        terminalId: otherTerminalId,
        fingerprint: `void-other-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    otherDeviceId = otherDeviceRow[0]?.id ?? ''
    createdDeviceIds.push(otherDeviceId)

    deviceToken = await signDeviceJwt({ deviceId, terminalId, branchId })
    otherDeviceToken = await signDeviceJwt({
      deviceId: otherDeviceId,
      terminalId: otherTerminalId,
      branchId,
    })

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `SD-CV${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashier.id))
    cashierToken = randomToken(40)
    const cashierBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
        role: 'CASHIER',
        branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(cashierToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    cashierBindingId = cashierBinding[0]?.id ?? ''

    const manager = await createTestUser({ role: 'MANAGER', branchId })
    createdUserIds.push(manager.id)
    managerUserId = manager.id
    managerStaffId = `SD-CVM${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: managerStaffId, pinVersion: 1 })
      .where(eq(userTable.id, manager.id))
    managerCookie = await signIn(manager.email)
    managerToken = randomToken(40)
    const managerBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: managerUserId,
        staffStaffId: managerStaffId,
        role: 'MANAGER',
        branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(managerToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    managerBindingId = managerBinding[0]?.id ?? ''

    // The same manager, bound on the other terminal: a close that presents this
    // proof to the first device must be refused (P13-D41).
    await db.insert(posStaffBinding).values({
      deviceId: otherDeviceId,
      staffUserId: managerUserId,
      staffStaffId: managerStaffId,
      role: 'MANAGER',
      branchId,
      pinVersion: 1,
      bindingTokenHash: hashDeviceToken(otherDeviceToken),
      expiresAt: new Date(Date.now() + 30 * 86_400_000),
    })

    shiftId = await freshShift()
    tolerance = await getSettingValue('pos.shiftVarianceToleranceMinor', { branchId })
    expect(tolerance).toBe(2_000)
  })

  afterAll(async () => {
    if (!available) return
    await db.delete(cartVoid).where(eq(cartVoid.branchId, branchId))
    await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
    if (createdDeviceIds.length > 0) {
      await db
        .delete(posSyncTransaction)
        .where(inArray(posSyncTransaction.deviceId, createdDeviceIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.branchId, createdBranchIds))
    }
    if (createdShiftIds.length > 0) {
      // The Z-report is immutable history and the shift FK is RESTRICT, so the
      // test removes the snapshots before the shifts they belong to.
      await db.delete(shiftReport).where(inArray(shiftReport.shiftId, createdShiftIds))
      await db.delete(shift).where(inArray(shift.id, createdShiftIds))
    }
    if (createdDeviceIds.length > 0) {
      await db.delete(posStaffBinding).where(inArray(posStaffBinding.deviceId, createdDeviceIds))
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  it('refuses OTHER without a note and writes nothing', async () => {
    await expect(
      applyCartVoid(cartVoidContext(), cartVoidPayload({ reasonCode: 'OTHER', note: null })),
    ).rejects.toMatchObject({ code: 'CART_VOID_NOTE_REQUIRED' })

    expect(await db.select().from(cartVoid).where(eq(cartVoid.branchId, branchId))).toHaveLength(0)
  })

  it('records OTHER with a note and audits the reason', async () => {
    const result = await applyCartVoidNow(
      cartVoidPayload({ reasonCode: 'OTHER', note: 'price changed' }),
    )

    const [row] = await db.select().from(cartVoid).where(eq(cartVoid.id, result.cartVoidId))
    expect(row).toMatchObject({
      reasonCode: 'OTHER',
      note: 'price changed',
      itemCount: 2,
      grossMinor: 4_500,
      cashierStaffId,
    })
    expect(result.cartVoidId).toBe(result.clientTransactionId)
    expect(row?.lines).toHaveLength(1)
  })

  it('accepts every coded reason without a note', async () => {
    const reasons = [
      'CUSTOMER_CHANGED_MIND',
      'WRONG_ITEM',
      'PRICE_DISPUTE',
      'DUPLICATE_SCAN',
      'CUSTOMER_LEFT',
    ] as const

    for (const reasonCode of reasons) {
      const result = await applyCartVoidNow(cartVoidPayload({ reasonCode, note: null }))
      const [row] = await db.select().from(cartVoid).where(eq(cartVoid.id, result.cartVoidId))
      expect(row?.reasonCode).toBe(reasonCode)
      expect(row?.note).toBeNull()
    }
  })

  it('accepts a zero gross with a zero-priced line', async () => {
    const result = await applyCartVoidNow(
      cartVoidPayload({
        reasonCode: 'CUSTOMER_LEFT',
        grossMinor: 0,
        itemCount: 1,
        lines: [
          { productId: crypto.randomUUID(), name: 'Goodwill line', quantity: 1, unitPriceMinor: 0 },
        ],
      }),
    )

    const [row] = await db.select().from(cartVoid).where(eq(cartVoid.id, result.cartVoidId))
    expect(row).toMatchObject({ grossMinor: 0, itemCount: 1 })
  })

  it('is idempotent through the upload ledger: one row, the replay says REPLAYED', async () => {
    const clientTransactionId = crypto.randomUUID()
    const body: PosUploadBody = {
      batchId: crypto.randomUUID(),
      deviceId,
      terminalId,
      transactions: [
        {
          clientTransactionId,
          type: 'CART_VOID',
          occurredAt: new Date().toISOString(),
          payloadVersion: 1,
          payload: cartVoidPayload({ reasonCode: 'CUSTOMER_CHANGED_MIND' }),
        },
      ],
    }

    const first = await applyUpload(deviceContext(), body)
    expect(first.results[0]).toMatchObject({ status: 'APPLIED', serverId: clientTransactionId })

    const second = await applyUpload(deviceContext(), body)
    expect(second.results[0]?.status).toBe('REPLAYED')

    const rows = await db.select().from(cartVoid).where(eq(cartVoid.id, clientTransactionId))
    expect(rows).toHaveLength(1)
  })

  it('moves no stock, credit or loyalty', async () => {
    const clientTransactionId = crypto.randomUUID()
    await applyCartVoidNow(cartVoidPayload({ reasonCode: 'DUPLICATE_SCAN' }))

    const [stock, credit, loyalty] = await Promise.all([
      db.select().from(stockMovement).where(eq(stockMovement.branchId, branchId)),
      db.select().from(creditLedgerEntry).where(eq(creditLedgerEntry.branchId, branchId)),
      db.select().from(loyaltyLedgerEntry).limit(1),
    ])
    expect(stock).toHaveLength(0)
    expect(credit).toHaveLength(0)
    // A loyalty row elsewhere in the suite is fine; what matters is that this
    // void wrote none of its own.
    expect(loyalty.every((row) => row.idempotencyKey !== clientTransactionId)).toBe(true)
  })

  it('refuses more than 200 lines at the route', async () => {
    const lines = Array.from({ length: 201 }, (_, index) => ({
      productId: crypto.randomUUID(),
      name: `Line ${index}`,
      quantity: 1,
      unitPriceMinor: 100,
    }))

    const response = await uploadRequest([
      {
        clientTransactionId: crypto.randomUUID(),
        type: 'CART_VOID',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: cartVoidPayload({ reasonCode: 'WRONG_ITEM', lines, itemCount: 201 }),
      },
    ])

    expect(response.status).toBe(400)
  })

  it('refuses a shift that belongs to another device', async () => {
    const before = await db.select().from(cartVoid).where(eq(cartVoid.branchId, branchId))

    const error = (await applyCartVoid(
      { ...cartVoidContext(), device: otherContext() },
      cartVoidPayload(),
    ).catch((caught: unknown) => caught)) as Error & { code?: string; statusCode?: number }

    // The same guard every device-originated fact uses: a foreign shift is a
    // conflict (409), not a forged document.
    expect(error).toMatchObject({ code: 'SHIFT_DEVICE_MISMATCH', statusCode: 409 })
    expect(await db.select().from(cartVoid).where(eq(cartVoid.branchId, branchId))).toHaveLength(
      before.length,
    )
  })

  it('names the manager who closed another cashier’s drawer as the requester', async () => {
    const id = await freshShift()
    const response = await uploadRequest([
      {
        clientTransactionId: crypto.randomUUID(),
        type: 'SHIFT_CLOSE',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: closePayload(id, tolerance + 1, { closedBy: managerClosedBy() }),
      },
    ])

    expect(response.status).toBe(200)
    const body = await readJson<PosUploadResponse>(response)
    expect(body.results[0]?.status).toBe('APPLIED')

    const [review] = await reviewsFor(id)
    expect(review?.requestedBy).toBe(managerStaffId)
    expect(review?.payload).toMatchObject({ closed_by: managerStaffId })
    expect((await shiftRow(id)).closedBy).toBe(managerStaffId)

    // The manager is the requester, so the no-self-approval rule finally bites.
    const refused = await decide(review?.id ?? '')
    expect(refused.status).toBe(403)
    expect((await shiftRow(id)).reviewStatus).toBe('REQUIRED')
  })

  it('falls back to the shift’s cashier and says the close is unattributed', async () => {
    const id = await freshShift()
    await closeShift(deviceContext(), closePayload(id, tolerance + 1))

    const [review] = await reviewsFor(id)
    expect(review?.requestedBy).toBe(cashierStaffId)
    expect(review?.payload).toMatchObject({ closed_by: 'shift owner (unattributed)' })
    expect((await shiftRow(id)).closedBy).toBe(cashierStaffId)
  })

  it('refuses a closer proven on another device and leaves the shift open', async () => {
    const id = await freshShift()

    const error = (await closeShift(
      deviceContext(),
      closePayload(id, tolerance + 1, {
        closedBy: managerClosedBy({ bindingToken: otherDeviceToken }),
      }),
    ).catch((caught: unknown) => caught)) as Error & { statusCode?: number }

    expect(error).toMatchObject({ statusCode: 403 })
    const row = await shiftRow(id)
    expect(row.status).toBe('OPEN')
    expect(await reviewsFor(id)).toHaveLength(0)
  })

  it('still lets a pre-Phase-13 till close through the wire', async () => {
    const id = await freshShift()
    const response = await uploadRequest([
      {
        clientTransactionId: crypto.randomUUID(),
        type: 'SHIFT_CLOSE',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: {
          shiftId: id,
          countedCashMinor: floatMinor,
          clientExpectedCashMinor: floatMinor,
          occurredAt: new Date().toISOString(),
        },
      },
    ])

    // `closedBy` is additive, so a payload without it is still a valid close.
    expect(response.status).toBe(200)
    const body = await readJson<PosUploadResponse>(response)
    expect(body.results[0]?.status).toBe('APPLIED')
    expect((await shiftRow(id)).status).toBe('CLOSED')
  })
})
