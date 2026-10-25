import { db } from '@sceptre/db'
import { priceCart } from '@sceptre/shared'
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
