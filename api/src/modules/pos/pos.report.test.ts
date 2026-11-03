import { readFileSync } from 'node:fs'
import { db } from '@sceptre/db'
import { priceCart, type TenderMethod, tenderBalance } from '@sceptre/shared'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { reconcileStalePayments } from '../../jobs/queues.ts'
import { approval } from '../approvals/approvals.schema.ts'
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
import { earnPointsForSale, quoteRedeem } from '../loyalty/loyalty.service.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { getMockCallCounts, settleMockPayment } from '../payments/payments.mock.provider.ts'
import { payment } from '../payments/payments.schema.ts'
import { createPayment, getPayment } from '../payments/payments.service.ts'
import { product } from '../products/products.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { reconcileShifts } from './pos.reconciliation.ts'
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
import type { ShiftCloseWithCloser } from './pos.service.ts'
import {
  applyCartVoid,
  applyRefund,
  applySale,
  closeShift,
  recordCashMovement,
} from './pos.service.ts'
import type { OverrideProof, SalePayload } from './pos.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[pos.report.test] database unavailable; integration tests skipped')

/**
 * The X-report, the Z-report and the sweep that stops a payment going missing
 * (Plan 13-07, P13-D32 … P13-D35).
 *
 * The fixture is built through the real write paths — `applySale`, `applyRefund`,
 * `applyCartVoid`, `recordCashMovement` — and every snapshot column is compared
 * against plain SQL written here, not against the function under test. A report
 * that agrees with itself has proved nothing.
 */
describe.skipIf(!available)('POS shift reports', () => {
  const suffix = randomToken(4)
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUomIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdSaleIds: string[] = []
  const createdRefundIds: string[] = []
  const createdPaymentIds: string[] = []

  let branchId = ''
  let terminalId = ''
  let deviceId = ''
  let deviceToken = ''
  let accessToken = ''
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
  let customerId = ''
  let customerPhone = ''
  let receiptSequence = 0
  let countedCashMinor = 0
  let xBefore: Record<string, unknown> = {}

  const openingFloatMinor = 50_000
  const cashInMinor = 4_000
  const cashOutMinor = 1_500

  /**
   * What the till handed over, recorded here as each sale is built. The report's
   * tender columns must equal these figures — they are the one part of the
   * oracle that does not come from the database at all.
   */
  const handed = {
    gross: 0,
    itemCount: 0,
    change: 0,
    cashRefunds: 0,
    tender: { CASH: 0, CREDIT: 0, MOMO: 0, CARD: 0, BANK_TRANSFER: 0 } as Record<
      TenderMethod,
      number
    >,
  }

  const deviceContext = (): DeviceAuthContext => ({ deviceId, terminalId, branchId })

  function saleContext() {
    const clientTransactionId = crypto.randomUUID()
    createdSaleIds.push(clientTransactionId)
    return {
      clientTransactionId,
      device: deviceContext(),
      receivedAt: new Date(),
      clockSkewToleranceMinutes: 10,
    }
  }

  interface SaleSpec {
    lines: Array<{
      productId: string
      quantity: number
      unitPriceMinor: number
      lineDiscountMinor?: number
    }>
    saleDiscountMinor?: number
    loyalty?: { redeemPoints: number; discountMinor: number; earnPreviewPoints: number }
    tenders: Array<{ method: TenderMethod; amountMinor: number; paymentId?: string }>
    customer?: { id: string; phone: string; name: string }
  }

  async function createSale(spec: SaleSpec): Promise<string> {
    receiptSequence += 1
    const lines = spec.lines.map((line) => ({
      productId: line.productId,
      quantity: line.quantity,
      unitPriceMinor: line.unitPriceMinor,
      lineDiscountMinor: line.lineDiscountMinor ?? 0,
      taxCategory: 'STANDARD' as const,
    }))

    const priced = priceCart(
      lines.map((line) => ({ ...line, name: '', sku: '' })),
      {
        taxMode: 'INCLUSIVE',
        saleDiscountMinor: spec.saleDiscountMinor ?? 0,
        loyaltyDiscountMinor: spec.loyalty?.discountMinor ?? 0,
      },
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
      customer: spec.customer ?? null,
      lines,
      saleDiscount: spec.saleDiscountMinor
        ? { amountMinor: spec.saleDiscountMinor, reasonCode: 'PROMO', note: null }
        : null,
      loyalty: spec.loyalty
        ? {
            redeemPoints: spec.loyalty.redeemPoints,
            earnPreviewPoints: spec.loyalty.earnPreviewPoints,
          }
        : null,
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

    const ctx = saleContext()
    await db.transaction((tx) => applySale(ctx, payload, tx))

    handed.gross += priced.totalMinor
    handed.change += balance.changeMinor
    handed.itemCount += spec.lines.reduce((sum, line) => sum + line.quantity, 0)
    for (const tender of spec.tenders) {
      handed.tender[tender.method] += tender.amountMinor
    }

    return ctx.clientTransactionId
  }

  /** A settled electronic payment, created and verified through the real paths. */
  async function electronicPayment(
    method: 'MOMO' | 'CARD' | 'BANK_TRANSFER',
    amountMinor: number,
  ): Promise<string> {
    const created = await createPayment(deviceContext(), {
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
    const settled = await getPayment(deviceContext(), created.id, { refresh: true })
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

  async function salesLinesFor(saleId: string) {
    return db.select().from(saleLine).where(eq(saleLine.saleId, saleId))
  }

  async function saleTendersFor(saleId: string) {
    return db
      .select()
      .from(saleTender)
      .where(eq(saleTender.saleId, saleId))
      .orderBy(saleTender.sequence)
  }

  /**
   * The independent oracle: the same figures as plain SQL, one scalar subselect
   * per column. It is deliberately a different shape from the repository's
   * cross-joined CTEs, so a mistake in either shows up as a disagreement.
   */
  const FIGURE_FIELDS = [
    'saleCount',
    'itemCount',
    'refundCount',
    'voidCount',
    'grossMinor',
    'refundMinor',
    'lineDiscountMinor',
    'saleDiscountMinor',
    'loyaltyDiscountMinor',
    'loyaltyRedeemPoints',
    'loyaltyEarnedPoints',
    'baseMinor',
    'vatMinor',
    'nhilMinor',
    'getfundMinor',
    'taxTotalMinor',
    'cashMinor',
    'creditMinor',
    'momoMinor',
    'cardMinor',
    'bankTransferMinor',
    'changeMinor',
    'cashInMinor',
    'cashOutMinor',
    'expectedCashMinor',
  ] as const

  type Oracle = { [K in (typeof FIGURE_FIELDS)[number]]: number }

  async function recomputeShift(id: string): Promise<Oracle> {
    const result = await db.execute<Record<string, number>>(sql`
      SELECT
        (SELECT COUNT(*)::int FROM sale WHERE shift_id = ${id}) AS "saleCount",
        (SELECT COALESCE(SUM(sl.quantity), 0)::int
           FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
          WHERE s.shift_id = ${id}) AS "itemCount",
        (SELECT COUNT(*)::int FROM refund WHERE shift_id = ${id}) AS "refundCount",
        (SELECT COUNT(*)::int FROM cart_void WHERE shift_id = ${id}) AS "voidCount",
        (SELECT COALESCE(SUM(total_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "grossMinor",
        (SELECT COALESCE(SUM(refunded_minor), 0)::int FROM refund WHERE shift_id = ${id})
          AS "refundMinor",
        (SELECT COALESCE(SUM(line_discount_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "lineDiscountMinor",
        (SELECT COALESCE(SUM(sale_discount_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "saleDiscountMinor",
        (SELECT COALESCE(SUM(loyalty_discount_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "loyaltyDiscountMinor",
        (SELECT COALESCE(SUM(loyalty_redeem_points), 0)::int FROM sale WHERE shift_id = ${id})
          AS "loyaltyRedeemPoints",
        (SELECT COALESCE(SUM(loyalty_earned_points), 0)::int FROM sale WHERE shift_id = ${id})
          AS "loyaltyEarnedPoints",
        (SELECT COALESCE(SUM(sl.base_minor), 0)::int
           FROM sale_line sl JOIN sale s ON s.id = sl.sale_id
          WHERE s.shift_id = ${id}) AS "baseMinor",
        (SELECT COALESCE(SUM(vat_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "vatMinor",
        (SELECT COALESCE(SUM(nhil_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "nhilMinor",
        (SELECT COALESCE(SUM(getfund_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "getfundMinor",
        (SELECT COALESCE(SUM(tax_total_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "taxTotalMinor",
        (SELECT COALESCE(SUM(st.amount_minor), 0)::int
           FROM sale_tender st JOIN sale s ON s.id = st.sale_id
          WHERE s.shift_id = ${id} AND st.method = 'CASH') AS "cashMinor",
        (SELECT COALESCE(SUM(st.amount_minor), 0)::int
           FROM sale_tender st JOIN sale s ON s.id = st.sale_id
          WHERE s.shift_id = ${id} AND st.method = 'CREDIT') AS "creditMinor",
        (SELECT COALESCE(SUM(st.amount_minor), 0)::int
           FROM sale_tender st JOIN sale s ON s.id = st.sale_id
          WHERE s.shift_id = ${id} AND st.method = 'MOMO') AS "momoMinor",
        (SELECT COALESCE(SUM(st.amount_minor), 0)::int
           FROM sale_tender st JOIN sale s ON s.id = st.sale_id
          WHERE s.shift_id = ${id} AND st.method = 'CARD') AS "cardMinor",
        (SELECT COALESCE(SUM(st.amount_minor), 0)::int
           FROM sale_tender st JOIN sale s ON s.id = st.sale_id
          WHERE s.shift_id = ${id} AND st.method = 'BANK_TRANSFER') AS "bankTransferMinor",
        (SELECT COALESCE(SUM(change_minor), 0)::int FROM sale WHERE shift_id = ${id})
          AS "changeMinor",
        (SELECT COALESCE(SUM(amount_minor), 0)::int FROM cash_movement
          WHERE shift_id = ${id} AND type = 'CASH_IN') AS "cashInMinor",
        (SELECT COALESCE(SUM(amount_minor), 0)::int FROM cash_movement
          WHERE shift_id = ${id} AND type = 'CASH_OUT') AS "cashOutMinor",
        (SELECT opening_float_minor + COALESCE((
            SELECT SUM(st.amount_minor) FROM sale_tender st
            JOIN sale s ON s.id = st.sale_id
            WHERE s.shift_id = ${id} AND st.method = 'CASH'
          ), 0)
          - COALESCE((SELECT SUM(change_minor) FROM sale WHERE shift_id = ${id}), 0)
          + COALESCE((SELECT SUM(cm.amount_minor) FROM cash_movement cm
              WHERE cm.shift_id = ${id} AND cm.type = 'CASH_IN'), 0)
          - COALESCE((SELECT SUM(cm.amount_minor) FROM cash_movement cm
              WHERE cm.shift_id = ${id} AND cm.type = 'CASH_OUT'), 0)
          - COALESCE((SELECT SUM(rt.amount_minor) FROM refund_tender rt
              JOIN refund r ON r.id = rt.refund_id
              WHERE r.shift_id = ${id} AND rt.method = 'CASH' AND rt.status = 'SETTLED'), 0)
          FROM shift WHERE id = ${id})::int AS "expectedCashMinor"
    `)
    const row = result.rows[0] as Oracle | undefined
    if (!row) throw new Error('the oracle returned no row')
    return row
  }

  /** Compares every figure column of a report against the oracle, one by one. */
  function expectFiguresMatch(report: Record<string, unknown>, oracle: Oracle): void {
    for (const field of FIGURE_FIELDS) {
      expect(report[field], field).toBe(oracle[field])
    }
  }

  async function shiftReportRows(id: string) {
    return db.select().from(shiftReport).where(eq(shiftReport.shiftId, id))
  }

  async function reportRequest(id: string, kind: string, token = accessToken) {
    return app.request(`/api/pos/shifts/${id}/report?kind=${kind}`, {
      headers: { authorization: `Bearer ${token}` },
    })
  }

  async function readJson<T>(response: Response): Promise<T> {
    return (await response.json()) as T
  }

  function closePayload(countedCashMinor: number, expectedCashMinor: number): ShiftCloseWithCloser {
    return {
      shiftId,
      countedCashMinor,
      clientExpectedCashMinor: expectedCashMinor,
      occurredAt: new Date('2026-10-27T18:00:00Z').toISOString(),
    }
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: `P${suffix}`, name: `Report ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `P${suffix}-T01`, name: 'Report Counter' })
      .returning()
    terminalId = terminalRow[0]?.id ?? ''

    deviceToken = randomToken(40)
    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `report-${suffix}`,
        tokenHash: hashDeviceToken(deviceToken),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    deviceId = deviceRow[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Report Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)

    const uomRow = await db
      .insert(uom)
      .values({ code: `PU${suffix}`, name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const products = await db
      .insert(product)
      .values([
        {
          sku: `PA-${suffix}`,
          name: `Report A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 1_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `PB-${suffix}`,
          name: `Report B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 3_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `PC-${suffix}`,
          name: `Report C ${suffix}`,
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
      { productId: productA, branchId, quantityOnHand: 100, avgCostMinor: 600 },
      { productId: productB, branchId, quantityOnHand: 100, avgCostMinor: 1_800 },
      { productId: productC, branchId, quantityOnHand: 100, avgCostMinor: 6_000 },
    ])

    customerPhone = `+23320${String(Date.now()).slice(-7)}`
    const customerRow = await db
      .insert(customer)
      .values({ name: 'Report Customer', phone: customerPhone, createdBranchId: branchId })
      .returning()
    customerId = customerRow[0]?.id ?? ''
    createdCustomerIds.push(customerId)

    // A loyalty balance the fixture can actually spend, granted through the
    // ledger and a lot rather than by moving a number on the account (D7).
    const accountRow = await db.insert(loyaltyAccount).values({ customerId }).returning()
    const accountId = accountRow[0]?.id ?? ''
    const earnEntry = await db
      .insert(loyaltyLedgerEntry)
      .values({
        accountId,
        customerId,
        branchId,
        kind: 'EARN',
        pointsDelta: 500,
        referenceType: 'TEST_GRANT',
        occurredAt: new Date('2026-10-20T09:00:00Z'),
      })
      .returning()
    await db.insert(loyaltyLot).values({
      accountId,
      earnEntryId: earnEntry[0]?.id ?? '',
      points: 500,
      remainingPoints: 500,
      expiresAt: new Date(Date.now() + 365 * 86_400_000),
    })
    await db
      .update(loyaltyAccount)
      .set({ balancePoints: 500 })
      .where(eq(loyaltyAccount.id, accountId))
    await db.insert(creditProfile).values({ customerId, branchId, limitMinor: 50_000 })

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `SD-PC${suffix.slice(0, 2)}`
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
    managerStaffId = `SD-PM${suffix.slice(0, 2)}`
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

    const shiftRow = await db
      .insert(shift)
      .values({
        number: `RP-${suffix}-S-01`,
        branchId,
        terminalId,
        deviceId,
        cashierUserId,
        cashierStaffId,
        status: 'OPEN',
        openedAt: new Date('2026-10-27T08:00:00Z'),
        openingFloatMinor,
        openedBy: cashierStaffId,
      })
      .returning()
    shiftId = shiftRow[0]?.id ?? ''

    // A device JWT, minted the way a terminal mints one.
    const sessionResponse = await app.request('/api/pos/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${deviceToken}` },
    })
    expect(sessionResponse.status).toBe(200)
    const session = await readJson<{ accessToken: string }>(sessionResponse)
    accessToken = session.accessToken

    // 1. Cash with change: 30.00 rung up, 50.00 handed over.
    await createSale({
      lines: [{ productId: productB, quantity: 1, unitPriceMinor: 3_000 }],
      tenders: [{ method: 'CASH', amountMinor: 5_000 }],
    })

    // 2. Cash with a line discount, a sale discount and a loyalty redemption.
    const redeemPoints = 100
    const redemption = await quoteRedeem(redeemPoints)
    const loyaltyLines = [
      { productId: productA, quantity: 3, unitPriceMinor: 1_000, lineDiscountMinor: 300 },
    ]
    const loyaltyPriced = priceCart(
      loyaltyLines.map((line) => ({
        ...line,
        name: '',
        sku: '',
        taxCategory: 'STANDARD' as const,
      })),
      {
        taxMode: 'INCLUSIVE',
        saleDiscountMinor: 200,
        loyaltyDiscountMinor: redemption.discountMinor,
      },
    )
    await createSale({
      lines: loyaltyLines,
      saleDiscountMinor: 200,
      loyalty: {
        redeemPoints,
        discountMinor: redemption.discountMinor,
        earnPreviewPoints: await earnPointsForSale(loyaltyPriced.baseMinor),
      },
      tenders: [{ method: 'CASH', amountMinor: loyaltyPriced.totalMinor }],
      customer: { id: customerId, phone: customerPhone, name: 'Report Customer' },
    })

    // 3. Three tenders on one 100.00 sale: cash, credit and card.
    const cardId = await electronicPayment('CARD', 4_000)
    await createSale({
      lines: [{ productId: productC, quantity: 1, unitPriceMinor: 10_000 }],
      tenders: [
        { method: 'CASH', amountMinor: 3_000 },
        { method: 'CREDIT', amountMinor: 3_000 },
        { method: 'CARD', amountMinor: 4_000, paymentId: cardId },
      ],
      customer: { id: customerId, phone: customerPhone, name: 'Report Customer' },
    })

    // 4. Mobile money and a bank transfer.
    const momoId = await electronicPayment('MOMO', 1_200)
    const bankId = await electronicPayment('BANK_TRANSFER', 800)
    await createSale({
      lines: [{ productId: productA, quantity: 2, unitPriceMinor: 1_000 }],
      tenders: [
        { method: 'MOMO', amountMinor: 1_200, paymentId: momoId },
        { method: 'BANK_TRANSFER', amountMinor: 800, paymentId: bankId },
      ],
    })

    // A refund against the first sale, with the goods going back on the shelf.
    const saleTwoLines = await salesLinesFor(createdSaleIds[0] ?? '')
    const saleTwoTenders = await saleTendersFor(createdSaleIds[0] ?? '')
    const refundId = crypto.randomUUID()
    createdRefundIds.push(refundId)
    const refundLineRow = saleTwoLines[0]
    const refundTenderRow = saleTwoTenders[0]
    if (!refundLineRow || !refundTenderRow) throw new Error('the fixture sale is incomplete')

    await db.transaction((tx) =>
      applyRefund(
        {
          clientTransactionId: refundId,
          device: deviceContext(),
          receivedAt: new Date(),
          clockSkewToleranceMinutes: 10,
        },
        {
          saleId: refundLineRow.saleId,
          number: `RF-RP-${suffix}-01`,
          shiftId,
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
            { saleLineId: refundLineRow.id, quantity: 1, restock: 'RESALABLE', damageReason: null },
          ],
          tenders: [{ saleTenderId: refundTenderRow.id, amountMinor: refundLineRow.totalMinor }],
          refundedMinor: refundLineRow.totalMinor,
          occurredAt: new Date().toISOString(),
        },
        tx,
      ),
    )
    if (refundTenderRow.method === 'CASH') handed.cashRefunds += refundLineRow.totalMinor

    // A cart that never became a sale, and the drawer's two manual movements.
    const voidId = crypto.randomUUID()
    await db.transaction((tx) =>
      applyCartVoid(
        {
          clientTransactionId: voidId,
          device: deviceContext(),
          receivedAt: new Date(),
          clockSkewToleranceMinutes: 10,
        },
        {
          shiftId,
          cashier: {
            userId: cashierUserId,
            staffId: cashierStaffId,
            bindingId: cashierBindingId,
            bindingToken: cashierToken,
            pinVersion: 1,
          },
          reasonCode: 'CUSTOMER_CHANGED_MIND',
          note: null,
          itemCount: 2,
          grossMinor: 4_000,
          label: 'Walk-in',
          lines: [
            { productId: productA, name: 'Report A', quantity: 1, unitPriceMinor: 1_000 },
            { productId: productB, name: 'Report B', quantity: 1, unitPriceMinor: 3_000 },
          ],
          occurredAt: new Date().toISOString(),
        },
        tx,
      ),
    )

    await recordCashMovement(deviceContext(), {
      id: crypto.randomUUID(),
      shiftId,
      type: 'CASH_IN',
      amountMinor: cashInMinor,
      reason: 'Change float top-up',
      occurredAt: new Date().toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })
    await recordCashMovement(deviceContext(), {
      id: crypto.randomUUID(),
      shiftId,
      type: 'CASH_OUT',
      amountMinor: cashOutMinor,
      reason: 'Courier supplies',
      occurredAt: new Date().toISOString(),
      staffUserId: cashierUserId,
      staffStaffId: cashierStaffId,
    })
  })

  afterAll(async () => {
    if (!available) return
    await db.delete(shiftReport).where(eq(shiftReport.branchId, branchId))
    if (createdRefundIds.length > 0) {
      await db.delete(refundTender).where(inArray(refundTender.refundId, createdRefundIds))
      await db.delete(refundLine).where(inArray(refundLine.refundId, createdRefundIds))
      await db.delete(refund).where(inArray(refund.id, createdRefundIds))
    }
    await db.delete(approval).where(eq(approval.branchId, branchId))
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(cartVoid).where(eq(cartVoid.branchId, branchId))
    if (createdSaleIds.length > 0) {
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    await db.delete(cashMovement).where(eq(cashMovement.branchId, branchId))
    if (createdPaymentIds.length > 0) {
      await db.delete(payment).where(inArray(payment.id, createdPaymentIds))
    }
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
    await db
      .delete(creditLedgerEntry)
      .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
    await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
    await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.customerId, createdCustomerIds))
    await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
    await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    if (shiftId) await db.delete(shift).where(eq(shift.branchId, branchId))
    if (deviceId) await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, deviceId))
    if (deviceId) await db.delete(device).where(eq(device.id, deviceId))
    if (terminalId) await db.delete(terminal).where(eq(terminal.id, terminalId))
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

  it('computes an X-report before the close and stores nothing', async () => {
    const before = await db.select({ value: sql<number>`count(*)::int` }).from(shiftReport)
    const oracle = await recomputeShift(shiftId)

    const response = await reportRequest(shiftId, 'X')
    expect(response.status).toBe(200)
    const { report } = await readJson<{ report: Record<string, unknown> }>(response)

    expect(report.kind).toBe('X')
    expect(report.shiftId).toBe(shiftId)
    expect(report.number).toBe(`RP-${suffix}-S-01`)
    expect(report.terminalId).toBe(terminalId)
    expect(report.branchId).toBe(branchId)
    expect(report.openingFloatMinor).toBe(openingFloatMinor)
    expect(report.generatedAt).toEqual(expect.any(String))
    // Nothing has been counted, so there is no variance to state.
    expect(report.closedAt).toBeNull()
    expect(report.countedCashMinor).toBeNull()
    expect(report.varianceMinor).toBeNull()
    expectFiguresMatch(report, oracle)

    // The tender columns are what the till handed over, which is the figure the
    // test recorded as it built each sale — not the report's own arithmetic.
    for (const method of ['CASH', 'CREDIT', 'MOMO', 'CARD', 'BANK_TRANSFER'] as const) {
      const column = {
        CASH: 'cashMinor',
        CREDIT: 'creditMinor',
        MOMO: 'momoMinor',
        CARD: 'cardMinor',
        BANK_TRANSFER: 'bankTransferMinor',
      }[method]
      expect(report[column], method).toBe(handed.tender[method])
    }
    expect(report.grossMinor).toBe(handed.gross)
    expect(report.changeMinor).toBe(handed.change)
    expect(report.itemCount).toBe(handed.itemCount)

    // An X-report is a question, not a document.
    const after = await db.select({ value: sql<number>`count(*)::int` }).from(shiftReport)
    expect(after[0]?.value).toBe(before[0]?.value)
    expect(await shiftReportRows(shiftId)).toHaveLength(0)

    // Kept for the Z comparison: the same shift, asked twice, must not drift.
    xBefore = report
  })

  it('refuses a Z-report for a shift that is still open', async () => {
    const response = await reportRequest(shiftId, 'Z')
    expect(response.status).toBe(409)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe('SHIFT_NOT_CLOSED')
  })

  it('settles a stranded pending payment once and leaves a paid one untouched', async () => {
    // The provider took the money; the webhook never arrived, so the row is still
    // PENDING and older than the sweep's ten-minute window.
    const stranded = await createPayment(deviceContext(), {
      method: 'CARD',
      amountMinor: 700,
      clientPaymentId: crypto.randomUUID(),
      shiftId,
    })
    createdPaymentIds.push(stranded.id)
    expect(settleMockPayment(stranded.providerReference, 'PAID')).toBe(true)

    // A payment the webhook settled: the sweep must not call the provider again.
    const settledByWebhook = await electronicPayment('CARD', 800)

    const twentyMinutesAgo = new Date(Date.now() - 20 * 60_000)
    await db
      .update(payment)
      .set({ createdAt: twentyMinutesAgo })
      .where(inArray(payment.id, [stranded.id, settledByWebhook]))

    const untouchedBefore = (
      await db.select().from(payment).where(eq(payment.id, settledByWebhook))
    )[0]
    expect(untouchedBefore?.status).toBe('PAID')

    const verifyCallsBefore = getMockCallCounts().verify
    const summary = await reconcileStalePayments()
    const verifyCalls = getMockCallCounts().verify - verifyCallsBefore

    expect(summary.failed).toBe(0)
    expect(summary.checked).toBeGreaterThanOrEqual(1)
    expect(summary.settled).toBeGreaterThanOrEqual(1)
    // One verify per candidate: the sweep neither double-checks a row nor
    // re-opens a settled one.
    expect(verifyCalls).toBe(summary.checked)

    const strandedAfter = (await db.select().from(payment).where(eq(payment.id, stranded.id)))[0]
    expect(strandedAfter?.status).toBe('PAID')

    const untouchedAfter = (
      await db.select().from(payment).where(eq(payment.id, settledByWebhook))
    )[0]
    expect(untouchedAfter?.status).toBe('PAID')
    expect(untouchedAfter?.lastVerifiedAt).toEqual(untouchedBefore?.lastVerifiedAt)
  })

  it('writes one immutable snapshot inside the close, equal to a hand recomputation', async () => {
    const oracle = await recomputeShift(shiftId)
    countedCashMinor = oracle.expectedCashMinor + 500

    const result = await closeShift(
      deviceContext(),
      closePayload(countedCashMinor, oracle.expectedCashMinor),
    )
    expect(result).toEqual({
      shiftId,
      serverExpectedCashMinor: oracle.expectedCashMinor,
      varianceMinor: 500,
    })

    const rows = await shiftReportRows(shiftId)
    expect(rows).toHaveLength(1)
    const snapshot = rows[0]
    if (!snapshot) throw new Error('the close wrote no report')

    expectFiguresMatch(snapshot, oracle)

    // The identities, stated again in the test even though the columns matched.
    expect(snapshot.netMinor).toBe(snapshot.grossMinor - snapshot.refundMinor)
    expect(snapshot.netMinor).toBe(handed.gross - oracle.refundMinor)
    expect(snapshot.refundCount).toBe(1)
    expect(snapshot.voidCount).toBe(1)

    // Cash is what was taken, not what was kept: change is its own column.
    expect(snapshot.cashMinor).toBe(handed.tender.CASH)
    expect(snapshot.changeMinor).toBe(handed.change)
    expect(snapshot.cashMinor - snapshot.changeMinor).toBe(handed.tender.CASH - handed.change)

    // Electronic money is electronic: cash and credit are not in it.
    expect(snapshot.momoMinor).toBe(1_200)
    expect(snapshot.cardMinor).toBe(4_000)
    expect(snapshot.bankTransferMinor).toBe(800)
    expect(snapshot.creditMinor).toBe(3_000)
    expect(snapshot.momoMinor + snapshot.cardMinor + snapshot.bankTransferMinor).toBe(6_000)

    // The drawer: float + cash − change + in − out − cash refunds, and counted
    // − expected. The refund is subtracted because that cash left the drawer.
    expect(snapshot.openingFloatMinor).toBe(openingFloatMinor)
    expect(snapshot.cashInMinor).toBe(cashInMinor)
    expect(snapshot.cashOutMinor).toBe(cashOutMinor)
    expect(snapshot.expectedCashMinor).toBe(
      openingFloatMinor +
        handed.tender.CASH -
        handed.change +
        cashInMinor -
        cashOutMinor -
        handed.cashRefunds,
    )
    expect(handed.cashRefunds).toBeGreaterThan(0)
    expect(snapshot.expectedCashMinor).toBe(oracle.expectedCashMinor)
    expect(snapshot.countedCashMinor).toBe(countedCashMinor)
    expect(snapshot.varianceMinor).toBe(countedCashMinor - snapshot.expectedCashMinor)
    expect(snapshot.closedAt.toISOString()).toBe('2026-10-27T18:00:00.000Z')
  })

  it('serves the stored snapshot for a Z and the same figures for an X', async () => {
    const snapshot = (await shiftReportRows(shiftId))[0]
    if (!snapshot) throw new Error('the close wrote no report')

    const zResponse = await reportRequest(shiftId, 'Z')
    expect(zResponse.status).toBe(200)
    const { report: z } = await readJson<{ report: Record<string, unknown> }>(zResponse)

    expect(z.kind).toBe('Z')
    expect(z.generatedAt).toBe(snapshot.createdAt.toISOString())
    for (const field of [
      ...FIGURE_FIELDS,
      'countedCashMinor',
      'varianceMinor',
      'shiftId',
      'number',
      'terminalId',
      'branchId',
      'openingFloatMinor',
      'netMinor',
    ] as const) {
      expect(z[field], field).toBe(snapshot[field as keyof typeof snapshot])
    }

    // An X after the close states the same numbers; only its timestamp differs.
    const xResponse = await reportRequest(shiftId, 'X')
    expect(xResponse.status).toBe(200)
    const { report: x } = await readJson<{ report: Record<string, unknown> }>(xResponse)
    const { kind: _xKind, generatedAt: _xAt, ...xFigures } = x
    const { kind: _zKind, generatedAt: _zAt, ...zFigures } = z
    expect(xFigures).toEqual(zFigures)

    // And the X taken before the close differs only in its timestamp, its close
    // time and the drawer it could not yet report (P13-D32, P13-D33).
    const {
      kind: _beforeKind,
      generatedAt: _beforeAt,
      closedAt: beforeClosedAt,
      countedCashMinor: beforeCounted,
      varianceMinor: beforeVariance,
      ...beforeFigures
    } = xBefore
    expect(beforeClosedAt).toBeNull()
    expect(beforeCounted).toBeNull()
    expect(beforeVariance).toBeNull()
    const {
      countedCashMinor: _zCounted,
      varianceMinor: _zVariance,
      closedAt: _zClosedAt,
      ...zOnly
    } = zFigures
    expect(beforeFigures).toEqual(zOnly)
  })

  it('keeps Phase 12 reconciliation at zero problems for the closed shift', async () => {
    const problems = await reconcileShifts(branchId)
    expect(problems.filter((problem) => problem.shiftId === shiftId)).toEqual([])
    expect(problems).toEqual([])
  })

  it('refuses a second close and neither adds nor changes a report', async () => {
    const before = (await shiftReportRows(shiftId))[0]

    await expect(
      closeShift(deviceContext(), closePayload(countedCashMinor, 60_900)),
    ).rejects.toMatchObject({ statusCode: 409 })

    const rows = await shiftReportRows(shiftId)
    expect(rows).toHaveLength(1)
    expect(rows[0]).toEqual(before)

    // There is no writer but the insert: a repository update of this table would
    // be a report that can be restated, which is the one thing it must not be.
    for (const file of ['pos.repository.ts', 'pos.service.ts']) {
      const source = readFileSync(new URL(file, import.meta.url), 'utf8')
      expect(source.includes('update(shiftReport)'), file).toBe(false)
    }
  })

  it('will not rebuild a missing Z-report, and says so with a code', async () => {
    // Test-only: the snapshot is deleted by hand to prove the read path does not
    // quietly recompute one (P13-D32).
    await db.delete(shiftReport).where(eq(shiftReport.shiftId, shiftId))

    const response = await reportRequest(shiftId, 'Z')
    expect(response.status).toBe(500)
    const body = await readJson<{ error: { code: string } }>(response)
    expect(body.error.code).toBe('SHIFT_REPORT_MISSING')

    // The X-report still answers, because it never depended on the snapshot.
    const xResponse = await reportRequest(shiftId, 'X')
    expect(xResponse.status).toBe(200)
    const { report } = await readJson<{ report: Record<string, unknown> }>(xResponse)
    expect(report.saleCount).toBe(4)
    expect(report.countedCashMinor).toBe(countedCashMinor)
  })

  it('scopes both reports to the device that owns the shift', async () => {
    const otherToken = randomToken(40)
    const otherTerminal = await db
      .insert(terminal)
      .values({ branchId, code: `P${suffix}-T02`, name: 'Other Counter' })
      .returning()
    const otherTerminalId = otherTerminal[0]?.id ?? ''
    const otherDevice = await db
      .insert(device)
      .values({
        terminalId: otherTerminalId,
        fingerprint: `report-other-${suffix}`,
        tokenHash: hashDeviceToken(otherToken),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const otherDeviceId = otherDevice[0]?.id ?? ''

    const sessionResponse = await app.request('/api/pos/session', {
      method: 'POST',
      headers: { authorization: `Bearer ${otherToken}` },
    })
    const session = await readJson<{ accessToken: string }>(sessionResponse)

    const response = await reportRequest(shiftId, 'X', session.accessToken)
    // Not theirs is indistinguishable from not there (P13-D39, A01).
    expect(response.status).toBe(404)

    await db.delete(device).where(eq(device.id, otherDeviceId))
    await db.delete(terminal).where(eq(terminal.id, otherTerminalId))
  })
})
