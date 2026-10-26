import { randomUUID } from 'node:crypto'
import { db } from '@sceptre/db'
import { eq, inArray } from 'drizzle-orm'
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
import { category, uom } from '../catalog/catalog.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { device, terminal } from '../org/terminals.schema.ts'
import { setting } from '../platform/settings.schema.ts'
import { sale, saleLine, shift } from '../pos/pos.schema.ts'
import { purchaseOrder, purchaseOrderLine } from '../procurement/procurement.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierProduct } from '../suppliers/suppliers.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[replenishment.test] database unavailable; integration tests skipped')

const suffix = uniqueSuffix()
const tail = suffix.slice(-5).toUpperCase()

interface SuggestionRow {
  productId: string
  sku: string
  name: string
  supplierId: string | null
  supplierName: string | null
  leadTimeDays: number
  leadTimeAssumed: boolean
  minLevel: number
  maxLevel: number | null
  minOrderQuantity: number
  onHand: number
  onOrder: number
  unitsSold: number
  velocityDays: number
  targetLevel: number
  coverageLevel: number
  position: number
  suggested: number
  basis: string
  lastCostMinor: number
  suggestedValueMinor: number
}

interface SuggestionGroup {
  supplierId: string
  supplierName: string
  leadTimeDays: number
  leadTimeAssumed: boolean
  rows: SuggestionRow[]
  suggestedUnits: number
  totalValueMinor: number
}

interface SuggestionResponse {
  branchId: string
  velocityDays: number
  settings: { velocityDays: number; safetyDays: number; defaultLeadDays: number }
  groups: SuggestionGroup[]
  unassigned: SuggestionGroup
  totals: { rows: number; suggestedUnits: number; valueMinor: number }
  totalRows: number
}

interface PerformanceRow {
  supplierId: string
  supplierCode: string
  supplierName: string
  ordersCount: number
  linesCount: number
  onTimeLines: number
  lateLines: number
  noPromiseLines: number
  noReceiptLines: number
  onTimeRateBasisPoints: number | null
  orderedUnits: number
  receivedUnits: number
  fillRateBasisPoints: number | null
  promisedLeadDaysAverageTenths: number | null
  actualLeadDaysAverageTenths: number | null
  lastCostDriftMinor: number | null
  lastCostDriftBasisPoints: number | null
  lastCostAt: string | null
  driftComparableProducts: number
}

interface PerformanceResponse {
  branchId: string
  from: string
  to: string
  suppliers: PerformanceRow[]
  totals: {
    suppliers: number
    onTimeRateBasisPoints: number | null
    fillRateBasisPoints: number | null
  }
  exclusions: { ordersWithoutSendDate: number; linesWithoutReceipt: number }
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

let branchAId = ''
let branchBId = ''
let terminalId = ''
let deviceId = ''
let shiftId = ''

let supplierMainId = ''
let supplierNoLeadId = ''
let supplierPerfId = ''

const productIds: string[] = []
let productVelocityId = ''
let productOnOrderId = ''
let productNoHistoryId = ''
let productMoqId = ''
let productNoLevelId = ''
let productNeverStockedId = ''
let productUnassignedId = ''
let productAssumedLeadId = ''

const orderIds: string[] = []
const receiptIds: string[] = []
const movementIds: string[] = []

let adminId = ''
let managerAId = ''
let managerBId = ''
let adminCookie = ''
let managerACookie = ''
let managerBCookie = ''

async function insertThreshold(
  productId: string,
  input: { threshold: number; maxQuantity: number | null; minOrderQuantity?: number },
) {
  await db.insert(stockThreshold).values({
    productId,
    branchId: branchAId,
    threshold: input.threshold,
    maxQuantity: input.maxQuantity,
    minOrderQuantity: input.minOrderQuantity ?? 0,
  })
}

async function insertStockLevel(productId: string, quantityOnHand: number) {
  await db.insert(stockLevel).values({
    productId,
    branchId: branchAId,
    quantityOnHand,
    avgCostMinor: 1_000,
  })
}

async function insertPreferredLink(
  supplierId: string,
  productId: string,
  input: { leadTimeDays: number | null; lastCostMinor: number },
) {
  await db.insert(supplierProduct).values({
    supplierId,
    productId,
    leadTimeDays: input.leadTimeDays,
    lastCostMinor: input.lastCostMinor,
    isPreferred: true,
  })
}

/** One completed sale with the given lines, so velocity reads a real fact. */
async function insertSale(
  receiptNumber: string,
  occurredAt: Date,
  lines: { productId: string; sku: string; name: string; quantity: number }[],
) {
  const saleId = randomUUID()
  await db.insert(sale).values({
    id: saleId,
    receiptNumber,
    branchId: branchAId,
    terminalId,
    deviceId,
    shiftId,
    clientTransactionId: randomUUID(),
    cashierUserId: adminId,
    cashierStaffId: 'GA-0001',
    occurredAt,
    subtotalMinor: 0,
    totalMinor: 0,
    tenderTotalMinor: 0,
    taxMode: 'INCLUSIVE',
  })
  await db.insert(saleLine).values(
    lines.map((line, index) => ({
      saleId,
      productId: line.productId,
      lineNumber: index + 1,
      sku: line.sku,
      name: line.name,
      quantity: line.quantity,
      unitPriceMinor: 1_000,
      expectedUnitPriceMinor: 1_000,
      netMinor: 0,
      taxableMinor: 0,
      baseMinor: 0,
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
      taxTotalMinor: 0,
      totalMinor: 0,
      taxCategory: 'STANDARD' as const,
      priceSource: 'BASE',
    })),
  )
}

async function insertOrder(input: {
  number: string
  submittedAt: Date | null
  sentAt: Date | null
  expectedDate: string | null
  status: 'APPROVED' | 'SENT' | 'RECEIVED'
}): Promise<string> {
  const rows = await db
    .insert(purchaseOrder)
    .values({
      number: input.number,
      branchId: branchAId,
      supplierId: supplierPerfId,
      status: input.status,
      requestedBy: 'test',
      submittedAt: input.submittedAt,
      sentAt: input.sentAt,
      expectedDate: input.expectedDate,
    })
    .returning({ id: purchaseOrder.id })
  const orderId = rows[0]?.id ?? ''
  orderIds.push(orderId)
  return orderId
}

async function insertOrderLine(
  orderId: string,
  lineNumber: number,
  productId: string,
  quantity: number,
  unitCostMinor: number,
): Promise<string> {
  const rows = await db
    .insert(purchaseOrderLine)
    .values({ orderId, lineNumber, productId, quantity, unitCostMinor })
    .returning({ id: purchaseOrderLine.id })
  return rows[0]?.id ?? ''
}

/** A receipt with an explicit date, and the movement its line must cite. */
async function insertReceipt(input: {
  number: string
  createdAt: Date
  lines: {
    productId: string
    quantity: number
    unitCostMinor: number
    purchaseOrderLineId: string
  }[]
}): Promise<void> {
  const rows = await db
    .insert(stockReceipt)
    .values({
      number: input.number,
      branchId: branchAId,
      supplierId: supplierPerfId,
      supplierName: `Perf supplier ${suffix}`,
      createdAt: input.createdAt,
      createdBy: 'test',
    })
    .returning({ id: stockReceipt.id })
  const receiptId = rows[0]?.id ?? ''
  receiptIds.push(receiptId)

  for (const line of input.lines) {
    const movements = await db
      .insert(stockMovement)
      .values({
        productId: line.productId,
        branchId: branchAId,
        type: 'RECEIPT',
        quantityDelta: line.quantity,
        unitCostMinor: line.unitCostMinor,
        referenceType: 'RECEIPT',
        referenceId: receiptId,
        referenceNumber: input.number,
        createdBy: 'test',
      })
      .returning({ id: stockMovement.id })
    const movementId = movements[0]?.id ?? ''
    movementIds.push(movementId)

    await db.insert(stockReceiptLine).values({
      receiptId,
      productId: line.productId,
      quantity: line.quantity,
      unitCostMinor: line.unitCostMinor,
      movementId,
      purchaseOrderLineId: line.purchaseOrderLineId,
    })
  }
}

beforeAll(async () => {
  if (!available) return

  const branches = await db
    .insert(branch)
    .values([
      { code: `RA${tail.slice(-4)}`, name: `Replenish A ${suffix}`, city: 'Accra' },
      { code: `RB${tail.slice(-4)}`, name: `Replenish B ${suffix}`, city: 'Kumasi' },
    ])
    .returning({ id: branch.id })
  branchAId = branches[0]?.id ?? ''
  branchBId = branches[1]?.id ?? ''

  const [unit] = await db
    .insert(uom)
    .values({ code: `U${tail.slice(-5)}`, name: `Replenish unit ${suffix}` })
    .returning({ id: uom.id })
  const [categoryRow] = await db
    .insert(category)
    .values({ name: `Replenish category ${suffix}` })
    .returning({ id: category.id })
  const categoryId = categoryRow?.id ?? ''
  const uomId = unit?.id ?? ''

  const suppliers = await db
    .insert(supplier)
    .values([
      { code: `SM${tail.slice(-4)}`, name: `Main supplier ${suffix}` },
      { code: `SN${tail.slice(-4)}`, name: `No-lead supplier ${suffix}` },
      { code: `SP${tail.slice(-4)}`, name: `Perf supplier ${suffix}` },
    ])
    .returning({ id: supplier.id })
  supplierMainId = suppliers[0]?.id ?? ''
  supplierNoLeadId = suppliers[1]?.id ?? ''
  supplierPerfId = suppliers[2]?.id ?? ''

  const products = await db
    .insert(product)
    .values([
      {
        sku: `RV${tail}`,
        name: `Velocity part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RO${tail}`,
        name: `On-order part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RN${tail}`,
        name: `No-history part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RM${tail}`,
        name: `Minimum-order part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RL${tail}`,
        name: `No-level part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RS${tail}`,
        name: `Never-stocked part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RU${tail}`,
        name: `Unassigned part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RA${tail}`,
        name: `Assumed-lead part ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 700,
      },
      {
        sku: `RP${tail}`,
        name: `Performance part A ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 5_000,
      },
      {
        sku: `RQ${tail}`,
        name: `Performance part B ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 3_000,
      },
    ])
    .returning({ id: product.id })

  const ids = products.map((row) => row.id)
  productVelocityId = ids[0] ?? ''
  productOnOrderId = ids[1] ?? ''
  productNoHistoryId = ids[2] ?? ''
  productMoqId = ids[3] ?? ''
  productNoLevelId = ids[4] ?? ''
  productNeverStockedId = ids[5] ?? ''
  productUnassignedId = ids[6] ?? ''
  productAssumedLeadId = ids[7] ?? ''
  const productPerfAId = ids[8] ?? ''
  const productPerfBId = ids[9] ?? ''
  productIds.push(...ids)

  const admin = await createTestUser({ role: 'ADMIN', email: `repl-admin-${suffix}@test.local` })
  const managerA = await createTestUser({
    role: 'MANAGER',
    branchId: branchAId,
    email: `repl-mgr-a-${suffix}@test.local`,
  })
  const managerB = await createTestUser({
    role: 'MANAGER',
    branchId: branchBId,
    email: `repl-mgr-b-${suffix}@test.local`,
  })
  adminId = admin.id
  managerAId = managerA.id
  managerBId = managerB.id
  adminCookie = await signIn(admin.email)
  managerACookie = await signIn(managerA.email)
  managerBCookie = await signIn(managerB.email)

  const [terminalRow] = await db
    .insert(terminal)
    .values({ branchId: branchAId, code: `RT${tail.slice(-4)}`, name: `Replenish till ${suffix}` })
    .returning({ id: terminal.id })
  terminalId = terminalRow?.id ?? ''

  const [deviceRow] = await db
    .insert(device)
    .values({
      terminalId,
      fingerprint: `replenish-fp-${suffix}`,
      tokenHash: `replenish-token-${suffix}`,
    })
    .returning({ id: device.id })
  deviceId = deviceRow?.id ?? ''

  const [shiftRow] = await db
    .insert(shift)
    .values({
      number: `RSHIFT-${tail}`,
      branchId: branchAId,
      terminalId,
      deviceId,
      cashierUserId: adminId,
      cashierStaffId: 'GA-0001',
      status: 'OPEN',
      openedAt: new Date(),
    })
    .returning({ id: shift.id })
  shiftId = shiftRow?.id ?? ''

  // Preferred suppliers: one with a real lead time, one with none.
  await insertPreferredLink(supplierMainId, productVelocityId, {
    leadTimeDays: 7,
    lastCostMinor: 500,
  })
  await insertPreferredLink(supplierMainId, productOnOrderId, {
    leadTimeDays: 7,
    lastCostMinor: 500,
  })
  await insertPreferredLink(supplierMainId, productNoHistoryId, {
    leadTimeDays: 7,
    lastCostMinor: 500,
  })
  await insertPreferredLink(supplierMainId, productMoqId, { leadTimeDays: 7, lastCostMinor: 500 })
  await insertPreferredLink(supplierMainId, productNoLevelId, {
    leadTimeDays: 7,
    lastCostMinor: 500,
  })
  await insertPreferredLink(supplierMainId, productNeverStockedId, {
    leadTimeDays: 7,
    lastCostMinor: 500,
  })
  await insertPreferredLink(supplierNoLeadId, productAssumedLeadId, {
    leadTimeDays: null,
    lastCostMinor: 500,
  })

  await insertThreshold(productVelocityId, { threshold: 40, maxQuantity: 40 })
  await insertThreshold(productOnOrderId, { threshold: 40, maxQuantity: 40 })
  await insertThreshold(productNoHistoryId, { threshold: 10, maxQuantity: 40 })
  await insertThreshold(productMoqId, { threshold: 10, maxQuantity: 40, minOrderQuantity: 50 })
  await insertThreshold(productNoLevelId, { threshold: 10, maxQuantity: null })
  await insertThreshold(productNeverStockedId, { threshold: 5, maxQuantity: 20 })
  await insertThreshold(productUnassignedId, { threshold: 10, maxQuantity: 20 })
  await insertThreshold(productAssumedLeadId, { threshold: 1, maxQuantity: null })

  await insertStockLevel(productVelocityId, 10)
  await insertStockLevel(productOnOrderId, 10)
  await insertStockLevel(productNoHistoryId, 10)
  await insertStockLevel(productMoqId, 10)
  await insertStockLevel(productNoLevelId, 10)
  await insertStockLevel(productUnassignedId, 5)

  const now = Date.now()
  const DAY = 86_400_000

  // 900 units inside the trailing window, 50 outside it: the window is the test.
  await insertSale(`RV-${suffix}-1`, new Date(now - 30 * DAY), [
    { productId: productVelocityId, sku: `RV${tail}`, name: 'Velocity part', quantity: 900 },
    { productId: productOnOrderId, sku: `RO${tail}`, name: 'On-order part', quantity: 900 },
  ])
  await insertSale(`RV-${suffix}-2`, new Date(now - 100 * DAY), [
    { productId: productVelocityId, sku: `RV${tail}`, name: 'Velocity part', quantity: 50 },
  ])

  // One approved order, so its outstanding quantity must stop a second order.
  const onOrder = await db
    .insert(purchaseOrder)
    .values({
      number: `PO-ONORDER-${tail}`,
      branchId: branchAId,
      supplierId: supplierMainId,
      status: 'APPROVED',
      requestedBy: 'test',
      submittedAt: new Date(),
    })
    .returning({ id: purchaseOrder.id })
  const onOrderId = onOrder[0]?.id ?? ''
  orderIds.push(onOrderId)
  await insertOrderLine(onOrderId, 1, productOnOrderId, 130, 500)

  // --- performance fixtures, all in a January 2026 window -------------------
  const jan = (day: number, hour = 9) => new Date(Date.UTC(2026, 0, day, hour))

  const p1 = await insertOrder({
    number: `PERF-1-${tail}`,
    submittedAt: jan(5),
    sentAt: jan(5),
    expectedDate: '2026-01-12',
    status: 'RECEIVED',
  })
  const p1Line1 = await insertOrderLine(p1, 1, productPerfAId, 100, 5_000)
  // Line 2 is ordered and never delivered: the fill rate must feel it.
  await insertOrderLine(p1, 2, productPerfBId, 50, 3_000)

  const p2 = await insertOrder({
    number: `PERF-2-${tail}`,
    submittedAt: jan(6),
    sentAt: jan(6),
    expectedDate: '2026-01-10',
    status: 'RECEIVED',
  })
  const p2Line1 = await insertOrderLine(p2, 1, productPerfAId, 100, 5_500)

  const p3 = await insertOrder({
    number: `PERF-3-${tail}`,
    submittedAt: jan(7),
    sentAt: null,
    expectedDate: null,
    status: 'APPROVED',
  })
  await insertOrderLine(p3, 1, productPerfBId, 10, 3_000)

  const p4 = await insertOrder({
    number: `PERF-4-${tail}`,
    submittedAt: jan(8),
    sentAt: jan(8),
    expectedDate: '2026-01-09',
    status: 'RECEIVED',
  })
  const p4Line1 = await insertOrderLine(p4, 1, productPerfBId, 20, 3_000)

  await insertReceipt({
    number: `RC-1-${tail}`,
    createdAt: jan(8, 15),
    lines: [
      {
        productId: productVelocityId,
        quantity: 80,
        unitCostMinor: 5_000,
        purchaseOrderLineId: p1Line1,
      },
    ],
  })
  await insertReceipt({
    number: `RC-2-${tail}`,
    createdAt: jan(15, 15),
    lines: [
      {
        productId: productVelocityId,
        quantity: 120,
        unitCostMinor: 5_500,
        purchaseOrderLineId: p2Line1,
      },
    ],
  })
  await insertReceipt({
    number: `RC-3-${tail}`,
    createdAt: jan(9, 15),
    lines: [
      {
        productId: productNoHistoryId,
        quantity: 20,
        unitCostMinor: 3_000,
        purchaseOrderLineId: p4Line1,
      },
    ],
  })
})

afterAll(async () => {
  if (!available) return

  await db.delete(stockReceiptLine).where(inArray(stockReceiptLine.receiptId, receiptIds))
  await db.delete(stockReceipt).where(inArray(stockReceipt.id, receiptIds))
  await db.delete(stockMovement).where(inArray(stockMovement.id, movementIds))
  await db.delete(purchaseOrder).where(inArray(purchaseOrder.id, orderIds))
  await db.delete(saleLine).where(inArray(saleLine.productId, productIds))
  await db.delete(sale).where(eq(sale.shiftId, shiftId))
  await db.delete(shift).where(eq(shift.id, shiftId))
  await db.delete(device).where(eq(device.id, deviceId))
  await db.delete(terminal).where(eq(terminal.id, terminalId))
  await db.delete(stockLevel).where(inArray(stockLevel.branchId, [branchAId, branchBId]))
  await db.delete(stockThreshold).where(inArray(stockThreshold.branchId, [branchAId, branchBId]))
  await db.delete(supplierProduct).where(inArray(supplierProduct.productId, productIds))
  await db.delete(product).where(inArray(product.id, productIds))
  await db
    .delete(supplier)
    .where(inArray(supplier.id, [supplierMainId, supplierNoLeadId, supplierPerfId]))
  await db.delete(setting).where(inArray(setting.branchId, [branchAId, branchBId]))
  for (const id of [adminId, managerAId, managerBId]) {
    if (id) await deleteTestUser(id)
  }
  await db.delete(branch).where(inArray(branch.id, [branchAId, branchBId]))
})

async function suggestions(query: string, cookie = managerACookie): Promise<SuggestionResponse> {
  const response = await app.request(`/api/replenishment/suggestions?${query}`, {
    headers: authedHeaders(cookie),
  })
  expect(response.status).toBe(200)
  return readJson<SuggestionResponse>(response)
}

function rowFor(body: SuggestionResponse, productId: string): SuggestionRow {
  const rows = [...body.groups.flatMap((group) => group.rows), ...body.unassigned.rows]
  const row = rows.find((candidate) => candidate.productId === productId)
  if (!row) throw new Error(`No suggestion row for ${productId}`)
  return row
}

describe.skipIf(!available)('replenishment suggestions', () => {
  it('computes coverage from sales, lead time and safety days, and shows every input', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productVelocityId)

    // 900 sold over 90 days, 7-day lead time, 7 safety days:
    // ceilDiv(900 × 14, 90) = 140, on hand 10 → 130.
    expect(body.velocityDays).toBe(90)
    expect(body.settings).toEqual({ velocityDays: 90, safetyDays: 7, defaultLeadDays: 14 })
    expect(row.unitsSold).toBe(900)
    expect(row.leadTimeDays).toBe(7)
    expect(row.leadTimeAssumed).toBe(false)
    expect(row.coverageLevel).toBe(140)
    expect(row.targetLevel).toBe(140)
    expect(row.position).toBe(10)
    expect(row.suggested).toBe(130)
    expect(row.basis).toBe('COVERAGE')
    expect(row.onHand).toBe(10)
    expect(row.onOrder).toBe(0)
    expect(row.suggestedValueMinor).toBe(130 * 500)
    expect(Number.isSafeInteger(row.suggestedValueMinor)).toBe(true)
  })

  it('will not order a part that is already on its way', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productOnOrderId)

    expect(row.onOrder).toBe(130)
    expect(row.position).toBe(140)
    expect(row.suggested).toBe(0)
    expect(row.basis).toBe('AT_TARGET')
  })

  it('falls back to the stored maximum when the branch has no history', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productNoHistoryId)

    expect(row.unitsSold).toBe(0)
    expect(row.coverageLevel).toBe(0)
    expect(row.targetLevel).toBe(40)
    expect(row.suggested).toBe(30)
    expect(row.basis).toBe('NO_HISTORY')
  })

  it('lets a supplier minimum set the answer even at target', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productMoqId)

    expect(row.minOrderQuantity).toBe(50)
    expect(row.suggested).toBe(50)
    expect(row.basis).toBe('MIN_ORDER')
  })

  it('says there is no level rather than inventing demand', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productNoLevelId)

    expect(row.maxLevel).toBeNull()
    expect(row.coverageLevel).toBe(0)
    expect(row.suggested).toBe(0)
    expect(row.basis).toBe('NO_LEVEL')
  })

  it('includes a part the branch has never stocked', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productNeverStockedId)

    expect(row.onHand).toBe(0)
    expect(row.onOrder).toBe(0)
    expect(row.suggested).toBe(20)
  })

  it('groups by preferred supplier and keeps unassigned rows out of the groups', async () => {
    const body = await suggestions(`branchId=${branchAId}`)

    const mainGroup = body.groups.find((group) => group.supplierId === supplierMainId)
    expect(mainGroup?.supplierName).toBe(`Main supplier ${suffix}`)
    expect(mainGroup?.rows.some((row) => row.productId === productVelocityId)).toBe(true)
    expect(mainGroup?.leadTimeDays).toBe(7)

    expect(body.unassigned.supplierId).toBe('')
    expect(body.unassigned.rows.map((row) => row.productId)).toContain(productUnassignedId)
    expect(body.groups.flatMap((group) => group.rows).map((row) => row.productId)).not.toContain(
      productUnassignedId,
    )

    // The unassigned row is priced from the derived catalogue cost, not a link.
    const unassignedRow = rowFor(body, productUnassignedId)
    expect(unassignedRow.supplierId).toBeNull()
    expect(unassignedRow.lastCostMinor).toBe(700)
    expect(unassignedRow.suggestedValueMinor).toBe(15 * 700)
  })

  it('assumes the default lead time and says so', async () => {
    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productAssumedLeadId)

    expect(row.supplierId).toBe(supplierNoLeadId)
    expect(row.leadTimeDays).toBe(14)
    expect(row.leadTimeAssumed).toBe(true)
    const group = body.groups.find((candidate) => candidate.supplierId === supplierNoLeadId)
    expect(group?.leadTimeAssumed).toBe(true)
  })

  it('only shows rows worth ordering when asked, with totals that add up', async () => {
    const body = await suggestions(`branchId=${branchAId}&onlySuggested=true`)
    const rows = [...body.groups.flatMap((group) => group.rows), ...body.unassigned.rows]

    expect(rows.every((row) => row.suggested > 0)).toBe(true)
    expect(rows.map((row) => row.productId)).not.toContain(productNoLevelId)
    expect(rows.map((row) => row.productId)).not.toContain(productOnOrderId)
    expect(body.totals.rows).toBe(rows.length)
    expect(body.totals.suggestedUnits).toBe(rows.reduce((total, row) => total + row.suggested, 0))
    expect(body.totals.valueMinor).toBe(
      rows.reduce((total, row) => total + row.suggestedValueMinor, 0),
    )
  })

  it('searches by SKU', async () => {
    const body = await suggestions(`branchId=${branchAId}&q=RN${tail}`)
    const rows = [...body.groups.flatMap((group) => group.rows), ...body.unassigned.rows]

    expect(rows).toHaveLength(1)
    expect(rows[0]?.productId).toBe(productNoHistoryId)
    expect(body.totalRows).toBe(1)
  })

  it('refuses another branch, and asks an admin to choose one', async () => {
    const foreign = await app.request(`/api/replenishment/suggestions?branchId=${branchAId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(foreign.status).toBe(403)

    const unscoped = await app.request('/api/replenishment/suggestions', {
      headers: authedHeaders(adminCookie),
    })
    expect(unscoped.status).toBe(400)

    const scoped = await app.request(`/api/replenishment/suggestions?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(scoped.status).toBe(200)
  })

  it('uses a branch override of the safety days', async () => {
    await db
      .insert(setting)
      .values({ key: 'procurement.safetyDays', value: 0, branchId: branchAId })

    const body = await suggestions(`branchId=${branchAId}`)
    const row = rowFor(body, productVelocityId)

    // 900 × (7 lead + 0 safety) / 90 = 70, on hand 10 → 60.
    expect(row.coverageLevel).toBe(70)
    expect(row.targetLevel).toBe(70)
    expect(row.suggested).toBe(60)

    await db.delete(setting).where(eq(setting.branchId, branchAId))
  })
})

describe.skipIf(!available)('supplier performance', () => {
  const window = 'from=2026-01-01&to=2026-01-31'

  async function performance(
    query = window,
    cookie = managerACookie,
  ): Promise<PerformanceResponse> {
    const response = await app.request(
      `/api/replenishment/suppliers/performance?branchId=${branchAId}&${query}`,
      { headers: authedHeaders(cookie) },
    )
    expect(response.status, await response.clone().text()).toBe(200)
    return readJson<PerformanceResponse>(response)
  }

  it('measures on-time delivery against the promised date, counting early as on time', async () => {
    const body = await performance()
    const row = body.suppliers[0]

    expect(body.suppliers).toHaveLength(1)
    expect(row?.supplierId).toBe(supplierPerfId)
    expect(row?.ordersCount).toBe(4)
    expect(row?.linesCount).toBe(5)
    // P1 line 1 (due 12th, arrived 8th) and P4 (due 9th, arrived 9th) on time;
    // P2 (due 10th, arrived 15th) late.
    expect(row?.onTimeLines).toBe(2)
    expect(row?.lateLines).toBe(1)
    expect(row?.onTimeRateBasisPoints).toBe(6_667)
    // P3 promised nothing, P1 line 2 promised a date but nothing has arrived.
    expect(row?.noPromiseLines).toBe(1)
    expect(row?.noReceiptLines).toBe(1)
  })

  it('caps the fill rate at 100 per cent and counts what was ordered', async () => {
    const body = await performance()
    const row = body.suppliers[0]

    expect(row?.orderedUnits).toBe(280)
    expect(row?.receivedUnits).toBe(220)
    // 200 fillable of 270 ordered across the three orders that received anything.
    expect(row?.fillRateBasisPoints).toBe(7_407)
    expect(row?.fillRateBasisPoints).toBeLessThanOrEqual(10_000)
  })

  it('measures lead time from the send date, in tenths of a day', async () => {
    const body = await performance()
    const row = body.suppliers[0]

    // 3, 9 and 1 whole days → 43 tenths; promised 7, 4 and 1 → exactly 40.
    expect(row?.actualLeadDaysAverageTenths).toBe(43)
    expect(row?.promisedLeadDaysAverageTenths).toBe(40)
    expect(body.exclusions.ordersWithoutSendDate).toBe(1)
    expect(body.exclusions.linesWithoutReceipt).toBe(2)
  })

  it('reports the last-cost drift between the two newest receipts', async () => {
    const body = await performance()
    const row = body.suppliers[0]

    expect(row?.lastCostDriftMinor).toBe(500)
    expect(row?.lastCostDriftBasisPoints).toBe(1_000)
    expect(row?.driftComparableProducts).toBe(1)
    expect(row?.lastCostAt?.slice(0, 10)).toBe('2026-01-15')
  })

  it('returns null rather than zero when a rate has no denominator', async () => {
    const body = await performance('from=2025-12-01&to=2025-12-31')

    expect(body.suppliers).toHaveLength(0)
    expect(body.totals.suppliers).toBe(0)
    expect(body.totals.onTimeRateBasisPoints).toBeNull()
    expect(body.totals.fillRateBasisPoints).toBeNull()
  })

  it('refuses another branch and a reversed range', async () => {
    const foreign = await app.request(
      `/api/replenishment/suppliers/performance?branchId=${branchAId}&${window}`,
      { headers: authedHeaders(managerBCookie) },
    )
    expect(foreign.status).toBe(403)

    const reversed = await app.request(
      `/api/replenishment/suppliers/performance?branchId=${branchAId}&from=2026-02-01&to=2026-01-01`,
      { headers: authedHeaders(managerACookie) },
    )
    expect(reversed.status).toBe(400)
  })
})
