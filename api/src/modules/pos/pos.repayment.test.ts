import { db } from '@sceptre/db'
import { priceCart, tenderBalance } from '@sceptre/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
import {
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import type { SessionUser } from '../../http/factory.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { creditLedgerEntry, creditProfile } from '../credit/credit.schema.ts'
import { createRepayment } from '../credit/credit.service.ts'
import { customer } from '../customers/customers.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import { loyaltyAccount, loyaltyLedgerEntry, loyaltyLot } from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { resetMockProvider, settleMockPayment } from '../payments/payments.mock.provider.ts'
import { payment } from '../payments/payments.schema.ts'
import { createPayment, getPayment } from '../payments/payments.service.ts'
import type { AuditActor } from '../platform/audit.types.ts'
import { product } from '../products/products.schema.ts'
import { signDeviceJwt } from '../sync/sync.jwt.ts'
import { applyUpload } from '../sync/sync.service.ts'
import type {
  CreditRepaymentPayload,
  DeviceAuthContext,
  PosUploadBody,
} from '../sync/sync.types.ts'
import {
  cashMovement,
  posStaffBinding,
  posSyncTransaction,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from './pos.schema.ts'
import { applyRepayment, applySale } from './pos.service.ts'
import type { OverrideProof, SalePayload } from './pos.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.repayment.test] database unavailable; integration tests skipped')

/**
 * A repayment at the till (P13-D27).
 *
 * Cash reduces a debt offline with no PIN; MoMo only exists when the server has
 * already settled exactly that money; a held account needs a manager. The ledger
 * keeps the till's own receipt number, and one fact can only be posted once.
 */
describe.skipIf(!available)('POS credit repayment', () => {
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
  let productId = ''
  let customerId = ''
  let customerPhone = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let managerUserId = ''
  let managerStaffId = ''
  let managerBindingId = ''
  let managerToken = ''
  let consoleUser: SessionUser
  let deviceToken = ''
  let receiptSequence = 0
  let numberSequence = 0

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })

  function context() {
    return {
      clientTransactionId: crypto.randomUUID(),
      device: deviceContext(),
      receivedAt: new Date(),
      clockSkewToleranceMinutes: 10,
    }
  }

  function managerProof(overrides: Partial<OverrideProof> = {}): OverrideProof {
    return {
      staffId: managerStaffId,
      userId: managerUserId,
      bindingId: managerBindingId,
      pinVersion: 1,
      reasonCode: 'CUSTOMER_REQUEST',
      note: null,
      occurredAt: new Date().toISOString(),
      ...overrides,
    }
  }

  function repaymentPayload(
    overrides: Partial<CreditRepaymentPayload> = {},
  ): CreditRepaymentPayload {
    numberSequence += 1
    return {
      customerId,
      shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      amountMinor: 5_000,
      method: 'CASH',
      paymentId: null,
      number: `RP-${suffix}-${numberSequence}`,
      note: null,
      override: null,
      occurredAt: new Date().toISOString(),
      ...overrides,
    }
  }

  async function applyNow(payload: CreditRepaymentPayload) {
    const ctx = context()
    const result = await db.transaction((tx) => applyRepayment(ctx, payload, tx))
    return { ...result, clientTransactionId: ctx.clientTransactionId }
  }

  /** A refusal runs without a transaction, so a stray write would be visible. */
  async function expectRefusal(payload: CreditRepaymentPayload, code: string): Promise<void> {
    await expect(applyRepayment(context(), payload)).rejects.toMatchObject({ code })
  }

  /** One 200.00 credit sale: the debt every repayment below pays down. */
  async function creditSale(amountMinor = 20_000): Promise<string> {
    receiptSequence += 1
    const priced = priceCart(
      [
        {
          productId,
          quantity: 1,
          unitPriceMinor: amountMinor,
          lineDiscountMinor: 0,
          taxCategory: 'STANDARD' as const,
          name: '',
          sku: '',
        },
      ],
      { taxMode: 'INCLUSIVE', saleDiscountMinor: 0, loyaltyDiscountMinor: 0 },
    )
    const balance = tenderBalance(priced.totalMinor, [
      { method: 'CREDIT', amountMinor: amountMinor, sequence: 1 },
    ])
    expect(balance.problem).toBeNull()

    const ctx = context()
    createdSaleIds.push(ctx.clientTransactionId)
    const payload: SalePayload = {
      receiptNumber: `RP${suffix}-${receiptSequence}`,
      shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      customer: { id: customerId, phone: customerPhone, name: 'Repayment Customer' },
      lines: [
        {
          productId,
          quantity: 1,
          unitPriceMinor: amountMinor,
          lineDiscountMinor: 0,
          taxCategory: 'STANDARD',
        },
      ],
      saleDiscount: null,
      loyalty: null,
      tenders: [{ method: 'CREDIT', amountMinor, paymentId: null, override: null }],
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
        changeMinor: balance.changeMinor,
      },
      occurredAt: new Date().toISOString(),
      appVersion: 'test',
    }

    await db.transaction((tx) => applySale(ctx, payload, tx))
    return ctx.clientTransactionId
  }

  async function profileBalance(): Promise<number> {
    const rows = await db
      .select({ balanceMinor: creditProfile.balanceMinor })
      .from(creditProfile)
      .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    return rows[0]?.balanceMinor ?? 0
  }

  async function repaymentEntries() {
    return db
      .select()
      .from(creditLedgerEntry)
      .where(
        and(eq(creditLedgerEntry.customerId, customerId), eq(creditLedgerEntry.kind, 'REPAYMENT')),
      )
  }

  /** A MoMo payment the mock provider has settled, exactly as a till would. */
  async function moMoPayment(amountMinor: number): Promise<string> {
    const created = await createPayment(deviceContext(), {
      method: 'MOMO',
      amountMinor,
      clientPaymentId: crypto.randomUUID(),
      shiftId,
      mobileMoney: { provider: 'mtn', phone: '024 123 4567' },
    })
    createdPaymentIds.push(created.id)
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)
    const settled = await getPayment(deviceContext(), created.id, { refresh: true })
    expect(settled.status).toBe('PAID')
    return settled.id
  }

  function uploadRequest(transactions: unknown[]) {
    return app.request('/api/pos/sync/upload', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${deviceToken}` },
      body: JSON.stringify({
        batchId: crypto.randomUUID(),
        deviceId,
        terminalId,
        transactions,
      }),
    })
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `P${suffix}`, name: `Repay ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `P${suffix}-T01`, name: 'Repay Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `repay-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''
    deviceToken = await signDeviceJwt({ deviceId, terminalId, branchId })

    const categoryRow = await db
      .insert(category)
      .values({ name: `Repay Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const uomRow = await db
      .insert(uom)
      .values({ code: `PU${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const productRow = await db
      .insert(product)
      .values({
        sku: `RP-${suffix}`,
        name: `Repay Product ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 20_000,
        taxCategory: 'STANDARD',
      })
      .returning()
    productId = productRow[0]?.id ?? ''
    createdProductIds.push(productId)
    await db
      .insert(stockLevel)
      .values({ productId, branchId, quantityOnHand: 100, avgCostMinor: 12_000 })

    customerPhone = `+23320${String(Date.now()).slice(-7)}`
    const customerRow = await db
      .insert(customer)
      .values({ name: 'Repayment Customer', phone: customerPhone, createdBranchId: branchId })
      .returning()
    customerId = customerRow[0]?.id ?? ''
    createdCustomerIds.push(customerId)
    await db.insert(creditProfile).values({ customerId, branchId, limitMinor: 100_000 })

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-RP${suffix.slice(0, 2)}`
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
    managerStaffId = `GA-RPM${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: managerStaffId, pinVersion: 1 })
      .where(eq(userTable.id, manager.id))
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

    consoleUser = {
      id: managerUserId,
      email: manager.email,
      name: 'Test User',
      emailVerified: false,
      createdAt: new Date(),
      updatedAt: new Date(),
      role: 'MANAGER',
      branchId,
      staffId: managerStaffId,
      phone: null,
      isActive: true,
      mustChangePassword: false,
      image: null,
    } as SessionUser

    const shiftRow = await db
      .insert(shift)
      .values({
        number: `RP-${suffix}-S-20261027-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor: 50_000,
        openedBy: cashierStaffId,
      })
      .returning()
    shiftId = shiftRow[0]?.id ?? ''

    // The debt every test pays down: one 200.00 credit sale.
    await creditSale(20_000)
    expect(await profileBalance()).toBe(20_000)
  })

  beforeEach(() => {
    resetMockProvider()
  })

  afterAll(async () => {
    if (!available) return
    await db.delete(posSyncTransaction).where(eq(posSyncTransaction.deviceId, deviceId))
    if (createdCustomerIds.length > 0) {
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
    }
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    await db.delete(cashMovement).where(eq(cashMovement.branchId, branchId))
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    if (createdCustomerIds.length > 0) {
      // The credit charge and the sale's loyalty post both reach these tables.
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
      await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
    await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
    if (deviceId) await db.delete(device).where(eq(device.id, deviceId))
    if (terminalId) await db.delete(terminal).where(eq(terminal.id, terminalId))
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdUomIds.length > 0) await db.delete(uom).where(inArray(uom.id, createdUomIds))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (branchId) await db.delete(branch).where(eq(branch.id, branchId))
  })

  it('posts one negative REPAYMENT entry and keeps the till number', async () => {
    const before = await profileBalance()
    const payload = repaymentPayload({ amountMinor: 5_000 })
    const result = await applyNow(payload)

    const entries = await repaymentEntries()
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      amountMinor: -5_000,
      method: 'CASH',
      referenceType: 'POS_REPAYMENT',
      referenceNumber: payload.number,
      idempotencyKey: `${result.clientTransactionId}:repayment`,
    })
    expect(entries[0]?.referenceId).toBe(result.clientTransactionId)
    expect(result.entryId).toBe(entries[0]?.id)
    expect(result.balanceAfterMinor).toBe(before - 5_000)
    expect(await profileBalance()).toBe(before - 5_000)
  })

  it('still allocates a number when the console sends none', async () => {
    await applyNow(repaymentPayload({ amountMinor: 1_000 }))

    const posted = await createRepayment(
      {
        actorId: managerUserId,
        actorStaffId: managerStaffId,
        ip: null,
        userAgent: null,
        requestId: null,
      } as AuditActor,
      consoleUser,
      {
        customerId,
        branchId,
        amountMinor: -2_000,
        method: 'CASH',
        note: 'Counter repayment',
      },
    )

    // The console never prints offline, so the server still mints the number.
    expect(posted.entry.referenceNumber).toMatch(/^REP-\d{5,}$/)
    expect(posted.entry.amountMinor).toBe(-2_000)
  })

  it('is idempotent through the upload ledger: one entry, the replay says REPLAYED', async () => {
    const clientTransactionId = crypto.randomUUID()
    const body: PosUploadBody = {
      batchId: crypto.randomUUID(),
      deviceId,
      terminalId,
      transactions: [
        {
          clientTransactionId,
          type: 'CREDIT_REPAYMENT',
          occurredAt: new Date().toISOString(),
          payloadVersion: 1,
          payload: repaymentPayload({ amountMinor: 3_000 }),
        },
      ],
    }

    const first = await applyUpload(deviceContext(), body)
    expect(first.results[0]).toMatchObject({ status: 'APPLIED', serverId: clientTransactionId })

    const second = await applyUpload(deviceContext(), body)
    expect(second.results[0]?.status).toBe('REPLAYED')

    const rows = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.idempotencyKey, `${clientTransactionId}:repayment`))
    expect(rows).toHaveLength(1)
  })

  it('accepts MoMo only when the server settled exactly this repayment', async () => {
    const paymentId = await moMoPayment(7_500)
    const result = await applyNow(
      repaymentPayload({ amountMinor: 7_500, method: 'MOMO', paymentId }),
    )

    const entries = await repaymentEntries()
    const posted = entries.find((entry) => entry.id === result.entryId)
    expect(posted).toMatchObject({ method: 'MOMO', amountMinor: -7_500, referenceId: paymentId })
  })

  it('refuses a payment that has not settled, and writes nothing', async () => {
    const created = await createPayment(deviceContext(), {
      method: 'MOMO',
      amountMinor: 4_000,
      clientPaymentId: crypto.randomUUID(),
      shiftId,
      mobileMoney: { provider: 'mtn', phone: '024 123 4567' },
    })
    createdPaymentIds.push(created.id)
    const countBefore = (await repaymentEntries()).length

    await expectRefusal(
      repaymentPayload({ amountMinor: 4_000, method: 'MOMO', paymentId: created.id }),
      'INVALID_TENDER',
    )
    expect(await repaymentEntries()).toHaveLength(countBefore)
  })

  it('refuses a payment another repayment already used', async () => {
    const paymentId = await moMoPayment(6_000)
    await applyNow(repaymentPayload({ amountMinor: 6_000, method: 'MOMO', paymentId }))

    await expectRefusal(
      repaymentPayload({ amountMinor: 6_000, method: 'MOMO', paymentId }),
      'INVALID_TENDER',
    )
    const used = (await repaymentEntries()).filter((entry) => entry.referenceId === paymentId)
    expect(used).toHaveLength(1)
  })

  it('requires a manager to take money against a held account', async () => {
    await db
      .update(creditProfile)
      .set({ hold: true })
      .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))

    try {
      const balanceBefore = await profileBalance()
      await expectRefusal(repaymentPayload({ amountMinor: 2_500 }), 'REPAYMENT_ON_HOLD')
      expect(await profileBalance()).toBe(balanceBefore)

      const applied = await applyNow(
        repaymentPayload({ amountMinor: 2_500, override: managerProof() }),
      )
      expect(applied.balanceAfterMinor).toBe(balanceBefore - 2_500)
    } finally {
      await db
        .update(creditProfile)
        .set({ hold: false })
        .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    }
  })

  it('refuses an override proven by a cashier binding', async () => {
    await db
      .update(creditProfile)
      .set({ hold: true })
      .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))

    try {
      await expectRefusal(
        repaymentPayload({
          amountMinor: 1_500,
          override: managerProof({
            userId: cashierUserId,
            staffId: cashierStaffId,
            bindingId: cashierBindingId,
          }),
        }),
        'OVERRIDE_INVALID',
      )
    } finally {
      await db
        .update(creditProfile)
        .set({ hold: false })
        .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    }
  })

  it('refuses a zero amount at the route', async () => {
    const response = await uploadRequest([
      {
        clientTransactionId: crypto.randomUUID(),
        type: 'CREDIT_REPAYMENT',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: repaymentPayload({ amountMinor: 0 }),
      },
    ])

    expect(response.status).toBe(400)
  })

  it('keeps the profile projection equal to the ledger it projects', async () => {
    await applyNow(repaymentPayload({ amountMinor: 3_000 }))
    const paymentId = await moMoPayment(2_000)
    await applyNow(repaymentPayload({ amountMinor: 2_000, method: 'MOMO', paymentId }))

    // Computed independently of the write path: the projection is a claim, the
    // ledger is the truth (P13-D27).
    const summed = await db
      .select({ total: sql<string>`coalesce(sum(${creditLedgerEntry.amountMinor}), 0)` })
      .from(creditLedgerEntry)
      .where(
        and(eq(creditLedgerEntry.customerId, customerId), eq(creditLedgerEntry.branchId, branchId)),
      )

    expect(await profileBalance()).toBe(Number(summed[0]?.total ?? 0))
  })

  it('leaves every sale row untouched', async () => {
    const [saleRow] = await db.select().from(sale).where(eq(sale.branchId, branchId)).limit(1)
    if (!saleRow) throw new Error('the fixture sale was not written')

    await applyNow(repaymentPayload({ amountMinor: 4_000 }))

    const [after] = await db.select().from(sale).where(eq(sale.id, saleRow.id))
    expect(after).toEqual(saleRow)
  })
})
