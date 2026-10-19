import { db } from '@gikautos/db'
import { and, eq, inArray } from 'drizzle-orm'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  authedHeaders,
  createTestUser,
  databaseAvailable,
  deleteTestUser,
  randomToken,
  signIn,
  uniqueSuffix,
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier } from '../suppliers/suppliers.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
  stockThreshold,
} from './inventory.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[inventory.api.test] database unavailable; integration tests skipped')

interface ReceiptLineResponse {
  productId: string
  sku: string
  productName: string
  quantity: number
  unitCostMinor: number
}

interface ReceiptResponse {
  id: string
  number: string
  branchId: string
  supplierId: string | null
  supplierName: string | null
  supplierInvoiceNumber: string | null
  lineCount: number
  totalCostMinor: number
  lines: ReceiptLineResponse[]
}

interface StockRowResponse {
  productId: string
  sku: string
  productName: string
  quantityOnHand: number
  avgCostMinor: number
  valueMinor: number
  threshold: number | null
  isLow: boolean
}

interface MovementResponse {
  id: string
  productId: string
  type: string
  quantityDelta: number
  referenceNumber: string | null
  reasonCode: string | null
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('inventory API', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  const createdReceiptIds: string[] = []
  const createdProductIds: string[] = []
  const createdSupplierIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let branchAId = ''
  let branchBId = ''
  let productAId = ''
  let productBId = ''
  let categoryId = ''
  let uomId = ''

  beforeAll(async () => {
    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const branchAResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `IV${randomToken(2)}-A`,
        name: 'Inventory API Branch A',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchAResponse.status).toBe(201)
    branchAId = (await readJson<{ branch: { id: string } }>(branchAResponse)).branch.id
    createdBranchIds.push(branchAId)

    const branchBResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `IV${randomToken(2)}-B`,
        name: 'Inventory API Branch B',
        type: 'RETAIL',
        city: 'Accra',
      }),
    })
    expect(branchBResponse.status).toBe(201)
    branchBId = (await readJson<{ branch: { id: string } }>(branchBResponse)).branch.id
    createdBranchIds.push(branchBId)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Inventory API Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const units = await db
      .insert(uom)
      .values({ code: `I${suffix}`.toUpperCase(), name: `Inventory API Unit ${suffix}` })
      .returning({ id: uom.id })
    uomId = units[0]?.id ?? ''

    const categories = await db
      .insert(category)
      .values({ name: `Inventory API Cat ${suffix}` })
      .returning({ id: category.id })
    categoryId = categories[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `IAPI-${suffix}-1`,
          name: `API Product One ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 900,
          basePriceMinor: 2_000,
        },
        {
          sku: `IAPI-${suffix}-2`,
          name: `API Product Two ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 1_800,
          basePriceMinor: 4_000,
        },
      ])
      .returning({ id: product.id })
    productAId = products[0]?.id ?? ''
    productBId = products[1]?.id ?? ''
    createdProductIds.push(productAId, productBId)
  })

  afterAll(async () => {
    if (createdReceiptIds.length > 0) {
      await db
        .delete(stockReceiptLine)
        .where(inArray(stockReceiptLine.receiptId, createdReceiptIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
      await db.delete(stockThreshold).where(inArray(stockThreshold.branchId, createdBranchIds))
      await db.delete(stockReceipt).where(inArray(stockReceipt.id, createdReceiptIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, createdSupplierIds))
    }
    if (categoryId) await db.delete(category).where(eq(category.id, categoryId))
    if (uomId) await db.delete(uom).where(eq(uom.id, uomId))
    for (const userId of createdUserIds) await deleteTestUser(userId)
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
  })

  it('receives stock with a supplier reference and returns the GRN', async () => {
    const response = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierName: 'Accra Parts Depot',
        supplierInvoiceNumber: 'APD-7788',
        lines: [
          { productId: productAId, quantity: 10, unitCostMinor: 1_000 },
          { productId: productBId, quantity: 5, unitCostMinor: 2_000 },
        ],
      }),
    })

    expect(response.status).toBe(201)
    const { receipt } = await readJson<{ receipt: ReceiptResponse }>(response)
    createdReceiptIds.push(receipt.id)
    expect(receipt.number).toMatch(/^GRN-\d{5}$/)
    expect(receipt.supplierName).toBe('Accra Parts Depot')
    expect(receipt.supplierInvoiceNumber).toBe('APD-7788')
    expect(receipt.lineCount).toBe(2)
    expect(receipt.totalCostMinor).toBe(20_000)
    expect(receipt.lines).toHaveLength(2)

    const stock = await app.request(`/api/inventory/stock/${productAId}?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(stock.status).toBe(200)
    const stockBody = await readJson<{
      stock: { quantityOnHand: number; avgCostMinor: number }
    }>(stock)
    expect(stockBody.stock.quantityOnHand).toBe(10)
    expect(stockBody.stock.avgCostMinor).toBe(1_000)
  })

  it('links receipts to the supplier master and rejects archived or unknown suppliers', async () => {
    const supplierResponse = await app.request('/api/suppliers', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name: `Inventory Supplier ${suffix}` }),
    })
    expect(supplierResponse.status).toBe(201)
    const { supplier: createdSupplier } = await readJson<{
      supplier: { id: string; name: string }
    }>(supplierResponse)
    createdSupplierIds.push(createdSupplier.id)

    const body = {
      branchId: branchAId,
      supplierId: createdSupplier.id,
      supplierInvoiceNumber: 'LINK-9001',
      lines: [{ productId: productBId, quantity: 2, unitCostMinor: 750 }],
    }

    const response = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(body),
    })
    expect(response.status).toBe(201)
    const { receipt } = await readJson<{ receipt: ReceiptResponse }>(response)
    createdReceiptIds.push(receipt.id)
    expect(receipt.supplierId).toBe(createdSupplier.id)
    expect(receipt.supplierName).toBe(createdSupplier.name)

    const list = await app.request(`/api/inventory/receipts?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(list.status).toBe(200)
    const listBody = await readJson<{ receipts: ReceiptResponse[] }>(list)
    const listed = listBody.receipts.find((row) => row.id === receipt.id)
    expect(listed?.supplierId).toBe(createdSupplier.id)

    const archive = await app.request(`/api/suppliers/${createdSupplier.id}/archive`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({}),
    })
    expect(archive.status).toBe(200)

    const archivedAttempt = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify(body),
    })
    expect(archivedAttempt.status).toBe(409)

    const unknownAttempt = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        ...body,
        supplierId: '00000000-0000-0000-0000-000000000000',
      }),
    })
    expect(unknownAttempt.status).toBe(404)
  })

  it('lets a manager receive at their own branch only', async () => {
    const own = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        lines: [{ productId: productAId, quantity: 2, unitCostMinor: 1_500 }],
      }),
    })
    expect(own.status).toBe(201)
    const { receipt } = await readJson<{ receipt: ReceiptResponse }>(own)
    createdReceiptIds.push(receipt.id)

    const other = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchBId,
        lines: [{ productId: productAId, quantity: 1, unitCostMinor: 1_000 }],
      }),
    })
    expect(other.status).toBe(403)
  })

  it('rejects receipts with duplicate products and archived products', async () => {
    const duplicate = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        lines: [
          { productId: productAId, quantity: 1, unitCostMinor: 1_000 },
          { productId: productAId, quantity: 2, unitCostMinor: 1_000 },
        ],
      }),
    })
    expect(duplicate.status).toBe(400)

    await db.update(product).set({ isActive: false }).where(eq(product.id, productBId))
    const archived = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        lines: [{ productId: productBId, quantity: 1, unitCostMinor: 1_000 }],
      }),
    })
    expect(archived.status).toBe(409)
    await db.update(product).set({ isActive: true }).where(eq(product.id, productBId))
  })

  it('posts reason-coded adjustments and blocks negative results', async () => {
    const missingReason = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ branchId: branchAId, productId: productAId, quantityDelta: -1 }),
    })
    expect(missingReason.status).toBe(400)

    const response = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productAId,
        quantityDelta: -2,
        reasonCode: 'DAMAGE',
        note: 'Broken during handling',
      }),
    })
    expect(response.status).toBe(201)
    const body = await readJson<{
      movement: MovementResponse
      level: { quantityOnHand: number; avgCostMinor: number }
    }>(response)
    expect(body.movement.reasonCode).toBe('DAMAGE')
    expect(body.movement.quantityDelta).toBe(-2)
    expect(body.level.quantityOnHand).toBe(10)

    const tooMany = await app.request('/api/inventory/adjustments', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        branchId: branchAId,
        productId: productAId,
        quantityDelta: -999,
        reasonCode: 'LOSS',
      }),
    })
    expect(tooMany.status).toBe(409)

    const auditRows = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.action, 'stock.adjusted'), eq(auditLog.entityId, productAId)))
    expect(auditRows.length).toBeGreaterThanOrEqual(1)
  })

  it('lists movement history with filters', async () => {
    const all = await app.request(
      `/api/inventory/movements?productId=${productAId}&branchId=${branchAId}`,
      { headers: authedHeaders(managerCookie) },
    )
    expect(all.status).toBe(200)
    const allBody = await readJson<{ movements: MovementResponse[]; total: number }>(all)
    expect(allBody.total).toBeGreaterThanOrEqual(3)
    expect(allBody.movements.every((row) => row.productId === productAId)).toBe(true)
    expect(allBody.movements.some((row) => row.referenceNumber?.startsWith('GRN-'))).toBe(true)

    const adjustments = await app.request(
      `/api/inventory/movements?productId=${productAId}&branchId=${branchAId}&type=ADJUSTMENT`,
      { headers: authedHeaders(managerCookie) },
    )
    const adjustmentBody = await readJson<{ movements: MovementResponse[] }>(adjustments)
    expect(adjustmentBody.movements.every((row) => row.type === 'ADJUSTMENT')).toBe(true)

    const crossBranch = await app.request(`/api/inventory/movements?branchId=${branchBId}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(crossBranch.status).toBe(403)
  })

  it('lists stock, filters search, and requires a branch for admin', async () => {
    const missingBranch = await app.request('/api/inventory/stock', {
      headers: authedHeaders(adminCookie),
    })
    expect(missingBranch.status).toBe(400)

    const list = await app.request(`/api/inventory/stock?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(list.status).toBe(200)
    const body = await readJson<{ stock: StockRowResponse[]; total: number }>(list)
    expect(body.total).toBeGreaterThanOrEqual(2)
    const row = body.stock.find((item) => item.productId === productAId)
    expect(row?.quantityOnHand).toBe(10)
    expect(row?.valueMinor).toBe((row?.quantityOnHand ?? 0) * (row?.avgCostMinor ?? 0))

    const search = await app.request(
      `/api/inventory/stock?branchId=${branchAId}&q=${encodeURIComponent(suffix)}`,
      { headers: authedHeaders(adminCookie) },
    )
    const searchBody = await readJson<{ stock: StockRowResponse[] }>(search)
    expect(searchBody.stock.length).toBe(2)

    const managerList = await app.request('/api/inventory/stock', {
      headers: authedHeaders(managerCookie),
    })
    expect(managerList.status).toBe(200)
    const managerBody = await readJson<{ branchId: string }>(managerList)
    expect(managerBody.branchId).toBe(branchAId)
  })

  it('manages thresholds and surfaces the low-stock list', async () => {
    const set = await app.request('/api/inventory/thresholds', {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: branchAId, productId: productAId, threshold: 12 }),
    })
    expect(set.status).toBe(200)
    const saved = await readJson<{ threshold: { threshold: number } }>(set)
    expect(saved.threshold.threshold).toBe(12)

    const list = await app.request(`/api/inventory/thresholds?branchId=${branchAId}`, {
      headers: authedHeaders(managerCookie),
    })
    const listBody = await readJson<{ thresholds: { productId: string }[] }>(list)
    expect(listBody.thresholds.some((row) => row.productId === productAId)).toBe(true)

    const lowStock = await app.request(`/api/inventory/low-stock?branchId=${branchAId}`, {
      headers: authedHeaders(managerCookie),
    })
    const lowBody = await readJson<{ stock: StockRowResponse[] }>(lowStock)
    const lowRow = lowBody.stock.find((row) => row.productId === productAId)
    expect(lowRow?.isLow).toBe(true)
    expect(lowRow?.threshold).toBe(12)

    const crossBranch = await app.request('/api/inventory/thresholds', {
      method: 'PUT',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({ branchId: branchBId, productId: productAId, threshold: 1 }),
    })
    expect(crossBranch.status).toBe(403)

    const remove = await app.request(
      `/api/inventory/thresholds/${productAId}?branchId=${branchAId}`,
      { method: 'DELETE', headers: authedHeaders(adminCookie) },
    )
    expect(remove.status).toBe(200)
  })

  it('lists receipts with branch scoping', async () => {
    const adminList = await app.request(`/api/inventory/receipts?branchId=${branchAId}`, {
      headers: authedHeaders(adminCookie),
    })
    expect(adminList.status).toBe(200)
    const adminBody = await readJson<{ receipts: ReceiptResponse[]; total: number }>(adminList)
    expect(adminBody.total).toBeGreaterThanOrEqual(2)

    const managerList = await app.request('/api/inventory/receipts', {
      headers: authedHeaders(managerCookie),
    })
    expect(managerList.status).toBe(200)
    const managerBody = await readJson<{ receipts: ReceiptResponse[] }>(managerList)
    expect(managerBody.receipts.every((item) => item.branchId === branchAId)).toBe(true)
  })
})
