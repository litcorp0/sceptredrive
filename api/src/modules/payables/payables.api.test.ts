import { db } from '@gikautos/db'
import { inArray } from 'drizzle-orm'
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
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
} from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { allocateFromSequence } from '../platform/settings.service.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierProduct } from '../suppliers/suppliers.schema.ts'
import { supplierInvoice, supplierInvoiceLine } from './payables.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[payables.api.test] database unavailable; integration tests skipped')

interface InvoiceResponse {
  id: string
  number: string
  branchId: string
  supplierId: string
  supplierInvoiceNumber: string
  invoiceDate: string
  dueDate: string
  receiptId: string | null
  subtotalMinor: number
  vatMinor: number
  nhilMinor: number
  getfundMinor: number
  totalMinor: number
  amountPaidMinor: number
  outstandingMinor: number
  status: string
}

interface InvoiceDetailResponse {
  invoice: InvoiceResponse
  supplier: { id: string; code: string; name: string }
  receipt: { id: string; number: string; branchId: string } | null
  lines: {
    id: string
    productId: string | null
    description: string | null
    quantity: number
    unitCostMinor: number
    lineTotalMinor: number
  }[]
  allocations: unknown[]
}

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

describe.skipIf(!available)('payables API', () => {
  const suffix = uniqueSuffix()
  const createdBranchIds: string[] = []
  const createdUserIds: string[] = []
  const createdProductIds: string[] = []
  const createdSupplierIds: string[] = []
  const createdReceiptIds: string[] = []
  const createdInvoiceIds: string[] = []
  let adminCookie = ''
  let managerCookie = ''
  let cashierCookie = ''
  let branchAId = ''
  let branchBId = ''
  let productAId = ''
  let productBId = ''
  let supplierId = ''

  const today = new Date().toISOString().slice(0, 10)

  beforeAll(async () => {
    // Skip the demo document numbers that seed fixtures insert with explicit
    // values into the shared test database.
    for (const key of [
      'supplier.codeSequence',
      'inventory.receiptSequence',
      'payable.invoiceSequence',
      'payable.paymentSequence',
    ] as const) {
      await allocateFromSequence(key, db)
      await allocateFromSequence(key, db)
    }

    const admin = await createTestUser({ role: 'ADMIN' })
    createdUserIds.push(admin.id)
    adminCookie = await signIn(admin.email)

    const branchAResponse = await app.request('/api/branches', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        code: `PA${randomToken(2)}-A`,
        name: `Payables API Branch A ${suffix}`,
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
        code: `PA${randomToken(2)}-B`,
        name: `Payables API Branch B ${suffix}`,
        type: 'RETAIL',
        city: 'Kumasi',
      }),
    })
    expect(branchBResponse.status).toBe(201)
    branchBId = (await readJson<{ branch: { id: string } }>(branchBResponse)).branch.id
    createdBranchIds.push(branchBId)

    const manager = await createTestUser({
      role: 'MANAGER',
      branchId: branchAId,
      name: 'Payables API Manager',
    })
    createdUserIds.push(manager.id)
    managerCookie = await signIn(manager.email)

    const cashier = await createTestUser({
      role: 'CASHIER',
      branchId: branchAId,
      name: 'Payables API Cashier',
    })
    createdUserIds.push(cashier.id)
    cashierCookie = await signIn(cashier.email)

    const units = await db
      .insert(uom)
      .values({
        code: `P${randomToken(2)}`,
        name: `Payables API Unit ${suffix}`,
        createdBy: 'test',
      })
      .returning({ id: uom.id })
    const uomId = units[0]?.id ?? ''

    const categories = await db
      .insert(category)
      .values({ name: `Payables API Cat ${suffix}`, createdBy: 'test' })
      .returning({ id: category.id })
    const categoryId = categories[0]?.id ?? ''

    const products = await db
      .insert(product)
      .values([
        {
          sku: `PAPI-${suffix}-1`,
          name: `Payables API Product One ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 900,
          basePriceMinor: 2_000,
          createdBy: 'test',
        },
        {
          sku: `PAPI-${suffix}-2`,
          name: `Payables API Product Two ${suffix}`,
          categoryId,
          uomId,
          costPriceMinor: 1_800,
          basePriceMinor: 4_000,
          createdBy: 'test',
        },
      ])
      .returning({ id: product.id })
    productAId = products[0]?.id ?? ''
    productBId = products[1]?.id ?? ''
    createdProductIds.push(productAId, productBId)

    const supplierResponse = await app.request('/api/suppliers', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ name: `Payables API Supplier ${suffix}` }),
    })
    expect(supplierResponse.status).toBe(201)
    supplierId = (await readJson<{ supplier: { id: string } }>(supplierResponse)).supplier.id
    createdSupplierIds.push(supplierId)
  })

  afterAll(async () => {
    if (createdInvoiceIds.length > 0) {
      await db
        .delete(supplierInvoiceLine)
        .where(inArray(supplierInvoiceLine.invoiceId, createdInvoiceIds))
      await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, createdInvoiceIds))
    }
    if (createdReceiptIds.length > 0) {
      await db
        .delete(stockReceiptLine)
        .where(inArray(stockReceiptLine.receiptId, createdReceiptIds))
      await db.delete(stockReceipt).where(inArray(stockReceipt.id, createdReceiptIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(stockMovement).where(inArray(stockMovement.branchId, createdBranchIds))
      await db.delete(stockLevel).where(inArray(stockLevel.branchId, createdBranchIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(supplierProduct).where(inArray(supplierProduct.productId, createdProductIds))
    }
    if (createdSupplierIds.length > 0) {
      await db.delete(supplier).where(inArray(supplier.id, createdSupplierIds))
    }
    const auditIds = [...createdInvoiceIds, ...createdReceiptIds, ...createdSupplierIds]
    if (auditIds.length > 0) {
      await db.delete(auditLog).where(inArray(auditLog.entityId, auditIds))
    }
    if (createdProductIds.length > 0) {
      await db.delete(product).where(inArray(product.id, createdProductIds))
    }
    if (createdBranchIds.length > 0) {
      await db.delete(branch).where(inArray(branch.id, createdBranchIds))
    }
    for (const id of createdUserIds) {
      await deleteTestUser(id)
    }
  })

  it('enforces the payables permission matrix', async () => {
    const list = await app.request('/api/payables/invoices', {
      headers: authedHeaders(cashierCookie),
    })
    expect(list.status).toBe(403)

    const create = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(cashierCookie),
      body: JSON.stringify({}),
    })
    expect(create.status).toBe(403)

    const read = await app.request('/api/payables/invoices/00000000-0000-0000-0000-000000000000', {
      headers: authedHeaders(cashierCookie),
    })
    expect(read.status).toBe(403)

    const voided = await app.request(
      '/api/payables/invoices/00000000-0000-0000-0000-000000000000/void',
      {
        method: 'POST',
        headers: authedHeaders(cashierCookie),
        body: JSON.stringify({ reason: 'ERROR' }),
      },
    )
    expect(voided.status).toBe(403)
  })

  it('creates, reads, lists, and validates invoices over HTTP', async () => {
    const missingLines = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        supplierInvoiceNumber: `API-${suffix}-1`,
        invoiceDate: today,
      }),
    })
    expect(missingLines.status).toBe(400)

    const copyWithoutReceipt = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        supplierInvoiceNumber: `API-${suffix}-2`,
        invoiceDate: today,
        copyFromReceipt: true,
      }),
    })
    expect(copyWithoutReceipt.status).toBe(400)

    const badDate = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        supplierInvoiceNumber: `API-${suffix}-3`,
        invoiceDate: '19-10-2026',
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    })
    expect(badDate.status).toBe(400)

    const adminNoBranch = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        supplierId,
        supplierInvoiceNumber: `API-${suffix}-4`,
        invoiceDate: today,
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    })
    expect(adminNoBranch.status).toBe(400)

    const crossBranch = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        branchId: branchBId,
        supplierInvoiceNumber: `API-${suffix}-5`,
        invoiceDate: today,
        lines: [{ description: 'x', quantity: 1, unitCostMinor: 100 }],
      }),
    })
    expect(crossBranch.status).toBe(403)

    const created = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        supplierInvoiceNumber: `API-${suffix}-OK`,
        invoiceDate: today,
        lines: [{ productId: productAId, quantity: 2, unitCostMinor: 5_000 }],
      }),
    })
    expect(created.status).toBe(201)
    const body = await readJson<{ invoice: InvoiceDetailResponse; replayed: boolean }>(created)
    createdInvoiceIds.push(body.invoice.invoice.id)
    expect(body.replayed).toBe(false)
    expect(body.invoice.invoice.number).toMatch(/^SINV-\d{5}$/)
    expect(body.invoice.invoice.branchId).toBe(branchAId)
    expect(body.invoice.invoice.totalMinor).toBe(10_000)
    expect(body.invoice.lines).toHaveLength(1)

    const read = await app.request(`/api/payables/invoices/${body.invoice.invoice.id}`, {
      headers: authedHeaders(managerCookie),
    })
    expect(read.status).toBe(200)
    const readBody = await readJson<InvoiceDetailResponse>(read)
    expect(readBody.invoice.id).toBe(body.invoice.invoice.id)
    expect(readBody.supplier.id).toBe(supplierId)
    expect(readBody.receipt).toBeNull()

    const list = await app.request('/api/payables/invoices', {
      headers: authedHeaders(managerCookie),
    })
    expect(list.status).toBe(200)
    const listBody = await readJson<{
      invoices: InvoiceResponse[]
      total: number
      branchId: string | null
    }>(list)
    expect(listBody.branchId).toBe(branchAId)
    expect(listBody.invoices.map((row) => row.id)).toContain(body.invoice.invoice.id)

    const badId = await app.request('/api/payables/invoices/not-a-uuid', {
      headers: authedHeaders(managerCookie),
    })
    expect(badId.status).toBe(400)

    const missing = await app.request(
      '/api/payables/invoices/00000000-0000-0000-0000-000000000000',
      { headers: authedHeaders(managerCookie) },
    )
    expect(missing.status).toBe(404)
  })

  it('invoices a receipt over HTTP, blocks duplicates, voids, and replays idempotently', async () => {
    const receiptResponse = await app.request('/api/inventory/receipts', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        supplierInvoiceNumber: 'APD-HTTP-1',
        lines: [{ productId: productBId, quantity: 4, unitCostMinor: 2_500 }],
      }),
    })
    expect(receiptResponse.status).toBe(201)
    const receipt = await readJson<{
      receipt: { id: string; number: string; totalCostMinor: number }
    }>(receiptResponse)
    createdReceiptIds.push(receipt.receipt.id)

    const fromReceipt = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        branchId: branchAId,
        supplierInvoiceNumber: `APD-INV-${suffix}-1`,
        invoiceDate: today,
        receiptId: receipt.receipt.id,
        copyFromReceipt: true,
      }),
    })
    expect(fromReceipt.status).toBe(201)
    const created = await readJson<{ invoice: InvoiceDetailResponse }>(fromReceipt)
    createdInvoiceIds.push(created.invoice.invoice.id)
    expect(created.invoice.invoice.totalMinor).toBe(receipt.receipt.totalCostMinor)
    expect(created.invoice.receipt?.id).toBe(receipt.receipt.id)
    expect(
      created.invoice.invoice.subtotalMinor +
        created.invoice.invoice.vatMinor +
        created.invoice.invoice.nhilMinor +
        created.invoice.invoice.getfundMinor,
    ).toBe(created.invoice.invoice.totalMinor)

    const double = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        supplierId,
        branchId: branchAId,
        supplierInvoiceNumber: `APD-INV-${suffix}-2`,
        invoiceDate: today,
        receiptId: receipt.receipt.id,
        copyFromReceipt: true,
      }),
    })
    expect(double.status).toBe(409)
    const doubleBody = await readJson<{
      error: { code: string; details?: { existingInvoiceId?: string } }
    }>(double)
    expect(doubleBody.error.details?.existingInvoiceId).toBe(created.invoice.invoice.id)

    const idempotentBody = {
      supplierId,
      branchId: branchAId,
      supplierInvoiceNumber: `IDEM-${suffix}`,
      invoiceDate: today,
      lines: [{ description: 'HTTP replay', quantity: 1, unitCostMinor: 3_000 }],
      idempotencyKey: `api-key-${suffix}`,
    }
    const first = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify(idempotentBody),
    })
    expect(first.status).toBe(201)
    const firstBody = await readJson<{ invoice: InvoiceDetailResponse; replayed: boolean }>(first)
    createdInvoiceIds.push(firstBody.invoice.invoice.id)

    const replay = await app.request('/api/payables/invoices', {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify(idempotentBody),
    })
    expect(replay.status).toBe(200)
    const replayBody = await readJson<{ invoice: InvoiceDetailResponse; replayed: boolean }>(replay)
    expect(replayBody.replayed).toBe(true)
    expect(replayBody.invoice.invoice.id).toBe(firstBody.invoice.invoice.id)

    const voided = await app.request(
      `/api/payables/invoices/${firstBody.invoice.invoice.id}/void`,
      {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ reason: 'ERROR' }),
      },
    )
    expect(voided.status).toBe(200)
    const voidedBody = await readJson<{ invoice: { status: string; voidReason: string } }>(voided)
    expect(voidedBody.invoice.status).toBe('VOID')
    expect(voidedBody.invoice.voidReason).toBe('ERROR')

    const badReason = await app.request(
      `/api/payables/invoices/${firstBody.invoice.invoice.id}/void`,
      {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ reason: 'NOPE' }),
      },
    )
    expect(badReason.status).toBe(400)
  })
})
