import { db } from '@sceptre/db'
import { accraIsoDay } from '@sceptre/shared'
import { and, eq, gte, inArray, lt, sql } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { enforceExportCap, MAX_EXPORT_ROWS } from '../../http/csv.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { stockCount } from '../counts/counts.schema.ts'
import { creditLedgerEntry, creditProfile } from '../credit/credit.schema.ts'
import { customer } from '../customers/customers.schema.ts'
import { loyaltyAccount, loyaltyLedgerEntry } from '../loyalty/loyalty.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { supplierInvoice } from '../payables/payables.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { writeAudit } from '../platform/audit.service.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import { transfer } from '../transfers/transfers.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockMovementTypeEnum,
  stockThreshold,
} from './inventory.schema.ts'

/**
 * The stock report and the five exports (Plan 05).
 *
 * Every assertion is a reconciliation, not a shape: totals against SQL, a manager's
 * rows against the admin's row for the same branch, an export against the JSON report
 * the screen renders, and the audit body against the PII the audit rows actually hold.
 */

const available = await databaseAvailable()
if (!available) console.warn('[inventory.report.test] database unavailable; skipped')

const PERIOD = { from: '2026-10-01', to: '2026-10-31' } as const
/** A future `to` is clamped to today (a UI shortcut, not an error), so the effective end moves. */
const EFFECTIVE_TO = accraIsoDay() < PERIOD.to ? accraIsoDay() : PERIOD.to
const FORMULA_NAME = "=cmd|' /C calc'!A0"

interface StockReportResponse {
  asOf: string
  period: { from: string; to: string }
  branchId: string | null
  rows: Array<{
    productId: string
    sku: string
    productName: string
    categoryName: string
    branchId: string
    branchCode: string
    quantityOnHand: number
    avgCostMinor: number
    valueMinor: number
    threshold: number | null
    belowThreshold: boolean
  }>
  total: number
  truncated: boolean
  totals: { quantityOnHand: number; valueMinor: number; products: number }
  byBranch: Array<{
    branchCode: string
    branchName: string
    quantityOnHand: number
    valueMinor: number
  }>
  movements: { inflow: number; outflow: number; byType: Array<{ type: string; quantity: number }> }
  transfers: { dispatched: number; received: number; shortClosed: number }
  counts: {
    completed: number
    countedLines: number
    matchedLines: number
    varianceValueMinor: number
  }
}

async function get(path: string, cookie: string): Promise<Response> {
  return app.request(path, { headers: authedHeaders(cookie) })
}

async function getJson<T>(path: string, cookie: string): Promise<T> {
  const response = await get(path, cookie)
  expect(response.status, `GET ${path}`).toBe(200)
  return (await response.json()) as T
}

function csvLines(body: string): string[] {
  return body.replace(/^\uFEFF/, '').split('\r\n')
}

/** SQL total for one branch, straight from the projection — the report must match it. */
async function sqlStockTotals(branchId: string) {
  const [row] = await db
    .select({
      quantityOnHand: sql<number>`coalesce(sum(${stockLevel.quantityOnHand}), 0)::bigint`.mapWith(
        Number,
      ),
      valueMinor:
        sql<number>`coalesce(sum(${stockLevel.quantityOnHand}::bigint * ${stockLevel.avgCostMinor}), 0)::bigint`.mapWith(
          Number,
        ),
      rowCount: sql<number>`count(*)::bigint`.mapWith(Number),
    })
    .from(stockLevel)
    .where(eq(stockLevel.branchId, branchId))
  return row ?? { quantityOnHand: 0, valueMinor: 0, rowCount: 0 }
}

describe.skipIf(!available)('stock report and exports', () => {
  const suffix = uniqueSuffix()
  const createdUserIds: string[] = []
  const createdBranchIds: string[] = []
  const createdProductIds: string[] = []
  const createdCustomerIds: string[] = []
  const createdSupplierIds: string[] = []
  const createdInvoiceIds: string[] = []
  const createdTransferIds: string[] = []
  const createdCountIds: string[] = []

  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''
  let branchAId = ''
  let branchBId = ''
  let branchCId = ''
  let branchACode = ''
  let branchBCode = ''
  let uomId = ''
  let categoryId = ''
  let productOneId = ''
  let productTwoId = ''

  beforeAll(async () => {
    const branches = await db
      .insert(branch)
      .values([
        {
          code: `RP${suffix}-A`.toUpperCase().slice(0, 20),
          name: `Report Branch A ${suffix}`,
          type: 'RETAIL',
          city: 'Accra',
        },
        {
          code: `RP${suffix}-B`.toUpperCase().slice(0, 20),
          name: `Report Branch B ${suffix}`,
          type: 'RETAIL',
          city: 'Kumasi',
        },
      ])
      .returning({ id: branch.id, code: branch.code })
    branchAId = branches[0]?.id ?? ''
    branchBId = branches[1]?.id ?? ''
    branchACode = branches[0]?.code ?? ''
    branchBCode = branches[1]?.code ?? ''
    createdBranchIds.push(branchAId, branchBId)

    const admin = await createTestUser({ role: 'ADMIN', name: 'Report Admin' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Report Mgr',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const cashier = await createTestUser({
      role: 'CASHIER',
      branchId: branchAId,
      name: 'Report Till',
    })
    createdUserIds.push(cashier.id)
    cashierCookie = await signIn(cashier.email)

    const units = await db
      .insert(uom)
      .values({ code: `R${suffix}`.toUpperCase().slice(0, 10), name: `Report Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''

    const categories = await db
      .insert(category)
      .values({ name: `Report Cat ${suffix}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `RPT-${suffix}-1`,
          name: `Report Product One ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 1_000,
          basePriceMinor: 2_500,
        },
        {
          sku: `RPT-${suffix}-2`,
          name: `${FORMULA_NAME} ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 2_000,
          basePriceMinor: 4_000,
        },
      ])
      .returning({ id: product.id })
    productOneId = products[0]?.id ?? ''
    productTwoId = products[1]?.id ?? ''
    createdProductIds.push(productOneId, productTwoId)

    // The projection is the report's basis: 10 × 1 000 at A, 5 × 2 000 at A, 7 × 500 at B.
    await db.insert(stockLevel).values([
      { productId: productOneId, branchId: branchAId, quantityOnHand: 10, avgCostMinor: 1_000 },
      { productId: productTwoId, branchId: branchAId, quantityOnHand: 5, avgCostMinor: 2_000 },
      { productId: productOneId, branchId: branchBId, quantityOnHand: 7, avgCostMinor: 500 },
    ])

    await db.insert(stockThreshold).values([
      { productId: productOneId, branchId: branchAId, threshold: 20 },
      { productId: productOneId, branchId: branchBId, threshold: 3 },
    ])

    // One of every movement type the ledger stores, plus one outside the period.
    const movement = (
      type: (typeof stockMovementTypeEnum.enumValues)[number],
      delta: number,
      at: string,
    ) => ({
      productId: productOneId,
      branchId: branchAId,
      type,
      quantityDelta: delta,
      unitCostMinor: 1_000,
      referenceType: 'ADJUSTMENT' as const,
      createdAt: new Date(at),
    })
    await db
      .insert(stockMovement)
      .values([
        movement('RECEIPT', 10, '2026-10-05T10:00:00.000Z'),
        movement('SALE', -2, '2026-10-06T10:00:00.000Z'),
        movement('WRITE_OFF', -1, '2026-10-07T10:00:00.000Z'),
        movement('RETURN', 1, '2026-10-08T10:00:00.000Z'),
        movement('SUPPLIER_RETURN', -1, '2026-10-09T10:00:00.000Z'),
        movement('SALE', -5, '2026-12-01T10:00:00.000Z'),
      ])

    // A credit customer at each branch, so a manager's file can be told apart from an admin's.
    const customers = await db
      .insert(customer)
      .values([
        { name: `Credit A ${suffix}`, createdBranchId: branchAId },
        { name: `Credit B ${suffix}`, createdBranchId: branchBId },
      ])
      .returning({ id: customer.id })
    const creditAId = customers[0]?.id ?? ''
    const creditBId = customers[1]?.id ?? ''
    createdCustomerIds.push(creditAId, creditBId)

    await db.insert(creditProfile).values([
      { customerId: creditAId, branchId: branchAId, balanceMinor: 50_000, paymentTermDays: 0 },
      { customerId: creditBId, branchId: branchBId, balanceMinor: 70_000, paymentTermDays: 0 },
    ])
    await db.insert(creditLedgerEntry).values([
      {
        customerId: creditAId,
        branchId: branchAId,
        kind: 'CHARGE',
        amountMinor: 50_000,
        reasonCode: 'SALE',
        dueDate: '2026-09-01',
        occurredAt: new Date('2026-09-01T10:00:00.000Z'),
      },
      {
        customerId: creditBId,
        branchId: branchBId,
        kind: 'CHARGE',
        amountMinor: 70_000,
        reasonCode: 'SALE',
        dueDate: '2026-09-01',
        occurredAt: new Date('2026-09-01T10:00:00.000Z'),
      },
    ])

    const suppliers = await db
      .insert(supplier)
      .values([
        { code: `SUP-${suffix}-A`.toUpperCase(), name: `Payable A ${suffix}` },
        { code: `SUP-${suffix}-B`.toUpperCase(), name: `Payable B ${suffix}` },
      ])
      .returning({ id: supplier.id })
    const supplierAId = suppliers[0]?.id ?? ''
    const supplierBId = suppliers[1]?.id ?? ''
    createdSupplierIds.push(supplierAId, supplierBId)

    const invoices = await db
      .insert(supplierInvoice)
      .values([
        {
          number: `PB-${suffix}-A`.toUpperCase(),
          supplierId: supplierAId,
          branchId: branchAId,
          supplierInvoiceNumber: `INV-${suffix}-A`,
          invoiceDate: '2026-08-01',
          dueDate: '2026-09-01',
          subtotalMinor: 30_000,
          totalMinor: 30_000,
        },
        {
          number: `PB-${suffix}-B`.toUpperCase(),
          supplierId: supplierBId,
          branchId: branchBId,
          supplierInvoiceNumber: `INV-${suffix}-B`,
          invoiceDate: '2026-08-01',
          dueDate: '2026-09-01',
          subtotalMinor: 40_000,
          totalMinor: 40_000,
        },
      ])
      .returning({ id: supplierInvoice.id })
    createdInvoiceIds.push(...invoices.map((invoice) => invoice.id))

    // Loyalty: one account and one earn at each branch.
    const accounts = await db
      .insert(loyaltyAccount)
      .values([
        { customerId: creditAId, balancePoints: 500 },
        { customerId: creditBId, balancePoints: 700 },
      ])
      .returning({ id: loyaltyAccount.id })
    const accountAId = accounts[0]?.id ?? ''
    const accountBId = accounts[1]?.id ?? ''
    await db.insert(loyaltyLedgerEntry).values([
      {
        accountId: accountAId,
        customerId: creditAId,
        branchId: branchAId,
        kind: 'EARN',
        pointsDelta: 500,
        occurredAt: new Date('2026-10-05T10:00:00.000Z'),
      },
      {
        accountId: accountBId,
        customerId: creditBId,
        branchId: branchBId,
        kind: 'EARN',
        pointsDelta: 700,
        occurredAt: new Date('2026-10-05T10:00:00.000Z'),
      },
    ])

    // Transfers and counts: one row inside the tested window, one a day outside it.
    const transfers = await db
      .insert(transfer)
      .values([
        {
          number: `TR-${suffix}-A`,
          fromBranchId: branchAId,
          toBranchId: branchBId,
          status: 'DISPATCHED',
          dispatchedAt: new Date('2026-10-10T09:00:00.000Z'),
        },
        {
          number: `TR-${suffix}-B`,
          fromBranchId: branchBId,
          toBranchId: branchAId,
          status: 'DISPATCHED',
          dispatchedAt: new Date('2026-10-20T09:00:00.000Z'),
        },
      ])
      .returning({ id: transfer.id })
    createdTransferIds.push(...transfers.map((row) => row.id))

    const counts = await db
      .insert(stockCount)
      .values([
        {
          number: `CNT-${suffix}-A`,
          branchId: branchAId,
          status: 'POSTED',
          postedAt: new Date('2026-10-05T09:00:00.000Z'),
          createdAt: new Date('2026-10-05T09:00:00.000Z'),
        },
        {
          number: `CNT-${suffix}-B`,
          branchId: branchAId,
          status: 'POSTED',
          postedAt: new Date('2026-10-15T09:00:00.000Z'),
          createdAt: new Date('2026-10-15T09:00:00.000Z'),
        },
      ])
      .returning({ id: stockCount.id })
    createdCountIds.push(...counts.map((row) => row.id))
  })

  afterAll(async () => {
    await db.delete(auditLog).where(sql`${auditLog.action} like 'report.test.%'`)
    if (createdCountIds.length > 0) {
      await db.delete(stockCount).where(inArray(stockCount.id, createdCountIds))
    }
    if (createdTransferIds.length > 0) {
      await db.delete(transfer).where(inArray(transfer.id, createdTransferIds))
    }
    if (createdCustomerIds.length > 0) {
      await db
        .delete(loyaltyLedgerEntry)
        .where(inArray(loyaltyLedgerEntry.customerId, createdCustomerIds))
      await db.delete(loyaltyAccount).where(inArray(loyaltyAccount.customerId, createdCustomerIds))
      await db
        .delete(creditLedgerEntry)
        .where(inArray(creditLedgerEntry.customerId, createdCustomerIds))
      await db.delete(creditProfile).where(inArray(creditProfile.customerId, createdCustomerIds))
    }
    if (createdInvoiceIds.length > 0) {
      await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, createdInvoiceIds))
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, createdSupplierIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
      await db.delete(stockThreshold).where(inArray(stockThreshold.branchId, createdBranchIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdCustomerIds.length > 0) {
      await db.delete(customer).where(inArray(customer.id, createdCustomerIds))
    }
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    for (const id of createdUserIds) await deleteTestUser(id)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('values stock from the projection and reconciles it with SQL', async () => {
    const report = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchAId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    const expected = await sqlStockTotals(branchAId)

    expect(report.asOf).toMatch(/^\d{4}-\d{2}-\d{2}T/)
    expect(report.period).toEqual({ from: PERIOD.from, to: EFFECTIVE_TO })
    expect(report.totals.valueMinor).toBe(expected.valueMinor)
    expect(report.totals.quantityOnHand).toBe(expected.quantityOnHand)
    expect(report.totals.products).toBe(2)
    expect(report.total).toBe(expected.rowCount)
    expect(report.truncated).toBe(false)
    expect(report.rows).toHaveLength(expected.rowCount)

    for (const row of report.rows) {
      expect(row.valueMinor).toBe(row.quantityOnHand * row.avgCostMinor)
      expect(Number.isInteger(row.valueMinor)).toBe(true)
    }
    const low = report.rows.find((row) => row.productId === productOneId)
    expect(low?.belowThreshold).toBe(true)
    expect(low?.threshold).toBe(20)

    // A manager's figure for their own branch is the admin's figure for it.
    const asManager = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?${new URLSearchParams(PERIOD).toString()}`,
      managerCookie,
    )
    expect(asManager.branchId).toBe(branchAId)
    expect(asManager.totals).toEqual(report.totals)
    expect(asManager.byBranch).toEqual([])
  })

  it('sums an admin is byBranch, and a manager is forced to their own branch', async () => {
    const whole = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?categoryId=${categoryId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    expect(whole.byBranch.length).toBeGreaterThanOrEqual(2)
    expect(whole.byBranch.reduce((total, row) => total + row.valueMinor, 0)).toBe(
      whole.totals.valueMinor,
    )
    expect(whole.byBranch.reduce((total, row) => total + row.quantityOnHand, 0)).toBe(
      whole.totals.quantityOnHand,
    )
    const branchARow = whole.byBranch.find((row) => row.branchCode === branchACode)
    const branchAOnly = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchAId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    expect(branchARow?.valueMinor).toBe(branchAOnly.totals.valueMinor)

    const foreign = await get(
      `/api/inventory/stock/report?branchId=${branchBId}&${new URLSearchParams(PERIOD).toString()}`,
      managerCookie,
    )
    expect(foreign.status).toBe(403)

    const lowStock = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchAId}&lowStock=true&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    expect(lowStock.rows.map((row) => row.productId)).toEqual([productOneId])
  })

  // 5 001 products is a real fixture, not a mock: the insert and the delete dominate the
  // runtime, and the cap is the one behaviour that cannot be proven with three rows.
  it('caps the row list at 5 000 and says it is truncated', { timeout: 30_000 }, async () => {
    const created = await db
      .insert(branch)
      .values({
        code: `RPC-${suffix}`.toUpperCase().slice(0, 20),
        name: `Report Cap ${suffix}`,
        type: 'RETAIL',
        city: 'Accra',
      })
      .returning({ id: branch.id })
    branchCId = created[0]?.id ?? ''
    createdBranchIds.push(branchCId)

    const rows = Array.from({ length: 5_001 }, (_, index) => ({
      sku: `CAP-${suffix}-${index}`,
      name: `Cap Product ${index}`,
      categoryId,
      uomId,
      costPriceMinor: 100,
      basePriceMinor: 200,
    }))
    const products = await db.insert(product).values(rows).returning({ id: product.id })
    const productIds = products.map((row) => row.id)
    createdProductIds.push(...productIds)

    await db.insert(stockLevel).values(
      productIds.map((productId) => ({
        productId,
        branchId: branchCId,
        quantityOnHand: 1,
        avgCostMinor: 100,
      })),
    )

    const report = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchCId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    expect(report.total).toBe(5_001)
    expect(report.rows).toHaveLength(5_000)
    expect(report.truncated).toBe(true)
    // The total is the whole filter, not the capped page: a truncated table still reconciles.
    expect(report.totals.valueMinor).toBe(500_100)
    expect(report.totals.quantityOnHand).toBe(5_001)

    const exportResponse = await get(
      `/api/inventory/stock/report/export?branchId=${branchCId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    expect(exportResponse.status).toBe(200)
    const lines = csvLines(await exportResponse.text())
    expect(lines).toHaveLength(5_000 + 2)
    expect(lines.at(-1)?.startsWith(',TOTAL,')).toBe(true)
  })

  it('reports movements by type, and the movement filter names what the ledger stores', async () => {
    const report = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchAId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )

    const ledgerSum = report.movements.byType.reduce((total, row) => total + row.quantity, 0)
    expect(ledgerSum).toBe(report.movements.inflow - report.movements.outflow)
    expect(report.movements.inflow).toBe(11)
    expect(report.movements.outflow).toBe(4)

    const [sqlSum] = await db
      .select({
        value: sql<number>`coalesce(sum(${stockMovement.quantityDelta}), 0)::bigint`.mapWith(
          Number,
        ),
      })
      .from(stockMovement)
      .where(
        and(
          eq(stockMovement.branchId, branchAId),
          gte(stockMovement.createdAt, new Date('2026-10-01T00:00:00.000Z')),
          lt(stockMovement.createdAt, new Date('2026-11-01T00:00:00.000Z')),
        ),
      )
    expect(ledgerSum).toBe(sqlSum?.value ?? 0)

    const sales = await getJson<{
      movements: Array<{ type: string; quantityDelta: number }>
      total: number
    }>(
      `/api/inventory/movements?branchId=${branchAId}&type=SALE&from=2026-10-01&to=2026-10-31`,
      adminCookie,
    )
    expect(sales.total).toBe(1)
    expect(sales.movements).toHaveLength(1)
    expect(sales.movements[0]?.type).toBe('SALE')
    expect(sales.movements[0]?.quantityDelta).toBe(-2)

    // Parity is derived from the pg enum, not from a hand-copied array: the day a type is
    // added to the table it is filterable, instead of the day somebody notices.
    for (const type of stockMovementTypeEnum.enumValues) {
      const response = await get(
        `/api/inventory/movements?branchId=${branchAId}&type=${type}&limit=1`,
        adminCookie,
      )
      expect(response.status, `type=${type}`).toBe(200)
    }
  })

  it('counts transfers and counts inside the period only, and the lists agree', async () => {
    const report = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchAId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    const transfers = await getJson<{ transfers: Array<{ number: string }>; total: number }>(
      `/api/transfers?branchId=${branchAId}&status=DISPATCHED&from=2026-10-01&to=2026-10-31`,
      adminCookie,
    )
    expect(transfers.total).toBe(2)
    expect(report.transfers.dispatched).toBe(2)

    // One day narrower: the 20 Oct dispatch falls outside, and the report agrees.
    const narrow = await getJson<{ transfers: Array<{ number: string }>; total: number }>(
      `/api/transfers?branchId=${branchAId}&from=2026-10-01&to=2026-10-19`,
      adminCookie,
    )
    expect(narrow.total).toBe(1)
    expect(narrow.transfers[0]?.number).toBe(`TR-${suffix}-A`)
    const narrowReport = await getJson<StockReportResponse>(
      `/api/inventory/stock/report?branchId=${branchAId}&from=2026-10-01&to=2026-10-19`,
      adminCookie,
    )
    expect(narrowReport.transfers.dispatched).toBe(1)

    const counts = await getJson<{ counts: Array<{ number: string }>; total: number }>(
      `/api/counts?branchId=${branchAId}&from=2026-10-01&to=2026-10-10`,
      adminCookie,
    )
    expect(counts.total).toBe(1)
    expect(counts.counts[0]?.number).toBe(`CNT-${suffix}-A`)

    const accuracy = await getJson<{
      countsPosted: number
      countedLines: number
      matchedLines: number
      varianceValueMinor: number
    }>(`/api/counts/accuracy?branchId=${branchAId}&from=2026-10-01&to=2026-10-31`, adminCookie)
    expect(report.counts).toEqual({
      completed: accuracy.countsPosted,
      countedLines: accuracy.countedLines,
      matchedLines: accuracy.matchedLines,
      varianceValueMinor: accuracy.varianceValueMinor,
    })
  })

  it('serves the stock export with one row per product, a TOTAL, and an escaped formula', async () => {
    const response = await get(
      `/api/inventory/stock/report/export?branchId=${branchAId}&${new URLSearchParams(PERIOD).toString()}`,
      adminCookie,
    )
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    expect(response.headers.get('content-disposition')).toBe(
      `attachment; filename="sceptre-stock-${branchACode.toLowerCase()}-2026-10-01-${EFFECTIVE_TO}.csv"`,
    )

    const bytes = new Uint8Array(await response.arrayBuffer())
    // `Response.text()` decodes UTF-8 and drops the BOM, so the bytes are the evidence.
    expect([...bytes.slice(0, 3)]).toEqual([0xef, 0xbb, 0xbf])
    const body = new TextDecoder('utf-8', { ignoreBOM: true }).decode(bytes)
    expect(body.replaceAll('\r\n', '')).not.toContain('\n')
    const lines = csvLines(body)
    expect(lines[0]).toBe(
      'product_id,sku,product_name,category,branch_code,quantity_on_hand,avg_cost_minor,value_minor,threshold,below_threshold,as_of',
    )
    // Two products plus the TOTAL — never a single TOTAL row (P14-D17).
    expect(lines).toHaveLength(1 + 2 + 1)
    const total = lines.at(-1) ?? ''
    expect(total.startsWith(',TOTAL,')).toBe(true)
    expect(total).toContain(',20000,')

    // A product named `=cmd|…` is a formula in a spreadsheet unless the cell is escaped.
    expect(body).toContain(`'${FORMULA_NAME}`)
  })

  it("keeps a manager's credit ageing as their customers, not one TOTAL row", async () => {
    const json = await getJson<{ branches: Array<{ totals: { total: number } }> }>(
      `/api/credit/aging?branchId=${branchAId}`,
      adminCookie,
    )
    const response = await get(`/api/credit/aging/export?branchId=${branchAId}`, managerCookie)
    expect(response.status).toBe(200)
    const lines = csvLines(await response.text())
    expect(lines[0]).toBe(
      'branch_code,customer_id,customer_name,current_minor,days_1_30_minor,days_31_60_minor,days_61_90_minor,over_90_minor,total_minor,oldest_due_date',
    )
    expect(lines).toHaveLength(1 + 1 + 1)
    expect(lines[1]).toContain(`Credit A ${suffix}`)
    expect(lines[1]).not.toContain(`Credit B ${suffix}`)
    const totalRow = lines.at(-1) ?? ''
    expect(totalRow).toContain(',TOTAL,')
    expect(totalRow).toContain(`,${json.branches[0]?.totals.total},`)

    const foreign = await get(`/api/credit/aging/export?branchId=${branchBId}`, managerCookie)
    expect(foreign.status).toBe(403)
  })

  it("keeps a manager's payables ageing as their suppliers, not one TOTAL row", async () => {
    const json = await getJson<{ totalOutstandingMinor: number }>(
      `/api/payables/aging?branchId=${branchAId}`,
      adminCookie,
    )
    const response = await get(`/api/payables/aging/export?branchId=${branchAId}`, managerCookie)
    expect(response.status).toBe(200)
    const lines = csvLines(await response.text())
    expect(lines[0]).toBe(
      'branch_code,supplier_id,supplier_code,supplier_name,current_minor,days_1_30_minor,days_31_60_minor,days_61_90_minor,over_90_minor,total_outstanding_minor,on_account_minor,credit_notes_minor',
    )
    expect(lines).toHaveLength(1 + 1 + 1)
    expect(lines[1]).toContain(`Payable A ${suffix}`)
    expect(lines[1]).not.toContain(`Payable B ${suffix}`)
    expect(lines.at(-1)).toContain(`,TOTAL,`)
    expect(lines.at(-1)).toContain(`,${json.totalOutstandingMinor},`)

    const foreign = await get(`/api/payables/aging/export?branchId=${branchBId}`, managerCookie)
    expect(foreign.status).toBe(403)
  })

  it("keeps a manager's loyalty liability to their branch's activity", async () => {
    const response = await get(
      `/api/loyalty/liability/export?branchId=${branchAId}&from=2026-10-01&to=2026-10-31`,
      managerCookie,
    )
    expect(response.status).toBe(200)
    const body = await response.text()
    const lines = csvLines(body)
    expect(lines[0]).toBe('section,branch_code,label,points,value_minor')
    expect(lines.length).toBeGreaterThan(3)
    expect(lines.at(-1)?.startsWith('total,')).toBe(true)
    expect(lines.at(-1)).toContain('TOTAL')
    // The manager's own branch activity is present; another branch's is not.
    expect(body).toContain(`,${branchACode},`)
    expect(body).not.toContain(`,${branchBCode},`)

    const foreign = await get(`/api/loyalty/liability/export?branchId=${branchBId}`, managerCookie)
    expect(foreign.status).toBe(403)
  })

  it('exports the audit trail without the payload it was written with', async () => {
    await writeAudit({
      action: 'report.test.customer',
      entity: 'customer',
      entityId: 'customer-1',
      actorStaffId: 'GA-EXPORT-1',
      branchId: branchAId,
      requestId: 'req-1',
      before: { email: 'seeded.customer@example.com', phone: '0244000111' },
      after: { email: 'seeded.customer@example.com', phone: '0244000111' },
    })
    await writeAudit({
      action: 'report.test.customer',
      entity: 'customer',
      entityId: 'customer-2',
      actorStaffId: 'GA-EXPORT-2',
      branchId: branchBId,
      before: { email: 'other.customer@example.com', phone: '0209999888' },
    })

    const response = await get('/api/audit/export?action=report.test.customer', adminCookie)
    expect(response.status).toBe(200)
    expect(response.headers.get('content-type')).toBe('text/csv; charset=utf-8')
    expect(response.headers.get('cache-control')).toBe('no-store, private')
    const body = await response.text()
    const lines = csvLines(body)

    expect(lines[0]).toBe(
      'created_at,actor_staff_id,action,entity,entity_id,branch_id,terminal_id,request_id',
    )
    expect(lines).toHaveLength(1 + 2)
    expect(body).not.toContain('before')
    expect(body).not.toContain('after')
    expect(body).not.toContain('seeded.customer@example.com')
    expect(body).not.toContain('0244000111')
    expect(body).not.toContain('other.customer@example.com')
    expect(body).not.toContain('0209999888')
    expect(body).toContain('GA-EXPORT-1')

    // A manager exports their branch and never another's.
    const asManager = await get('/api/audit/export?action=report.test.customer', managerCookie)
    expect(asManager.status).toBe(200)
    const managerBody = await asManager.text()
    expect(managerBody).toContain('GA-EXPORT-1')
    expect(managerBody).not.toContain('GA-EXPORT-2')

    const foreign = await get(`/api/audit/export?branchId=${branchBId}`, managerCookie)
    expect(foreign.status).toBe(403)
  })

  it('refuses a cashier every report and every export', async () => {
    const paths = [
      `/api/inventory/stock/report?branchId=${branchAId}`,
      `/api/inventory/stock/report/export?branchId=${branchAId}`,
      '/api/credit/aging/export',
      '/api/payables/aging/export',
      '/api/loyalty/liability/export',
      '/api/audit/export',
    ]
    for (const path of paths) {
      const response = await get(path, cashierCookie)
      expect(response.status, path).toBe(403)
    }
  })

  it('refuses the 50 001st row rather than streaming a partial ledger', () => {
    expect(MAX_EXPORT_ROWS).toBe(50_000)
    expect(() => enforceExportCap(MAX_EXPORT_ROWS)).not.toThrow()
    expect(() => enforceExportCap(MAX_EXPORT_ROWS + 1)).toThrow(/at most 50000 rows/)
  })
})
