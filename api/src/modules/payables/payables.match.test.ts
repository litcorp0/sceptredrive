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
} from '../../../test/integration.ts'
import { app } from '../../app.ts'
import { approval } from '../approvals/approvals.schema.ts'
import { category, uom } from '../catalog/catalog.schema.ts'
import {
  stockLevel,
  stockMovement,
  stockReceipt,
  stockReceiptLine,
} from '../inventory/inventory.schema.ts'
import { branch } from '../org/branches.schema.ts'
import { auditLog } from '../platform/audit.schema.ts'
import { documentSequence } from '../platform/sequences.schema.ts'
import { purchaseOrder } from '../procurement/procurement.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierProduct } from '../suppliers/suppliers.schema.ts'
import { supplierInvoice, supplierInvoiceLine } from './payables.schema.ts'

const available = await databaseAvailable()
if (!available)
  console.warn('[payables.match.test] database unavailable; integration tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

let branchId = ''
let supplierId = ''
let productId = ''
let otherProductId = ''
let managerId = ''
let managerCookie = ''
const invoiceIds: string[] = []

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

beforeAll(async () => {
  if (!available) return

  const [branchRow] = await db
    .insert(branch)
    .values({ code: `MA${suffix.slice(-6)}`, name: `Match branch ${suffix}`, city: 'Accra' })
    .returning({ id: branch.id })
  branchId = branchRow?.id ?? ''

  const [uomRow] = await db
    .insert(uom)
    .values({ code: `M${suffix.slice(-5)}`, name: `Match unit ${suffix}` })
    .returning({ id: uom.id })
  const [categoryRow] = await db
    .insert(category)
    .values({ name: `Match category ${suffix}` })
    .returning({ id: category.id })

  const [supplierRow] = await db
    .insert(supplier)
    .values({ code: `MS${suffix.slice(-5)}`, name: `Match supplier ${suffix}` })
    .returning({ id: supplier.id })
  supplierId = supplierRow?.id ?? ''

  const categoryId = categoryRow?.id ?? ''
  const uomId = uomRow?.id ?? ''

  const products = await db
    .insert(product)
    .values([
      {
        sku: `MPA${suffix.slice(-5)}`,
        name: `Match product A ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 0,
      },
      {
        sku: `MPB${suffix.slice(-5)}`,
        name: `Match product B ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 0,
      },
    ])
    .returning({ id: product.id })
  productId = products[0]?.id ?? ''
  otherProductId = products[1]?.id ?? ''

  const manager = await createTestUser({
    role: 'MANAGER',
    branchId,
    email: `match-mgr-${suffix}@test.local`,
  })
  managerId = manager.id
  managerCookie = await signIn(manager.email)
})

afterAll(async () => {
  if (!available) return
  if (invoiceIds.length > 0) {
    await db.delete(supplierInvoiceLine).where(inArray(supplierInvoiceLine.invoiceId, invoiceIds))
    await db.delete(supplierInvoice).where(inArray(supplierInvoice.id, invoiceIds))
  }
  const orderIds = (
    await db
      .select({ id: purchaseOrder.id })
      .from(purchaseOrder)
      .where(eq(purchaseOrder.branchId, branchId))
  ).map((row) => row.id)
  if (orderIds.length > 0) {
    await db.delete(purchaseOrder).where(inArray(purchaseOrder.id, orderIds))
  }
  await db.delete(approval).where(eq(approval.branchId, branchId))
  await db.delete(stockReceiptLine).where(eq(stockReceiptLine.productId, productId))
  await db.delete(stockReceipt).where(eq(stockReceipt.branchId, branchId))
  await db.delete(stockMovement).where(eq(stockMovement.branchId, branchId))
  await db.delete(stockLevel).where(eq(stockLevel.branchId, branchId))
  await db.delete(supplierProduct).where(eq(supplierProduct.supplierId, supplierId))
  await db.delete(auditLog).where(eq(auditLog.branchId, branchId))
  await db.delete(documentSequence).where(eq(documentSequence.branchId, branchId))
  await db.delete(product).where(inArray(product.id, [productId, otherProductId]))
  await db.delete(supplier).where(eq(supplier.id, supplierId))
  if (managerId) await deleteTestUser(managerId)
  await db.delete(branch).where(eq(branch.id, branchId))
})

async function createReceivedOrder(ordered: number, unitCostMinor: number, received = ordered) {
  const created = await app.request('/api/procurement/orders', {
    method: 'POST',
    headers: authedHeaders(managerCookie),
    body: JSON.stringify({
      branchId,
      supplierId,
      idempotencyKey: randomUUID(),
      lines: [{ productId, quantity: ordered, unitCostMinor }],
    }),
  })
  const detail = await readJson<{ order: { id: string } }>(created)
  const orderId = detail.order.id

  await app.request(`/api/procurement/orders/${orderId}/submit`, {
    method: 'POST',
    headers: authedHeaders(managerCookie),
  })

  const linesResponse = await app.request(`/api/procurement/orders/${orderId}`, {
    headers: authedHeaders(managerCookie),
  })
  const lines = await readJson<{ lines: { id: string }[] }>(linesResponse)

  if (received > 0) {
    await app.request(`/api/procurement/orders/${orderId}/receive`, {
      method: 'POST',
      headers: authedHeaders(managerCookie),
      body: JSON.stringify({
        idempotencyKey: randomUUID(),
        lines: [{ purchaseOrderLineId: lines.lines[0]?.id, quantity: received, unitCostMinor }],
      }),
    })
  }

  return orderId
}

async function createInvoice(input: {
  purchaseOrderId?: string
  lines: { productId: string; quantity: number; unitCostMinor: number }[]
  supplierInvoiceNumber?: string
}) {
  const response = await app.request('/api/payables/invoices', {
    method: 'POST',
    headers: authedHeaders(managerCookie),
    body: JSON.stringify({
      supplierId,
      branchId,
      supplierInvoiceNumber: input.supplierInvoiceNumber ?? `MATCH-${randomUUID().slice(0, 8)}`,
      invoiceDate: new Date().toISOString().slice(0, 10),
      idempotencyKey: randomUUID(),
      ...(input.purchaseOrderId ? { purchaseOrderId: input.purchaseOrderId } : {}),
      lines: input.lines,
    }),
  })
  const body = await readJson<{
    invoice: { invoice: { id: string; purchaseOrderId: string | null } }
  }>(response.clone())
  if (body.invoice?.invoice?.id) invoiceIds.push(body.invoice.invoice.id)
  return { response, body }
}

describe.skipIf(!available)('invoice matching', () => {
  it('matches an invoice to a received order and posts the payable', async () => {
    const orderId = await createReceivedOrder(10, 5_000)
    const { response } = await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId, quantity: 10, unitCostMinor: 5_000 }],
    })
    expect(response.status).toBe(201)

    const body = await readJson<{
      invoice: {
        invoice: { purchaseOrderId: string | null }
        match: { status: string; orderNumber: string; lines: { matchStatus: string }[] }
      }
    }>(response)

    expect(body.invoice.invoice.purchaseOrderId).toBe(orderId)
    expect(body.invoice.match.status).toBe('MATCHED')
    expect(body.invoice.match.lines[0]?.matchStatus).toBe('MATCHED')
    expect(body.invoice.match.orderNumber).toMatch(/^PO-/)
  })

  it('flags a price variance with both values and still posts', async () => {
    const orderId = await createReceivedOrder(5, 5_000)
    const { response } = await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId, quantity: 5, unitCostMinor: 5_200 }],
    })
    expect(response.status).toBe(201)

    const body = await readJson<{
      invoice: {
        match: {
          status: string
          lines: { invoicedUnitCostMinor: number; orderedUnitCostMinor: number }[]
        }
        invoice: { status: string }
      }
    }>(response)

    expect(body.invoice.match.status).toBe('PRICE_VARIANCE')
    expect(body.invoice.match.lines[0]?.invoicedUnitCostMinor).toBe(5_200)
    expect(body.invoice.match.lines[0]?.orderedUnitCostMinor).toBe(5_000)
    expect(body.invoice.invoice.status).toBe('OPEN')
  })

  it('flags a quantity variance against what was received, not ordered', async () => {
    const orderId = await createReceivedOrder(10, 1_000)
    const { response } = await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId, quantity: 12, unitCostMinor: 1_000 }],
    })

    const body = await readJson<{
      invoice: { match: { status: string; lines: { receivedQuantity: number }[] } }
    }>(response)
    expect(body.invoice.match.status).toBe('QUANTITY_VARIANCE')
    expect(body.invoice.match.lines[0]?.receivedQuantity).toBe(10)
  })

  it('treats an invoice before any receipt as a quantity variance', async () => {
    const orderId = await createReceivedOrder(10, 1_000)
    // A fresh order with no receipt at all.
    const unreceived = await createReceivedOrder(10, 1_000, 0)
    expect(orderId).toBeTruthy()

    const { response } = await createInvoice({
      purchaseOrderId: unreceived,
      lines: [{ productId, quantity: 10, unitCostMinor: 1_000 }],
    })

    const body = await readJson<{
      invoice: { match: { status: string; lines: { receivedQuantity: number }[] } }
    }>(response)
    expect(body.invoice.match.status).toBe('QUANTITY_VARIANCE')
    expect(body.invoice.match.lines[0]?.receivedQuantity).toBe(0)
  })

  it('flags a product that is not on the order', async () => {
    const orderId = await createReceivedOrder(1, 1_000)
    const { response } = await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId: otherProductId, quantity: 1, unitCostMinor: 1_000 }],
    })

    const body = await readJson<{ invoice: { match: { status: string } } }>(response)
    expect(body.invoice.match.status).toBe('NOT_ON_ORDER')
  })

  it('refuses an order from another supplier', async () => {
    const orderId = await createReceivedOrder(1, 1_000)
    const otherSupplier = await db
      .insert(supplier)
      .values({ code: `MX${suffix.slice(-5)}`, name: `Other supplier ${suffix}` })
      .returning({ id: supplier.id })

    try {
      const response = await app.request('/api/payables/invoices', {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({
          supplierId: otherSupplier[0]?.id,
          branchId,
          supplierInvoiceNumber: `OTHER-${randomUUID().slice(0, 8)}`,
          invoiceDate: new Date().toISOString().slice(0, 10),
          purchaseOrderId: orderId,
          lines: [{ productId, quantity: 1, unitCostMinor: 1_000 }],
        }),
      })
      expect(response.status).toBe(400)
    } finally {
      await db.delete(supplier).where(eq(supplier.id, otherSupplier[0]?.id ?? ''))
    }
  })

  it('voiding an invoice stops it counting against the order', async () => {
    const orderId = await createReceivedOrder(6, 1_000)
    const first = await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId, quantity: 6, unitCostMinor: 1_000 }],
    })
    const firstBody = await readJson<{ invoice: { invoice: { id: string } } }>(first.response)

    const voided = await app.request(
      `/api/payables/invoices/${firstBody.invoice.invoice.id}/void`,
      {
        method: 'POST',
        headers: authedHeaders(managerCookie),
        body: JSON.stringify({ reason: 'ERROR' }),
      },
    )
    expect(voided.status).toBe(200)

    const second = await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId, quantity: 6, unitCostMinor: 1_000 }],
    })
    const secondBody = await readJson<{ invoice: { match: { status: string } } }>(second.response)
    expect(secondBody.invoice.match.status).toBe('MATCHED')
  })

  it('lists invoices with a variance filter', async () => {
    const orderId = await createReceivedOrder(2, 1_000)
    await createInvoice({
      purchaseOrderId: orderId,
      lines: [{ productId, quantity: 2, unitCostMinor: 1_500 }],
    })

    const response = await app.request('/api/payables/invoices?variance=true', {
      headers: authedHeaders(managerCookie),
    })
    expect(response.status).toBe(200)
    const body = await readJson<{
      invoices: { hasVariance: boolean; purchaseOrderNumber: string | null }[]
    }>(response)
    expect(body.invoices.length).toBeGreaterThan(0)
    expect(body.invoices.every((invoice) => invoice.hasVariance)).toBe(true)
  })

  it('offers only matchable orders to the invoice form', async () => {
    // Approved but not yet received: the picker lists orders a supplier can bill.
    const orderId = await createReceivedOrder(1, 1_000, 0)
    const response = await app.request(
      `/api/procurement/orders/matchable?supplierId=${supplierId}`,
      { headers: authedHeaders(managerCookie) },
    )
    expect(response.status).toBe(200)
    const body = await readJson<{ orders: { id: string; number: string }[] }>(response)
    expect(body.orders.map((order) => order.id)).toContain(orderId)
  })
})
