import { db } from '@sceptre/db'
import { accraIsoDay, priceCart, ratioBp } from '@sceptre/shared'
import { eq, inArray } from 'drizzle-orm'
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
import { stockLevel, stockMovement, stockThreshold } from '../inventory/inventory.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { hashDeviceToken } from '../org/enrollment.service.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import {
  supplierInvoice,
  supplierInvoiceLine,
  supplierPayment,
  supplierPaymentAllocation,
} from '../payables/payables.schema.ts'
import {
  cashMovement,
  posStaffBinding,
  sale,
  saleLine,
  saleTender,
  shift,
  syncConflict,
} from '../pos/pos.schema.ts'
import { applySale, openShift } from '../pos/pos.service.ts'
import type { SalePayload } from '../pos/pos.types.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import type { DeviceAuthContext } from '../sync/sync.types.ts'
import { buildTenderMix, foldCategories, resolvePeriod, toWindow } from './analytics.service.ts'
import type { CategorySlice } from './analytics.types.ts'

const available = await databaseAvailable()
if (!available) console.warn('[analytics.test] database unavailable; integration tests skipped')

const PERIOD = { from: '2026-10-01', to: '2026-10-05', granularity: 'day' } as const

describe.skipIf(!available)('analytics overview', () => {
  const suffix = randomToken(4)
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdShiftIds: string[] = []
  const createdSaleIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUomIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdUserIds: string[] = []

  let branchA = ''
  let branchB = ''
  let adminCookie = ''
  let managerCookie = ''
  let cashierAUserId = ''
  let cashierAStaffId = ''
  let cashierBUserId = ''
  let cashierBStaffId = ''
  let deviceA: DeviceAuthContext = { deviceId: '', terminalId: '', branchId: '' }
  let deviceB: DeviceAuthContext = { deviceId: '', terminalId: '', branchId: '' }
  let shiftA = ''
  let shiftB = ''
  let cashierAProof: CashierProof = {
    userId: '',
    staffId: '',
    bindingId: '',
    bindingToken: '',
    pinVersion: 1,
  }
  let productA = ''
  let productB = ''
  let customerId = ''
  const customerName = `Analytics Customer ${suffix}`
  const customerPhone = `+23324${String(Date.now()).slice(-7)}`

  async function createTerminalWithBinding(
    branchId: string,
    label: string,
    role: 'CASHIER',
  ): Promise<{
    device: DeviceAuthContext
    cashier: {
      userId: string
      staffId: string
      bindingId: string
      bindingToken: string
      pinVersion: number
    }
  }> {
    const terminalRow = await db
      .insert(terminal)
      .values({ branchId, code: `${suffix}-${label}`, name: `Analytics ${label}` })
      .returning()
    const terminalId = terminalRow[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `analytics-${label}-${suffix}`,
        tokenHash: hashDeviceToken(randomToken(40)),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)

    const user = await createTestUser({ role, branchId })
    createdUserIds.push(user.id)
    const staffId = `GA-${label}${suffix.slice(0, 3)}`
    await db.update(userTable).set({ staffId, pinVersion: 1 }).where(eq(userTable.id, user.id))

    const bindingToken = randomToken(40)
    const bindingRow = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: user.id,
        staffStaffId: staffId,
        role,
        branchId,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(bindingToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()

    return {
      device: { deviceId, terminalId, branchId },
      cashier: {
        userId: user.id,
        staffId,
        bindingId: bindingRow[0]?.id ?? '',
        bindingToken,
        pinVersion: 1,
      },
    }
  }

  type CashierProof = {
    userId: string
    staffId: string
    bindingId: string
    bindingToken: string
    pinVersion: number
  }

  function payloadFor(input: {
    clientTransactionId: string
    shiftId: string
    cashier: CashierProof
    occurredAt: string
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>
    tender: { method: 'CASH' | 'CREDIT'; amountMinor: number }
    customer?: { id: string; phone: string; name: string } | null
  }): SalePayload {
    const lines = input.lines.map((line) => ({
      ...line,
      lineDiscountMinor: 0,
      taxCategory: 'STANDARD' as const,
    }))
    const priced = priceCart(
      lines.map((line) => ({ ...line, name: '', sku: '' })),
      { taxMode: 'INCLUSIVE' },
    )

    return {
      receiptNumber: `AN-${suffix}-${input.clientTransactionId.slice(0, 8)}`,
      shiftId: input.shiftId,
      cashier: input.cashier,
      customer: input.customer ?? null,
      lines,
      saleDiscount: null,
      loyalty: null,
      tenders: [
        {
          method: input.tender.method,
          amountMinor: input.tender.amountMinor,
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
        totalMinor: priced.totalMinor,
        changeMinor:
          input.tender.method === 'CASH'
            ? Math.max(0, input.tender.amountMinor - priced.totalMinor)
            : 0,
      },
      occurredAt: input.occurredAt,
      appVersion: 'test',
    }
  }

  async function apply(deviceContext: DeviceAuthContext, payload: SalePayload) {
    const saleId = crypto.randomUUID()
    createdSaleIds.push(saleId)
    return db.transaction((tx) =>
      applySale(
        {
          clientTransactionId: saleId,
          device: deviceContext,
          receivedAt: new Date(payload.occurredAt),
          clockSkewToleranceMinutes: 999_999,
        },
        payload,
        tx,
      ),
    )
  }

  async function overview(cookie: string, query: Record<string, string> = {}) {
    const params = new URLSearchParams(query)
    const response = await app.request(`/api/analytics/overview?${params.toString()}`, {
      headers: authedHeaders(cookie),
    })
    return { response, body: (await response.json()) as Record<string, unknown> }
  }

  beforeAll(async () => {
    const branchRows = await db
      .insert(branch)
      .values([
        { code: `${suffix}A`, name: `Analytics A ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `${suffix}B`, name: `Analytics B ${suffix}`, type: 'RETAIL', city: 'Kumasi' },
      ])
      .returning()
    branchA = branchRows[0]?.id ?? ''
    branchB = branchRows[1]?.id ?? ''
    createdBranchIds.push(branchA, branchB)

    const a = await createTerminalWithBinding(branchA, 'A', 'CASHIER')
    const b = await createTerminalWithBinding(branchB, 'B', 'CASHIER')
    deviceA = a.device
    deviceB = b.device
    cashierAProof = a.cashier
    cashierAUserId = a.cashier.userId
    cashierAStaffId = a.cashier.staffId
    cashierBUserId = b.cashier.userId
    cashierBStaffId = b.cashier.staffId

    shiftA = crypto.randomUUID()
    shiftB = crypto.randomUUID()
    createdShiftIds.push(shiftA, shiftB)
    await openShift(deviceA, {
      shiftId: shiftA,
      number: `${suffix}-A-S-20261001-01`,
      openingFloatMinor: 20_000,
      cashierUserId: cashierAUserId,
      cashierStaffId: cashierAStaffId,
      occurredAt: '2026-10-01T08:00:00.000Z',
    })
    await openShift(deviceB, {
      shiftId: shiftB,
      number: `${suffix}-B-S-20261001-01`,
      openingFloatMinor: 20_000,
      cashierUserId: cashierBUserId,
      cashierStaffId: cashierBStaffId,
      occurredAt: '2026-10-01T08:00:00.000Z',
    })

    const categoryRow = await db
      .insert(category)
      .values({ name: `Analytics Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)
    const uomRow = await db
      .insert(uom)
      .values({ code: `A${suffix}`.slice(0, 8), name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const productRows = await db
      .insert(product)
      .values([
        {
          sku: `AN-A-${suffix}`,
          name: `Analytics Part A ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `AN-B-${suffix}`,
          name: `Analytics Part B ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 5_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productA = productRows[0]?.id ?? ''
    productB = productRows[1]?.id ?? ''
    createdProductIds.push(productA, productB)

    await db.insert(stockLevel).values([
      { productId: productA, branchId: branchA, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productB, branchId: branchA, quantityOnHand: 100, avgCostMinor: 3_000 },
      { productId: productA, branchId: branchB, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productB, branchId: branchB, quantityOnHand: 100, avgCostMinor: 3_000 },
    ])

    const customerRow = await db
      .insert(customer)
      .values({ name: customerName, phone: customerPhone, createdBranchId: branchA })
      .returning()
    customerId = customerRow[0]?.id ?? ''
    createdCustomerIds.push(customerId)
    await db.insert(creditProfile).values({ customerId, branchId: branchA, limitMinor: 500_000 })

    // A: 2 × Part A for 20,000 paid with 25,000 cash on 1 Oct.
    await apply(
      deviceA,
      payloadFor({
        clientTransactionId: 'day1',
        shiftId: shiftA,
        cashier: a.cashier,
        occurredAt: '2026-10-01T10:00:00.000Z',
        lines: [{ productId: productA, quantity: 2, unitPriceMinor: 10_000 }],
        tender: { method: 'CASH', amountMinor: 25_000 },
      }),
    )

    // A: 1 × Part A + 1 × Part B for 15,000 cash on 3 Oct.
    await apply(
      deviceA,
      payloadFor({
        clientTransactionId: 'day3',
        shiftId: shiftA,
        cashier: a.cashier,
        occurredAt: '2026-10-03T12:00:00.000Z',
        lines: [
          { productId: productA, quantity: 1, unitPriceMinor: 10_000 },
          { productId: productB, quantity: 1, unitPriceMinor: 5_000 },
        ],
        tender: { method: 'CASH', amountMinor: 15_000 },
      }),
    )

    // B: 1 × Part A for 10,000 on credit on 1 Oct.
    await apply(
      deviceB,
      payloadFor({
        clientTransactionId: 'day1b',
        shiftId: shiftB,
        cashier: b.cashier,
        occurredAt: '2026-10-01T15:00:00.000Z',
        lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
        tender: { method: 'CREDIT', amountMinor: 10_000 },
        customer: { id: customerId, phone: customerPhone, name: customerName },
      }),
    )

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({ role: 'MANAGER', branchId: branchA })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)
  })

  afterAll(async () => {
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(stockMovement).where(inArray(stockMovement.referenceId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    if (createdCustomerIds.length > 0) {
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
      // A draft customer resolution opens a loyalty account automatically. Lots reference
      // their earning entry, so they must go before the ledger.
      const accounts = await db
        .select({ id: loyaltyAccount.id })
        .from(loyaltyAccount)
        .where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      const accountIds = accounts.map((account) => account.id)
      if (accountIds.length > 0) {
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(inArray(loyaltyLot.accountId, accountIds))
        const lotIds = lots.map((lot) => lot.id)
        if (lotIds.length > 0) {
          await db.delete(loyaltyLotConsumption).where(inArray(loyaltyLotConsumption.lotId, lotIds))
          await db.delete(loyaltyLot).where(inArray(loyaltyLot.id, lotIds))
        }
        await db.delete(loyaltyLedgerEntry).where(inArray(loyaltyLedgerEntry.accountId, accountIds))
        await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.id, accountIds))
      }
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    if (createdShiftIds.length > 0) {
      await db.delete(cashMovement).where(inArray(cashMovement.shiftId, createdShiftIds))
      await db.delete(shift).where(inArray(shift.id, createdShiftIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(stockLevel).where(inArray(stockLevel.productId, createdProductIds))
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdUomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, createdUomIds))
    }
    if (createdDeviceIds.length > 0) {
      await db.delete(posStaffBinding).where(inArray(posStaffBinding.deviceId, createdDeviceIds))
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
    for (const id of createdUserIds) await deleteTestUser(id)
  })

  it('reports totals that reconcile to the sale, line, and tender ledgers', async () => {
    const { response, body } = await overview(adminCookie, PERIOD)
    expect(response.status).toBe(200)

    const totals = body.totals as Record<string, number | Record<string, number>>
    expect(totals.takeMinor).toBe(45_000)
    expect(totals.salesCount).toBe(3)
    expect(totals.itemsSold).toBe(5)
    expect(totals.avgBasketMinor).toBe(15_000)
    expect(totals.cashMinor).toBe(35_000)
    expect(totals.creditMinor).toBe(10_000)
    expect(totals.electronicMinor).toBe(0)

    const tax = totals.tax as {
      vatMinor: number
      nhilMinor: number
      getfundMinor: number
      totalMinor: number
    }
    expect(tax.totalMinor).toBe(tax.vatMinor + tax.nhilMinor + tax.getfundMinor)
    expect((totals.takeMinor as number) - tax.totalMinor).toBe(totals.revenueBaseMinor)

    const lines = await db.select().from(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
    const lineBase = lines.reduce((total, line) => total + line.baseMinor, 0)
    const lineCost = lines.reduce((total, line) => total + line.unitCostMinor * line.quantity, 0)
    expect(totals.revenueBaseMinor).toBe(lineBase)
    expect(totals.grossProfitMinor).toBe(lineBase - lineCost)
    expect(body.driftMinor).toEqual({ revenue: 0, tax: 0 })
  })

  it('gap-fills the series and keeps every bucket a calendar day', async () => {
    const { body } = await overview(adminCookie, PERIOD)
    const series = body.series as Array<Record<string, number | string>>

    expect(series).toHaveLength(5)
    expect(series.map((point) => point.bucketStart)).toEqual([
      '2026-10-01',
      '2026-10-02',
      '2026-10-03',
      '2026-10-04',
      '2026-10-05',
    ])
    expect(series[0]?.takeMinor).toBe(30_000)
    expect(series[1]?.takeMinor).toBe(0)
    expect(series[2]?.takeMinor).toBe(15_000)
    expect(series.reduce((total, point) => total + Number(point.takeMinor), 0)).toBe(45_000)
    expect(series.reduce((total, point) => total + Number(point.salesCount), 0)).toBe(3)
  })

  it('sums the tender mix to the take, with cash derived rather than summed', async () => {
    const { body } = await overview(adminCookie, PERIOD)
    const mix = body.tenderMix as Array<{ method: string; amountMinor: number }>
    expect(mix.reduce((total, slice) => total + slice.amountMinor, 0)).toBe(45_000)
    expect(mix.find((slice) => slice.method === 'CASH')?.amountMinor).toBe(35_000)
    expect(mix.find((slice) => slice.method === 'CREDIT')?.amountMinor).toBe(10_000)
  })

  it('reports sync health from terminals, devices, and the sale clock', async () => {
    // One active terminal in branch A; no device revoked; every fixture sale was
    // received at the instant it occurred, so both lag figures are zero.
    const { body } = await overview(adminCookie, { ...PERIOD, branchId: branchA })
    expect(body.syncHealth).toEqual({
      activeTerminals: 1,
      terminalsSeenToday: 0,
      revokedDevices30d: 0,
      avgUploadLagMinutes: 0,
      maxUploadLagMinutes: 0,
    })
  })

  it('narrows a manager to their own branch and refuses another with 403', async () => {
    const own = await overview(managerCookie, PERIOD)
    expect(own.response.status).toBe(200)
    expect((own.body.totals as Record<string, number>).takeMinor).toBe(35_000)
    expect((own.body.scope as Record<string, unknown>).branchId).toBe(branchA)
    expect(own.body.branchRanking).toEqual([])

    const foreign = await overview(managerCookie, { ...PERIOD, branchId: branchB })
    expect(foreign.response.status).toBe(403)
    expect((foreign.body.error as Record<string, unknown>).code).toBe('FORBIDDEN')
  })

  it('shows an admin the whole organisation with branch ranking', async () => {
    const { body } = await overview(adminCookie, PERIOD)
    const ranking = body.branchRanking as Array<{ branchId: string; takeMinor: number }>
    expect(ranking).toHaveLength(2)
    expect(ranking[0]).toMatchObject({ branchId: branchA, takeMinor: 35_000 })
    expect(ranking[1]).toMatchObject({ branchId: branchB, takeMinor: 10_000 })
  })

  it('rejects an impossible period and clamps a future end date', async () => {
    const reversed = await overview(adminCookie, { from: '2026-10-05', to: '2026-10-01' })
    expect(reversed.response.status).toBe(400)

    const tooLong = await overview(adminCookie, { from: '2025-01-01', to: '2026-12-31' })
    expect(tooLong.response.status).toBe(400)

    const badGranularity = await overview(adminCookie, { ...PERIOD, granularity: 'quarter' })
    expect(badGranularity.response.status).toBe(400)

    const future = await overview(adminCookie, { from: '2026-10-01', to: '2026-12-31' })
    expect(future.response.status).toBe(200)
    expect((future.body.period as Record<string, string>).to).toBe(
      new Date().toISOString().slice(0, 10),
    )
  })

  it('returns zeros and the full bucket list for an empty period', async () => {
    const { body } = await overview(adminCookie, {
      from: '2026-09-01',
      to: '2026-09-03',
      granularity: 'day',
    })
    const totals = body.totals as Record<string, number>
    expect(totals.takeMinor).toBe(0)
    expect(totals.salesCount).toBe(0)
    expect(body.series).toHaveLength(3)
    expect(body.deltas).toMatchObject({
      take: { deltaBp: null },
      grossProfit: { deltaBp: null },
    })
  })

  it('carries no customer identity', async () => {
    const { body } = await overview(adminCookie, PERIOD)
    const serialised = JSON.stringify(body)
    expect(serialised).not.toContain(customerPhone)
    expect(serialised).not.toContain(customerName)
    expect(serialised).not.toContain(customerId)
  })

  it('surfaces header/line drift instead of hiding it', async () => {
    const driftResult = await apply(
      deviceA,
      payloadFor({
        clientTransactionId: 'drift',
        shiftId: shiftA,
        cashier: cashierAProof,
        occurredAt: '2026-09-15T10:00:00.000Z',
        lines: [{ productId: productA, quantity: 1, unitPriceMinor: 10_000 }],
        tender: { method: 'CASH', amountMinor: 10_000 },
      }),
    )

    const [driftSale] = await db.select().from(sale).where(eq(sale.id, driftResult.saleId))
    const saleId = driftSale?.id ?? ''

    // Simulate what the POS stores for a TOTAL_MISMATCH: the charged header differs from
    // the server's line recomputation.
    await db
      .update(sale)
      .set({
        totalMinor: (driftSale?.totalMinor ?? 0) + 1,
        taxTotalMinor: (driftSale?.taxTotalMinor ?? 0) + 2,
      })
      .where(eq(sale.id, saleId))

    const { body } = await overview(adminCookie, {
      from: '2026-09-15',
      to: '2026-09-15',
      granularity: 'day',
    })
    expect(body.driftMinor).toEqual({ revenue: -1, tax: 2 })
  })

  async function get(path: string, cookie: string, query: Record<string, string> = {}) {
    const params = new URLSearchParams(query)
    return app.request(`${path}?${params.toString()}`, { headers: authedHeaders(cookie) })
  }

  it('reconciles the sales report with the overview and paginates its rows', async () => {
    const [overviewResponse, salesResponse] = await Promise.all([
      overview(adminCookie, PERIOD),
      get('/api/analytics/sales', adminCookie, { ...PERIOD, limit: '2', offset: '0' }),
    ])
    expect(salesResponse.status).toBe(200)
    const sales = (await salesResponse.json()) as Record<string, unknown>
    const overviewTotals = overviewResponse.body.totals as Record<string, number>

    expect((sales.totals as Record<string, number>).takeMinor).toBe(overviewTotals.takeMinor)
    expect((sales.totals as Record<string, number>).salesCount).toBe(3)
    expect(sales.total).toBe(3)
    expect((sales.rows as unknown[]).length).toBe(2)
    expect((sales.byHour as unknown[]).length).toBe(24)

    const series = sales.series as Array<{ takeMinor: number }>
    expect(series.reduce((total, point) => total + point.takeMinor, 0)).toBe(
      overviewTotals.takeMinor,
    )

    const hourTotal = (sales.byHour as Array<{ takeMinor: number }>).reduce(
      (total, slice) => total + slice.takeMinor,
      0,
    )
    expect(hourTotal).toBe(overviewTotals.takeMinor)

    const secondPage = await get('/api/analytics/sales', adminCookie, {
      ...PERIOD,
      limit: '2',
      offset: '2',
    })
    const page2 = (await secondPage.json()) as { rows: unknown[] }
    expect(page2.rows).toHaveLength(1)
  })

  it('carries the sale id on every sales row, so a receipt links to its own detail', async () => {
    const response = await get('/api/analytics/sales', adminCookie, PERIOD)
    expect(response.status).toBe(200)
    const body = (await response.json()) as {
      rows: Array<{ saleId: string; receiptNumber: string }>
    }
    expect(body.rows.length).toBeGreaterThan(0)

    const sales = await db
      .select({ id: sale.id, receiptNumber: sale.receiptNumber })
      .from(sale)
      .where(inArray(sale.id, createdSaleIds))
    const idByReceipt = new Map(sales.map((row) => [row.receiptNumber, row.id]))
    for (const row of body.rows) {
      // One column, no second query: the id is the row the console opens.
      expect(idByReceipt.get(row.receiptNumber)).toBe(row.saleId)
      expect(row.saleId).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-/)
    }
  })

  it('rejects an unknown sort instead of interpolating it', async () => {
    const response = await get('/api/analytics/sales', adminCookie, {
      ...PERIOD,
      sort: 'drop_table',
    })
    expect(response.status).toBe(400)
  })

  it('reconciles product revenue, cost, and margin', async () => {
    const response = await get('/api/analytics/products', adminCookie, PERIOD)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const overviewResponse = await overview(adminCookie, PERIOD)
    const overviewTotals = overviewResponse.body.totals as Record<string, number>
    const totals = body.totals as {
      revenueBaseMinor: number
      costMinor: number
      grossProfitMinor: number
      marginBp: number
    }

    expect(totals.revenueBaseMinor).toBe(overviewTotals.revenueBaseMinor)
    expect(totals.grossProfitMinor).toBe(totals.revenueBaseMinor - totals.costMinor)
    expect(totals.marginBp).toBe(
      Math.round((totals.grossProfitMinor * 10_000) / totals.revenueBaseMinor),
    )

    const rows = body.rows as Array<{ revenueBaseMinor: number }>
    const allRevenue = rows.reduce((total, row) => total + row.revenueBaseMinor, 0)
    expect(allRevenue).toBe(totals.revenueBaseMinor)
    expect(body.total).toBe(2)
  })

  it('reports the tax split by category and rates from the shared engine', async () => {
    const response = await get('/api/analytics/tax', adminCookie, PERIOD)
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const totals = body.totals as {
      vatMinor: number
      nhilMinor: number
      getfundMinor: number
      totalMinor: number
      baseMinor: number
    }
    const categories = body.byCategory as Array<Record<string, string | number>>

    expect(totals.totalMinor).toBe(totals.vatMinor + totals.nhilMinor + totals.getfundMinor)
    const categoryBase = categories.reduce((total, row) => total + Number(row.baseMinor), 0)
    expect(categoryBase).toBe(totals.baseMinor)
    expect(body.rates).toMatchObject({ vatBp: 1500, nhilBp: 250, getfundBp: 250, totalBp: 2000 })
    expect(
      (body.series as Array<{ totalMinor: number }>).reduce(
        (total, point) => total + point.totalMinor,
        0,
      ),
    ).toBe(totals.totalMinor)
  })

  it('escapes a formula in an exported product name and scopes the export', async () => {
    const uomRow = await db
      .insert(uom)
      .values({ code: `E${suffix}`.slice(0, 8), name: 'Piece' })
      .returning()
    const hostileUomId = uomRow[0]?.id ?? ''
    createdUomIds.push(hostileUomId)
    const [hostile] = await db
      .insert(product)
      .values({
        sku: `EVIL-${suffix}`,
        name: '=HYPERLINK("http://evil")',
        categoryId: createdCategoryIds[0] ?? '',
        uomId: hostileUomId,
        basePriceMinor: 1_000,
        taxCategory: 'STANDARD',
      })
      .returning()
    const hostileId = hostile?.id ?? ''
    createdProductIds.push(hostileId)
    await db
      .insert(stockLevel)
      .values({ productId: hostileId, branchId: branchA, quantityOnHand: 10, avgCostMinor: 500 })

    await apply(
      deviceA,
      payloadFor({
        clientTransactionId: 'hostile',
        shiftId: shiftA,
        cashier: cashierAProof,
        occurredAt: '2026-09-20T10:00:00.000Z',
        lines: [{ productId: hostileId, quantity: 1, unitPriceMinor: 1_000 }],
        tender: { method: 'CASH', amountMinor: 1_000 },
      }),
    )

    const response = await get('/api/analytics/products/export', adminCookie, {
      from: '2026-09-20',
      to: '2026-09-20',
    })
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toContain('text/csv')
    expect(response.headers.get('content-disposition')).toContain('attachment; filename=')
    // `response.text()` decodes UTF-8 and strips a leading BOM by spec, so inspect the bytes
    // the spreadsheet will actually receive.
    const bytes = new Uint8Array(await response.arrayBuffer())
    expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
    const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(csv.startsWith('\uFEFF')).toBe(true)
    expect(csv).toContain(`"'=HYPERLINK(""http://evil"")"`)
    expect(csv.includes('\r\n')).toBe(true)

    const foreign = await get('/api/analytics/products/export', managerCookie, {
      ...PERIOD,
      branchId: branchB,
    })
    expect(foreign.status).toBe(403)

    const managerExport = await get('/api/analytics/sales/export', managerCookie, PERIOD)
    const managerCsv = await managerExport.text()
    expect(managerCsv).not.toContain(`${suffix}B`)
    expect(managerCsv).toContain(`${suffix}A`)
  })

  it('exports the four state reports with a reconciling TOTAL row', async () => {
    for (const report of ['inventory', 'credit', 'loyalty', 'payables']) {
      const response = await get(`/api/analytics/${report}/export`, adminCookie, PERIOD)
      expect(response.status).toBe(200)
      expect(response.headers.get('content-type')).toContain('text/csv')
      const bytes = new Uint8Array(await response.arrayBuffer())
      expect([bytes[0], bytes[1], bytes[2]]).toEqual([0xef, 0xbb, 0xbf])
      const csv = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
      expect(csv).toContain('\r\n')
      expect(csv).toContain('TOTAL')
      const header = csv.split('\r\n')[0] ?? ''
      expect(header.length).toBeGreaterThan(0)
    }

    const forbidden = await get('/api/analytics/credit/export', managerCookie, {
      ...PERIOD,
      branchId: branchB,
    })
    expect(forbidden.status).toBe(403)
  })
})

describe('analytics pure helpers', () => {
  it('computes the comparison window as the immediately preceding equal period', () => {
    const { period, comparison } = resolvePeriod({
      from: '2026-09-01',
      to: '2026-09-30',
      granularity: 'day',
    })
    expect(period.days).toBe(30)
    expect(comparison).toMatchObject({ from: '2026-08-02', to: '2026-08-31' })
    expect(toWindow(period).toExclusive.toISOString()).toBe('2026-10-01T00:00:00.000Z')
  })

  it('derives cash as the remainder and refuses an over-allocated mix', () => {
    expect(buildTenderMix(10_000, 2_000, [])).toEqual([
      { method: 'CASH', amountMinor: 8_000 },
      { method: 'CREDIT', amountMinor: 2_000 },
    ])
    expect(buildTenderMix(10_000, 0, [{ method: 'MOMO', amountMinor: 4_000 }])).toEqual([
      { method: 'CASH', amountMinor: 6_000 },
      { method: 'MOMO', amountMinor: 4_000 },
    ])
    expect(() => buildTenderMix(1_000, 2_000, [])).toThrow(/inconsistent/)
  })

  it('folds the category tail into an exact Other', () => {
    const slices: CategorySlice[] = Array.from({ length: 7 }, (_, index) => ({
      categoryId: `c${index}`,
      name: `Category ${index}`,
      revenueBaseMinor: 1_000 - index * 100,
      quantity: 1,
    }))
    const folded = foldCategories(slices)
    expect(folded).toHaveLength(5)
    expect(folded.at(-1)?.name).toBe('Other')
    expect(folded.reduce((total, slice) => total + slice.revenueBaseMinor, 0)).toBe(
      slices.reduce((total, slice) => total + slice.revenueBaseMinor, 0),
    )
  })
})

describe.skipIf(!available)('analytics ledger read models', () => {
  const suffix = randomToken(4)
  const createdBranchIds: string[] = []
  const createdTerminalIds: string[] = []
  const createdDeviceIds: string[] = []
  const createdShiftIds: string[] = []
  const createdSaleIds: string[] = []
  const createdProductIds: string[] = []
  const createdCategoryIds: string[] = []
  const createdUomIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdUserIds: string[] = []
  const createdSupplierIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdPaymentIds: string[] = []

  const CREDIT_PERIOD = { from: '2026-10-01', to: '2026-10-05', granularity: 'day' } as const
  const CREDIT_CHARGE_MINOR = 10_000
  const CREDIT_REPAYMENT_MINOR = 4_000
  const EARN_NET_PAID_MINOR = 50_000
  const REDEEM_POINTS = 200

  let branchC = ''
  let branchD = ''
  let adminCookie = ''
  let managerCookie = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let proof: {
    userId: string
    staffId: string
    bindingId: string
    bindingToken: string
    pinVersion: number
  } = { userId: '', staffId: '', bindingId: '', bindingToken: '', pinVersion: 1 }
  let deviceC: DeviceAuthContext = { deviceId: '', terminalId: '', branchId: '' }
  let shiftC = ''
  let productP1 = ''
  let productP2 = ''
  let productP3 = ''
  let creditCustomerId = ''
  let loyaltyCustomerId = ''
  let supplierId = ''
  let invoiceId = ''
  let invoiceTotalMinorValue = 0
  let paymentAmountMinorValue = 0
  const creditCustomerName = `Credit Bucket ${suffix}`
  const creditCustomerPhone = `+23320${String(Date.now()).slice(-7)}`
  const loyaltyCustomerName = `Loyalty Flow ${suffix}`
  const loyaltyCustomerPhone = `+23327${String(Date.now()).slice(-7)}`

  function isoMinus(day: string, days: number): string {
    return new Date(new Date(`${day}T00:00:00.000Z`).getTime() - days * 86_400_000)
      .toISOString()
      .slice(0, 10)
  }

  async function get(path: string, cookie: string, query: Record<string, string> = {}) {
    const params = new URLSearchParams(query)
    return app.request(`${path}?${params.toString()}`, { headers: authedHeaders(cookie) })
  }

  async function post(path: string, cookie: string, body: unknown) {
    return app.request(path, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify(body),
    })
  }

  function payloadFor(input: {
    receiptNumber: string
    clientTransactionId: string
    occurredAt: string
    lines: Array<{ productId: string; quantity: number; unitPriceMinor: number }>
    tender: { method: 'CASH' | 'CREDIT'; amountMinor: number }
    customer?: { id: string; phone: string; name: string } | null
  }): SalePayload {
    const lines = input.lines.map((line) => ({
      ...line,
      lineDiscountMinor: 0,
      taxCategory: 'STANDARD' as const,
    }))
    const priced = priceCart(lines, { taxMode: 'INCLUSIVE' })

    return {
      receiptNumber: input.receiptNumber,
      shiftId: shiftC,
      cashier: proof,
      customer: input.customer ?? null,
      lines,
      saleDiscount: null,
      loyalty: null,
      tenders: [{ method: input.tender.method, amountMinor: input.tender.amountMinor }],
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
        changeMinor:
          input.tender.method === 'CASH'
            ? Math.max(0, input.tender.amountMinor - priced.totalMinor)
            : 0,
      },
      occurredAt: input.occurredAt,
      appVersion: 'test',
    }
  }

  async function apply(payload: SalePayload) {
    const saleId = crypto.randomUUID()
    createdSaleIds.push(saleId)
    return db.transaction((tx) =>
      applySale(
        {
          clientTransactionId: saleId,
          device: deviceC,
          receivedAt: new Date(payload.occurredAt),
          clockSkewToleranceMinutes: 999_999,
        },
        payload,
        tx,
      ),
    )
  }

  beforeAll(async () => {
    const branchRows = await db
      .insert(branch)
      .values([
        { code: `${suffix}C`, name: `Read Model C ${suffix}`, type: 'RETAIL', city: 'Accra' },
        { code: `${suffix}D`, name: `Read Model D ${suffix}`, type: 'RETAIL', city: 'Kumasi' },
      ])
      .returning()
    branchC = branchRows[0]?.id ?? ''
    branchD = branchRows[1]?.id ?? ''
    createdBranchIds.push(branchC, branchD)

    const terminalRow = await db
      .insert(terminal)
      .values({ branchId: branchC, code: `${suffix}-RC`, name: 'Read Model Counter' })
      .returning()
    const terminalId = terminalRow[0]?.id ?? ''
    createdTerminalIds.push(terminalId)

    const deviceRow = await db
      .insert(device)
      .values({
        terminalId,
        fingerprint: `read-model-${suffix}`,
        tokenHash: hashDeviceToken(randomToken(40)),
        status: 'ACTIVE',
        enrolledAt: new Date(),
      })
      .returning()
    const deviceId = deviceRow[0]?.id ?? ''
    createdDeviceIds.push(deviceId)
    deviceC = { deviceId, terminalId, branchId: branchC }

    const cashier = await createTestUser({ role: 'CASHIER', branchId: branchC })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-R${suffix.slice(0, 3)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashier.id))

    const bindingToken = randomToken(40)
    const bindingRow = await db
      .insert(posStaffBinding)
      .values({
        deviceId,
        staffUserId: cashier.id,
        staffStaffId: cashierStaffId,
        role: 'CASHIER',
        branchId: branchC,
        pinVersion: 1,
        bindingTokenHash: hashDeviceToken(bindingToken),
        expiresAt: new Date(Date.now() + 30 * 86_400_000),
      })
      .returning()
    proof = {
      userId: cashier.id,
      staffId: cashierStaffId,
      bindingId: bindingRow[0]?.id ?? '',
      bindingToken,
      pinVersion: 1,
    }

    shiftC = crypto.randomUUID()
    createdShiftIds.push(shiftC)
    await openShift(deviceC, {
      shiftId: shiftC,
      number: `RM-${suffix}-S-20261002-01`,
      openingFloatMinor: 20_000,
      cashierUserId,
      cashierStaffId,
      occurredAt: '2026-10-02T08:00:00.000Z',
    })

    const categoryRow = await db
      .insert(category)
      .values({ name: `Read Model Category ${suffix}` })
      .returning()
    const categoryId = categoryRow[0]?.id ?? ''
    createdCategoryIds.push(categoryId)
    const uomRow = await db
      .insert(uom)
      .values({ code: `R${suffix}`.slice(0, 8), name: 'Piece' })
      .returning()
    const uomId = uomRow[0]?.id ?? ''
    createdUomIds.push(uomId)

    const productRows = await db
      .insert(product)
      .values([
        {
          sku: `RM-1-${suffix}`,
          name: `Read Model Moves ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 10_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `RM-2-${suffix}`,
          name: `Read Model Low ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 5_000,
          taxCategory: 'STANDARD',
        },
        {
          sku: `RM-3-${suffix}`,
          name: `Read Model Dead ${suffix}`,
          categoryId,
          uomId,
          basePriceMinor: 2_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productP1 = productRows[0]?.id ?? ''
    productP2 = productRows[1]?.id ?? ''
    productP3 = productRows[2]?.id ?? ''
    createdProductIds.push(productP1, productP2, productP3)

    await db.insert(stockLevel).values([
      { productId: productP1, branchId: branchC, quantityOnHand: 100, avgCostMinor: 6_000 },
      { productId: productP2, branchId: branchC, quantityOnHand: 100, avgCostMinor: 3_000 },
      { productId: productP3, branchId: branchC, quantityOnHand: 10, avgCostMinor: 500 },
    ])
    // One configured threshold, deliberately above the quantity on hand: exactly one low row.
    await db
      .insert(stockThreshold)
      .values({ productId: productP2, branchId: branchC, threshold: 500, updatedBy: 'test' })

    const creditCustomer = await db
      .insert(customer)
      .values({
        name: creditCustomerName,
        phone: creditCustomerPhone,
        createdBranchId: branchC,
      })
      .returning()
    creditCustomerId = creditCustomer[0]?.id ?? ''
    createdCustomerIds.push(creditCustomerId)
    await db.insert(creditProfile).values({
      customerId: creditCustomerId,
      branchId: branchC,
      limitMinor: 500_000,
    })

    const loyaltyCustomer = await db
      .insert(customer)
      .values({
        name: loyaltyCustomerName,
        phone: loyaltyCustomerPhone,
        createdBranchId: branchC,
      })
      .returning()
    loyaltyCustomerId = loyaltyCustomer[0]?.id ?? ''
    createdCustomerIds.push(loyaltyCustomerId)
    // The POS path bootstraps the loyalty account, but the direct EARN needs it to exist.
    await db.insert(loyaltyAccount).values({ customerId: loyaltyCustomerId })

    // Two lines for P1 (2 + 1) and one for P2, so the mover order is unambiguous.
    await apply(
      payloadFor({
        receiptNumber: `RM-${suffix}-0001`,
        clientTransactionId: 'rm-1',
        occurredAt: '2026-10-02T10:00:00.000Z',
        lines: [{ productId: productP1, quantity: 2, unitPriceMinor: 10_000 }],
        tender: { method: 'CASH', amountMinor: 25_000 },
      }),
    )
    await apply(
      payloadFor({
        receiptNumber: `RM-${suffix}-0002`,
        clientTransactionId: 'rm-2',
        occurredAt: '2026-10-02T11:00:00.000Z',
        lines: [{ productId: productP1, quantity: 1, unitPriceMinor: 10_000 }],
        tender: { method: 'CREDIT', amountMinor: CREDIT_CHARGE_MINOR },
        customer: {
          id: creditCustomerId,
          phone: creditCustomerPhone,
          name: creditCustomerName,
        },
      }),
    )
    await apply(
      payloadFor({
        receiptNumber: `RM-${suffix}-0003`,
        clientTransactionId: 'rm-3',
        occurredAt: '2026-10-02T12:00:00.000Z',
        lines: [{ productId: productP2, quantity: 1, unitPriceMinor: 5_000 }],
        tender: { method: 'CASH', amountMinor: 5_000 },
      }),
    )

    // A count-correction movement, so the flow's adjusted column is exercised.
    await db.insert(stockMovement).values({
      productId: productP2,
      branchId: branchC,
      type: 'ADJUSTMENT',
      quantityDelta: 5,
      unitCostMinor: 3_000,
      referenceType: 'ADJUSTMENT',
      reasonCode: 'FOUND',
      createdBy: 'test',
    })

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({ role: 'MANAGER', branchId: branchC })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    // Credit: one repayment on top of the POS charge.
    const repayment = await post('/api/credit/repayments', adminCookie, {
      customerId: creditCustomerId,
      branchId: branchC,
      amountMinor: CREDIT_REPAYMENT_MINOR,
      method: 'CASH',
      occurredAt: '2026-10-04T09:00:00.000Z',
    })
    if (repayment.status !== 201 && repayment.status !== 200) {
      throw new Error(`credit repayment failed: ${repayment.status} ${await repayment.text()}`)
    }

    // Loyalty: an EARN and a REDEEM through the owning service's endpoint.
    const earn = await post('/api/loyalty/entries', adminCookie, {
      customerId: loyaltyCustomerId,
      branchId: branchC,
      kind: 'EARN',
      netPaidMinor: EARN_NET_PAID_MINOR,
      occurredAt: '2026-10-03T09:00:00.000Z',
    })
    if (earn.status !== 201 && earn.status !== 200) {
      throw new Error(`loyalty earn failed: ${earn.status} ${await earn.text()}`)
    }
    const redeem = await post('/api/loyalty/entries', adminCookie, {
      customerId: loyaltyCustomerId,
      branchId: branchC,
      kind: 'REDEEM',
      points: REDEEM_POINTS,
      occurredAt: '2026-10-04T09:30:00.000Z',
    })
    if (redeem.status !== 201 && redeem.status !== 200) {
      throw new Error(`loyalty redeem failed: ${redeem.status} ${await redeem.text()}`)
    }

    // Payables: an invoice dated ten days ago, part-paid eight days ago, due five days ago.
    const today = accraIsoDay()
    const supplierRow = await db
      .insert(supplier)
      .values({ code: `SUP-${suffix}`, name: `Read Model Supplier ${suffix}` })
      .returning()
    supplierId = supplierRow[0]?.id ?? ''
    createdSupplierIds.push(supplierId)

    const invoiceResponse = await post('/api/payables/invoices', adminCookie, {
      supplierId,
      branchId: branchC,
      supplierInvoiceNumber: `INV-${suffix}-1`,
      invoiceDate: isoMinus(today, 10),
      dueDate: isoMinus(today, 5),
      lines: [{ description: 'Parts delivery', quantity: 4, unitCostMinor: 5_000 }],
    })
    if (invoiceResponse.status !== 201 && invoiceResponse.status !== 200) {
      throw new Error(`payables invoice failed: ${await invoiceResponse.text()}`)
    }
    const invoiceBody = (await invoiceResponse.json()) as {
      invoice: { invoice: { id: string; totalMinor: number } }
    }
    invoiceId = invoiceBody.invoice.invoice.id
    createdInvoiceIds.push(invoiceId)
    invoiceTotalMinorValue = invoiceBody.invoice.invoice.totalMinor

    const paymentAmount = Math.floor(invoiceTotalMinorValue / 2)
    const paymentResponse = await post('/api/payables/payments', adminCookie, {
      supplierId,
      branchId: branchC,
      method: 'BANK',
      amountMinor: paymentAmount,
      paidAt: `${isoMinus(today, 8)}T10:00:00.000Z`,
      allocations: [{ invoiceId, amountMinor: paymentAmount }],
    })
    if (paymentResponse.status !== 201 && paymentResponse.status !== 200) {
      throw new Error(`payables payment failed: ${await paymentResponse.text()}`)
    }
    const paymentBody = (await paymentResponse.json()) as {
      payment: { payment: { id: string } }
    }
    createdPaymentIds.push(paymentBody.payment.payment.id)
    paymentAmountMinorValue = paymentAmount
  })

  afterAll(async () => {
    if (createdSaleIds.length > 0) {
      await db.delete(syncConflict).where(inArray(syncConflict.saleId, createdSaleIds))
      await db.delete(stockMovement).where(inArray(stockMovement.referenceId, createdSaleIds))
      await db.delete(saleTender).where(inArray(saleTender.saleId, createdSaleIds))
      await db.delete(saleLine).where(inArray(saleLine.saleId, createdSaleIds))
      await db.delete(sale).where(inArray(sale.id, createdSaleIds))
    }
    if (createdSupplierIds.length > 0) {
      if (createdPaymentIds.length > 0) {
        await db
          .delete(supplierPaymentAllocation)
          .where(inArray(supplierPaymentAllocation.paymentId, createdPaymentIds))
        await db.delete(supplierPayment).where(inArray(supplierPayment.id, createdPaymentIds))
      }
      if (createdInvoiceIds.length > 0) {
        await db
          .delete(supplierInvoiceLine)
          .where(inArray(supplierInvoiceLine.invoiceId, createdInvoiceIds))
        await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, createdInvoiceIds))
      }
      await db.delete(supplier).where(inArray(supplier.id, createdSupplierIds))
    }
    if (createdShiftIds.length > 0) {
      await db.delete(cashMovement).where(inArray(cashMovement.shiftId, createdShiftIds))
      await db.delete(shift).where(inArray(shift.id, createdShiftIds))
    }
    if (createdCustomerIds.length > 0) {
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
      const accounts = await db
        .select({ id: loyaltyAccount.id })
        .from(loyaltyAccount)
        .where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      const accountIds = accounts.map((account) => account.id)
      if (accountIds.length > 0) {
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(inArray(loyaltyLot.accountId, accountIds))
        const lotIds = lots.map((lot) => lot.id)
        if (lotIds.length > 0) {
          await db.delete(loyaltyLotConsumption).where(inArray(loyaltyLotConsumption.lotId, lotIds))
          await db.delete(loyaltyLot).where(inArray(loyaltyLot.id, lotIds))
        }
        await db.delete(loyaltyLedgerEntry).where(inArray(loyaltyLedgerEntry.accountId, accountIds))
        await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.id, accountIds))
      }
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.productId, createdProductIds))
      await db.delete(stockLevel).where(inArray(stockLevel.productId, createdProductIds))
      await db.delete(stockThreshold).where(inArray(stockThreshold.productId, createdProductIds))
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCategoryIds.length > 0) {
      await db.delete(category).where(inArray(category.id, createdCategoryIds))
    }
    if (createdUomIds.length > 0) {
      await db.delete(uom).where(inArray(uom.id, createdUomIds))
    }
    if (createdDeviceIds.length > 0) {
      await db.delete(posStaffBinding).where(inArray(posStaffBinding.deviceId, createdDeviceIds))
      await db.delete(device).where(inArray(device.id, createdDeviceIds))
    }
    if (createdTerminalIds.length > 0) {
      await db.delete(terminal).where(inArray(terminal.id, createdTerminalIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
    for (const id of createdUserIds) await deleteTestUser(id)
  })

  it('values stock from the projection and reconciles it with the branch split', async () => {
    const response = await get('/api/analytics/inventory', adminCookie, {
      ...CREDIT_PERIOD,
      branchId: branchC,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    const levels = await db.select().from(stockLevel).where(eq(stockLevel.branchId, branchC))
    const expectedValue = levels.reduce(
      (total, row) => total + row.quantityOnHand * row.avgCostMinor,
      0,
    )
    const expectedUnits = levels.reduce((total, row) => total + row.quantityOnHand, 0)

    const totals = body.totals as Record<string, number>
    expect(totals.stockValueMinor).toBe(expectedValue)
    expect(totals.unitsOnHand).toBe(expectedUnits)
    expect(totals.distinctProducts).toBe(3)
    expect(totals.lowStockCount).toBe(1)
    expect(totals.thresholdCount).toBe(1)
    expect(totals.outOfStockCount).toBe(0)

    const allBranches = await get('/api/analytics/inventory', adminCookie, CREDIT_PERIOD)
    const allBody = (await allBranches.json()) as Record<string, unknown>
    const byBranch = allBody.byBranch as Array<{ stockValueMinor: number; unitsOnHand: number }>
    expect(byBranch.reduce((total, row) => total + row.stockValueMinor, 0)).toBe(
      (allBody.totals as Record<string, number>).stockValueMinor,
    )
    expect(byBranch.reduce((total, row) => total + row.unitsOnHand, 0)).toBe(
      (allBody.totals as Record<string, number>).unitsOnHand,
    )
  })

  it('trends stock movements and names the top movers', async () => {
    const today = accraIsoDay()
    const from = isoMinus(today, 20)
    const response = await get('/api/analytics/inventory', adminCookie, {
      from,
      to: today,
      branchId: branchC,
    })
    const body = (await response.json()) as Record<string, unknown>

    const movements = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.branchId, branchC))
    const expectedSold = movements
      .filter((row) => row.type === 'SALE')
      .reduce((total, row) => total - row.quantityDelta, 0)
    const expectedAdjusted = movements
      .filter((row) => row.type === 'ADJUSTMENT' || row.type === 'COUNT_VARIANCE')
      .reduce((total, row) => total + row.quantityDelta, 0)

    const flow = body.flow as Array<Record<string, number>>
    expect(flow).toHaveLength(21)
    expect(flow.reduce((total, point) => total + Number(point.soldUnits), 0)).toBe(expectedSold)
    expect(flow.reduce((total, point) => total + Number(point.adjustedUnits), 0)).toBe(
      expectedAdjusted,
    )
    expect(expectedSold).toBe(4)
    expect(expectedAdjusted).toBe(5)

    const movers = body.topMovers as Array<{ productId: string; unitsSold: number }>
    expect(movers[0]).toMatchObject({ productId: productP1, unitsSold: 3 })
    expect(movers[1]).toMatchObject({ productId: productP2, unitsSold: 1 })

    // P3 holds stock and never moved; P1/P2 both did.
    expect(body.deadStock).toEqual({ count: 1 })
  })

  it('reconciles credit to the ledger and buckets utilisation in integers', async () => {
    const response = await get('/api/analytics/credit', adminCookie, {
      ...CREDIT_PERIOD,
      branchId: branchC,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const totals = body.totals as Record<string, number | null>

    expect(totals.outstandingMinor).toBe(CREDIT_CHARGE_MINOR - CREDIT_REPAYMENT_MINOR)
    expect(totals.ledgerBalanceMinor).toBe(CREDIT_CHARGE_MINOR - CREDIT_REPAYMENT_MINOR)
    expect(totals.reconcileDriftMinor).toBe(0)
    expect(totals.limitMinor).toBe(500_000)
    expect(totals.utilisationBp).toBe(ratioBp(6_000, 500_000))
    expect(totals.customersWithBalance).toBe(1)
    expect(totals.overLimitCount).toBe(0)
    expect(totals.onHoldCount).toBe(0)
    expect(totals.overLimitExposureMinor).toBe(0)

    const distribution = body.distribution as Array<{
      label: string
      count: number
      balanceMinor: number
    }>
    expect(distribution).toHaveLength(5)
    expect(distribution.reduce((total, bucket) => total + bucket.count, 0)).toBe(
      totals.customersWithBalance,
    )
    expect(distribution.find((bucket) => bucket.label === '0-50%')).toMatchObject({
      count: 1,
      balanceMinor: 6_000,
    })

    const series = body.series as Array<{
      bucketStart: string
      chargesMinor: number
      repaymentsMinor: number
      netMinor: number
    }>
    expect(series.reduce((total, point) => total + point.chargesMinor, 0)).toBe(CREDIT_CHARGE_MINOR)
    expect(series.reduce((total, point) => total + point.repaymentsMinor, 0)).toBe(
      CREDIT_REPAYMENT_MINOR,
    )
    expect(series.reduce((total, point) => total + point.netMinor, 0)).toBe(6_000)
  })

  it('reports loyalty flows and values the liability with the owning rule', async () => {
    const response = await get('/api/analytics/loyalty', adminCookie, {
      ...CREDIT_PERIOD,
      branchId: branchC,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    const entries = await db
      .select()
      .from(loyaltyLedgerEntry)
      .where(eq(loyaltyLedgerEntry.branchId, branchC))
    const inWindow = entries.filter(
      (entry) =>
        entry.occurredAt >= new Date(`${CREDIT_PERIOD.from}T00:00:00.000Z`) &&
        entry.occurredAt < new Date('2026-10-06T00:00:00.000Z'),
    )
    const expectedIssued = inWindow
      .filter((entry) => entry.kind === 'EARN')
      .reduce((total, entry) => total + entry.pointsDelta, 0)
    const expectedRedeemed = inWindow
      .filter((entry) => entry.kind === 'REDEEM')
      .reduce((total, entry) => total - entry.pointsDelta, 0)

    const totals = body.totals as Record<string, number>
    expect(totals.issuedPoints).toBe(expectedIssued)
    expect(totals.redeemedPoints).toBe(expectedRedeemed)
    expect(expectedRedeemed).toBe(REDEEM_POINTS)
    // 50,000 pesewas at the default 1 point per cedi is 500 points, plus the sale earn.
    expect(totals.issuedPoints).toBeGreaterThanOrEqual(500)

    expect(body.expiringSoon).toMatchObject({ days: 30 })

    const liability = await get('/api/loyalty/liability', adminCookie, { branchId: branchC })
    expect(liability.status).toBe(200)
    const liabilityBody = (await liability.json()) as Record<string, number>
    expect(totals.outstandingValueMinor).toBe(liabilityBody.outstandingValueMinor)
    expect(totals.outstandingPoints).toBe(liabilityBody.outstandingPoints)

    const series = body.series as Array<{
      bucketStart: string
      issuedPoints: number
      redeemedPoints: number
      expiredPoints: number
    }>
    expect(series.reduce((total, point) => total + point.issuedPoints, 0)).toBe(expectedIssued)
    expect(series.reduce((total, point) => total + point.redeemedPoints, 0)).toBe(expectedRedeemed)
    expect(body.earnRate).toMatchObject({ pointsPerCedi: 100, earnPointsPerCedi: 1 })
  })

  it('reports payables positions and the same ageing buckets as the payables report', async () => {
    const today = accraIsoDay()
    const period = { from: isoMinus(today, 20), to: today }
    const response = await get('/api/analytics/payables', adminCookie, {
      ...period,
      branchId: branchC,
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>
    const totals = body.totals as Record<string, number>

    expect(totals.invoicedMinor).toBe(invoiceTotalMinorValue)
    expect(totals.paidMinor).toBe(paymentAmountMinorValue)
    expect(totals.outstandingMinor).toBe(invoiceTotalMinorValue - paymentAmountMinorValue)
    expect(totals.overdueMinor).toBe(totals.outstandingMinor)
    expect(totals.onAccountMinor).toBe(0)

    const buckets = body.overdueBuckets as {
      current: number
      days1To30: number
      days31To60: number
      days61To90: number
      over90: number
    }
    expect(buckets.days1To30).toBe(totals.outstandingMinor)
    expect(buckets.current).toBe(0)
    expect(buckets.days1To30 + buckets.days31To60 + buckets.days61To90 + buckets.over90).toBe(
      totals.overdueMinor,
    )

    const aging = await get('/api/payables/aging', adminCookie, { branchId: branchC })
    expect(aging.status).toBe(200)
    const agingBody = (await aging.json()) as Record<string, unknown>
    expect(agingBody.totals).toEqual(buckets)
    expect(agingBody.totalOutstandingMinor).toBe(totals.outstandingMinor)

    const topSuppliers = body.topSuppliers as Array<Record<string, string | number>>
    expect(topSuppliers[0]).toMatchObject({
      supplierId,
      outstandingMinor: totals.outstandingMinor,
      overdueMinor: totals.overdueMinor,
    })
  })

  it('refuses a manager a foreign branch on every read model', async () => {
    const paths = [
      '/api/analytics/inventory',
      '/api/analytics/credit',
      '/api/analytics/loyalty',
      '/api/analytics/payables',
    ]
    for (const path of paths) {
      const foreign = await get(path, managerCookie, {
        ...CREDIT_PERIOD,
        branchId: branchD,
      })
      expect(foreign.status).toBe(403)

      const own = await get(path, managerCookie, CREDIT_PERIOD)
      expect(own.status).toBe(200)
      const ownBody = (await own.json()) as Record<string, unknown>
      expect((ownBody.scope as Record<string, unknown>).branchId).toBe(branchC)
      if (path !== '/api/analytics/inventory') continue
      // Only an admin may compare branches.
      expect(ownBody.byBranch).toEqual([])
    }
  })

  it('carries no customer identity in any read model', async () => {
    const paths = ['/api/analytics/inventory', '/api/analytics/credit', '/api/analytics/loyalty']
    for (const path of paths) {
      const response = await get(path, adminCookie, { ...CREDIT_PERIOD, branchId: branchC })
      const serialised = JSON.stringify(await response.json())
      expect(serialised).not.toContain(creditCustomerId)
      expect(serialised).not.toContain(creditCustomerPhone)
      expect(serialised).not.toContain(creditCustomerName)
      expect(serialised).not.toContain(loyaltyCustomerId)
      expect(serialised).not.toContain(loyaltyCustomerPhone)
      expect(serialised).not.toContain(loyaltyCustomerName)
    }
  })
})
