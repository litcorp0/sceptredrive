import { db } from '@sceptre/db'
import { accraIsoDay, priceCart, type TenderMethod, tenderBalance } from '@sceptre/shared'
import { eq, inArray, sql } from 'drizzle-orm'
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
import { category, uom } from '../catalog/catalog.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { evatSubmission } from '../evat/evat.schema.ts'
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
import { settleMockPayment } from '../payments/payments.mock.provider.ts'
import { payment } from '../payments/payments.schema.ts'
import { createPayment, getPayment } from '../payments/payments.service.ts'
import { product } from '../products/products.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import {
  cartVoid,
  cashMovement,
  posStaffBinding,
  refund,
  refundLine,
  refundTender,
  sale,
  saleLine,
  saleTender,
  shift,
  shiftReport,
  syncConflict,
} from './pos.schema.ts'
import {
  applyCartVoid,
  applyRefund,
  applySale,
  closeShift,
  recordCashMovement,
} from './pos.service.ts'
import type { OverrideProof, SalePayload } from './pos.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.oversight.test] database unavailable; integration tests skipped')

/**
 * Oversight reads (Phase 14, Plan 03).
 *
 * The fixture is built through the real write paths — the enrolment API, the
 * device session, `applySale`, `applyRefund`, `applyCartVoid`,
 * `recordCashMovement` and the real `closeShift` — because a hand-inserted sale
 * proves nothing about the shape the till sends. Every figure an endpoint returns
 * is compared with SQL written here, not with the function under test.
 */
describe.skipIf(!available)('POS oversight reads', () => {
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
  const createdBranchIds: string[] = []

  interface Counter {
    branchId: string
    terminalId: string
    deviceId: string
    deviceToken: string
    accessToken: string
  }

  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''
  let rateLimitCookie = ''

  let home: Counter
  let other: Counter

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
  let customerId = ''
  let customerPhone = ''
  let receiptSequence = 0
  let refundSequence = 0

  /** The fixture's own narrative, so the assertions can name a sale. */
  let cashSaleId = '' // GH₵500.00, refunded in full
  let smallSaleId = '' // GH₵50.00, refunded below the approval threshold
  let splitSaleId = '' // GH₵100.00 across cash, card and MoMo, with change
  let foreignSaleId = '' // branch B: never in a manager's list
  let foreignShiftId = ''
  let homeShiftId = ''
  let missingReportShiftId = ''
  let largeRefundId = ''
  let smallRefundId = ''

  const openingFloatMinor = 50_000
  const cashInMinor = 2_000
  const cashOutMinor = 500
  const countedCashMinor = 55_500

  const deviceContext = (counter: Counter): DeviceAuthContext => ({
    deviceId: counter.deviceId,
    terminalId: counter.terminalId,
    branchId: counter.branchId,
  })

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  function sessionHeaders(cookie: string): Record<string, string> {
    return authedHeaders(cookie)
  }

  async function get(path: string, cookie: string): Promise<Response> {
    return app.request(path, { headers: sessionHeaders(cookie) })
  }

  async function getDevice(path: string, token: string): Promise<Response> {
    return app.request(path, { headers: { authorization: `Bearer ${token}` } })
  }

  async function shiftReportCount(): Promise<number> {
    const rows = await db.select({ value: sql<number>`count(*)::int` }).from(shiftReport)
    return rows[0]?.value ?? 0
  }

  /** A branch, a terminal and an enrolled device, all through the real API. */
  async function provisionCounter(label: string, code: string): Promise<Counter> {
    const branchResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: sessionHeaders(adminCookie),
      body: JSON.stringify({
        code: `${code}${suffix.slice(0, 2)}`,
        name: `Oversight ${label} ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchResponse.status).toBe(201)
    const branchId = (await readJson<{ branch: { id: string } }>(branchResponse)).branch.id
    createdBranchIds.push(branchId)

    const terminalResponse = await app.request('/api/terminals', {
      method: 'POST',
      headers: sessionHeaders(adminCookie),
      body: JSON.stringify({ branchId, name: `Oversight ${label} counter` }),
    })
    expect(terminalResponse.status).toBe(201)
    const terminalId = (await readJson<{ terminal: { id: string } }>(terminalResponse)).terminal.id
    createdTerminalIds.push(terminalId)

    const enrollmentResponse = await app.request(`/api/terminals/${terminalId}/enrollment`, {
      method: 'POST',
      headers: sessionHeaders(adminCookie),
    })
    expect(enrollmentResponse.status).toBe(201)
    const { enrollment } = await readJson<{ enrollment: { code: string } }>(enrollmentResponse)

    const redeem = await app.request('/api/enrollments/redeem', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ code: enrollment.code, fingerprint: `oversight-${label}-${suffix}` }),
    })
    expect(redeem.status).toBe(201)
    const { deviceToken } = await readJson<{ deviceToken: string }>(redeem)

    const session = await app.request('/api/pos/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(session.status).toBe(200)
    const { accessToken } = await readJson<{ accessToken: string }>(session)

    const deviceRow = await db
      .select({ id: device.id })
      .from(device)
      .where(eq(device.terminalId, terminalId))
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    return { branchId, terminalId, deviceId, deviceToken, accessToken }
  }

  interface SaleSpec {
    counter: Counter
    shiftId: string
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>
    tenders: Array<{ method: TenderMethod; amountMinor: number; paymentId?: string }>
    customer?: { id: string; phone: string; name: string }
  }

  async function createSale(spec: SaleSpec): Promise<{
    saleId: string
    totalMinor: number
    lineIds: string[]
    tenderIds: string[]
  }> {
    receiptSequence += 1
    const receiptNumber = `OV${suffix}-${receiptSequence}`
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
    const balanced = tenderBalance(
      priced.totalMinor,
      spec.tenders.map((tender, index) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        sequence: index + 1,
      })),
    )
    expect(balanced.problem).toBeNull()

    const payload: SalePayload = {
      receiptNumber,
      shiftId: spec.shiftId,
      cashier: {
        userId: cashierUserId,
        staffId: cashierStaffId,
        bindingId: cashierBindingId,
        bindingToken: cashierToken,
        pinVersion: 1,
      },
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
        changeMinor: balanced.changeMinor,
      },
      occurredAt: new Date().toISOString(),
      appVersion: 'test',
    }

    const clientTransactionId = crypto.randomUUID()
    createdSaleIds.push(clientTransactionId)
    await db.transaction((tx) =>
      applySale(
        {
          clientTransactionId,
          device: deviceContext(spec.counter),
          receivedAt: new Date(),
          clockSkewToleranceMinutes: 10,
        },
        payload,
        tx,
      ),
    )

    const lines = await db.select().from(saleLine).where(eq(saleLine.saleId, clientTransactionId))
    const tenders = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, clientTransactionId))
      .orderBy(saleTender.sequence)

    return {
      saleId: clientTransactionId,
      totalMinor: priced.totalMinor,
      lineIds: lines.map((line) => line.id),
      tenderIds: tenders.map((tender) => tender.id),
    }
  }

  /** A settled electronic payment, created and verified through the real paths. */
  async function electronicPayment(
    counter: Counter,
    shiftId: string,
    method: 'MOMO' | 'CARD',
    amountMinor: number,
  ): Promise<string> {
    const created = await createPayment(deviceContext(counter), {
      method,
      amountMinor,
      clientPaymentId: crypto.randomUUID(),
      shiftId,
      ...(method === 'MOMO'
        ? { mobileMoney: { provider: 'mtn' as const, phone: customerPhone } }
        : {}),
    })
    createdPaymentIds.push(created.id)
    expect(settleMockPayment(created.providerReference, 'PAID')).toBe(true)
    const settled = await getPayment(deviceContext(counter), created.id, { refresh: true })
    expect(settled.status).toBe('PAID')
    return settled.id
  }

  function managerProof(): OverrideProof {
    return {
      staffId: managerStaffId,
      userId: managerUserId,
      bindingId: managerBindingId,
      pinVersion: 1,
      reasonCode: 'RETURN',
      note: null,
      occurredAt: new Date().toISOString(),
    }
  }

  async function createRefund(input: {
    counter: Counter
    shiftId: string
    saleId: string
    saleLineId: string
    saleTenderId: string
    amountMinor: number
    quantity: number
  }): Promise<string> {
    refundSequence += 1
    const clientTransactionId = crypto.randomUUID()
    createdRefundIds.push(clientTransactionId)

    await db.transaction((tx) =>
      applyRefund(
        {
          clientTransactionId,
          device: deviceContext(input.counter),
          receivedAt: new Date(),
          clockSkewToleranceMinutes: 10,
        },
        {
          saleId: input.saleId,
          number: `OVR-${suffix}-${refundSequence}`,
          shiftId: input.shiftId,
          cashier: {
            userId: cashierUserId,
            staffId: cashierStaffId,
            bindingId: cashierBindingId,
            bindingToken: cashierToken,
            pinVersion: 1,
          },
          reasonCode: 'CUSTOMER_CHANGED_MIND',
          note: null,
          approval: managerProof(),
          lines: [
            {
              saleLineId: input.saleLineId,
              quantity: input.quantity,
              restock: 'RESALABLE',
              damageReason: null,
            },
          ],
          tenders: [{ saleTenderId: input.saleTenderId, amountMinor: input.amountMinor }],
          refundedMinor: input.amountMinor,
          occurredAt: new Date().toISOString(),
        },
        tx,
      ),
    )
    return clientTransactionId
  }

  async function insertShift(input: {
    counter: Counter
    number: string
    status: 'OPEN' | 'CLOSED'
    openingFloatMinor?: number
  }): Promise<string> {
    const rows = await db
      .insert(shift)
      .values({
        number: `${input.number}-${suffix}`,
        branchId: input.counter.branchId,
        terminalId: input.counter.terminalId,
        deviceId: input.counter.deviceId,
        cashierUserId,
        cashierStaffId,
        status: input.status,
        openedAt: new Date('2026-10-27T08:00:00Z'),
        closedAt: input.status === 'CLOSED' ? new Date('2026-10-27T18:00:00Z') : null,
        openingFloatMinor: input.openingFloatMinor ?? openingFloatMinor,
        openedBy: cashierStaffId,
      })
      .returning()
    const id = rows[0]?.id ?? ''
    if (!id) throw new Error('the shift fixture was not inserted')
    return id
  }

  async function expectError(response: Response, status: number, code: string): Promise<void> {
    expect(response.status, `expected ${status} ${code}`).toBe(status)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe(code)
  }

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    home = await provisionCounter('home', 'OH')
    other = await provisionCounter('other', 'OX')

    const manager = await createTestUser({ role: 'MANAGER', branchId: home.branchId })
    createdUserIds.push(manager.id)
    managerUserId = manager.id
    managerStaffId = `GA-OM${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: managerStaffId, pinVersion: 1 })
      .where(eq(userTable.id, managerUserId))
    managerCookie = await signIn(manager.email)
    managerToken = randomToken(40)
    const managerBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId: home.deviceId,
        staffUserId: managerUserId,
        staffStaffId: managerStaffId,
        role: 'MANAGER',
        branchId: home.branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(managerToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    managerBindingId = managerBinding[0]?.id ?? ''

    const cashier = await createTestUser({ role: 'CASHIER', branchId: home.branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-OC${suffix.slice(0, 2)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashierUserId))
    cashierCookie = await signIn(cashier.email)
    cashierToken = randomToken(40)
    const cashierBinding = await db
      .insert(posStaffBinding)
      .values({
        deviceId: home.deviceId,
        staffUserId: cashierUserId,
        staffStaffId: cashierStaffId,
        role: 'CASHIER',
        branchId: home.branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(cashierToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    cashierBindingId = cashierBinding[0]?.id ?? ''

    // A fourth session, so the 429 leg does not exhaust the bucket every other
    // assertion shares.
    const rateLimitUser = await createTestUser({ role: 'MANAGER', branchId: home.branchId })
    createdUserIds.push(rateLimitUser.id)
    rateLimitCookie = await signIn(rateLimitUser.email)

    const categoryRow = await db
      .insert(category)
      .values({ name: `Oversight Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const uomRow = await db
      .insert(uom)
      .values({ code: `OU${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const products = await db
      .insert(product)
      .values([
        {
          sku: `OA-${suffix}`,
          name: `Oversight A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `OB-${suffix}`,
          name: `Oversight B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 5_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `OC-${suffix}`,
          name: `Oversight C ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productA = products[0]?.id ?? ''
    productB = products[1]?.id ?? ''
    productC = products[2]?.id ?? ''
    createdProductIds.push(productA, productB, productC)

    await db.insert(stockLevel).values([
      { productId: productA, branchId: home.branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productB, branchId: home.branchId, quantityOnHand: 100, avgCostMinor: 3_000 },
      { productId: productC, branchId: home.branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productA, branchId: other.branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
    ])

    customerPhone = `+23320${String(Date.now()).slice(-7)}`
    const customerRow = await db
      .insert(customer)
      .values({ name: 'Oversight Customer', phone: customerPhone, createdBranchId: home.branchId })
      .returning()
    customerId = customerRow[0]?.id ?? ''
    createdCustomerIds.push(customerId)

    homeShiftId = await insertShift({ counter: home, number: 'OVS-1', status: 'OPEN' })
    foreignShiftId = await insertShift({ counter: other, number: 'OVS-2', status: 'OPEN' })

    // 1. GH₵500.00 in cash, refunded in full — above the approval threshold.
    const cashSale = await createSale({
      counter: home,
      shiftId: homeShiftId,
      lines: [{ productId: productA, quantity: 5, unitPriceMinor: 10_000 }],
      tenders: [{ method: 'CASH', amountMinor: 50_000 }],
    })
    cashSaleId = cashSale.saleId

    // 2. GH₵50.00 in cash, refunded — below the threshold, so no approval row.
    const smallSale = await createSale({
      counter: home,
      shiftId: homeShiftId,
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 5_000 }],
      tenders: [{ method: 'CASH', amountMinor: 5_000 }],
    })
    smallSaleId = smallSale.saleId

    // 3. Three tenders with change: cash 50.00, card 30.00, MoMo 30.00 on a 100.00 sale.
    const cardId = await electronicPayment(home, homeShiftId, 'CARD', 3_000)
    const momoId = await electronicPayment(home, homeShiftId, 'MOMO', 3_000)
    const splitSale = await createSale({
      counter: home,
      shiftId: homeShiftId,
      lines: [{ productId: productC, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 5_000 },
        { method: 'CARD', amountMinor: 3_000, paymentId: cardId },
        { method: 'MOMO', amountMinor: 3_000, paymentId: momoId },
      ],
      customer: { id: customerId, phone: customerPhone, name: 'Oversight Customer' },
    })
    splitSaleId = splitSale.saleId

    const cashLineRows = await db.select().from(saleLine).where(eq(saleLine.saleId, cashSaleId))
    const cashTenderRows = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, cashSaleId))
    const smallLineRows = await db.select().from(saleLine).where(eq(saleLine.saleId, smallSaleId))
    const smallTenderRows = await db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, smallSaleId))
    const cashLine = cashLineRows[0]
    const cashTender = cashTenderRows[0]
    const smallLine = smallLineRows[0]
    const smallTender = smallTenderRows[0]
    if (!cashLine || !cashTender || !smallLine || !smallTender) {
      throw new Error('a fixture sale is incomplete')
    }
    expect(cashLine.totalMinor).toBe(50_000)
    expect(smallLine.totalMinor).toBe(5_000)

    largeRefundId = await createRefund({
      counter: home,
      shiftId: homeShiftId,
      saleId: cashSaleId,
      saleLineId: cashLine.id,
      saleTenderId: cashTender.id,
      amountMinor: 50_000,
      quantity: 5,
    })
    smallRefundId = await createRefund({
      counter: home,
      shiftId: homeShiftId,
      saleId: smallSaleId,
      saleLineId: smallLine.id,
      saleTenderId: smallTender.id,
      amountMinor: 5_000,
      quantity: 1,
    })

    // Two abandoned carts and the drawer's two manual movements.
    for (const [reasonCode, itemCount, grossMinor, label] of [
      ['CUSTOMER_CHANGED_MIND', 2, 4_000, 'Walk-in'],
      ['WRONG_ITEM', 1, 1_000, null],
    ] as const) {
      await db.transaction((tx) =>
        applyCartVoid(
          {
            clientTransactionId: crypto.randomUUID(),
            device: deviceContext(home),
            receivedAt: new Date(),
            clockSkewToleranceMinutes: 10,
          },
          {
            shiftId: homeShiftId,
            cashier: {
              userId: cashierUserId,
              staffId: cashierStaffId,
              bindingId: cashierBindingId,
              bindingToken: cashierToken,
              pinVersion: 1,
            },
            reasonCode,
            note: null,
            itemCount,
            grossMinor,
            label,
            lines: [
              { productId: productA, name: 'Oversight A', quantity: 1, unitPriceMinor: 1_000 },
            ],
            occurredAt: new Date().toISOString(),
          },
          tx,
        ),
      )
    }

    await recordCashMovement(deviceContext(home), {
      id: crypto.randomUUID(),
      shiftId: homeShiftId,
      type: 'CASH_IN',
      amountMinor: cashInMinor,
      reason: 'Float top-up',
      occurredAt: new Date().toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })
    await recordCashMovement(deviceContext(home), {
      id: crypto.randomUUID(),
      shiftId: homeShiftId,
      type: 'CASH_OUT',
      amountMinor: cashOutMinor,
      reason: 'Courier',
      occurredAt: new Date().toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })

    // The real close writes the Z snapshot inside its own transaction.
    await closeShift(deviceContext(home), {
      shiftId: homeShiftId,
      countedCashMinor,
      clientExpectedCashMinor: countedCashMinor,
      occurredAt: new Date().toISOString(),
    })

    // A third shift, closed by the real close and then robbed of its snapshot by
    // the test that proves a Z is never rebuilt. Float zero keeps its variance zero.
    missingReportShiftId = await insertShift({
      counter: home,
      number: 'OVS-3',
      status: 'OPEN',
      openingFloatMinor: 0,
    })
    await closeShift(deviceContext(home), {
      shiftId: missingReportShiftId,
      countedCashMinor: 0,
      clientExpectedCashMinor: 0,
      occurredAt: new Date().toISOString(),
    })

    // A sale on the other branch's till, which a home manager must never see.
    const foreignSale = await createSale({
      counter: other,
      shiftId: foreignShiftId,
      lines: [{ productId: productA, quantity: 1, unitPriceMinor: 3_000 }],
      tenders: [{ method: 'CASH', amountMinor: 3_000 }],
    })
    foreignSaleId = foreignSale.saleId
  })

  afterAll(async () => {
    // Child first, and every id this suite created. `sale`, `refund` and the
    // ledgers are append-only in production; a test suite is the one place they
    // are removed, and leaving a row behind breaks the analytics aggregates.
    await db.delete(evatSubmission).where(eq(evatSubmission.branchId, home.branchId))
    await db.delete(shiftReport).where(inArray(shiftReport.branchId, createdBranchIds))
    if (createdRefundIds.length > 0) {
      await db.delete(refundTender).where(inArray(refundTender.refundId, createdRefundIds))
      await db.delete(refundLine).where(inArray(refundLine.refundId, createdRefundIds))
      await db.delete(refund).where(inArray(refund.id, createdRefundIds))
    }
    await db.delete(approval).where(inArray(approval.branchId, createdBranchIds))
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    await db.delete(syncConflict).where(inArray(syncConflict.branchId, createdBranchIds))
    await db.delete(cartVoid).where(inArray(cartVoid.branchId, createdBranchIds))
    await db.delete(cashMovement).where(inArray(cashMovement.branchId, createdBranchIds))
    await db.delete(shift).where(inArray(shift.branchId, createdBranchIds))
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(loyaltyLotConsumption).where(
        inArray(
          loyaltyLotConsumption.lotId,
          db
            .select({ id: loyaltyLot.id })
            .from(loyaltyLot)
            .where(
              inArray(
                loyaltyLot.accountId,
                db
                  .select({ id: loyaltyAccount.id })
                  .from(loyaltyAccount)
                  .where(inArray(loyaltyAccount.customerId, createdCustomerIds)),
              ),
            ),
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
      await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
    await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
    if (createdDeviceIds.length > 0) {
      await db.delete(posStaffBinding).where(inArray(posStaffBinding.deviceId, createdDeviceIds))
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
    if (createdUomIds.length > 0) await db.delete(uom).where(inArray(uom.id, createdUomIds))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('lists a sale with its id, its own total and the refunds booked against it', async () => {
    const response = await get(
      `/api/pos/oversight/sales?receiptNumber=OV${suffix}-1`,
      managerCookie,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{
      sales: Array<Record<string, number | string | null>>
      total: number
    }>(response)

    expect(body.total).toBe(1)
    const [row] = body.sales
    expect(row?.id).toBe(cashSaleId)
    expect(row?.receiptNumber).toBe(`OV${suffix}-1`)

    const stored = (await db.select().from(sale).where(eq(sale.id, cashSaleId)))[0]
    expect(row?.totalMinor).toBe(stored?.totalMinor)
    expect(row?.taxTotalMinor).toBe(stored?.taxTotalMinor)
    expect(row?.changeMinor).toBe(stored?.changeMinor)
    // The whole GH₵500.00 came back: the row must not read as a sale.
    expect(row?.refundedMinor).toBe(50_000)
    expect(row?.itemsSold).toBe(5)
    expect(row?.branchCode).toBe(`OH${suffix.slice(0, 2)}`)
    expect(row?.cashierName).toBe('Test User')

    const small = await get(`/api/pos/oversight/sales?receiptNumber=OV${suffix}-2`, managerCookie)
    const smallBody = await readJson<{ sales: Array<{ refundedMinor: number }> }>(small)
    expect(smallBody.sales[0]?.refundedMinor).toBe(5_000)
  })

  it('refuses another branch with a 403 and hides it from the list', async () => {
    const list = await get('/api/pos/oversight/sales', managerCookie)
    expect(list.status).toBe(200)
    const body = await readJson<{ sales: Array<{ id: string; branchId: string }> }>(list)
    const ids = body.sales.map((row) => row.id)
    expect(ids).toContain(cashSaleId)
    expect(ids).not.toContain(foreignSaleId)
    for (const row of body.sales) expect(row.branchId).toBe(home.branchId)

    // A foreign object is a 403, not a 404: the manager may learn it exists.
    await expectError(
      await get(`/api/pos/oversight/sales/${foreignSaleId}`, managerCookie),
      403,
      'FORBIDDEN',
    )
    // So is a foreign branch filter.
    await expectError(
      await get(`/api/pos/oversight/sales?branchId=${other.branchId}`, managerCookie),
      403,
      'FORBIDDEN',
    )
    // The admin sees both branches, and can filter to the other one.
    const adminList = await readJson<{ sales: Array<{ id: string }> }>(
      await get('/api/pos/oversight/sales', adminCookie),
    )
    const adminIds = adminList.sales.map((row) => row.id)
    expect(adminIds).toContain(cashSaleId)
    expect(adminIds).toContain(foreignSaleId)
    const otherOnly = await readJson<{ sales: Array<{ id: string }> }>(
      await get(`/api/pos/oversight/sales?branchId=${other.branchId}`, adminCookie),
    )
    expect(otherOnly.sales.map((row) => row.id)).toEqual([foreignSaleId])
  })

  it('filters by an exact receipt number and by Accra days', async () => {
    const exact = await readJson<{ total: number }>(
      await get(`/api/pos/oversight/sales?receiptNumber=OV${suffix}-3`, managerCookie),
    )
    expect(exact.total).toBe(1)

    // Case-sensitive: a receipt number is a document key, not a search term.
    const lower = await readJson<{ total: number }>(
      await get(
        `/api/pos/oversight/sales?receiptNumber=${encodeURIComponent(`ov${suffix}-3`)}`,
        managerCookie,
      ),
    )
    expect(lower.total).toBe(0)

    const today = accraIsoDay()
    const yesterday = new Date(Date.parse(`${today}T00:00:00.000Z`) - 86_400_000)
      .toISOString()
      .slice(0, 10)
    const todayList = await readJson<{ sales: Array<{ id: string }> }>(
      await get(`/api/pos/oversight/sales?from=${today}&to=${today}`, managerCookie),
    )
    expect(todayList.sales.map((row) => row.id)).toContain(cashSaleId)
    const pastList = await readJson<{ sales: Array<{ id: string }> }>(
      await get(`/api/pos/oversight/sales?from=${yesterday}&to=${yesterday}`, managerCookie),
    )
    expect(pastList.sales).toHaveLength(0)

    // A reversed range is a client bug with a sentence, not an empty list.
    await expectError(
      await get(`/api/pos/oversight/sales?from=${today}&to=${yesterday}`, managerCookie),
      400,
      'VALIDATION_ERROR',
    )
  })

  it('returns a sale with its lines in order, its tenders in payment order and its refund', async () => {
    const response = await get(`/api/pos/oversight/sales/${splitSaleId}`, managerCookie)
    expect(response.status).toBe(200)
    const body = await readJson<{
      sale: { id: string; totalMinor: number; changeMinor: number; customerName: string | null }
      lines: Array<{ lineNumber: number; totalMinor: number }>
      tenders: Array<{ sequence: number; method: TenderMethod; amountMinor: number }>
      refunds: Array<{ id: string }>
      conflicts: Array<{ id: string }>
    }>(response)

    expect(body.sale.id).toBe(splitSaleId)
    expect(body.lines).toHaveLength(1)
    expect(body.tenders.map((tender) => tender.method)).toEqual(['CASH', 'CARD', 'MOMO'])
    expect(body.tenders.map((tender) => tender.sequence)).toEqual([1, 2, 3])
    expect(body.refunds).toHaveLength(0)
    expect(body.conflicts).toEqual([])
    // Σ tenders − change is the sale's own total, on the rows themselves.
    const tendered = body.tenders.reduce((sum, tender) => sum + tender.amountMinor, 0)
    expect(tendered - body.sale.changeMinor).toBe(body.sale.totalMinor)
    expect(body.sale.customerName).toBe('Oversight Customer')

    const refunded = await readJson<{ refunds: Array<{ id: string }> }>(
      await get(`/api/pos/oversight/sales/${cashSaleId}`, managerCookie),
    )
    expect(refunded.refunds.map((item) => item.id)).toEqual([largeRefundId])
  })

  it('renders a receipt copy whose lines and tenders reconcile to the sale', async () => {
    const response = await get(`/api/pos/oversight/sales/${splitSaleId}/receipt`, managerCookie)
    expect(response.status).toBe(200)
    const body = await readJson<{
      header: {
        seller: string
        receiptNumber: string
        isCopy: boolean
        reprint: boolean
        customer: { name: string; phoneMasked: string } | null
      }
      lines: Array<{ totalMinor: number; taxTotalMinor: number }>
      tenders: Array<{ amountMinor: number }>
      totals: { totalMinor: number; taxTotalMinor: number }
      tenderedMinor: number
      changeMinor: number
    }>(response)

    const stored = (await db.select().from(sale).where(eq(sale.id, splitSaleId)))[0]
    const lineTotal = body.lines.reduce((sum, line) => sum + line.totalMinor, 0)
    const tenderTotal = body.tenders.reduce((sum, tender) => sum + tender.amountMinor, 0)

    // The two identities the copy exists to make provable.
    expect(lineTotal).toBe(stored?.totalMinor)
    expect(tenderTotal - body.changeMinor).toBe(stored?.totalMinor)
    expect(body.totals.totalMinor).toBe(stored?.totalMinor)
    expect(body.totals.taxTotalMinor).toBe(stored?.taxTotalMinor)
    expect(body.tenderedMinor).toBe(tenderTotal)
    expect(body.changeMinor).toBe(stored?.changeMinor)

    // A copy, and labelled as one.
    expect(body.header.isCopy).toBe(true)
    expect(body.header.reprint).toBe(false)
    expect(body.header.receiptNumber).toBe(stored?.receiptNumber)
    expect(body.header.seller.length).toBeGreaterThan(0)

    // The phone is masked server-side and the full number is nowhere in the bytes.
    const digits = customerPhone.replace(/\D/g, '')
    expect(body.header.customer?.phoneMasked).toBe(`•••• ${digits.slice(-4)}`)
    const serialized = JSON.stringify(body)
    expect(serialized).not.toContain(customerPhone)
    expect(serialized).not.toContain(digits)
  })

  it('has no customer and no certificate until one is certified, then carries GRA bytes', async () => {
    const before = await readJson<{ header: { customer: unknown }; evat: unknown }>(
      await get(`/api/pos/oversight/sales/${cashSaleId}/receipt`, managerCookie),
    )
    expect(before.header.customer).toBeNull()
    expect(before.evat).toBeNull()

    const certifiedAt = new Date('2026-10-27T10:30:00.000Z')
    await db.insert(evatSubmission).values({
      kind: 'INVOICE',
      branchId: home.branchId,
      terminalId: home.terminalId,
      saleId: cashSaleId,
      status: 'CERTIFIED',
      dueAt: new Date('2026-10-28T09:00:00.000Z'),
      provider: 'mock',
      providerInvoiceNumber: 'INV-OV-1',
      sdcId: 'SDC-OV-1',
      serial: 'SER-OV-1',
      signature: 'SIG-OV-1',
      internalData: 'INT-OV-1',
      machineCode: 'MRC-OV-1',
      stampedAt: certifiedAt,
      qrPayload: 'qr-payload-fixture',
      certifiedAt,
    })

    const after = await readJson<{
      evat: {
        providerInvoiceNumber: string
        sdcId: string
        serial: string
        signature: string
        internalData: string
        machineCode: string
        stampedAt: string
        qrPayload: string
      } | null
    }>(await get(`/api/pos/oversight/sales/${cashSaleId}/receipt`, managerCookie))

    // GRA's bytes, returned as stored: the API never composes a QR payload.
    expect(after.evat).toMatchObject({
      providerInvoiceNumber: 'INV-OV-1',
      sdcId: 'SDC-OV-1',
      serial: 'SER-OV-1',
      signature: 'SIG-OV-1',
      internalData: 'INT-OV-1',
      machineCode: 'MRC-OV-1',
      stampedAt: certifiedAt.toISOString(),
      qrPayload: 'qr-payload-fixture',
    })
    // Certification never touched the document (P14-D34).
    const stored = (await db.select().from(sale).where(eq(sale.id, cashSaleId)))[0]
    expect(stored?.totalMinor).toBe(50_000)
  })

  it('serves a closed shift the stored Z, identical to the device route', async () => {
    const sessionResponse = await get(
      `/api/pos/oversight/shifts/${homeShiftId}/report?kind=Z`,
      managerCookie,
    )
    expect(sessionResponse.status).toBe(200)
    const sessionBody = await readJson<{ report: Record<string, unknown> }>(sessionResponse)

    const deviceResponse = await getDevice(
      `/api/pos/shifts/${homeShiftId}/report?kind=Z`,
      home.accessToken,
    )
    expect(deviceResponse.status).toBe(200)
    const deviceBody = await readJson<{ report: Record<string, unknown> }>(deviceResponse)

    // One arithmetic, two gates: the same bytes, not two implementations that
    // happen to agree today.
    expect(sessionBody.report).toEqual(deviceBody.report)

    // And those figures are the snapshot's own, not a recomputation that matches.
    const snapshot = (
      await db.select().from(shiftReport).where(eq(shiftReport.shiftId, homeShiftId))
    )[0]
    expect(sessionBody.report.grossMinor).toBe(snapshot?.grossMinor)
    expect(sessionBody.report.refundMinor).toBe(snapshot?.refundMinor)
    expect(sessionBody.report.expectedCashMinor).toBe(snapshot?.expectedCashMinor)
    expect(sessionBody.report.expectedCashMinor).toBe(countedCashMinor)
  })

  it('lists the voids a shift contains, with their reasons and their value', async () => {
    const response = await get(`/api/pos/oversight/shifts/${homeShiftId}`, managerCookie)
    expect(response.status).toBe(200)
    const body = await readJson<{
      voids: {
        count: number
        itemCount: number
        grossMinor: number
        rows: Array<{
          reasonCode: string
          reasonLabel: string
          label: string | null
          itemCount: number
          grossMinor: number
          occurredAt: string
        }>
      }
      shift: { id: string; status: string }
    }>(response)

    expect(body.shift.id).toBe(homeShiftId)
    expect(body.voids.count).toBe(2)
    expect(body.voids.itemCount).toBe(3)
    expect(body.voids.grossMinor).toBe(5_000)
    expect(body.voids.rows.map((row) => row.reasonCode)).toEqual([
      'CUSTOMER_CHANGED_MIND',
      'WRONG_ITEM',
    ])
    expect(body.voids.rows[0]).toMatchObject({
      reasonLabel: 'Customer changed their mind',
      label: 'Walk-in',
      itemCount: 2,
      grossMinor: 4_000,
    })
    expect(body.voids.rows[1]).toMatchObject({ label: null, itemCount: 1, grossMinor: 1_000 })
    expect(body.voids.rows[0]?.occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/)

    // The Z's own void count agrees with the list it came from.
    const report = await readJson<{ report: { voidCount: number } }>(
      await get(`/api/pos/oversight/shifts/${homeShiftId}/report?kind=Z`, managerCookie),
    )
    expect(report.report.voidCount).toBe(body.voids.count)
  })

  it('refuses to rebuild a missing Z and leaves the shift without one', async () => {
    const stored = await get(`/api/pos/oversight/shifts/${missingReportShiftId}`, managerCookie)
    expect(stored.status).toBe(200)
    const storedBody = await readJson<{ reportState: string; report: { kind: string } | null }>(
      stored,
    )
    expect(storedBody.reportState).toBe('STORED')
    expect(storedBody.report?.kind).toBe('Z')

    // The only way to have a closed shift without its snapshot is to take it away.
    await db.delete(shiftReport).where(eq(shiftReport.shiftId, missingReportShiftId))

    await expectError(
      await get(`/api/pos/oversight/shifts/${missingReportShiftId}/report?kind=Z`, managerCookie),
      500,
      'SHIFT_REPORT_MISSING',
    )
    const rows = await db
      .select()
      .from(shiftReport)
      .where(eq(shiftReport.shiftId, missingReportShiftId))
    expect(rows).toHaveLength(0)

    // The detail names the gap rather than inventing a report.
    const detail = await readJson<{ reportState: string; report: unknown }>(
      await get(`/api/pos/oversight/shifts/${missingReportShiftId}`, managerCookie),
    )
    expect(detail.reportState).toBe('MISSING')
    expect(detail.report).toBeNull()
  })

  it('computes an X live and writes no report row', async () => {
    const before = await shiftReportCount()
    const response = await get(
      `/api/pos/oversight/shifts/${homeShiftId}/report?kind=X`,
      managerCookie,
    )
    expect(response.status).toBe(200)
    const body = await readJson<{
      report: {
        kind: string
        closedAt: string | null
        expectedCashMinor: number
        countedCashMinor: number | null
        varianceMinor: number | null
      }
    }>(response)

    expect(body.report.kind).toBe('X')
    // A closed shift's X is still a live reading, with the close in the document.
    expect(body.report.closedAt).not.toBeNull()
    expect(body.report.expectedCashMinor).toBe(countedCashMinor)
    expect(body.report.countedCashMinor).toBe(countedCashMinor)
    expect(body.report.varianceMinor).toBe(0)
    expect(await shiftReportCount()).toBe(before)
  })

  it('keeps the device gate exactly as Phase 13 shipped it', async () => {
    // Another terminal's shift is not found at all (P13-D39).
    await expectError(
      await getDevice(`/api/pos/shifts/${foreignShiftId}/report?kind=Z`, home.accessToken),
      404,
      'NOT_FOUND',
    )
    // A Z of an open shift stays a 409.
    await expectError(
      await getDevice(`/api/pos/shifts/${foreignShiftId}/report?kind=Z`, other.accessToken),
      409,
      'SHIFT_NOT_CLOSED',
    )
    // The session gate answers 403 for the same shift: a manager may know that a
    // drawer exists elsewhere, and the shift id is not evidence of access.
    await expectError(
      await get(`/api/pos/oversight/shifts/${foreignShiftId}/report?kind=Z`, managerCookie),
      403,
      'FORBIDDEN',
    )
    // An admin reads the other branch, and an open shift's X is live.
    const admin = await readJson<{ report: { kind: string; closedAt: string | null } }>(
      await get(`/api/pos/oversight/shifts/${foreignShiftId}/report?kind=X`, adminCookie),
    )
    expect(admin.report.kind).toBe('X')
    expect(admin.report.closedAt).toBeNull()
  })

  it('lists refunds of any amount, above and below the approval threshold', async () => {
    const response = await get('/api/pos/oversight/refunds', managerCookie)
    expect(response.status).toBe(200)
    const body = await readJson<{
      refunds: Array<{
        id: string
        refundedMinor: number
        approvalId: string | null
        tenderCount: number
        hasPendingTender: boolean
        approvedBy: string | null
        receiptNumber: string
      }>
    }>(response)

    const byId = new Map(body.refunds.map((row) => [row.id, row]))
    const large = byId.get(largeRefundId)
    const small = byId.get(smallRefundId)
    // The GH₵500.00 refund raised an approval; the GH₵50.00 one did not, and is
    // listed anyway — that gap is why this list exists.
    expect(large?.refundedMinor).toBe(50_000)
    expect(large?.approvalId).not.toBeNull()
    expect(small?.refundedMinor).toBe(5_000)
    expect(small?.approvalId).toBeNull()
    expect(small?.tenderCount).toBe(1)
    expect(small?.hasPendingTender).toBe(false)
    expect(small?.approvedBy).toBe('Test User')
    expect(small?.receiptNumber).toBe(`OV${suffix}-2`)

    const filtered = await readJson<{ refunds: Array<{ id: string }> }>(
      await get('/api/pos/oversight/refunds?method=CASH&tenderStatus=SETTLED', managerCookie),
    )
    expect(filtered.refunds.map((row) => row.id)).toContain(smallRefundId)
    const cardOnly = await readJson<{ refunds: Array<{ id: string }> }>(
      await get('/api/pos/oversight/refunds?method=CARD', managerCookie),
    )
    expect(cardOnly.refunds).toHaveLength(0)
  })

  it('returns a refund with its restock decisions and settled tenders', async () => {
    const response = await get(`/api/pos/oversight/refunds/${largeRefundId}`, managerCookie)
    expect(response.status).toBe(200)
    const body = await readJson<{
      refund: { id: string; refundedMinor: number; note: string | null; approvedAt: string }
      lines: Array<{ restock: string; damageReason: string | null; quantity: number }>
      tenders: Array<{ method: string; status: string; settledAt: string | null }>
    }>(response)

    expect(body.refund.id).toBe(largeRefundId)
    expect(body.refund.refundedMinor).toBe(50_000)
    expect(body.lines).toHaveLength(1)
    expect(body.lines[0]?.restock).toBe('RESALABLE')
    expect(body.lines[0]?.quantity).toBe(5)
    expect(body.tenders).toHaveLength(1)
    expect(body.tenders[0]?.method).toBe('CASH')
    expect(body.tenders[0]?.status).toBe('SETTLED')
    expect(body.tenders[0]?.settledAt).not.toBeNull()

    await expectError(
      await get(`/api/pos/oversight/refunds/${crypto.randomUUID()}`, managerCookie),
      404,
      'NOT_FOUND',
    )
  })

  it('lists shifts by branch, status and review state', async () => {
    const response = await get('/api/pos/oversight/shifts', managerCookie)
    expect(response.status).toBe(200)
    const body = await readJson<{
      shifts: Array<{
        id: string
        branchId: string
        status: string
        hasReport: boolean
        countedCashMinor: number | null
        varianceMinor: number | null
      }>
    }>(response)

    expect(body.shifts.map((row) => row.id)).toContain(homeShiftId)
    expect(body.shifts.map((row) => row.id)).not.toContain(foreignShiftId)
    const homeShift = body.shifts.find((row) => row.id === homeShiftId)
    expect(homeShift?.status).toBe('CLOSED')
    expect(homeShift?.hasReport).toBe(true)
    expect(homeShift?.countedCashMinor).toBe(countedCashMinor)
    expect(homeShift?.varianceMinor).toBe(0)

    const open = await readJson<{ shifts: Array<{ id: string; status: string }> }>(
      await get('/api/pos/oversight/shifts?status=OPEN', adminCookie),
    )
    expect(open.shifts.map((row) => row.id)).toContain(foreignShiftId)
    expect(open.shifts.map((row) => row.id)).not.toContain(homeShiftId)

    const reviewed = await readJson<{ shifts: Array<{ id: string }> }>(
      await get('/api/pos/oversight/shifts?reviewStatus=REQUIRED', adminCookie),
    )
    expect(reviewed.shifts).toHaveLength(0)
  })

  it('denies a cashier and refuses an unauthenticated call', async () => {
    await expectError(await get('/api/pos/oversight/sales', cashierCookie), 403, 'FORBIDDEN')
    const anonymous = await app.request('/api/pos/oversight/sales')
    expect(anonymous.status).toBe(401)
  })

  it('rate limits one user to 120 oversight reads a minute', async () => {
    let limited = 0
    for (let attempt = 0; attempt < 125; attempt += 1) {
      const response = await get('/api/pos/oversight/refunds?limit=1', rateLimitCookie)
      if (response.status === 429) {
        limited = attempt
        break
      }
      expect(response.status).toBe(200)
    }
    expect(limited).toBeGreaterThanOrEqual(120)
  })
})
