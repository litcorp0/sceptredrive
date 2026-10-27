import { db } from '@sceptre/db'
import { accraIsoDay } from '@sceptre/shared'
import { eq, inArray, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
} from '../../test/integration.ts'
import { app } from '../app.ts'
import { category, uom } from '../modules/catalog/catalog.schema.ts'
import { selectCountAccuracy } from '../modules/counts/counts.repository.ts'
import { stockCount, stockCountLine } from '../modules/counts/counts.schema.ts'
import { creditLedgerEntry, creditProfile } from '../modules/credit/credit.schema.ts'
import { customer } from '../modules/customers/customers.schema.ts'
import { user as userTable } from '../modules/identity/staff.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockThreshold,
} from '../modules/inventory/inventory.schema.ts'
import {
  loyaltyAccount,
  loyaltyLedgerEntry,
  loyaltyLot,
  loyaltyLotConsumption,
} from '../modules/loyalty/loyalty.schema.ts'
import { branch } from '../modules/org/branches.schema.ts'
import { device, terminal } from '../modules/org/terminals.schema.ts'
import {
  posStaffBinding,
  sale,
  shift,
  shiftReport,
  syncConflict,
} from '../modules/pos/pos.schema.ts'
import { product } from '../modules/products/products.schema.ts'
import {
  DEMO_SALES_BRANCHES,
  type DemoPlanOptions,
  demoClientTransactionId,
  planDemoCounts,
  planDemoSales,
  roundUpToNote,
} from './demo-sales.plan.ts'
import { seedDemoSales } from './demo-sales.ts'

const available = await databaseAvailable()
if (!available) console.warn('[demo-sales.test] database unavailable; integration tests skipped')

const DAY_MS = 86_400_000

function plannerOptions(overrides: Partial<DemoPlanOptions> = {}): DemoPlanOptions {
  return {
    endDay: '2026-10-24',
    days: 14,
    seed: 20261024,
    branches: [
      {
        code: 'TST-A',
        name: 'Test A',
        city: 'Accra',
        terminals: ['TST-A-T01', 'TST-A-T02'],
      },
      {
        code: 'TST-B',
        name: 'Test B',
        city: 'Kumasi',
        terminals: ['TST-B-T01'],
      },
    ],
    products: [
      { id: 'p1', priceMinor: 7_500, costMinor: 4_500, taxCategory: 'STANDARD' },
      { id: 'p2', priceMinor: 12_000, costMinor: 7_500, taxCategory: 'STANDARD' },
      { id: 'p3', priceMinor: 28_000, costMinor: 18_000, taxCategory: 'STANDARD' },
      { id: 'p4', priceMinor: 4_500, costMinor: 2_000, taxCategory: 'STANDARD' },
    ],
    customers: [
      { id: 'c-credit', kind: 'CREDIT', loyalty: false },
      { id: 'c-loyal', kind: 'CASH', loyalty: true },
    ],
    ...overrides,
  }
}

describe('demo sales planner', () => {
  it('is deterministic for the same options', () => {
    const first = planDemoSales(plannerOptions())
    const second = planDemoSales(plannerOptions())
    expect(second).toEqual(first)
    expect(first.length).toBeGreaterThan(0)
    expect(new Set(first.map((entry) => entry.clientTransactionId)).size).toBe(first.length)
    expect(new Set(first.map((entry) => entry.receiptNumber)).size).toBe(first.length)
  })

  it('trades only inside opening hours and never on a Sunday evening', () => {
    const sales = planDemoSales(plannerOptions())

    for (const entry of sales) {
      expect(entry.occurredAt.startsWith(`${entry.day}T`)).toBe(true)
      const hour = Number(entry.occurredAt.slice(11, 13))
      expect(hour).toBeGreaterThanOrEqual(9)
      expect(hour).toBeLessThan(19)

      const weekday = new Date(`${entry.day}T00:00:00.000Z`).getUTCDay()
      if (weekday === 0) expect(hour).toBeLessThan(15)
    }
  })

  it('keeps credit a minority of trade and always against a credit customer', () => {
    const sales = planDemoSales(plannerOptions())
    const credit = sales.filter((entry) => entry.tender === 'CREDIT')
    const share = credit.length / sales.length

    expect(share).toBeGreaterThanOrEqual(0.1)
    expect(share).toBeLessThanOrEqual(0.3)
    for (const entry of credit) expect(entry.customerId).toBe('c-credit')
  })

  it('hands over a note that covers the basket, so change is a whole number of coins', () => {
    const sales = planDemoSales(plannerOptions())
    const cash = sales.filter((entry) => entry.tender === 'CASH')
    expect(cash.length).toBeGreaterThan(0)

    for (const entry of cash) {
      const gross = entry.lines.reduce(
        (total, line) => total + line.unitPriceMinor * line.quantity,
        0,
      )
      expect(entry.cashTenderedMinor).toBeGreaterThanOrEqual(gross)
      expect((entry.cashTenderedMinor - gross) % 50).toBe(0)
    }
    expect(roundUpToNote(1)).toBe(1_000)
    expect(roundUpToNote(7_600)).toBe(10_000)
    expect(roundUpToNote(120_000)).toBe(200_000)
  })

  it('derives storefront coverage for both demo branches', () => {
    const codes = DEMO_SALES_BRANCHES.map((entry) => entry.code)
    expect(codes).toEqual(['ACC-SPX', 'KUM-ASO'])
    // A UUID the `sale.client_transaction_id` column will accept.
    const id = demoClientTransactionId('A', 'T', '2026-10-01', 1)
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
    expect(demoClientTransactionId('A', 'T', '2026-10-01', 1)).toBe(id)
  })

  it('plans a deterministic quarter of count history with a real variance mix', () => {
    const productIds = Array.from({ length: 12 }, (_, index) => `p${index + 1}`)
    const options = {
      branchCode: 'ACC-SPX',
      endDay: '2026-10-24',
      productIds,
      seed: 20261024,
    }
    const counts = planDemoCounts(options)
    expect(planDemoCounts(options)).toEqual(counts)
    expect(counts).toHaveLength(3)
    expect(new Set(counts.map((count) => count.number)).size).toBe(3)

    const lines = counts.flatMap((count) => count.lines)
    const matched = lines.filter((line) => line.delta === 0)
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.length).toBeLessThan(lines.length)

    for (const count of counts) {
      // Every count has lines, one per product, and is inside the 90-day window.
      expect(count.lines.length).toBeGreaterThanOrEqual(6)
      expect(new Set(count.lines.map((line) => line.productId)).size).toBe(count.lines.length)
      const age = new Date('2026-10-24T00:00:00.000Z').getTime()
      const day = new Date(`${count.dueAt}T00:00:00.000Z`).getTime()
      expect(day).toBeLessThan(age)
      expect(age - day).toBeLessThanOrEqual(90 * DAY_MS)
      expect(count.postedAt.startsWith(count.dueAt)).toBe(true)
    }

    // Each product's last counted day varies, so ROTATION has a real order.
    const lastCounted = new Map<string, string>()
    for (const count of counts) {
      for (const line of count.lines) lastCounted.set(line.productId, count.dueAt)
    }
    expect(lastCounted.size).toBe(productIds.length)
    expect(new Set(lastCounted.values()).size).toBeGreaterThan(1)
  })
})

describe.skipIf(!available)('seed:demo-sales writer', () => {
  const suffix = randomToken(4)
  const branchCode = `TMP-${suffix}`
  const terminalCode = `${branchCode}-T01`
  const createdUserIds: string[] = []

  let branchId = ''
  let cashierUserId = ''
  let cashierStaffId = ''
  let adminCookie = ''
  let productA = ''
  let productB = ''
  let categoryId = ''
  let uomId = ''
  let creditCustomerId = ''
  let loyaltyCustomerId = ''
  let creditCustomerPhone = ''
  let loyaltyCustomerPhone = ''

  async function cleanup(): Promise<void> {
    if (!branchId) return
    await db.delete(syncConflict).where(eq(syncConflict.branchId, branchId))
    await db.delete(sale).where(eq(sale.branchId, branchId))
    // Posted counts reference the branch and their lines reference products with
    // RESTRICT: the counts (lines cascade) go before the products do.
    await db.delete(stockCount).where(eq(stockCount.branchId, branchId))
    // Receipt lines reference movements with ON DELETE RESTRICT, so the receipt (and its
    // cascading lines) must go before the ledger rows.
    await db.delete(stockReceipt).where(eq(stockReceipt.branchId, branchId))
    await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
    // The Z-report is immutable history and the shift FK is RESTRICT, so the
    // test removes the snapshots before the shifts they belong to.
    await db.delete(shiftReport).where(eq(shiftReport.branchId, branchId))
    await db.delete(shift).where(eq(shift.branchId, branchId))
    await db.delete(creditLedgerEntry).where(eq(creditLedgerEntry.branchId, branchId))
    await db.delete(creditProfile).where(eq(creditProfile.branchId, branchId))

    const customers = await db
      .select({ id: customer.id })
      .from(customer)
      .where(eq(customer.createdBranchId, branchId))
    const customerIds = customers.map((entry) => entry.id)
    if (customerIds.length > 0) {
      const accounts = await db
        .select({ id: loyaltyAccount.id })
        .from(loyaltyAccount)
        .where(inArray(loyaltyAccount.customerId, customerIds))
      const accountIds = accounts.map((entry) => entry.id)
      if (accountIds.length > 0) {
        // Lots reference their earning entry with ON DELETE RESTRICT: consumptions, then
        // lots, then the ledger, then the account.
        const lots = await db
          .select({ id: loyaltyLot.id })
          .from(loyaltyLot)
          .where(inArray(loyaltyLot.accountId, accountIds))
        const lotIds = lots.map((entry) => entry.id)
        if (lotIds.length > 0) {
          await db.delete(loyaltyLotConsumption).where(inArray(loyaltyLotConsumption.lotId, lotIds))
          await db.delete(loyaltyLot).where(inArray(loyaltyLot.id, lotIds))
        }
        await db.delete(loyaltyLedgerEntry).where(inArray(loyaltyLedgerEntry.accountId, accountIds))
        await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.id, accountIds))
      }
      await db.delete(customer).where(inArray(customer.id, customerIds))
    }

    await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
    await db.delete(stockThreshold).where(eq(stockThreshold.branchId, branchId))
    if (productA) await db.delete(product).where(eq(product.id, productA))
    if (productB) await db.delete(product).where(eq(product.id, productB))
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))

    const terminals = await db
      .select({ id: terminal.id })
      .from(terminal)
      .where(eq(terminal.branchId, branchId))
    for (const row of terminals) {
      const devices = await db
        .select({ id: device.id })
        .from(device)
        .where(eq(device.terminalId, row.id))
      for (const entry of devices) {
        await db.delete(posStaffBinding).where(eq(posStaffBinding.deviceId, entry.id))
        await db.delete(device).where(eq(device.id, entry.id))
      }
    }
    await db.delete(terminal).where(eq(terminal.branchId, branchId))
    await db.delete(branch).where(eq(branch.id, branchId))
    for (const id of createdUserIds) await deleteTestUser(id)
  }

  beforeAll(async () => {
    const branchRow = await db
      .insert(branch)
      .values({ code: branchCode, name: `Demo Sales ${suffix}`, type: 'RETAIL', city: 'Accra' })
      .returning()
    branchId = branchRow[0]?.id ?? ''

    const categoryRow = await db
      .insert(category)
      .values({ name: `Demo Sales Category ${suffix}` })
      .returning()
    categoryId = categoryRow[0]?.id ?? ''
    const uomRow = await db
      .insert(uom)
      .values({ code: `D${suffix}`.slice(0, 8), name: 'Piece' })
      .returning()
    uomId = uomRow[0]?.id ?? ''

    const productRows = await db
      .insert(product)
      .values([
        {
          sku: `DS-1-${suffix}`,
          name: `Demo Sales Part ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 4_500,
          basePriceMinor: 7_500,
          taxCategory: 'STANDARD',
        },
        {
          sku: `DS-2-${suffix}`,
          name: `Demo Sales Filter ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 7_500,
          basePriceMinor: 12_000,
          taxCategory: 'STANDARD',
        },
      ])
      .returning()
    productA = productRows[0]?.id ?? ''
    productB = productRows[1]?.id ?? ''

    creditCustomerPhone = `+23355${String(Date.now()).slice(-7)}`
    loyaltyCustomerPhone = `+23356${String(Date.now()).slice(-7)}`
    const creditRow = await db
      .insert(customer)
      .values({
        name: `Demo Sales Credit ${suffix}`,
        phone: creditCustomerPhone,
        createdBranchId: branchId,
      })
      .returning()
    creditCustomerId = creditRow[0]?.id ?? ''
    const loyaltyRow = await db
      .insert(customer)
      .values({
        name: `Demo Sales Loyal ${suffix}`,
        phone: loyaltyCustomerPhone,
        createdBranchId: branchId,
      })
      .returning()
    loyaltyCustomerId = loyaltyRow[0]?.id ?? ''

    const cashier = await createTestUser({ role: 'CASHIER', branchId })
    createdUserIds.push(cashier.id)
    cashierUserId = cashier.id
    cashierStaffId = `GA-D${suffix.slice(0, 3)}`
    await db
      .update(userTable)
      .set({ staffId: cashierStaffId, pinVersion: 1 })
      .where(eq(userTable.id, cashier.id))

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)
  })

  afterAll(cleanup)

  async function runSeed() {
    return seedDemoSales({
      endDay: accraIsoDay(),
      days: 3,
      seed: 424_242,
      branches: [
        {
          code: branchCode,
          name: `Demo Sales ${suffix}`,
          city: 'Accra',
          terminals: [terminalCode],
          cashier: { userId: cashierUserId, staffId: cashierStaffId },
        },
      ],
      products: [
        {
          id: productA,
          sku: `DS-1-${suffix}`,
          priceMinor: 7_500,
          costMinor: 4_500,
          taxCategory: 'STANDARD',
        },
        {
          id: productB,
          sku: `DS-2-${suffix}`,
          priceMinor: 12_000,
          costMinor: 7_500,
          taxCategory: 'STANDARD',
        },
      ],
      creditCustomerIds: [creditCustomerId],
      loyaltyCustomerIds: [loyaltyCustomerId],
    })
  }

  it('writes the month through applySale and refuses to repeat itself', async () => {
    const first = await runSeed()
    expect(first.sales).toBeGreaterThan(0)
    expect(first.shifts).toBe(3)

    const sales = await db.select().from(sale).where(eq(sale.branchId, branchId))
    expect(sales).toHaveLength(first.sales)
    // Every sale carries the client id the plan derived, so a rerun would collide.
    expect(new Set(sales.map((row) => row.receiptNumber)).size).toBe(sales.length)

    const second = await runSeed()
    expect(second).toEqual({ created: [], sales: 0, shifts: 0 })
    const afterSecond = await db.select().from(sale).where(eq(sale.branchId, branchId))
    expect(afterSecond).toHaveLength(sales.length)
    // Each sale is one service transaction; three days of trade needs more than the
    // default five seconds.
  }, 180_000)

  it('posts count history that reconciles to the stock ledger', async () => {
    const counts = await db.select().from(stockCount).where(eq(stockCount.branchId, branchId))
    expect(counts).toHaveLength(3)
    expect(counts.every((row) => row.status === 'POSTED')).toBe(true)
    expect(counts.every((row) => row.postedAt !== null && row.dueAt !== null)).toBe(true)

    const countIds = counts.map((row) => row.id)
    const lines = await db
      .select()
      .from(stockCountLine)
      .where(inArray(stockCountLine.countId, countIds))
    // Two demo products, so a two-line slice per count.
    expect(lines).toHaveLength(counts.length * 2)
    const counted = lines.filter((line) => line.countedQty !== null)
    expect(counted).toHaveLength(lines.length)
    const matched = counted.filter((line) => line.countedQty === line.snapshotQty)
    expect(matched.length).toBeGreaterThan(0)
    expect(matched.length).toBeLessThan(counted.length)

    const today = accraIsoDay()
    const todayStart = new Date(`${today}T00:00:00.000Z`).getTime()
    const accuracy = await selectCountAccuracy(
      branchId,
      new Date(todayStart - 90 * DAY_MS),
      new Date(todayStart + DAY_MS),
    )
    expect(accuracy.countsPosted).toBe(3)
    expect(accuracy.countedLines).toBe(lines.length)
    expect(accuracy.accuracyBp).toBeGreaterThan(0)
    expect(accuracy.accuracyBp).toBeLessThan(10_000)

    // The append-only ledger still explains the projection, per product.
    const levels = await db
      .select({ productId: stockLevel.productId, quantityOnHand: stockLevel.quantityOnHand })
      .from(stockLevel)
      .where(eq(stockLevel.branchId, branchId))
    const sums = await db
      .select({
        productId: stockMovement.productId,
        quantity: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)`.mapWith(Number),
      })
      .from(stockMovement)
      .where(eq(stockMovement.branchId, branchId))
      .groupBy(stockMovement.productId)
    const byProduct = new Map(sums.map((row) => [row.productId, row.quantity]))

    expect(levels.length).toBeGreaterThan(0)
    for (const level of levels) {
      expect(level.quantityOnHand).toBe(byProduct.get(level.productId) ?? 0)
    }
  })

  it('leaves the overview reconciling to the sales and the tax split', async () => {
    const today = accraIsoDay()
    const from = new Date(new Date(`${today}T00:00:00.000Z`).getTime() - 2 * DAY_MS)
      .toISOString()
      .slice(0, 10)
    const params = new URLSearchParams({ from, to: today, branchId })
    const response = await app.request(`/api/analytics/overview?${params.toString()}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as Record<string, unknown>

    const rows = await db.select().from(sale).where(eq(sale.branchId, branchId))
    const expectedTake = rows.reduce((total, row) => total + row.totalMinor, 0)
    const expectedTax = rows.reduce((total, row) => total + row.taxTotalMinor, 0)

    const totals = body.totals as Record<string, number>
    expect(totals.takeMinor).toBe(expectedTake)
    expect(totals.salesCount).toBe(rows.length)
    expect((totals.tax as unknown as Record<string, number>).totalMinor).toBe(expectedTax)
    expect(body.driftMinor).toEqual({ revenue: 0, tax: 0 })
  })

  it('leaves POS reconciliation clean for the seeded branch', async () => {
    const response = await app.request(`/api/pos/reconciliation?branchId=${branchId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(response.status).toBe(200)
    const body = (await response.json()) as { sales: unknown[]; shifts: unknown[] }
    expect(body.sales).toEqual([])
    expect(body.shifts).toEqual([])
  })
})
