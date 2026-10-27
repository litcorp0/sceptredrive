import { db } from '@sceptre/db'
import { priceCart, type TenderMethod, tenderBalance } from '@sceptre/shared'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
} from '../../../test/integration.ts'
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
import { resetMockProvider, settleMockPayment } from '../payments/payments.mock.provider.ts'
import { payment } from '../payments/payments.schema.ts'
import { createPayment, getPayment } from '../payments/payments.service.ts'
import { product } from '../products/products.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { uploadSchema } from '../sync/sync.validation.ts'
import { posStaffBinding, sale, saleLine, saleTender, shift, syncConflict } from './pos.schema.ts'
import { applySale } from './pos.service.ts'
import type { OverrideProof, SalePayload } from './pos.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.tender.test] database unavailable; integration tests skipped')

/**
 * The split-tender contract (P13-D1, D3, D5, D6).
 *
 * A sale is written once and only when the tenders cover it. These cases prove
 * the money identity for every combination the till can produce, and that an
 * impossible set is refused whole — before a single row is written — while
 * business conflicts (over-limit credit, oversell) still apply.
 */
describe.skipIf(!available)('POS sale tenders', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUomIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdSaleIds: string[] = []
  const createdPaymentIds: string[] = []

  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let otherTerminalId = ''
  let otherDeviceId = ''
  let otherShiftId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let managerUserId = ''
  let managerStaffId = ''
  let managerBindingId = ''
  let productA = ''
  let productB = ''
  let productC = ''

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })
  const otherDevice = (): DeviceAuthContext => ({
    deviceId: otherDeviceId,
    terminalId: otherTerminalId,
    branchId,
  })

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
    const phone = `+23320${String(Date.now()).slice(-5)}${String(createdCustomerIds.length).padStart(2, '0')}`
    const rows = await db
      .insert(customer)
      .values({
        name: `Tender Customer ${createdCustomerIds.length}`,
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

  interface TenderSpec {
    method: TenderMethod
    amountMinor: number
    paymentId?: string
    override?: OverrideProof
  }

  interface SaleSpec {
    receiptNumber: string
    lines: Array<{
      productId: string
      quantity: number
      unitPriceMinor: number
      lineDiscountMinor?: number
      taxCategory?: 'STANDARD' | 'ZERO_RATED' | 'EXEMPT'
    }>
    tenders: TenderSpec[]
    /** Defaults to the shared arithmetic's change; override only to break it. */
    changeMinor?: number
    customer?: { id: string; phone: string; name: string }
    occurredAt?: string
  }

  function salePayload(spec: SaleSpec): SalePayload {
    const lines = spec.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineDiscountMinor: line.lineDiscountMinor ?? 0,
      taxCategory: line.taxCategory ?? ('STANDARD' as const),
    }))
    const priced = priceCart(
      lines.map((line) => ({ ...line, name: '', sku: '' })),
      { taxMode: 'INCLUSIVE', saleDiscountMinor: 0, loyaltyDiscountMinor: 0 },
    )
    const computed = tenderBalance(
      priced.totalMinor,
      spec.tenders.map((tender, index) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        sequence: index + 1,
      })),
    )

    return {
      receiptNumber: spec.receiptNumber,
      shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      customer: spec.customer ?? null,
      lines,
      saleDiscount: null,
      loyalty: null,
      tenders: spec.tenders.map((tender) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        paymentId: tender.paymentId ?? null,
        override: tender.override ?? null,
      })),
      totals: {
        subtotalMinor: priced.subtotalMinor,
        lineDiscountMinor: priced.lineDiscountMinor,
        saleDiscountMinor: priced.saleDiscountMinor,
        loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
        vatMinor: priced.vatMinor,
        nhilMinor: priced.nhilMinor,
        getfundMinor: priced.getfundMinor,
        taxTotalMinor: priced.taxTotalMinor,
        totalMinor: priced.totalMinor,
        changeMinor: spec.changeMinor ?? computed.changeMinor,
      },
      occurredAt: spec.occurredAt ?? new Date().toISOString(),
      appVersion: 'test',
    }
  }

  async function apply(ctx: ReturnType<typeof context>, payload: SalePayload) {
    return db.transaction((tx) => applySale(ctx, payload, tx))
  }

  /**
   * A refused sale is executed without a transaction on purpose: if any check
   * ran after a write, the row would stay behind and the assertion would see it.
   */
  async function applyExpectingRejection(
    ctx: ReturnType<typeof context>,
    payload: SalePayload,
  ): Promise<Error> {
    try {
      await applySale(ctx, payload)
    } catch (error) {
      return error as Error
    }
    throw new Error('the sale was applied but should have been refused')
  }

  async function paymentFor(
    amountMinor: number,
    method: 'MOMO' | 'CARD' = 'MOMO',
    fixture: DeviceAuthContext = deviceContext(),
    shiftForPayment: string = shiftId,
  ): Promise<{ id: string; providerReference: string }> {
    const created = await createPayment(fixture, {
      method,
      amountMinor,
      clientPaymentId: crypto.randomUUID(),
      shiftId: shiftForPayment,
      ...(method === 'MOMO'
        ? { mobileMoney: { provider: 'mtn' as const, phone: '+233551234987' } }
        : {}),
    })
    createdPaymentIds.push(created.id)
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)
    const settled = await getPayment(fixture, created.id, { refresh: true })
    expect(settled.status).toBe('PAID')
    return { id: settled.id, providerReference: settled.providerReference }
  }

  async function pendingPayment(amountMinor: number): Promise<string> {
    const created = await createPayment(deviceContext(), {
      method: 'MOMO',
      amountMinor,
      clientPaymentId: crypto.randomUUID(),
      shiftId,
      mobileMoney: { provider: 'mtn', phone: '+233551234987' },
    })
    createdPaymentIds.push(created.id)
    return created.id
  }

  async function expectNothingWritten(saleId: string): Promise<void> {
    const counts = await Promise.all([
      db.select().from(sale).where(eq(sale.id, saleId)),
      db.select().from(saleLine).where(eq(saleLine.saleId, saleId)),
      db.select().from(saleTender).where(eq(saleTender.saleId, saleId)),
      db.select().from(stockMovement).where(eq(stockMovement.referenceId, saleId)),
      db.select().from(creditLedgerEntry).where(eq(creditLedgerEntry.referenceId, saleId)),
      db.select().from(syncConflict).where(eq(syncConflict.saleId, saleId)),
    ])
    expect(counts.map((rows) => rows.length)).toEqual([0, 0, 0, 0, 0, 0])
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `T${suffix}`, name: `Tender ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `T${suffix}-T01`, name: 'Tender Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `tender-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''

    const otherTerminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `T${suffix}-T02`, name: 'Other Tender Counter' })
      .returning()
    otherTerminalId = otherTerminalRow[0]?.id ?? ''

    const otherDeviceRow = await db
      .insert(device)
      .values({
        terminalId: otherTerminalId,
        fingerprint: `tender-other-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    otherDeviceId = otherDeviceRow[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Tender Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const uomRow = await db
      .insert(uom)
      .values({ code: `TU${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const products = await db
      .insert(product)
      .values([
        {
          sku: `TA-${suffix}`,
          name: `Tender A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `TB-${suffix}`,
          name: `Tender B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 9_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `TC-${suffix}`,
          name: `Tender C ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 5_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productA = products[0]?.id ?? ''
    productB = products[1]?.id ?? ''
    productC = products[2]?.id ?? ''
    createdProductIds.push(productA, productB, productC)

    await db.insert(stockLevel).values([
      { productId: productA, branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productB, branchId, quantityOnHand: 100, avgCostMinor: 5_000 },
      { productId: productC, branchId, quantityOnHand: 100, avgCostMinor: 3_000 },
    ])

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-T${suffix.slice(0, 3)}`
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
    managerStaffId = `GA-TM${suffix.slice(0, 3)}`
    await db
      .update(userTable)
      .set({ staffId: managerStaffId, pinVersion: 1 })
      .where(eq(userTable.id, manager.id))
    const managerBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: managerUserId,
        staffStaffId: managerStaffId,
        role: 'MANAGER',
        branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(randomToken(40)),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    managerBindingId = managerBinding[0]?.id ?? ''

    const shiftRow = await db
      .insert(shift)
      .values({
        number: `T${suffix}-S-20261027-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor: 20_000,
        openedBy: cashierStaffId,
      })
      .returning()
    shiftId = shiftRow[0]?.id ?? ''

    const otherShiftRow = await db
      .insert(shift)
      .values({
        number: `T${suffix}-S-20261027-02`,
        branchId,
        terminalId: otherTerminalId,
        deviceId: otherDeviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor: 0,
        openedBy: cashierStaffId,
      })
      .returning()
    otherShiftId = otherShiftRow[0]?.id ?? ''
  })

  beforeEach(() => {
    resetMockProvider()
  })

  afterAll(async () => {
    if (createdSaleIds.length > 0) {
      // Conflicts first (their `sale_id` is `set null` on delete), then the
      // tenders, which reference the payments deleted further down.
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
    // Any conflict this suite raised without a sale (none expected) would still
    // hold the device and branch rows hostage.
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    if (otherDeviceId) {
      await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, otherDeviceId))
    }
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
    if (deviceId) await db.delete(device).where(eq(device.id, deviceId))
    if (otherDeviceId) await db.delete(device).where(eq(device.id, otherDeviceId))
    if (terminalId) await db.delete(terminal).where(eq(terminal.id, terminalId))
    if (otherTerminalId) await db.delete(terminal).where(eq(terminal.id, otherTerminalId))
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdUomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, createdUomIds))
    }
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  it('gives change out of the cash tender and nothing else', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1001`,
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 9_000 }],
      tenders: [{ method: 'CASH', amountMinor: 10_000 }],
    })
    expect(payload.totals.totalMinor).toBe(9_000)

    const result = await apply(ctx, payload)
    expect(result.conflicts).toEqual([])

    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]).toMatchObject({
      totalMinor: 9_000,
      tenderTotalMinor: 10_000,
      changeMinor: 1_000,
      creditAmountMinor: 0,
    })

    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, result.saleId))
    expect(tenders).toHaveLength(1)
    expect(tenders[0]).toMatchObject({
      sequence: 1,
      method: 'CASH',
      amountMinor: 10_000,
      paymentId: null,
      reference: null,
    })
  })

  it('stores cash and a settled MoMo payment as two ordered tenders', async () => {
    const momo = await paymentFor(6_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1002`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 4_000 },
        { method: 'MOMO', amountMinor: 6_000, paymentId: momo.id },
      ],
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts).toEqual([])

    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]).toMatchObject({
      creditAmountMinor: 0,
      changeMinor: 0,
      tenderTotalMinor: 10_000,
    })

    const tenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, result.saleId))
      .orderBy(saleTender.sequence)
    expect(tenders.map((row) => row.sequence)).toEqual([1, 2])
    expect(tenders[0]).toMatchObject({ method: 'CASH', amountMinor: 4_000, paymentId: null })
    expect(tenders[1]).toMatchObject({
      method: 'MOMO',
      amountMinor: 6_000,
      paymentId: momo.id,
      // The reference is the server's copy of the provider reference, never the body's.
      reference: momo.providerReference,
    })
  })

  it('keeps a three-tender sale as one sale and charges only the credit portion', async () => {
    const buyer = await createCustomer(50_000)
    const card = await paymentFor(4_000, 'CARD')
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1003`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 3_000 },
        { method: 'CREDIT', amountMinor: 3_000 },
        { method: 'CARD', amountMinor: 4_000, paymentId: card.id },
      ],
      customer: { ...buyer, name: 'Split Credit' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts).toEqual([])

    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]).toMatchObject({
      totalMinor: 10_000,
      changeMinor: 0,
      tenderTotalMinor: 10_000,
      creditAmountMinor: 3_000,
    })

    const tenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, result.saleId))
      .orderBy(saleTender.sequence)
    expect(tenders).toHaveLength(3)
    expect(tenders.map((row) => row.method)).toEqual(['CASH', 'CREDIT', 'CARD'])

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, buyer.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({ kind: 'CHARGE', referenceId: result.saleId })
    expect(entries[0]?.amountMinor).toBe(3_000)

    // Plan §7: the identity, not the shape. Σ tenders − change − total = 0.
    const identity = await db.execute<{ drift: number; tenders: number }>(sql`
      select (coalesce(sum(st.amount_minor), 0))::int - s.change_minor - s.total_minor as drift,
             count(*)::int as tenders
      from sale_tender st
      join sale s on s.id = st.sale_id
      where s.id = ${result.saleId}
      group by s.total_minor, s.change_minor
    `)
    expect(identity.rows[0]?.drift).toBe(0)
    expect(identity.rows[0]?.tenders).toBe(3)
  })

  it('stores two tenders of the same electronic method', async () => {
    const first = await paymentFor(2_500)
    const second = await paymentFor(2_500)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1004`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'MOMO', amountMinor: 2_500, paymentId: first.id },
        { method: 'MOMO', amountMinor: 2_500, paymentId: second.id },
        { method: 'CASH', amountMinor: 5_000 },
      ],
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts).toEqual([])

    const tenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, result.saleId))
      .orderBy(saleTender.sequence)
    expect(tenders).toHaveLength(3)
    expect(tenders.filter((row) => row.method === 'MOMO')).toHaveLength(2)
    expect(tenders.map((row) => row.paymentId)).toEqual([first.id, second.id, null])
  })

  it('refuses a declared change that does not reconcile and writes nothing', async () => {
    const lying = salePayload({
      receiptNumber: `${suffix}-R-1005`,
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 9_000 }],
      tenders: [{ method: 'CASH', amountMinor: 10_000 }],
      changeMinor: 500,
    })
    const ctx = context()
    const error = await applyExpectingRejection(ctx, lying)
    expect(error).toMatchObject({ code: 'INVALID_TENDER' })
    await expectNothingWritten(ctx.clientTransactionId)

    const noChange = salePayload({
      receiptNumber: `${suffix}-R-1006`,
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 9_000 }],
      tenders: [{ method: 'CASH', amountMinor: 10_000 }],
      changeMinor: 0,
    })
    const secondCtx = context()
    const second = await applyExpectingRejection(secondCtx, noChange)
    expect(second).toMatchObject({ code: 'INVALID_TENDER' })
    await expectNothingWritten(secondCtx.clientTransactionId)
  })

  it('refuses change larger than the cash tender', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1007`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 10_000 },
        { method: 'MOMO', amountMinor: 20_000, paymentId: crypto.randomUUID() },
      ],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      details: { problem: 'OVERPAID_BY_ELECTRONIC' },
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses credit above the sale total', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1008`,
      lines: [{ productId: productC, quantity: 1, unitPriceMinor: 5_000 }],
      tenders: [{ method: 'CREDIT', amountMinor: 6_000 }],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      details: { problem: 'CREDIT_EXCEEDS_TOTAL' },
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses two credit tenders', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1009`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CREDIT', amountMinor: 5_000 },
        { method: 'CREDIT', amountMinor: 5_000 },
      ],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      details: { problem: 'MULTIPLE_CREDIT_TENDERS' },
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses a credit tender without a customer', async () => {
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1010`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 7_000 },
        { method: 'CREDIT', amountMinor: 3_000 },
      ],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({ code: 'CREDIT_REQUIRES_CUSTOMER' })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses six tenders at the wire before the service sees them', () => {
    const tenders: TenderSpec[] = Array.from({ length: 6 }, () => ({
      method: 'CASH' as const,
      amountMinor: 1_000,
    }))
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1011`,
      lines: [{ productId: productC, quantity: 1, unitPriceMinor: 5_000 }],
      tenders,
    })
    const body = {
      batchId: crypto.randomUUID(),
      deviceId,
      terminalId,
      transactions: [
        {
          clientTransactionId: crypto.randomUUID(),
          occurredAt: new Date().toISOString(),
          payloadVersion: 1,
          type: 'SALE',
          payload,
        },
      ],
    }

    expect(uploadSchema.safeParse(body).success).toBe(false)

    // Five is the limit, not four: the same body with one tender removed parses.
    const five = {
      ...body,
      transactions: [
        { ...body.transactions[0], payload: { ...payload, tenders: payload.tenders.slice(0, 5) } },
      ],
    }
    expect(uploadSchema.safeParse(five).success).toBe(true)

    // The payment link is required for an electronic tender and forbidden on a
    // cash or credit one: the shape cannot be ambiguous on the wire.
    const fiveTenders = payload.tenders.slice(0, 5)
    const firstTender = fiveTenders[0]
    if (!firstTender) throw new Error('the payload lost its first tender')
    const cashWithPayment = {
      ...body,
      transactions: [
        {
          ...body.transactions[0],
          payload: {
            ...payload,
            tenders: [{ ...firstTender, paymentId: crypto.randomUUID() }, ...fiveTenders.slice(1)],
          },
        },
      ],
    }
    expect(uploadSchema.safeParse(cashWithPayment).success).toBe(false)

    const momoWithoutPayment = {
      ...body,
      transactions: [
        {
          ...body.transactions[0],
          payload: {
            ...payload,
            tenders: [{ ...firstTender, method: 'MOMO' }, ...fiveTenders.slice(1)],
          },
        },
      ],
    }
    expect(uploadSchema.safeParse(momoWithoutPayment).success).toBe(false)
  })

  it('refuses an electronic tender whose payment has not settled', async () => {
    const pending = await pendingPayment(10_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1012`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'MOMO', amountMinor: 10_000, paymentId: pending }],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      message: 'This payment has not settled yet',
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses a payment another terminal created', async () => {
    const foreign = await paymentFor(10_000, 'MOMO', otherDevice(), otherShiftId)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1013`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'MOMO', amountMinor: 10_000, paymentId: foreign.id }],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      message: 'This payment belongs to another terminal',
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses a payment taken by a different channel than the tender', async () => {
    const momo = await paymentFor(10_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1021`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'CARD', amountMinor: 10_000, paymentId: momo.id }],
    })

    // The money identity would hold with the methods swapped, but the receipt
    // line and the provider reconciliation would both name the wrong channel.
    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      message: 'The payment was taken by MOMO, not CARD',
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses the same payment cited twice in one sale', async () => {
    const paymentId = await paymentFor(5_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1014`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'MOMO', amountMinor: 5_000, paymentId: paymentId.id },
        { method: 'MOMO', amountMinor: 5_000, paymentId: paymentId.id },
      ],
    })

    const error = await applyExpectingRejection(ctx, payload)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      message: 'The same payment cannot settle two tenders',
    })
    await expectNothingWritten(ctx.clientTransactionId)
  })

  it('refuses a payment a second sale already spent', async () => {
    const paymentId = await paymentFor(10_000)
    const first = await apply(
      context(),
      salePayload({
        receiptNumber: `${suffix}-R-1015`,
        lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
        tenders: [{ method: 'MOMO', amountMinor: 10_000, paymentId: paymentId.id }],
      }),
    )

    const ctx = context()
    const reuse = salePayload({
      receiptNumber: `${suffix}-R-1016`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'MOMO', amountMinor: 10_000, paymentId: paymentId.id }],
    })
    const error = await applyExpectingRejection(ctx, reuse)
    expect(error).toMatchObject({
      code: 'INVALID_TENDER',
      message: 'This payment has already been used on another sale',
    })
    await expectNothingWritten(ctx.clientTransactionId)

    // The first sale keeps its tender: the refusal did not disturb it.
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, first.saleId))
    expect(tenders).toHaveLength(1)
  })

  it('refuses a tender on a sale with nothing to pay, and applies a free sale', async () => {
    const ctx = context()
    const withTender = salePayload({
      receiptNumber: `${suffix}-R-1017`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 0 }],
      tenders: [{ method: 'CASH', amountMinor: 1_000 }],
    })
    const error = await applyExpectingRejection(ctx, withTender)
    expect(error).toMatchObject({ code: 'INVALID_TENDER' })
    await expectNothingWritten(ctx.clientTransactionId)

    const freeCtx = context()
    const free = await apply(
      freeCtx,
      salePayload({
        receiptNumber: `${suffix}-R-1018`,
        lines: [{ productId: productA, quantity: 1, unitPriceMinor: 0 }],
        tenders: [],
      }),
    )
    const sales = await db.select().from(sale).where(eq(sale.id, free.saleId))
    expect(sales[0]).toMatchObject({
      totalMinor: 0,
      changeMinor: 0,
      tenderTotalMinor: 0,
      creditAmountMinor: 0,
    })
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, free.saleId))
    expect(tenders).toHaveLength(0)
  })

  it('applies an over-limit split credit and records CREDIT_OVER_LIMIT', async () => {
    const buyer = await createCustomer(1_000)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1019`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 5_000 },
        { method: 'CREDIT', amountMinor: 5_000 },
      ],
      customer: { ...buyer, name: 'Split Over Limit' },
    })

    // The money was already taken at the till: the sale applies and the policy
    // breach becomes a conflict for a manager (P13-D4).
    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).toContain('CREDIT_OVER_LIMIT')

    const sales = await db.select().from(sale).where(eq(sale.id, result.saleId))
    expect(sales[0]?.creditAmountMinor).toBe(5_000)

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, buyer.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]?.amountMinor).toBe(5_000)
  })

  it('authorises the split credit portion once with the manager proof', async () => {
    const buyer = await createCustomer(0)
    const ctx = context()
    const payload = salePayload({
      receiptNumber: `${suffix}-R-1020`,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 7_000 },
        {
          method: 'CREDIT',
          amountMinor: 3_000,
          override: {
            staffId: managerStaffId,
            userId: managerUserId,
            bindingId: managerBindingId,
            pinVersion: 1,
            reasonCode: 'CUSTOMER_REQUEST',
            note: 'Regular customer',
            occurredAt: new Date().toISOString(),
          },
        },
      ],
      customer: { ...buyer, name: 'Split Approved' },
    })

    const result = await apply(ctx, payload)
    expect(result.conflicts.map((conflict) => conflict.type)).not.toContain('CREDIT_OVER_LIMIT')

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.customerId, buyer.id))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      amountMinor: 3_000,
      overrideReason: 'TEMPORARY_APPROVAL',
      overriddenBy: managerStaffId,
    })
  })
})
