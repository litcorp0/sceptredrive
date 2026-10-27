import { db } from '@sceptre/db'
import { priceCart, type TenderMethod, tenderBalance } from '@sceptre/shared'
import { and, eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest'
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
import { category, uom } from '../catalog/catalog.schema.ts'
import { creditLedgerEntry, creditProfile } from '../credit/credit.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { evatSubmission } from '../evat/evat.schema.ts'
import { user as userTable } from '../identity/staff.schema.ts'
import { stockLevel, stockMovement } from '../inventory/inventory.schema.ts'
import { loyaltyAccount, loyaltyLedgerEntry, loyaltyLot } from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { resetMockProvider, settleMockPayment } from '../payments/payments.mock.provider.ts'
import { payment } from '../payments/payments.schema.ts'
import { createPayment, getPayment } from '../payments/payments.service.ts'
import { product } from '../products/products.schema.ts'
import { applyUpload } from '../sync/sync.service.ts'
import type { DeviceAuthContext, RefundPayload } from '../sync/sync.types.ts'
import {
  cashMovement,
  posStaffBinding,
  posSyncTransaction,
  refund,
  refundLine,
  refundTender,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from './pos.schema.ts'
import { applyRefund, applySale } from './pos.service.ts'
import type { OverrideProof, SalePayload } from './pos.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.refund.test] database unavailable; integration tests skipped')

/**
 * The refund document (P13-D17 … P13-D26).
 *
 * A refund is a new numbered document that names its lines, its tenders, the
 * restock decision and the manager who authorised it. It never edits the sale,
 * never exceeds a cap, and posts stock only where the goods can be resold.
 * Every fixture sale is built through `applySale`, so the caps are tested
 * against the same rows production writes.
 */
describe.skipIf(!available)('POS refunds', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUomIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdSaleIds: string[] = []
  const createdRefundIds: string[] = []
  const createdPaymentIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []

  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let shiftId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let cashierBindingId = ''
  let cashierToken = ''
  let managerUserId = ''
  let managerStaffId = ''
  let managerBindingId = ''
  let managerToken = ''
  let productA = ''
  let productB = ''
  let productC = ''
  let productD = ''
  let productE = ''
  let adminCookie = ''
  let customerId = ''
  let customerPhone = ''
  let receiptSequence = 0
  let refundNumberSequence = 0

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })

  function saleContext(device = deviceContext()) {
    const clientTransactionId = crypto.randomUUID()
    createdSaleIds.push(clientTransactionId)
    return {
      clientTransactionId,
      device,
      receivedAt: new Date(),
      clockSkewToleranceMinutes: 10,
    }
  }

  function refundContext() {
    const clientTransactionId = crypto.randomUUID()
    createdRefundIds.push(clientTransactionId)
    return {
      clientTransactionId,
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
      reasonCode: 'RETURN',
      note: null,
      occurredAt: new Date().toISOString(),
      ...overrides,
    }
  }

  interface SaleSpec {
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>
    tenders: Array<{ method: TenderMethod; amountMinor: number; paymentId?: string }>
    customer?: { id: string; phone: string; name: string }
    cashier?: { userId: string; staffId: string; bindingId: string; bindingToken: string }
    /** A sale taken on another till, for the foreign-refund refusal. */
    context?: { device: DeviceAuthContext; shiftId: string }
  }

  async function createSale(spec: SaleSpec): Promise<string> {
    receiptSequence += 1
    const priced = priceCart(
      spec.lines.map((line) => ({
        ...line,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD' as const,
        name: '',
        sku: '',
      })),
      { taxMode: 'INCLUSIVE', saleDiscountMinor: 0, loyaltyDiscountMinor: 0 },
    )
    const balance = tenderBalance(
      priced.totalMinor,
      spec.tenders.map((tender, index) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        sequence: index + 1,
      })),
    )
    expect(balance.problem).toBeNull()

    const cashier = spec.cashier ?? {
      userId: cashierUserId,
      staffId: cashierStaffId,
      bindingId: cashierBindingId,
      bindingToken: cashierToken,
    }

    const payload: SalePayload = {
      receiptNumber: `RF${suffix}-${receiptSequence}`,
      shiftId: spec.context?.shiftId ?? shiftId,
      cashier: { ...cashier, pinVersion: 1 },
      customer: spec.customer ?? null,
      lines: spec.lines.map((line) => ({
        productId: line.productId,
        quantity: line.quantity,
        unitPriceMinor: line.unitPriceMinor,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      })),
      saleDiscount: null,
      loyalty: null,
      tenders: spec.tenders.map((tender) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        paymentId: tender.paymentId ?? null,
        override: null,
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
        changeMinor: balance.changeMinor,
      },
      occurredAt: new Date().toISOString(),
      appVersion: 'test',
    }

    const ctx = saleContext(spec.context?.device)
    await db.transaction((tx) => applySale(ctx, payload, tx))
    return ctx.clientTransactionId
  }

  async function cardPayment(amountMinor: number): Promise<string> {
    const created = await createPayment(deviceContext(), {
      method: 'CARD',
      amountMinor,
      clientPaymentId: crypto.randomUUID(),
      shiftId,
    })
    createdPaymentIds.push(created.id)
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)
    const settled = await getPayment(deviceContext(), created.id, { refresh: true })
    expect(settled.status).toBe('PAID')
    return settled.id
  }

  /** The plan's fixture: a 100.00 sale paid cash 30 / credit 30 / card 40. */
  async function threeTenderSale(): Promise<{
    saleId: string
    lineAId: string
    lineBId: string
    cashTenderId: string
    creditTenderId: string
    cardTenderId: string
  }> {
    const cardId = await cardPayment(4_000)
    const saleId = await createSale({
      lines: [
        { productId: productA, quantity: 3, unitPriceMinor: 3_000 },
        { productId: productB, quantity: 1, unitPriceMinor: 1_000 },
      ],
      tenders: [
        { method: 'CASH', amountMinor: 3_000 },
        { method: 'CREDIT', amountMinor: 3_000 },
        { method: 'CARD', amountMinor: 4_000, paymentId: cardId },
      ],
      customer: { id: customerId, phone: customerPhone, name: 'Refund Customer' },
    })

    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const tenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, saleId))
      .orderBy(saleTender.sequence)

    return {
      saleId,
      lineAId: lines.find((line) => line.productId === productA)?.id ?? '',
      lineBId: lines.find((line) => line.productId === productB)?.id ?? '',
      cashTenderId: tenders.find((tender) => tender.method === 'CASH')?.id ?? '',
      creditTenderId: tenders.find((tender) => tender.method === 'CREDIT')?.id ?? '',
      cardTenderId: tenders.find((tender) => tender.method === 'CARD')?.id ?? '',
    }
  }

  interface RefundSpec {
    saleId: string
    number?: string
    lines: Array<{
      saleLineId: string
      quantity: number
      restock?: 'RESALABLE' | 'DAMAGED' | 'NOT_RETURNED'
      damageReason?: string | null
    }>
    tenders: Array<{ saleTenderId: string; amountMinor: number }>
    refundedMinor: number
    reasonCode?: RefundPayload['reasonCode']
    approval?: Partial<OverrideProof>
    cashier?: RefundPayload['cashier']
  }

  function refundPayload(spec: RefundSpec): RefundPayload {
    const proof = managerProof(spec.approval)
    refundNumberSequence += 1
    return {
      saleId: spec.saleId,
      number: spec.number ?? `RF-${suffix}-${refundNumberSequence}`,
      shiftId,
      cashier: spec.cashier ?? {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
      reasonCode: spec.reasonCode ?? 'CUSTOMER_CHANGED_MIND',
      note: null,
      approval: proof,
      lines: spec.lines.map((line) => ({
        saleLineId: line.saleLineId,
        quantity: line.quantity,
        restock: line.restock ?? ('RESALABLE' as const),
        damageReason: line.damageReason ?? null,
      })),
      tenders: spec.tenders,
      refundedMinor: spec.refundedMinor,
      occurredAt: new Date().toISOString(),
    }
  }

  async function applyRefundNow(payload: RefundPayload) {
    const ctx = refundContext()
    const result = await db.transaction((tx) => applyRefund(ctx, payload, tx))
    return { ...result, clientTransactionId: ctx.clientTransactionId }
  }

  /** A refused refund is run without a transaction, so a stray write would show. */
  async function expectRefusal(payload: RefundPayload, code: string): Promise<void> {
    const ctx = refundContext()
    await expect(applyRefund(ctx, payload)).rejects.toMatchObject({ code })
  }

  async function stockMovementsFor(refundId: string) {
    return db.select().from(stockMovement).where(eq(stockMovement.referenceId, refundId))
  }

  async function refundRowsFor(saleId: string) {
    return db.select().from(refund).where(eq(refund.saleId, saleId))
  }

  async function approvalsFor(saleId: string) {
    const refunds = await refundRowsFor(saleId)
    if (refunds.length === 0) return []
    return db
      .select()
      .from(approval)
      .where(
        and(
          eq(approval.type, 'REFUND'),
          inArray(
            approval.entityId,
            refunds.map((row) => row.id),
          ),
        ),
      )
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `R${suffix}`, name: `Refund ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `R${suffix}-T01`, name: 'Refund Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `refund-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Refund Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const uomRow = await db
      .insert(uom)
      .values({ code: `RU${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const products = await db
      .insert(product)
      .values([
        {
          sku: `RA-${suffix}`,
          name: `Refund A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 3_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `RB-${suffix}`,
          name: `Refund B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 1_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `RC-${suffix}`,
          name: `Refund C ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        // The approval boundary is 200.00 exactly, so the fixture needs one line
        // worth 199.99 and one worth 200.00 (P13-D21).
        {
          sku: `RD-${suffix}`,
          name: `Refund D ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 19_999,
          taxCategory: 'STANDARD',
        },
        {
          sku: `RE-${suffix}`,
          name: `Refund E ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 20_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productA = products[0]?.id ?? ''
    productB = products[1]?.id ?? ''
    productC = products[2]?.id ?? ''
    productD = products[3]?.id ?? ''
    productE = products[4]?.id ?? ''
    createdProductIds.push(productA, productB, productC, productD, productE)

    await db.insert(stockLevel).values([
      { productId: productA, branchId, quantityOnHand: 100, avgCostMinor: 1_800 },
      { productId: productB, branchId, quantityOnHand: 100, avgCostMinor: 600 },
      { productId: productC, branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productD, branchId, quantityOnHand: 100, avgCostMinor: 12_000 },
      { productId: productE, branchId, quantityOnHand: 100, avgCostMinor: 12_000 },
    ])

    customerPhone = `+23320${String(Date.now()).slice(-7)}`
    const customerRow = await db
      .insert(customer)
      .values({ name: 'Refund Customer', phone: customerPhone, createdBranchId: branchId })
      .returning()
    customerId = customerRow[0]?.id ?? ''
    createdCustomerIds.push(customerId)
    await db.insert(loyaltyAccount).values({ customerId })
    await db.insert(creditProfile).values({ customerId, branchId, limitMinor: 50_000 })

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-RR${suffix.slice(0, 2)}`
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
    managerStaffId = `GA-RM${suffix.slice(0, 2)}`
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

    const admin = await createTestUser({
      role: 'ADMIN',
      email: `refund-admin-${suffix}@test.local`,
    })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const shiftRow = await db
      .insert(shift)
      .values({
        number: `RF-${suffix}-S-20261027-01`,
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
  })

  beforeEach(() => {
    resetMockProvider()
  })

  afterAll(async () => {
    // A submission restricts its document (P14-D34): the certificate is a child
    // of the refund, so a suite that deletes documents deletes it first.
    await db.delete(evatSubmission).where(eq(evatSubmission.branchId, branchId))
    if (createdRefundIds.length > 0) {
      // refund_tender, refund_line and refund are append-only; a test suite is
      // the one place they are removed, child first.
      await db.delete(refundTender).where(inArray(refundTender.refundId, createdRefundIds))
      await db.delete(refundLine).where(inArray(refundLine.refundId, createdRefundIds))
      await db.delete(refund).where(inArray(refund.id, createdRefundIds))
    }
    await db.delete(approval).where(eq(approval.branchId, branchId))
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    await db.delete(cashMovement).where(eq(cashMovement.branchId, branchId))
    if (createdCustomerIds.length > 0) {
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
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    if (deviceId) {
      // The upload ledger rows this suite's replayed refunds left behind.
      await db.delete(posSyncTransaction).where(eq(posSyncTransaction.deviceId, deviceId))
    }
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
    if (deviceId) await db.delete(device).where(eq(device.id, deviceId))
    if (terminalId) await db.delete(terminal).where(eq(terminal.id, terminalId))
    if (createdDeviceIds.length > 0) {
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
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

  it('posts one RETURN movement for a resalable unit and never touches the sale', async () => {
    const fixture = await threeTenderSale()
    const before = (await db.select().from(sale).where(eq(sale.id, fixture.saleId)))[0]

    const result = await applyRefundNow(
      refundPayload({
        saleId: fixture.saleId,
        lines: [{ saleLineId: fixture.lineAId, quantity: 1, restock: 'RESALABLE' }],
        tenders: [{ saleTenderId: fixture.cashTenderId, amountMinor: 3_000 }],
        refundedMinor: 3_000,
      }),
    )

    const movements = await stockMovementsFor(result.refundId)
    expect(movements).toHaveLength(1)
    expect(movements[0]).toMatchObject({
      productId: productA,
      type: 'RETURN',
      referenceType: 'REFUND',
      referenceId: result.refundId,
      referenceNumber: result.number,
      quantityDelta: 1,
      unitCostMinor: 1_800,
    })

    const after = (await db.select().from(sale).where(eq(sale.id, fixture.saleId)))[0]
    // The sale is the record of what was taken. A refund is a second document,
    // so every money column of the first is byte-identical afterwards.
    expect(after).toEqual(before)
    expect(after).toMatchObject({ totalMinor: 10_000, tenderTotalMinor: 10_000, changeMinor: 0 })

    const lines = await db.select().from(refundLine).where(eq(refundLine.refundId, result.refundId))
    expect(lines[0]).toMatchObject({ quantity: 1, restock: 'RESALABLE', damageReason: null })
    // The cost is the sale line's, not today's average.
    expect(lines[0]?.unitCostMinor).toBe(1_800)
  })

  it('allocates every component over the remaining quantity, so refunds sum to the line', async () => {
    const sale = await threeTenderSale()
    const saleLineRow = (await db.select().from(saleLine).where(eq(saleLine.id, sale.lineAId)))[0]

    const first = await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 1 }],
        tenders: [{ saleTenderId: sale.cashTenderId, amountMinor: 3_000 }],
        refundedMinor: 3_000,
      }),
    )
    const second = await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 2 }],
        tenders: [
          { saleTenderId: sale.creditTenderId, amountMinor: 3_000 },
          { saleTenderId: sale.cardTenderId, amountMinor: 3_000 },
        ],
        refundedMinor: 6_000,
      }),
    )

    const rows = await db
      .select()
      .from(refundLine)
      .where(inArray(refundLine.refundId, [first.refundId, second.refundId]))

    for (const component of [
      'baseMinor',
      'vatMinor',
      'nhilMinor',
      'getfundMinor',
      'taxTotalMinor',
      'totalMinor',
    ] as const) {
      const summed = rows.reduce((sum, row) => sum + row[component], 0)
      expect(summed, component).toBe(saleLineRow?.[component])
    }
    expect(rows.reduce((sum, row) => sum + row.quantity, 0)).toBe(3)
  })

  it('refuses money that does not match the value of the lines returned', async () => {
    const saleId = await createSale({
      lines: [{ productId: productE, quantity: 1, unitPriceMinor: 20_000 }],
      tenders: [{ method: 'CASH', amountMinor: 20_000 }],
    })
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, saleId))

    const ctx = refundContext()
    const error = (await applyRefund(
      ctx,
      refundPayload({
        saleId,
        lines: [{ saleLineId: lines[0]?.id ?? '', quantity: 1 }],
        tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 15_000 }],
        refundedMinor: 15_000,
      }),
    ).catch((caught: unknown) => caught)) as Error & { code?: string }

    expect(error).toMatchObject({ code: 'REFUND_LINE_TOTAL_MISMATCH' })
    // Both figures are in the message: what left and what came back.
    expect(error.message).toContain('GHS 150.00')
    expect(error.message).toContain('GHS 200.00')

    expect(await refundRowsFor(saleId)).toHaveLength(0)
    expect(await stockMovementsFor(ctx.clientTransactionId)).toHaveLength(0)
  })

  it('refuses a unit beyond the line and writes nothing', async () => {
    const sale = await threeTenderSale()

    // All three units of a 90.00 line, so the money and the goods agree.
    await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 3 }],
        tenders: [
          { saleTenderId: sale.cashTenderId, amountMinor: 3_000 },
          { saleTenderId: sale.creditTenderId, amountMinor: 3_000 },
          { saleTenderId: sale.cardTenderId, amountMinor: 3_000 },
        ],
        refundedMinor: 9_000,
      }),
    )

    await expectRefusal(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 1 }],
        tenders: [{ saleTenderId: sale.cardTenderId, amountMinor: 1_000 }],
        refundedMinor: 1_000,
      }),
      'REFUND_EXCEEDS_LINE',
    )

    expect(await refundRowsFor(sale.saleId)).toHaveLength(1)
  })

  it('refuses a sale another terminal took and writes nothing', async () => {
    // A second till in the same branch takes a sale of its own.
    const foreignTerminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `R${suffix}-T02`, name: 'Other Refund Counter' })
      .returning()
    const foreignTerminalId = foreignTerminalRow[0]?.id ?? ''
    createdTerminalIds.push(foreignTerminalId)
    const foreignDeviceRow = await db
      .insert(device)
      .values({
        terminalId: foreignTerminalId,
        fingerprint: `refund-foreign-${suffix}`,
        tokenHash: randomToken(32),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const foreignDeviceId = foreignDeviceRow[0]?.id ?? ''
    createdDeviceIds.push(foreignDeviceId)
    const foreignShiftRow = await db
      .insert(shift)
      .values({
        number: `RF-${suffix}-S-20261027-02`,
        branchId,
        terminalId: foreignTerminalId,
        deviceId: foreignDeviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor: 0,
        openedBy: cashierStaffId,
      })
      .returning()
    const foreignShiftId = foreignShiftRow[0]?.id ?? ''

    const foreignSaleId = await createSale({
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 1_000 }],
      tenders: [{ method: 'CASH', amountMinor: 1_000 }],
      context: {
        device: { deviceId: foreignDeviceId, terminalId: foreignTerminalId, branchId },
        shiftId: foreignShiftId,
      },
    })
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, foreignSaleId))
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, foreignSaleId))

    // This till may not refund another till's sale, even in the same branch.
    const ctx = refundContext()
    await expect(
      applyRefund(
        ctx,
        refundPayload({
          saleId: foreignSaleId,
          lines: [{ saleLineId: lines[0]?.id ?? '', quantity: 1 }],
          tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 1_000 }],
          refundedMinor: 1_000,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 403, code: 'REFUND_SALE_FOREIGN' })

    // Nothing was written: no document, no approval, no stock movement.
    expect(await refundRowsFor(foreignSaleId)).toHaveLength(0)
    expect(await stockMovementsFor(ctx.clientTransactionId)).toHaveLength(0)
    expect(
      await db.select().from(approval).where(eq(approval.entityId, ctx.clientTransactionId)),
    ).toHaveLength(0)
    // The foreign sale is untouched.
    const storedSale = (await db.select().from(sale).where(eq(sale.id, foreignSaleId)))[0]
    expect(storedSale?.shiftId).toBe(foreignShiftId)
    expect(tenders).toHaveLength(1)
  })

  it('writes an electronic tender PENDING and enqueues the dispatch after the commit', async () => {
    const sale = await threeTenderSale()
    const refundId = crypto.randomUUID()
    createdRefundIds.push(refundId)
    const payload = refundPayload({
      saleId: sale.saleId,
      lines: [{ saleLineId: sale.lineAId, quantity: 2 }],
      tenders: [
        { saleTenderId: sale.cashTenderId, amountMinor: 3_000 },
        { saleTenderId: sale.cardTenderId, amountMinor: 3_000 },
      ],
      refundedMinor: 6_000,
    })

    const enqueued: string[] = []
    const body = {
      batchId: crypto.randomUUID(),
      deviceId,
      terminalId,
      transactions: [
        {
          clientTransactionId: refundId,
          type: 'REFUND' as const,
          occurredAt: new Date().toISOString(),
          payloadVersion: 1 as const,
          payload,
        },
      ],
    }

    const first = await applyUpload(deviceContext(), body, {
      enqueueRefund: async (id) => {
        enqueued.push(id)
      },
    })
    expect(first.results[0]?.status).toBe('APPLIED')
    expect(enqueued).toEqual([refundId])

    const tenders = await db
      .select()
      .from(refundTender)
      .where(eq(refundTender.refundId, refundId))
      .orderBy(refundTender.sequence)
    expect(tenders).toHaveLength(2)
    expect(tenders[0]).toMatchObject({ method: 'CASH', status: 'SETTLED' })
    expect(tenders[1]).toMatchObject({ method: 'CARD', status: 'PENDING', settledAt: null })
    expect(tenders[1]?.paymentId).not.toBeNull()

    // The same upload again is a replay: one document, no second job.
    const replay = await applyUpload(deviceContext(), body, {
      enqueueRefund: async (id) => {
        enqueued.push(id)
      },
    })
    expect(replay.results[0]?.status).toBe('REPLAYED')
    expect(enqueued).toEqual([refundId])
    expect(await refundRowsFor(sale.saleId)).toHaveLength(1)
  })

  it('does not fail the upload when the enqueue fails', async () => {
    const sale = await threeTenderSale()
    const refundId = crypto.randomUUID()
    createdRefundIds.push(refundId)
    const payload = refundPayload({
      saleId: sale.saleId,
      lines: [{ saleLineId: sale.lineAId, quantity: 1 }],
      tenders: [{ saleTenderId: sale.cardTenderId, amountMinor: 3_000 }],
      refundedMinor: 3_000,
    })

    const response = await applyUpload(
      deviceContext(),
      {
        batchId: crypto.randomUUID(),
        deviceId,
        terminalId,
        transactions: [
          {
            clientTransactionId: refundId,
            type: 'REFUND',
            occurredAt: new Date().toISOString(),
            payloadVersion: 1,
            payload,
          },
        ],
      },
      {
        enqueueRefund: async () => {
          throw new Error('queue down')
        },
      },
    )

    expect(response.results[0]?.status).toBe('APPLIED')
    expect(await refundRowsFor(sale.saleId)).toHaveLength(1)
  })

  it('refuses more than a tender holds', async () => {
    const sale = await threeTenderSale()

    await expectRefusal(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 2 }],
        // The card tender is 40.00; 40.01 is one pesewa too much.
        tenders: [{ saleTenderId: sale.cardTenderId, amountMinor: 4_001 }],
        refundedMinor: 4_001,
      }),
      'REFUND_EXCEEDS_TENDER',
    )
  })

  it('caps a refund at the money the sale kept, not at what was tendered', async () => {
    const saleId = await createSale({
      lines: [{ productId: productB, quantity: 9, unitPriceMinor: 1_000 }],
      // 90.00 sale, 100.00 tendered, 10.00 change: only 90.00 was ever ours.
      tenders: [{ method: 'CASH', amountMinor: 10_000 }],
    })
    const saleRow = (await db.select().from(sale).where(eq(sale.id, saleId)))[0]
    expect(saleRow).toMatchObject({
      totalMinor: 9_000,
      tenderTotalMinor: 10_000,
      changeMinor: 1_000,
    })

    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, saleId))

    await expectRefusal(
      refundPayload({
        saleId,
        lines: [{ saleLineId: lines[0]?.id ?? '', quantity: 9 }],
        tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 9_001 }],
        refundedMinor: 9_001,
      }),
      'REFUND_EXCEEDS_SALE',
    )

    const ok = await applyRefundNow(
      refundPayload({
        saleId,
        lines: [{ saleLineId: lines[0]?.id ?? '', quantity: 9 }],
        tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 9_000 }],
        refundedMinor: 9_000,
      }),
    )
    expect(ok.refundedMinor).toBe(9_000)
  })

  it('reduces the credit ledger by the credit portion and moves no cash', async () => {
    const sale = await threeTenderSale()
    const cashBefore = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(cashMovement)
      .where(eq(cashMovement.shiftId, shiftId))
    const balanceBefore =
      (
        await db
          .select()
          .from(creditProfile)
          .where(
            and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)),
          )
      )[0]?.balanceMinor ?? 0

    const result = await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 1 }],
        tenders: [{ saleTenderId: sale.creditTenderId, amountMinor: 3_000 }],
        refundedMinor: 3_000,
      }),
    )

    const entries = await db
      .select()
      .from(creditLedgerEntry)
      .where(eq(creditLedgerEntry.referenceId, result.refundId))
    expect(entries).toHaveLength(1)
    expect(entries[0]).toMatchObject({
      kind: 'REFUND',
      amountMinor: -3_000,
      reasonCode: 'RETURN',
      referenceType: 'REFUND',
      referenceNumber: result.number,
    })

    const profile = (
      await db
        .select()
        .from(creditProfile)
        .where(and(eq(creditProfile.customerId, customerId), eq(creditProfile.branchId, branchId)))
    )[0]
    // The debt shrinks by exactly the credit portion; no cash leaves the drawer.
    expect(profile?.balanceMinor).toBe(balanceBefore - 3_000)

    const cashAfter = await db
      .select({ value: sql<number>`count(*)::int` })
      .from(cashMovement)
      .where(eq(cashMovement.shiftId, shiftId))
    expect(cashAfter[0]?.value).toBe(cashBefore[0]?.value ?? 0)
  })

  it('posts nothing for damaged goods and insists on the reason', async () => {
    const sale = await threeTenderSale()

    await expect(
      applyRefund(
        refundContext(),
        refundPayload({
          saleId: sale.saleId,
          lines: [{ saleLineId: sale.lineAId, quantity: 1, restock: 'DAMAGED' }],
          tenders: [{ saleTenderId: sale.cashTenderId, amountMinor: 3_000 }],
          refundedMinor: 3_000,
        }),
      ),
    ).rejects.toMatchObject({ statusCode: 400, code: 'REFUND_INVALID' })

    const result = await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [
          {
            saleLineId: sale.lineAId,
            quantity: 1,
            restock: 'DAMAGED',
            damageReason: 'Torn packaging',
          },
        ],
        tenders: [{ saleTenderId: sale.cashTenderId, amountMinor: 3_000 }],
        refundedMinor: 3_000,
      }),
    )

    expect(await stockMovementsFor(result.refundId)).toHaveLength(0)
    const lines = await db.select().from(refundLine).where(eq(refundLine.refundId, result.refundId))
    expect(lines[0]).toMatchObject({ restock: 'DAMAGED', damageReason: 'Torn packaging' })
  })

  it('posts nothing when the customer kept the goods', async () => {
    const sale = await threeTenderSale()
    const result = await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 1, restock: 'NOT_RETURNED' }],
        tenders: [{ saleTenderId: sale.cashTenderId, amountMinor: 3_000 }],
        refundedMinor: 3_000,
      }),
    )
    expect(await stockMovementsFor(result.refundId)).toHaveLength(0)
  })

  it('raises exactly one ADMIN approval at the threshold and none one pesewa below', async () => {
    const bigSaleId = await createSale({
      lines: [{ productId: productC, quantity: 3, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'CASH', amountMinor: 30_000 }],
    })
    const bigLines = await db.select().from(saleLine).where(eq(saleLine.saleId, bigSaleId))
    const bigTenders = await db.select().from(saleTender).where(eq(saleTender.saleId, bigSaleId))

    const atThreshold = await applyRefundNow(
      refundPayload({
        saleId: bigSaleId,
        lines: [{ saleLineId: bigLines[0]?.id ?? '', quantity: 2 }],
        tenders: [{ saleTenderId: bigTenders[0]?.id ?? '', amountMinor: 20_000 }],
        refundedMinor: 20_000,
      }),
    )

    const raised = await approvalsFor(bigSaleId)
    expect(raised).toHaveLength(1)
    expect(raised[0]).toMatchObject({
      type: 'REFUND',
      status: 'PENDING',
      entityId: atThreshold.refundId,
      amountMinor: 20_000,
      deciderRole: 'ADMIN',
      deciderBranchId: null,
    })
    const storedRefund = (
      await db.select().from(refund).where(eq(refund.id, atThreshold.refundId))
    )[0]
    expect(storedRefund?.approvalId).toBe(raised[0]?.id)

    const underSaleId = await createSale({
      lines: [{ productId: productD, quantity: 1, unitPriceMinor: 19_999 }],
      tenders: [{ method: 'CASH', amountMinor: 19_999 }],
    })
    const underLines = await db.select().from(saleLine).where(eq(saleLine.saleId, underSaleId))
    const underTenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, underSaleId))

    const underThreshold = await applyRefundNow(
      refundPayload({
        saleId: underSaleId,
        lines: [{ saleLineId: underLines[0]?.id ?? '', quantity: 1 }],
        tenders: [{ saleTenderId: underTenders[0]?.id ?? '', amountMinor: 19_999 }],
        refundedMinor: 19_999,
      }),
    )
    expect(underThreshold.refundedMinor).toBe(19_999)
    expect(await approvalsFor(underSaleId)).toHaveLength(0)
  })

  it('does not accumulate refunds of one sale into an approval', async () => {
    const saleId = await createSale({
      lines: [{ productId: productC, quantity: 5, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'CASH', amountMinor: 50_000 }],
    })
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, saleId))

    for (let index = 0; index < 5; index += 1) {
      await applyRefundNow(
        refundPayload({
          saleId,
          lines: [{ saleLineId: lines[0]?.id ?? '', quantity: 1 }],
          tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 10_000 }],
          refundedMinor: 10_000,
        }),
      )
    }

    expect(await refundRowsFor(saleId)).toHaveLength(5)
    // 50.00 returned in total, but not one document reached the cap.
    expect(await approvalsFor(saleId)).toHaveLength(0)
  })

  it('refuses an approver who took the refund themselves', async () => {
    const saleId = await createSale({
      lines: [{ productId: productB, quantity: 2, unitPriceMinor: 1_000 }],
      tenders: [{ method: 'CASH', amountMinor: 2_000 }],
      cashier: {
        userId: managerUserId,
        staffId: managerStaffId,
        bindingId: managerBindingId,
        bindingToken: managerToken,
      },
    })
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, saleId))

    await expectRefusal(
      refundPayload({
        saleId,
        lines: [{ saleLineId: lines[0]?.id ?? '', quantity: 1 }],
        tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 1_000 }],
        refundedMinor: 1_000,
        cashier: {
          userId: managerUserId,
          staffId: managerStaffId,
          bindingId: managerBindingId,
          bindingToken: managerToken,
          pinVersion: 1,
        },
      }),
      'OVERRIDE_INVALID',
    )
  })

  it('refuses an approver who does not hold pos.refund', async () => {
    const sale = await threeTenderSale()

    await expectRefusal(
      refundPayload({
        saleId: sale.saleId,
        lines: [{ saleLineId: sale.lineAId, quantity: 1 }],
        tenders: [{ saleTenderId: sale.cashTenderId, amountMinor: 3_000 }],
        refundedMinor: 3_000,
        approval: {
          staffId: cashierStaffId,
          userId: cashierUserId,
          bindingId: cashierBindingId,
          pinVersion: 1,
        },
      }),
      'OVERRIDE_INVALID',
    )
  })

  it('decides the approval without restating a single refund figure', async () => {
    const saleId = await createSale({
      lines: [{ productId: productC, quantity: 3, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'CASH', amountMinor: 30_000 }],
    })
    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const tenders = await db.select().from(saleTender).where(eq(saleTender.saleId, saleId))

    const result = await applyRefundNow(
      refundPayload({
        saleId,
        lines: [
          {
            saleLineId: lines[0]?.id ?? '',
            quantity: 2,
            restock: 'DAMAGED',
            damageReason: 'Broken',
          },
        ],
        tenders: [{ saleTenderId: tenders[0]?.id ?? '', amountMinor: 20_000 }],
        refundedMinor: 20_000,
      }),
    )
    const before = (await db.select().from(refund).where(eq(refund.id, result.refundId)))[0]
    const raised = await approvalsFor(saleId)
    expect(raised).toHaveLength(1)

    const response = await app.request(`/api/approvals/${raised[0]?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED', note: 'Return checked at the counter' }),
    })
    expect(response.status).toBe(200)

    const after = (await db.select().from(refund).where(eq(refund.id, result.refundId)))[0]
    expect(after).toEqual(before)

    const decided = (
      await db
        .select()
        .from(approval)
        .where(eq(approval.id, raised[0]?.id ?? ''))
    )[0]
    expect(decided?.status).toBe('APPROVED')

    const audited = await db.execute<{ value: string }>(sql`
      SELECT count(*)::text AS value FROM audit_log
      WHERE action = 'pos.refund.reviewed' AND entity_id = ${result.refundId}
    `)
    expect(Number(audited.rows[0]?.value ?? 0)).toBe(1)
  })

  it('shows the reviewer each refunded line, in line order, with its damage reason', async () => {
    // The sale's order is E then B; the refund's order is B then E. Ordering by
    // the refund's own `line_number` is therefore the only answer that matches
    // the document the customer was handed.
    const saleId = await createSale({
      lines: [
        { productId: productE, quantity: 1, unitPriceMinor: 20_000 },
        { productId: productB, quantity: 1, unitPriceMinor: 1_000 },
      ],
      tenders: [{ method: 'CASH', amountMinor: 21_000 }],
    })
    const saleLines = await db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
    const saleTenders = await db.select().from(saleTender).where(eq(saleTender.saleId, saleId))

    await applyRefundNow(
      refundPayload({
        saleId,
        lines: [
          {
            saleLineId: saleLines.find((line) => line.productId === productB)?.id ?? '',
            quantity: 1,
          },
          {
            saleLineId: saleLines.find((line) => line.productId === productE)?.id ?? '',
            quantity: 1,
            restock: 'DAMAGED',
            damageReason: 'Screen cracked',
          },
        ],
        tenders: [{ saleTenderId: saleTenders[0]?.id ?? '', amountMinor: 21_000 }],
        refundedMinor: 21_000,
      }),
    )

    const raised = await approvalsFor(saleId)
    expect(raised).toHaveLength(1)

    const response = await app.request(`/api/approvals/${raised[0]?.id}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      subject: {
        kind: string
        lines: Array<Record<string, unknown>>
      }
    }

    // The name and sku are the sale line's snapshot, not the live product row.
    expect(body.subject.kind).toBe('refund')
    expect(body.subject.lines).toEqual([
      {
        productName: `Refund B ${suffix}`,
        sku: `RB-${suffix}`,
        quantity: 1,
        restock: 'RESALABLE',
        damageReason: null,
        totalMinor: 1_000,
      },
      {
        productName: `Refund E ${suffix}`,
        sku: `RE-${suffix}`,
        quantity: 1,
        restock: 'DAMAGED',
        damageReason: 'Screen cracked',
        totalMinor: 20_000,
      },
    ])

    // A return with nothing damaged still carries the key, as null: an absent
    // field would read as "not recorded" rather than "nothing was damaged".
    const cleanSaleId = await createSale({
      lines: [{ productId: productC, quantity: 2, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'CASH', amountMinor: 20_000 }],
    })
    const cleanLines = await db.select().from(saleLine).where(eq(saleLine.saleId, cleanSaleId))
    const cleanTenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, cleanSaleId))

    await applyRefundNow(
      refundPayload({
        saleId: cleanSaleId,
        lines: [{ saleLineId: cleanLines[0]?.id ?? '', quantity: 2 }],
        tenders: [{ saleTenderId: cleanTenders[0]?.id ?? '', amountMinor: 20_000 }],
        refundedMinor: 20_000,
      }),
    )

    const cleanRaised = await approvalsFor(cleanSaleId)
    expect(cleanRaised).toHaveLength(1)
    const cleanResponse = await app.request(`/api/approvals/${cleanRaised[0]?.id}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(cleanResponse.status).toBe(200)
    const cleanBody = (await cleanResponse.json()) as {
      subject: { lines: Array<Record<string, unknown>> }
    }

    expect(cleanBody.subject.lines).toHaveLength(1)
    const [only] = cleanBody.subject.lines
    expect(only).toMatchObject({ restock: 'RESALABLE' })
    expect(Object.hasOwn(only ?? {}, 'damageReason')).toBe(true)
    expect(only?.damageReason).toBeNull()
  })

  it('reconciles stock, credit and tenders against the document', async () => {
    const sale = await threeTenderSale()
    const result = await applyRefundNow(
      refundPayload({
        saleId: sale.saleId,
        lines: [
          { saleLineId: sale.lineAId, quantity: 2, restock: 'RESALABLE' },
          { saleLineId: sale.lineBId, quantity: 1, restock: 'DAMAGED', damageReason: 'Snapped' },
        ],
        tenders: [
          { saleTenderId: sale.cashTenderId, amountMinor: 3_000 },
          { saleTenderId: sale.creditTenderId, amountMinor: 2_000 },
          { saleTenderId: sale.cardTenderId, amountMinor: 2_000 },
        ],
        refundedMinor: 7_000,
      }),
    )

    const reconciled = await db.execute<{
      moved: string
      credit: string
      tenders: string
      refunded: string
    }>(sql`
      SELECT
        COALESCE((SELECT SUM(quantity_delta) FROM stock_movement WHERE reference_id = ${result.refundId}), 0)::text AS moved,
        COALESCE((SELECT SUM(amount_minor) FROM credit_ledger_entry WHERE reference_id = ${result.refundId}), 0)::text AS credit,
        COALESCE((SELECT SUM(amount_minor) FROM refund_tender WHERE refund_id = ${result.refundId}), 0)::text AS tenders,
        (SELECT refunded_minor FROM refund WHERE id = ${result.refundId})::text AS refunded
    `)
    const row = reconciled.rows[0]
    // Only the two resalable units came back; the damaged one moved nothing.
    expect(Number(row?.moved)).toBe(2)
    expect(Number(row?.credit)).toBe(-2_000)
    expect(Number(row?.tenders)).toBe(7_000)
    expect(Number(row?.refunded)).toBe(7_000)
  })
})
