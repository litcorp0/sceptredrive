import { db } from '@gikautos/db'
import { eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { databaseAvailable, randomToken } from '../../../test/integration.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { cashMovement, shift, syncConflict } from './pos.schema.ts'
import { closeShift, computeExpectedCash, openShift, recordCashMovement } from './pos.service.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.test] database unavailable; integration tests skipped')

describe.skipIf(!available)('POS shift application', () => {
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdShiftIds: string[] = []
  const suffix = randomToken(4)
  let deviceA: DeviceAuthContext = { deviceId: '', terminalId: '', branchId: '' }
  let otherDevice: DeviceAuthContext = { deviceId: '', terminalId: '', branchId: '' }
  let secondBranchId = ''
  let cashierUserId = ''
  let cashierStaffId = ''

  async function createTerminal(branchId: string, label: string): Promise<DeviceAuthContext> {
    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `${suffix}-${label}`, name: `Shift ${label} ${suffix}` })
      .returning()
    const terminalId = terminalRow[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `pos-suite-${label}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    return { deviceId, terminalId, branchId }
  }

  function openPayload(id: string, floatMinor = 20_000) {
    return {
      shiftId: id,
      number: `${suffix}-S-20261022-01`,
      openingFloatMinor: floatMinor,
      cashierUserId,
      cashierStaffId,
      occurredAt: new Date('2026-10-22T08:00:00Z').toISOString(),
    }
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `${suffix}A`, name: `Shift Branch ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    const branchId = branchRow[0]?.id ?? ''
    createdBranchIds.push(branchId)

    const otherBranchRow = await db
      .insert(branch)
      .values({
        code: `${suffix}B`,
        name: `Other Shift Branch ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning()
    secondBranchId = otherBranchRow[0]?.id ?? ''
    createdBranchIds.push(secondBranchId)

    deviceA = await createTerminal(branchId, 'A')
    otherDevice = await createTerminal(branchId, 'B')
    cashierUserId = `cashier-${suffix}`
    cashierStaffId = `GA-9${suffix.slice(0, 3)}`
  })

  afterAll(async () => {
    if (createdShiftIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.shiftId, createdShiftIds))
      await db.delete(cashMovement).where(inArray(cashMovement.shiftId, createdShiftIds))
      await db.delete(shift).where(inArray(shift.id, createdShiftIds))
    }
    if (createdDeviceIds.length > 0) {
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('computes expected cash from tenders, change, and movements', () => {
    expect(
      computeExpectedCash({
        openingFloatMinor: 20_000,
        cashTendersMinor: 22_500,
        changeMinor: 7_500,
        cashInMinor: 5_000,
        cashOutMinor: 2_000,
      }),
    ).toBe(38_000)

    expect(
      computeExpectedCash({
        openingFloatMinor: 0,
        cashTendersMinor: 0,
        changeMinor: 0,
        cashInMinor: 0,
        cashOutMinor: 0,
      }),
    ).toBe(0)
  })

  it('opens a shift with the client id and audits it', async () => {
    const shiftId = crypto.randomUUID()
    createdShiftIds.push(shiftId)

    const result = await openShift(deviceA, openPayload(shiftId))
    expect(result.shiftId).toBe(shiftId)

    const rows = await db.select().from(shift).where(eq(shift.id, shiftId))
    expect(rows[0]).toMatchObject({
      status: 'OPEN',
      openingFloatMinor: 20_000,
      branchId: deviceA.branchId,
      terminalId: deviceA.terminalId,
      deviceId: deviceA.deviceId,
      cashierUserId,
    })

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, shiftId))
    expect(auditRows.some((row) => row.action === 'pos.shift.opened')).toBe(true)

    // A replay of the same client transaction is a no-op.
    const replay = await openShift(deviceA, openPayload(shiftId))
    expect(replay.shiftId).toBe(shiftId)
  })

  it('rejects a second open shift on the same terminal', async () => {
    const anotherId = crypto.randomUUID()
    await expect(openShift(deviceA, openPayload(anotherId, 10_000))).rejects.toMatchObject({
      statusCode: 409,
      code: 'CONFLICT',
    })
  })

  it('rejects a terminal that is not in the device branch', async () => {
    await expect(
      openShift({ ...deviceA, branchId: secondBranchId }, openPayload(crypto.randomUUID(), 1_000)),
    ).rejects.toMatchObject({ statusCode: 409, code: 'TERMINAL_BRANCH_MISMATCH' })
  })

  it('records cash movements on an open shift and audits them', async () => {
    const shiftId = createdShiftIds[0] ?? ''
    const movementId = crypto.randomUUID()

    await recordCashMovement(deviceA, {
      id: movementId,
      shiftId,
      type: 'CASH_IN',
      amountMinor: 5_000,
      reason: 'Float top-up',
      occurredAt: new Date('2026-10-22T09:00:00Z').toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })

    const rows = await db.select().from(cashMovement).where(eq(cashMovement.id, movementId))
    expect(rows[0]).toMatchObject({
      shiftId,
      type: 'CASH_IN',
      amountMinor: 5_000,
      deviceId: deviceA.deviceId,
    })

    const auditRows = await db.select().from(auditLog).where(eq(auditLog.entityId, movementId))
    expect(auditRows.some((row) => row.action === 'pos.cash.movement')).toBe(true)

    await recordCashMovement(deviceA, {
      id: crypto.randomUUID(),
      shiftId,
      type: 'CASH_OUT',
      amountMinor: 2_000,
      reason: 'Change run',
      occurredAt: new Date('2026-10-22T10:00:00Z').toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })
  })

  it('rejects movements from another device, of zero value, or on a closed shift', async () => {
    const shiftId = createdShiftIds[0] ?? ''

    await expect(
      recordCashMovement(otherDevice, {
        id: crypto.randomUUID(),
        shiftId,
        type: 'CASH_IN',
        amountMinor: 100,
        reason: 'Wrong device',
        occurredAt: new Date().toISOString(),
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
      }),
    ).rejects.toMatchObject({ code: 'SHIFT_DEVICE_MISMATCH' })

    await expect(
      recordCashMovement(deviceA, {
        id: crypto.randomUUID(),
        shiftId,
        type: 'CASH_IN',
        amountMinor: 0,
        reason: 'Zero',
        occurredAt: new Date().toISOString(),
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
      }),
    ).rejects.toMatchObject({ code: 'INVALID_AMOUNT' })
  })

  it('closes with the server expected cash and no conflict when the client agrees', async () => {
    const shiftId = createdShiftIds[0] ?? ''
    // float 20000 + cash in 5000 − cash out 2000 = 23000
    const result = await closeShift(deviceA, {
      shiftId,
      countedCashMinor: 22_500,
      clientExpectedCashMinor: 23_000,
      closeNote: 'Evening close',
      occurredAt: new Date('2026-10-22T18:00:00Z').toISOString(),
    })

    expect(result.serverExpectedCashMinor).toBe(23_000)
    expect(result.varianceMinor).toBe(-500)
    expect(result.conflictId).toBeUndefined()

    const rows = await db.select().from(shift).where(eq(shift.id, shiftId))
    expect(rows[0]).toMatchObject({
      status: 'CLOSED',
      countedCashMinor: 22_500,
      clientExpectedCashMinor: 23_000,
      serverExpectedCashMinor: 23_000,
      varianceMinor: -500,
    })

    await expect(
      closeShift(deviceA, {
        shiftId,
        countedCashMinor: 0,
        clientExpectedCashMinor: 0,
        occurredAt: new Date().toISOString(),
      }),
    ).rejects.toMatchObject({ statusCode: 409 })

    const closedMovement = recordCashMovement(deviceA, {
      id: crypto.randomUUID(),
      shiftId,
      type: 'CASH_IN',
      amountMinor: 100,
      reason: 'After close',
      occurredAt: new Date().toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })
    await expect(closedMovement).rejects.toMatchObject({ statusCode: 409 })
  })

  it('raises SHIFT_VARIANCE_MISMATCH when the client expected cash differs', async () => {
    const shiftId = crypto.randomUUID()
    createdShiftIds.push(shiftId)
    await openShift(otherDevice, {
      ...openPayload(shiftId, 10_000),
      number: `${suffix}-S-20261023-01`,
    })

    const result = await closeShift(otherDevice, {
      shiftId,
      countedCashMinor: 10_000,
      // Client missed a cash movement the server has (or invented one).
      clientExpectedCashMinor: 9_000,
      occurredAt: new Date('2026-10-23T18:00:00Z').toISOString(),
    })

    expect(result.serverExpectedCashMinor).toBe(10_000)
    expect(result.varianceMinor).toBe(0)
    expect(result.conflictId).toBeDefined()

    const conflicts = await db.select().from(syncConflict).where(eq(syncConflict.shiftId, shiftId))
    expect(conflicts).toHaveLength(1)
    expect(conflicts[0]).toMatchObject({
      type: 'SHIFT_VARIANCE_MISMATCH',
      severity: 'MEDIUM',
      status: 'OPEN',
      branchId: otherDevice.branchId,
    })
    expect(conflicts[0]?.details).toMatchObject({
      clientExpectedCashMinor: 9_000,
      serverExpectedCashMinor: 10_000,
      varianceMinor: 0,
    })
  })
})
