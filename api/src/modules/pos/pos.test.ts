import { db } from '@gikautos/db'
import { priceCart } from '@gikautos/shared'
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
import { category, uom } from '../catalog/catalog.schema.ts'
import { creditLedgerEntry, creditProfile } from '../credit/credit.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { product, productPrice } from '../products/products.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { reconcileSales, reconcileShifts } from './pos.reconciliation.ts'
import {
  cashMovement,
  posStaffBinding,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from './pos.schema.ts'
import {
  applySale,
  closeShift,
  computeExpectedCash,
  openShift,
  recordCashMovement,
} from './pos.service.ts'
import type { SaleApplyResult, SalePayload } from './pos.types.ts'

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

describe.skipIf(!available)('POS sale application', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdSaleIds: string[] = []

  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let managerUserId = ''
  let managerStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let managerBindingId = ''
  let productA = ''
  let productB = ''
  let productC = ''

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })

  function context(receivedAt = new Date(), clockSkewToleranceMinutes = 10) {
    const clientTransactionId = crypto.randomUUID()
    createdSaleIds.push(clientTransactionId)
    return {
      clientTransactionId,
      device: deviceContext(),
      receivedAt,
      clockSkewToleranceMinutes,
    }
  }

  async function createCustomer(limitMinor = 50_000): Promise<{ id: string; phone: string }> {
    const phone = `+23324${String(Date.now()).slice(-5)}${String(createdCustomerIds.length).padStart(2, '0')}`
    const rows = await db
      .insert(customer)
      .values({
        name: `Sale Customer ${createdCustomerIds.length}`,
        phone,
        createdBranchId: branchId,
      })
      .returning()
    const id = rows[0]?.id ?? ''
    createdCustomerIds.push(id)
    await db.insert(loyaltyAccount).values({ customerId: id })
    await db.insert(creditProfile).values({ customerId: id, branchId, limitMinor })
    return { id, phone }
  }

  function salePayload(input: {
    receiptNumber: string
    lines: Array<{
      productId: string
      quantity: number
      unitPriceMinor: number
      lineDiscountMinor?: number
      taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
    }>
    saleDiscountMinor?: number
    loyalty?: { redeemPoints: number; earnPreviewPoints: number; discountMinor: number }
    tender: { method: 'CASH' | 'CREDIT'; amountMinor?: number; override?: never } | null
    customer?: { id: string; phone: string; name: string }
    occurredAt?: string
    cashierOverrides?: Partial<{ bindingToken: string; bindingId: string; pinVersion: number }>
  }): SalePayload {
    const lines = input.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineDiscountMinor: line.lineDiscountMinor ?? 0,
      taxCategory: line.taxCategory ?? ('STANDARD' as const),
    }))
    const priced = priceCart(
      lines.map((line) => ({
        ...line,
        name: '',
        sku: '',
      })),
      {
        taxMode: 'INCLUSIVE',
        saleDiscountMinor: input.saleDiscountMinor ?? 0,
        loyaltyDiscountMinor: input.loyalty?.discountMinor ?? 0,
      },
    )
    const total = priced.totalMinor
    const tenderAmount =
      input.tender === null
        ? 0
        : input.tender.method === 'CREDIT'
          ? total
          : (input.tender.amountMinor ?? total)
    const change = tenderAmount > total ? tenderAmount - total : 0

    return {
      receiptNumber: input.receiptNumber,
      shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: input.cashierOverrides?.bindingId ?? cashierBindingId,
        bindingToken: input.cashierOverrides?.bindingToken ?? cashierToken,
        pinVersion: input.cashierOverrides?.pinVersion ?? 1,
      },
      customer: input.customer ?? null,
      lines,
      saleDiscount: input.saleDiscountMinor
        ? { amountMinor: input.saleDiscountMinor, reasonCode: 'PROMO', note: null }
        : null,
      loyalty: input.loyalty
        ? {
            redeemPoints: input.loyalty.redeemPoints,
            earnPreviewPoints: input.loyalty.earnPreviewPoints,
          }
        : null,
      tenders:
        input.tender === null
          ? []
          : [
              {
                method: input.tender.method,
                amountMinor: input.tender.method === 'CASH' ? tenderAmount : total,
              },
            ],
      totals: {
        subtotalMinor: priced.subtotalMinor,
        lineDiscountMinor: priced.lineDiscountMinor,
        saleDiscountMinor: priced.saleDiscountMinor,
        loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
        vatMinor: priced.vatMinor,
        nhilMinor: priced.nhilMinor,
        getfundMinor: priced.getfundMinor,
        taxTotalMinor: priced.taxTotalMinor,
        totalMinor: total,
        changeMinor: change,
      },
      occurredAt: input.occurredAt ?? new Date().toISOString(),
      appVersion: 'test',
    }
  }

  async function apply(
    ctx: ReturnType<typeof context>,
    payload: SalePayload,
  ): Promise<SaleApplyResult> {
    return db.transaction((tx) => applySale(ctx, payload, tx))
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `P${suffix}`, name: `POS Sale ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `P${suffix}-T01`, name: 'Sale Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `sale-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Sale Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    const uomRow = await db
      .insert(uom)
      .values({ code: `U${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `SA-${suffix}`,
          name: `Sale A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `SB-${suffix}`,
          name: `Sale B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 5_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `SC-${suffix}`,
          name: `Sale C ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 7_500,
          taxCategory: 'ZERO_RATED',
        },
      ])
      .returning()
    productA = products[0]?.id ?? ''
    productB = products[1]?.id ?? ''
    productC = products[2]?.id ?? ''
    createdProductIds.push(productA, productB, productC)

    await db.insert(productPrice).values({ productId: productB, branchId, priceMinor: 4_500 })
    await db.insert(stockLevel).values([
      { productId: productA, branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productB, branchId, quantityOnHand: 100, avgCostMinor: 3_000 },
      { productId: productC, branchId, quantityOnHand: 100, avgCostMinor: 4_000 },
    ])

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-S${suffix.slice(0, 3)}`
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
    managerStaffId = `GA-M${suffix.slice(0, 3)}`
    await db
      .update(userTable)
      .set({ staffId: managerStaffId, pinVersion: 1 })
      .where(eq(userTable.id, manager.id))
    const managerToken = randomToken(40)
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

    const shiftRow = await db
      .insert(shift)
      .values({
        number: `P${suffix}-S-20261023-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-23T08:00:00Z'),
        openingFloatMinor: 20_000,
        openedBy: cashierStaffId,
      })
      .returning()
    shiftId = shiftRow[0]?.id ?? ''
  })

  afterAll(async () => {
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    if (createdCustomerIds.length > 0) {
      await db
        .delete(loyaltyLotConsumption)
        .where(
          inArray(
            loyaltyLotConsumption.entryId,
            db
              .select({ id: loyaltyLedgerEntry.id })
              .from(loyaltyLedgerEntry)
              .where(inArray(loyaltyLedgerEntry.customerId, createdCustomerIds)),
          ),
        )
      await db
        .delete(loyaltyLot)
        .where(
          inArray(
            loyaltyLot.accountId,
            db
              .select({ id: loyaltyAccount.id })
              .from(loyaltyAccount)
              .where(inArray(loyaltyAccount.customerId, createdCustomerIds)),
          ),
        )
      await db
        .delete(loyaltyLedgerEntry)
        .where(inArray(loyaltyLedgerEntry.customerId, createdCustomerIds))
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
      await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
    await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    await db.delete(productPrice).where(eq(productPrice.branchId, branchId))
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(cashMovement).where(eq(cashMovement.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    if (deviceId) await db.delete(device).where(eq(device.id, deviceId))
    if (terminalId) await db.delete(terminal).where(eq(terminal.id, terminalId))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  it('applies a clean cash sale with one movement and no conflicts', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0001`,
      lines: [
        { productId: productA, quantity: 2, unitPriceMinor: 10_000 },
        { productId: productC, quantity: 1, unitPriceMinor: 7_500, taxCategory: 'ZERO_RATED' },
      ],
      tender: { method: 'CASH', amountMinor: 30_000 },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts).toEqual([])
    expect(result.resolvedCustomerId).toBeNull()

    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]).toMatchObject({
      receiptNumber: `${suffix}-R-0001`,
      totalMinor: payload.totals.totalMinor,
      changeMinor: payload.totals.changeMinor,
      tenderTotalMinor: 30_000,
      conflictCount: 0,
    })

    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, result.saleId))
    expect(lines).toHaveLength(2)

    const movements = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.referenceId, result.saleId))
    expect(movements).toHaveLength(2)
    expect(movements.every((movement) => movement.referenceType === 'SALE')).toBe(true)

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, result.saleId))
    expect(audits.some((row) => row.action === 'pos.sale.applied')).toBe(true)
  })

  it('applies a credit sale and moves the credit ledger', async () => {
    const customerRecord = await createCustomer(50_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0002`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CREDIT' },
      customer: { ...customerRecord, name: 'Credit Buyer' },
    })

    const result = await apply(ctx, payload)
    expect(result.resolvedCustomerId).toBe(customerRecord.id)
    expect(result.conflicts).toEqual([])

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, customerRecord.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'CHARGE', reasonCode: 'SALE' })
    expect(entries[0]?.amountMinor).toBe(payload.totals.totalMinor)

    const profiles = await db
      .select()
      .from(creditProfile)
      .where(eq(creditProfile.customerId, customerRecord.id))
    expect(profiles[0]?.balanceMinor).toBe(payload.totals.totalMinor)
  })

  it('aggregates duplicate product lines for stock but keeps both receipt lines', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0003`,
      lines: [
        { productId: productA, quantity: 1, unitPriceMinor: 10_000 },
        { productId: productA, quantity: 2, unitPriceMinor: 10_000 },
      ],
      tender: { method: 'CASH' },
    })

    const result = await apply(ctx, payload)
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, result.saleId))
    expect(lines).toHaveLength(2)
    const movements = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.referenceId, result.saleId))
    expect(movements).toHaveLength(1)
    expect(movements[0]?.quantityDelta).toBe(-3)
  })

  it('records STOCK_OVERSELL and still applies the sale', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0004`,
      lines: [
        { productId: productC, quantity: 10_000, unitPriceMinor: 7_500, taxCategory: 'ZERO_RATED' },
      ],
      tender: { method: 'CASH' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('STOCK_OVERSELL')
    const level = await db
      .select()
      .from(stockLevel)
      .where(and(eq(stockLevel.productId, productC), eq(stockLevel.branchId, branchId)))
    expect(level[0]?.quantityOnHand).toBeLessThan(0)
  })

  it('applies over-limit credit and records CREDIT_OVER_LIMIT', async () => {
    const customerRecord = await createCustomer(5_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0005`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CREDIT' },
      customer: { ...customerRecord, name: 'Over Limit' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('CREDIT_OVER_LIMIT')

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, customerRecord.id))
    expect(entries[0]?.amountMinor).toBe(payload.totals.totalMinor)
  })

  it('accepts a validated manager override without the over-limit conflict', async () => {
    const customerRecord = await createCustomer(0)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0006`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CREDIT' },
      customer: { ...customerRecord, name: 'Approved Credit' },
    })
    payload.tenders[0] = {
      ...payload.tenders[0]!,
      override: {
        staffId: managerStaffId,
        userId: managerUserId,
        bindingId: managerBindingId,
        pinVersion: 1,
        reasonCode: 'CUSTOMER_REQUEST',
        note: 'Regular customer',
        occurredAt: new Date().toISOString(),
      },
    }

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).not.toContain('CREDIT_OVER_LIMIT')

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, customerRecord.id))
    expect(entries[0]?.overrideReason).toBe('TEMPORARY_APPROVAL')
    expect(entries[0]?.overriddenBy).toBe(managerStaffId)

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, result.saleId))
    expect(audits.some((row) => row.action === 'pos.sale.override')).toBe(true)
  })

  it('records CREDIT_HOLD but still records the debt', async () => {
    const customerRecord = await createCustomer(100_000)
    await db
      .update(creditProfile)
      .set({ hold: true })
      .where(eq(creditProfile.customerId, customerRecord.id))
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0007`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CREDIT' },
      customer: { ...customerRecord, name: 'Held Account' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('CREDIT_HOLD')
    const profiles = await db
      .select()
      .from(creditProfile)
      .where(eq(creditProfile.customerId, customerRecord.id))
    expect(profiles[0]?.balanceMinor).toBe(payload.totals.totalMinor)
  })

  it('records LOYALTY_NEGATIVE when the offline redemption exceeds the balance', async () => {
    const customerRecord = await createCustomer(100_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0008`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      loyalty: { redeemPoints: 100, earnPreviewPoints: 0, discountMinor: 100 },
      tender: { method: 'CASH' },
      customer: { ...customerRecord, name: 'Loyalty Overspend' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('LOYALTY_NEGATIVE')
    const accounts = await db
      .select()
      .from(loyaltyAccount)
      .where(eq(loyaltyAccount.customerId, customerRecord.id))
    expect(accounts[0]?.balancePoints).toBeLessThan(0)
  })

  it('records PRICE_MISMATCH and keeps the charged price', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0009`,
      // B has a branch override of 4,500; charge 5,000.
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 5_000 }],
      tender: { method: 'CASH' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('PRICE_MISMATCH')
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, result.saleId))
    expect(lines[0]?.unitPriceMinor).toBe(5_000)
    expect(lines[0]?.expectedUnitPriceMinor).toBe(4_500)
  })

  it('stores an internally consistent but different total with TOTAL_MISMATCH', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0010`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CASH' },
    })
    payload.totals.subtotalMinor += 100
    payload.totals.totalMinor += 100
    payload.tenders[0]!.amountMinor = payload.totals.totalMinor

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('TOTAL_MISMATCH')
    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]?.totalMinor).toBe(payload.totals.totalMinor)
  })

  it('rejects an internally inconsistent total', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0011`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CASH' },
    })
    payload.totals.totalMinor += 500

    await expect(apply(ctx, payload)).rejects.toMatchObject({ code: 'INVALID_TOTALS' })
    const sales = await db.select().from(sale).where(eq(sale.id, ctx.clientTransactionId))
    expect(sales).toHaveLength(0)
  })

  it('rejects an unknown product without writing a sale', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0012`,
      lines: [{ productId: crypto.randomUUID(), quantity: 1, unitPriceMinor: 1_000 }],
      tender: { method: 'CASH' },
    })
    await expect(apply(ctx, payload)).rejects.toMatchObject({ code: 'UNKNOWN_PRODUCT' })
    const sales = await db.select().from(sale).where(eq(sale.id, ctx.clientTransactionId))
    expect(sales).toHaveLength(0)
  })

  it('flags a cashier line discount above the 0% cap and still applies the sale', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0021`,
      lines: [
        { productId: productA, quantity: 1, unitPriceMinor: 10_000, lineDiscountMinor: 1_000 },
      ],
      tender: { method: 'CASH' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('OVERRIDE_INVALID')

    const conflict = await db
      .select()
      .from(syncConflict)
      .where(and(eq(syncConflict.saleId, result.saleId), eq(syncConflict.type, 'OVERRIDE_INVALID')))
    // The cap counts line discounts, not just the sale-level discount.
    expect(conflict[0]?.details).toMatchObject({
      kind: 'DISCOUNT',
      percent: 10,
      capPercent: 0,
      totalDiscountMinor: 1_000,
      grossMinor: 10_000,
    })

    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]?.lineDiscountMinor).toBe(1_000)
  })

  it('accepts a manager approval attached to a line discount', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0022`,
      lines: [
        { productId: productA, quantity: 1, unitPriceMinor: 10_000, lineDiscountMinor: 1_000 },
      ],
      tender: { method: 'CASH' },
    })
    // The client carries the proof on the sale-discount object even when the
    // approval was for a line: it is the only override slot in the contract.
    payload.saleDiscount = {
      amountMinor: 0,
      reasonCode: 'OTHER',
      note: 'Line discount approved',
      override: {
        staffId: managerStaffId,
        userId: managerUserId,
        bindingId: managerBindingId,
        pinVersion: 1,
        reasonCode: 'STAFF',
        note: 'Approved line discount',
        occurredAt: new Date().toISOString(),
      },
    }

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).not.toContain('OVERRIDE_INVALID')

    const audits = await db.select().from(auditLog).where(eq(auditLog.entityId, result.saleId))
    expect(audits.some((row) => row.action === 'pos.sale.override')).toBe(true)
  })

  it('applies a sale discount above the cashier cap without approval and flags it', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0023`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      saleDiscountMinor: 2_000,
      tender: { method: 'CASH' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('OVERRIDE_INVALID')
  })

  it('applies a sale with a stale binding and records STALE_CREDENTIALS', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0013`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CASH' },
      cashierOverrides: { bindingToken: randomToken(40), bindingId: cashierBindingId },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('STALE_CREDENTIALS')
  })

  it('links a draft customer with an existing phone and records DUPLICATE_CUSTOMER', async () => {
    const existing = await createCustomer(50_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0014`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CASH' },
      customer: { id: crypto.randomUUID(), phone: existing.phone, name: 'Draft Twin' },
    })

    const result = await apply(ctx, payload)
    expect(result.resolvedCustomerId).toBe(existing.id)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('DUPLICATE_CUSTOMER')
  })

  it('reconciles a clean sale and reports a corrupted header', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0016`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CASH' },
    })
    const result = await apply(ctx, payload)

    const cleanSales = await reconcileSales(branchId)
    expect(cleanSales.filter((divergence) => divergence.saleId === result.saleId)).toHaveLength(0)
    const cleanShifts = await reconcileShifts(branchId)
    expect(cleanShifts).toHaveLength(0)

    // A credit-only sale has no cash leg; the tender invariant must still hold.
    const buyer = await createCustomer(50_000)
    const creditResult = await apply(
      context(),
      salePayload({
        receiptNumber: `${suffix}-R-0017`,
        lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
        tender: { method: 'CREDIT' },
        customer: { ...buyer, name: 'Credit Reconcile' },
      }),
    )
    const creditReconcile = await reconcileSales(branchId)
    expect(creditReconcile.filter((divergence) => divergence.saleId === creditResult.saleId)).toHaveLength(
      0,
    )

    // Another branch's SALE movement must not leak into this branch's report.
    const foreignBranch = (
      await db
        .insert(branch)
        .values({ code: `FB-${suffix.slice(0, 3)}`, name: `Foreign ${suffix}`, type: 'RETAIL', city: 'Accra' })
        .returning()
    )[0]?.id
    await db.insert(stockMovement).values({
      productId: productA,
      branchId: foreignBranch,
      type: 'SALE',
      quantityDelta: -1,
      unitCostMinor: 6_000,
      referenceType: 'SALE',
      referenceId: crypto.randomUUID(),
      referenceNumber: `FOREIGN-${suffix}`,
      createdBy: 'test',
    })
    const scopedSales = await reconcileSales(branchId)
    expect(
      scopedSales.some(
        (divergence) => divergence.details.movementReceiptNumber === `FOREIGN-${suffix}`,
      ),
    ).toBe(false)
    const foreignSales = await reconcileSales(foreignBranch)
    expect(foreignSales.some((divergence) => divergence.check === 'STOCK_MOVEMENTS')).toBe(true)
    await db.delete(stockMovement).where(eq(stockMovement.branchId, foreignBranch))
    await db.delete(branch).where(eq(branch.id, foreignBranch))

    // Test-only corruption: the header no longer equals the lines/tenders.
    await db
      .update(sale)
      .set({ totalMinor: payload.totals.totalMinor + 1 })
      .where(eq(sale.id, result.saleId))

    const corrupted = await reconcileSales(branchId)
    const forSale = corrupted.filter((divergence) => divergence.saleId === result.saleId)
    expect(forSale.some((divergence) => divergence.check === 'HEADER_TOTALS')).toBe(true)
    expect(forSale.some((divergence) => divergence.check === 'TENDER_TOTALS')).toBe(true)
  })

  it('exposes reconciliation to admins and pins managers to their branch', async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    const manager = await createTestUser({ role: 'MANAGER', branchId })
    try {
      const adminCookie = await signIn(admin.email)
      const adminResponse = await app.request(`/api/pos/reconciliation?branchId=${branchId}`, {
        headers: authedHeaders(adminCookie),
      })
      expect(adminResponse.status).toBe(200)
      const adminBody = (await adminResponse.json()) as { sales: unknown[]; shifts: unknown[] }
      expect(Array.isArray(adminBody.sales)).toBe(true)
      expect(Array.isArray(adminBody.shifts)).toBe(true)

      const managerCookie = await signIn(manager.email)
      const ownBranch = await app.request('/api/pos/reconciliation', {
        headers: authedHeaders(managerCookie),
      })
      expect(ownBranch.status).toBe(200)

      const otherBranch = await app.request(
        `/api/pos/reconciliation?branchId=${crypto.randomUUID()}`,
        { headers: authedHeaders(managerCookie) },
      )
      expect(otherBranch.status).toBe(403)
    } finally {
      await deleteTestUser(admin.id)
      await deleteTestUser(manager.id)
    }
  })

  it('records CLOCK_SKEW for an old device timestamp', async () => {
    const ctx = context(new Date(), 10)
    const payload = salePayload({
      receiptNumber: `${suffix}-R-0015`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tender: { method: 'CASH' },
      occurredAt: new Date(Date.now() - 3 * 60 * 60 * 1000).toISOString(),
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('CLOCK_SKEW')
  })
})
