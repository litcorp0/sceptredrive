import { randomUUID } from 'node:crypto'
import { db } from '@sceptre/db'
import { and, eq, inArray } from 'drizzle-orm'
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
import { setting } from '../platform/settings.schema.ts'
import { product } from '../products/products.schema.ts'
import { supplier, supplierProduct } from '../suppliers/suppliers.schema.ts'
import { purchaseOrder, supplierCreditNote, supplierReturn } from './procurement.schema.ts'

const available = await databaseAvailable()
if (!available) console.warn('[procurement.test] database unavailable; integration tests skipped')

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`.toUpperCase()

let branchAId = ''
let branchBId = ''
let supplierId = ''
let productAId = ''
let productBId = ''
let productCId = ''
let productDId = ''
let productIds: string[] = []
let adminId = ''
let managerAId = ''
let managerBId = ''
let adminCookie = ''
let managerACookie = ''
let managerBCookie = ''
const orderIds: string[] = []

async function readJson<T>(response: Response): Promise<T> {
  return (await response.json()) as T
}

function key(): string {
  return randomUUID()
}

async function createOrder(
  cookie: string,
  input: { quantity: number; unitCostMinor: number; branchId?: string; idempotencyKey?: string },
) {
  const response = await app.request('/api/procurement/orders', {
    method: 'POST',
    headers: authedHeaders(cookie),
    body: JSON.stringify({
      branchId: input.branchId ?? branchAId,
      supplierId,
      expectedDate: '2026-11-05',
      idempotencyKey: input.idempotencyKey ?? key(),
      lines: [
        {
          productId: productAId,
          quantity: input.quantity,
          unitCostMinor: input.unitCostMinor,
        },
      ],
    }),
  })
  const detail = await readJson<{ order: { id: string; status: string; number: string } }>(response)
  if (detail.order?.id) orderIds.push(detail.order.id)
  return { response, body: detail.order }
}

async function orderRow(id: string) {
  const rows = await db.select().from(purchaseOrder).where(eq(purchaseOrder.id, id)).limit(1)
  return rows[0]
}

async function approvalRowsFor(orderId: string) {
  return db.select().from(approval).where(eq(approval.entityId, orderId))
}

beforeAll(async () => {
  if (!available) return

  const branches = await db
    .insert(branch)
    .values([
      { code: `PA${suffix.slice(-6)}`, name: `Order A ${suffix}`, city: 'Accra' },
      { code: `PB${suffix.slice(-6)}`, name: `Order B ${suffix}`, city: 'Kumasi' },
    ])
    .returning({ id: branch.id })
  branchAId = branches[0]?.id ?? ''
  branchBId = branches[1]?.id ?? ''

  const [unit] = await db
    .insert(uom)
    .values({ code: `O${suffix.slice(-5)}`, name: `Order unit ${suffix}` })
    .returning({ id: uom.id })
  const [categoryRow] = await db
    .insert(category)
    .values({ name: `Order category ${suffix}` })
    .returning({ id: category.id })
  const categoryId = categoryRow?.id ?? ''
  const uomId = unit?.id ?? ''

  const [supplierRow] = await db
    .insert(supplier)
    .values({ code: `OS${suffix.slice(-5)}`, name: `Order supplier ${suffix}` })
    .returning({ id: supplier.id })
  supplierId = supplierRow?.id ?? ''

  const products = await db
    .insert(product)
    .values([
      {
        sku: `OPA${suffix.slice(-5)}`,
        name: `Order product A ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        costPriceMinor: 0,
      },
      {
        sku: `OPB${suffix.slice(-5)}`,
        name: `Order product B ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 20_000,
        costPriceMinor: 0,
      },
      {
        sku: `OPC${suffix.slice(-5)}`,
        name: `Order product C ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 30_000,
        costPriceMinor: 0,
      },
      {
        sku: `OPD${suffix.slice(-5)}`,
        name: `Order product D ${suffix}`,
        categoryId,
        uomId,
        basePriceMinor: 40_000,
        costPriceMinor: 0,
      },
    ])
    .returning({ id: product.id })
  productAId = products[0]?.id ?? ''
  productBId = products[1]?.id ?? ''
  productCId = products[2]?.id ?? ''
  productDId = products[3]?.id ?? ''
  productIds = [productAId, productBId, productCId, productDId]

  const admin = await createTestUser({ role: 'ADMIN', email: `po-admin-${suffix}@test.local` })
  const managerA = await createTestUser({
    role: 'MANAGER',
    branchId: branchAId,
    email: `po-mgr-a-${suffix}@test.local`,
  })
  const managerB = await createTestUser({
    role: 'MANAGER',
    branchId: branchBId,
    email: `po-mgr-b-${suffix}@test.local`,
  })
  adminId = admin.id
  managerAId = managerA.id
  managerBId = managerB.id

  adminCookie = await signIn(admin.email)
  managerACookie = await signIn(managerA.email)
  managerBCookie = await signIn(managerB.email)
})

afterAll(async () => {
  if (!available) return

  const orderIdsForBranches = (
    await db
      .select({ id: purchaseOrder.id })
      .from(purchaseOrder)
      .where(inArray(purchaseOrder.branchId, [branchAId, branchBId]))
  ).map((row) => row.id)

  const returnIds = (
    await db
      .select({ id: supplierReturn.id })
      .from(supplierReturn)
      .where(inArray(supplierReturn.branchId, [branchAId, branchBId]))
  ).map((row) => row.id)
  if (returnIds.length > 0) {
    await db.delete(supplierCreditNote).where(inArray(supplierCreditNote.returnId, returnIds))
    await db.delete(supplierReturn).where(inArray(supplierReturn.id, returnIds))
  }
  if (orderIdsForBranches.length > 0) {
    await db.delete(purchaseOrder).where(inArray(purchaseOrder.id, orderIdsForBranches))
  }
  await db.delete(approval).where(inArray(approval.branchId, [branchAId, branchBId]))
  await db
    .delete(documentSequence)
    .where(inArray(documentSequence.branchId, [branchAId, branchBId]))
  await db.delete(auditLog).where(inArray(auditLog.branchId, [branchAId, branchBId]))
  await db.delete(stockReceiptLine).where(inArray(stockReceiptLine.productId, productIds))
  await db.delete(stockReceipt).where(inArray(stockReceipt.branchId, [branchAId, branchBId]))
  await db.delete(stockMovement).where(inArray(stockMovement.branchId, [branchAId, branchBId]))
  await db.delete(stockLevel).where(inArray(stockLevel.branchId, [branchAId, branchBId]))
  await db.delete(supplierProduct).where(eq(supplierProduct.supplierId, supplierId))
  await db.delete(product).where(inArray(product.id, productIds))
  await db.delete(supplier).where(eq(supplier.id, supplierId))
  for (const id of [adminId, managerAId, managerBId]) {
    if (id) await deleteTestUser(id)
  }
  await db.delete(branch).where(inArray(branch.id, [branchAId, branchBId]))
})

describe.skipIf(!available)('purchase orders', () => {
  it('creates a draft with a branch-month number and a goods value', async () => {
    const { response, body } = await createOrder(managerACookie, {
      quantity: 10,
      unitCostMinor: 5_000,
    })
    expect(response.status).toBe(201)
    expect(body.status).toBe('DRAFT')
    expect(body.number).toMatch(/^PO-[A-Z0-9]+-\d{6}-0001$/)

    const detail = await app.request(`/api/procurement/orders/${body.id}`, {
      headers: authedHeaders(managerACookie),
    })
    const detailBody = await readJson<{
      goodsValueMinor: number
      lines: { outstandingQuantity: number; receivedQuantity: number }[]
      canApply: Record<string, boolean>
    }>(detail)
    expect(detailBody.goodsValueMinor).toBe(50_000)
    expect(detailBody.lines[0]?.outstandingQuantity).toBe(10)
    expect(detailBody.canApply.submit).toBe(true)
    expect(detailBody.canApply.receive).toBe(false)
  })

  it('replays the same idempotency key instead of creating a second order', async () => {
    const idempotencyKey = key()
    const first = await createOrder(managerACookie, {
      quantity: 1,
      unitCostMinor: 1_000,
      idempotencyKey,
    })
    const second = await createOrder(managerACookie, {
      quantity: 1,
      unitCostMinor: 1_000,
      idempotencyKey,
    })

    expect(first.response.status).toBe(201)
    expect(second.response.status).toBe(200)
    expect(second.body.id).toBe(first.body.id)
  })

  it('rejects a product twice in one order', async () => {
    const response = await app.request('/api/procurement/orders', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        idempotencyKey: key(),
        lines: [
          { productId: productAId, quantity: 1, unitCostMinor: 100 },
          { productId: productAId, quantity: 2, unitCostMinor: 100 },
        ],
      }),
    })
    expect(response.status).toBe(400)
  })

  it('edits a draft and refuses to edit an approved order', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 2, unitCostMinor: 1_000 })

    const update = await app.request(`/api/procurement/orders/${body.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        lines: [
          { productId: productAId, quantity: 3, unitCostMinor: 1_000 },
          { productId: productBId, quantity: 1, unitCostMinor: 2_000 },
        ],
      }),
    })
    expect(update.status).toBe(200)
    const updated = await readJson<{ goodsValueMinor: number; lines: unknown[] }>(update)
    expect(updated.goodsValueMinor).toBe(5_000)
    expect(updated.lines).toHaveLength(2)

    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const blocked = await app.request(`/api/procurement/orders/${body.id}`, {
      method: 'PATCH',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ note: 'too late' }),
    })
    expect(blocked.status).toBe(409)
  })

  it('auto-approves a manager order one pesewa below the limit', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 999_999 })

    const submit = await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(submit.status).toBe(200)

    const row = await orderRow(body.id)
    expect(row?.status).toBe('APPROVED')
    expect(row?.approvalId).toBeNull()
    expect(await approvalRowsFor(body.id)).toHaveLength(0)

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'purchase_order'), eq(auditLog.entityId, body.id)))
    expect(audits.map((entry) => entry.action)).toContain('purchase_order.auto_approved')
  })

  it('waits for an admin at exactly the limit', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 1_000_000 })

    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const row = await orderRow(body.id)
    expect(row?.status).toBe('PENDING_APPROVAL')
    expect(row?.approvalId).toBeTruthy()

    const approvals = await approvalRowsFor(body.id)
    expect(approvals).toHaveLength(1)
    expect(approvals[0]?.amountMinor).toBe(1_000_000)
  })

  it('uses a branch override of the threshold', async () => {
    const override = await app.request('/api/settings', {
      method: 'PATCH',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({
        key: 'procurement.approvalThresholdMinor',
        value: 500_000,
        branchId: branchAId,
      }),
    })
    expect(override.status).toBe(200)

    try {
      const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 600_000 })
      await app.request(`/api/procurement/orders/${body.id}/submit`, {
        method: 'POST',
        headers: authedHeaders(managerACookie),
      })
      expect((await orderRow(body.id))?.status).toBe('PENDING_APPROVAL')
    } finally {
      await db
        .delete(setting)
        .where(
          and(
            eq(setting.key, 'procurement.approvalThresholdMinor'),
            eq(setting.branchId, branchAId),
          ),
        )
    }
  })

  it('never sends an admin order to a second admin', async () => {
    const { body } = await createOrder(adminCookie, { quantity: 5, unitCostMinor: 1_000_000 })
    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
    })

    const row = await orderRow(body.id)
    expect(row?.status).toBe('APPROVED')
    expect(row?.approvalId).toBeNull()
    expect(await approvalRowsFor(body.id)).toHaveLength(0)
  })

  it('approves, sends, and refuses a second send timestamp', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 2_000_000 })
    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const pending = await approvalRowsFor(body.id)
    const decide = await app.request(`/api/approvals/${pending[0]?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'APPROVED' }),
    })
    expect(decide.status).toBe(200)

    expect((await orderRow(body.id))?.status).toBe('APPROVED')

    const send = await app.request(`/api/procurement/orders/${body.id}/send`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(send.status).toBe(200)
    const firstSend = await orderRow(body.id)
    expect(firstSend?.status).toBe('SENT')

    await new Promise((resolve) => setTimeout(resolve, 20))
    await app.request(`/api/procurement/orders/${body.id}/send`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    const secondSend = await orderRow(body.id)
    expect(secondSend?.sentAt?.getTime()).toBe(firstSend?.sentAt?.getTime())
  })

  it('refuses to send a rejected order', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 3_000_000 })
    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const pending = await approvalRowsFor(body.id)
    await app.request(`/api/approvals/${pending[0]?.id}/decide`, {
      method: 'POST',
      headers: authedHeaders(adminCookie),
      body: JSON.stringify({ decision: 'REJECTED', reasonCode: 'OVER_THRESHOLD' }),
    })

    const send = await app.request(`/api/procurement/orders/${body.id}/send`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(send.status).toBe(409)
    expect((await orderRow(body.id))?.status).toBe('REJECTED')
  })

  it('cancels a pending order and withdraws its approval', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 4_000_000 })
    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const cancel = await app.request(`/api/procurement/orders/${body.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ reason: 'Supplier changed the price' }),
    })
    expect(cancel.status).toBe(200)

    expect((await orderRow(body.id))?.status).toBe('CANCELLED')
    const approvals = await approvalRowsFor(body.id)
    expect(approvals[0]?.status).toBe('WITHDRAWN')
  })

  it('closes a sent order short and records what is outstanding', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 10, unitCostMinor: 100 })
    await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    await app.request(`/api/procurement/orders/${body.id}/send`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })

    const close = await app.request(`/api/procurement/orders/${body.id}/close`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ note: 'Supplier discontinued the part' }),
    })
    expect(close.status).toBe(200)
    expect((await orderRow(body.id))?.status).toBe('CLOSED')

    const audits = await db
      .select()
      .from(auditLog)
      .where(and(eq(auditLog.entity, 'purchase_order'), eq(auditLog.entityId, body.id)))
    const closed = audits.find((entry) => entry.action === 'purchase_order.closed')
    expect(JSON.stringify(closed?.after)).toContain('outstanding')
  })

  it('keeps one branch out of another branch order', async () => {
    const { body } = await createOrder(managerACookie, { quantity: 1, unitCostMinor: 100 })

    const read = await app.request(`/api/procurement/orders/${body.id}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(read.status).toBe(403)

    const list = await app.request(`/api/procurement/orders?branchId=${branchAId}`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(list.status).toBe(403)

    const submit = await app.request(`/api/procurement/orders/${body.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
    })
    expect(submit.status).toBe(403)
  })

  it('rejects an unknown field and a cashier', async () => {
    const strict = await app.request('/api/procurement/orders', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        idempotencyKey: key(),
        lines: [{ productId: productAId, quantity: 1, unitCostMinor: 100 }],
        totalMinor: 100,
      }),
    })
    expect(strict.status).toBe(400)

    const cashier = await createTestUser({ role: 'CASHIER', email: `po-cash-${suffix}@test.local` })
    try {
      const cashierCookie = await signIn(cashier.email)
      const denied = await app.request('/api/procurement/orders', {
        headers: authedHeaders(cashierCookie),
      })
      expect(denied.status).toBe(403)
    } finally {
      await deleteTestUser(cashier.id)
    }
  })
})

describe.skipIf(!available)('receiving against an order', () => {
  async function approvedOrder(quantity: number, unitCostMinor: number, productId = productAId) {
    const created = await app.request('/api/procurement/orders', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        idempotencyKey: randomUUID(),
        lines: [{ productId, quantity, unitCostMinor }],
      }),
    })
    const detail = await readJson<{ order: { id: string } }>(created)
    orderIds.push(detail.order.id)
    await app.request(`/api/procurement/orders/${detail.order.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    const order = await app.request(`/api/procurement/orders/${detail.order.id}`, {
      headers: authedHeaders(managerACookie),
    })
    const body = await readJson<{ lines: { id: string }[] }>(order)
    return { orderId: detail.order.id, lineId: body.lines[0]?.id ?? '' }
  }

  async function receive(
    orderId: string,
    lineId: string,
    quantity: number,
    unitCostMinor: number,
    extra: Record<string, unknown> = {},
    cookie = managerACookie,
    idempotencyKey = randomUUID(),
  ) {
    return app.request(`/api/procurement/orders/${orderId}/receive`, {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({
        idempotencyKey,
        lines: [{ purchaseOrderLineId: lineId, quantity, unitCostMinor, ...extra }],
      }),
    })
  }

  async function onHand(productId: string) {
    const rows = await db
      .select()
      .from(stockLevel)
      .where(and(eq(stockLevel.productId, productId), eq(stockLevel.branchId, branchAId)))
      .limit(1)
    return rows[0]
  }

  it('receives a full delivery and closes the order', async () => {
    const { orderId, lineId } = await approvedOrder(10, 5_000)
    const response = await receive(orderId, lineId, 10, 5_000)
    expect(response.status, await response.clone().text()).toBe(201)

    const body = await readJson<{
      receipt: { id: string; number: string }
      order: { order: { status: string }; lines: { receivedQuantity: number }[] }
    }>(response)
    expect(body.order.order.status).toBe('RECEIVED')
    expect(body.order.lines[0]?.receivedQuantity).toBe(10)

    // The receipt knows its order, so the console can list what arrived against it.
    const receipts = await app.request(
      `/api/inventory/receipts?branchId=${branchAId}&purchaseOrderId=${orderId}`,
      { headers: authedHeaders(managerACookie) },
    )
    expect(receipts.status).toBe(200)
    const receiptList = await readJson<{
      receipts: { id: string; purchaseOrderId: string | null }[]
    }>(receipts)
    expect(receiptList.receipts).toHaveLength(1)
    expect(receiptList.receipts[0]?.id).toBe(body.receipt.id)
    expect(receiptList.receipts[0]?.purchaseOrderId).toBe(orderId)

    const level = await onHand(productAId)
    expect(level?.quantityOnHand).toBeGreaterThanOrEqual(10)
    expect(level?.avgCostMinor).toBe(5_000)

    const [productRow] = await db.select().from(product).where(eq(product.id, productAId))
    expect(productRow?.costPriceMinor).toBe(5_000)
  })

  it('creates the supplier-product link on the first receipt', async () => {
    const rows = await db
      .select()
      .from(supplierProduct)
      .where(
        and(eq(supplierProduct.supplierId, supplierId), eq(supplierProduct.productId, productAId)),
      )
    expect(rows).toHaveLength(1)
    expect(rows[0]?.lastCostMinor).toBe(5_000)
    expect(rows[0]?.leadTimeDays).toBeNull()
  })

  it('leaves the order partly received after a short delivery', async () => {
    const { orderId, lineId } = await approvedOrder(10, 1_000)
    const first = await receive(orderId, lineId, 6, 1_000)
    expect(first.status).toBe(201)
    const firstBody = await readJson<{
      order: { order: { status: string }; lines: { outstandingQuantity: number }[] }
    }>(first)
    expect(firstBody.order.order.status).toBe('PARTIALLY_RECEIVED')
    expect(firstBody.order.lines[0]?.outstandingQuantity).toBe(4)

    const second = await receive(orderId, lineId, 4, 1_000)
    const secondBody = await readJson<{ order: { order: { status: string } } }>(second)
    expect(secondBody.order.order.status).toBe('RECEIVED')
  })

  it('refuses an over-delivery without a reason and records one with it', async () => {
    const { orderId, lineId } = await approvedOrder(10, 500)

    const blocked = await receive(orderId, lineId, 11, 500)
    expect(blocked.status).toBe(400)

    const allowed = await receive(orderId, lineId, 11, 500, {
      overReceiptReason: 'SUPPLIER_SENT_MORE',
      overReceiptNote: 'Supplier sent a spare',
    })
    expect(allowed.status).toBe(201)

    const receiptLines = await db
      .select()
      .from(stockReceiptLine)
      .where(eq(stockReceiptLine.purchaseOrderLineId, lineId))
    expect(receiptLines[0]?.overReceiptReason).toBe('SUPPLIER_SENT_MORE')
    expect(receiptLines[0]?.quantity).toBe(11)
  })

  it('refuses to receive an order that is not approved', async () => {
    const created = await app.request('/api/procurement/orders', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        idempotencyKey: randomUUID(),
        lines: [{ productId: productAId, quantity: 1, unitCostMinor: 100 }],
      }),
    })
    const detail = await readJson<{ order: { id: string } }>(created)
    orderIds.push(detail.order.id)
    const lineResponse = await app.request(`/api/procurement/orders/${detail.order.id}`, {
      headers: authedHeaders(managerACookie),
    })
    const lineBody = await readJson<{ lines: { id: string }[] }>(lineResponse)

    const response = await receive(detail.order.id, lineBody.lines[0]?.id ?? '', 1, 100)
    expect(response.status).toBe(409)
  })

  it('replays a receipt with the same idempotency key', async () => {
    const { orderId, lineId } = await approvedOrder(5, 200)
    const idempotencyKey = randomUUID()

    const first = await receive(orderId, lineId, 5, 200, {}, managerACookie, idempotencyKey)
    const second = await receive(orderId, lineId, 5, 200, {}, managerACookie, idempotencyKey)

    expect(first.status).toBe(201)
    expect(second.status).toBe(200)

    const rows = await db
      .select()
      .from(stockReceiptLine)
      .where(eq(stockReceiptLine.purchaseOrderLineId, lineId))
    expect(rows).toHaveLength(1)
  })

  it('blends average cost across two receipts', async () => {
    const first = await approvedOrder(10, 100, productCId)
    await receive(first.orderId, first.lineId, 10, 100)

    const second = await approvedOrder(10, 200, productCId)
    await receive(second.orderId, second.lineId, 10, 200)

    const level = await onHand(productCId)
    expect(level?.quantityOnHand).toBe(20)
    expect(level?.avgCostMinor).toBe(150)

    const [productRow] = await db.select().from(product).where(eq(product.id, productCId))
    expect(productRow?.costPriceMinor).toBe(200)
  })

  it('keeps another branch out of the receipt', async () => {
    const { orderId, lineId } = await approvedOrder(1, 100)
    const response = await receive(orderId, lineId, 1, 100, {}, managerBCookie)
    expect(response.status).toBe(403)
  })
})

describe.skipIf(!available)('orders from replenishment suggestions', () => {
  async function suggest(input: {
    lines: { productId: string; quantity: number; unitCostMinor?: number }[]
    idempotencyKey?: string
    branchId?: string
    cookie?: string
  }) {
    return app.request('/api/procurement/orders/from-suggestions', {
      method: 'POST',
      headers: authedHeaders(input.cookie ?? managerACookie),
      body: JSON.stringify({
        branchId: input.branchId ?? branchAId,
        supplierId,
        expectedDate: '2026-12-01',
        idempotencyKey: input.idempotencyKey ?? randomUUID(),
        lines: input.lines,
      }),
    })
  }

  beforeAll(async () => {
    if (!available) return
    // A supplier's last delivery, which is where a suggestion's cost comes from.
    await db
      .insert(supplierProduct)
      .values({ supplierId, productId: productBId, lastCostMinor: 1_200, leadTimeDays: 5 })
      .onConflictDoNothing()
  })

  it('creates a draft priced from the supplier link', async () => {
    const response = await suggest({ lines: [{ productId: productBId, quantity: 10 }] })
    expect(response.status, await response.clone().text()).toBe(201)
    const detail = await readJson<{
      order: { id: string; status: string }
      goodsValueMinor: number
      lines: { unitCostMinor: number; quantity: number }[]
    }>(response)
    orderIds.push(detail.order.id)

    expect(detail.order.status).toBe('DRAFT')
    expect(detail.goodsValueMinor).toBe(12_000)
    expect(detail.lines[0]?.unitCostMinor).toBe(1_200)
    expect(detail.lines[0]?.quantity).toBe(10)
  })

  it('prefers a cost the manager typed', async () => {
    const response = await suggest({
      lines: [{ productId: productBId, quantity: 5, unitCostMinor: 1_500 }],
    })
    expect(response.status).toBe(201)
    const detail = await readJson<{ order: { id: string }; goodsValueMinor: number }>(response)
    orderIds.push(detail.order.id)
    expect(detail.goodsValueMinor).toBe(7_500)
  })

  it('replays the same key instead of committing twice', async () => {
    const idempotencyKey = randomUUID()
    const first = await suggest({
      lines: [{ productId: productBId, quantity: 1 }],
      idempotencyKey,
    })
    const second = await suggest({
      lines: [{ productId: productBId, quantity: 1 }],
      idempotencyKey,
    })
    expect(first.status).toBe(201)
    expect(second.status).toBe(200)
    const firstBody = await readJson<{ order: { id: string } }>(first)
    const secondBody = await readJson<{ order: { id: string } }>(second)
    orderIds.push(firstBody.order.id)
    expect(secondBody.order.id).toBe(firstBody.order.id)
  })

  it('refuses a product with no cost from this supplier, naming it', async () => {
    const response = await suggest({ lines: [{ productId: productDId, quantity: 2 }] })
    expect(response.status).toBe(400)
    const body = await readJson<{ error: { message: string } }>(response)
    expect(body.error.message).toContain(`OPD${suffix.slice(-5)}`)
  })

  it('refuses an explicitly zero cost rather than sailing under the threshold', async () => {
    const response = await suggest({
      lines: [{ productId: productBId, quantity: 2, unitCostMinor: 0 }],
    })
    expect(response.status).toBe(400)
  })

  it('runs through the ordinary threshold on submit', async () => {
    const response = await suggest({ lines: [{ productId: productBId, quantity: 1 }] })
    const detail = await readJson<{ order: { id: string } }>(response)
    orderIds.push(detail.order.id)

    const submit = await app.request(`/api/procurement/orders/${detail.order.id}/submit`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(submit.status).toBe(200)
    const row = await orderRow(detail.order.id)
    expect(row?.status).toBe('APPROVED')
    expect(row?.approvalId).toBeNull()
  })

  it('keeps another branch out of the suggestion order', async () => {
    const response = await suggest({
      lines: [{ productId: productBId, quantity: 1 }],
      cookie: managerBCookie,
    })
    expect(response.status).toBe(403)
  })
})

describe.skipIf(!available)('purchase returns', () => {
  async function receiptLineFor(productId: string) {
    const rows = await db
      .select()
      .from(stockReceiptLine)
      .where(eq(stockReceiptLine.productId, productId))
      .limit(1)
    return rows[0]
  }

  async function createReturn(quantity: number, productId = productAId, cookie = managerACookie) {
    const line = await receiptLineFor(productId)
    const response = await app.request('/api/procurement/returns', {
      method: 'POST',
      headers: authedHeaders(cookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        reason: 'Damaged on arrival',
        idempotencyKey: randomUUID(),
        lines: [{ receiptLineId: line?.id, quantity }],
      }),
    })
    const body = await readJson<{
      supplierReturn: { id: string; status: string; number: string }
    }>(response)
    return { response, body: body.supplierReturn, line }
  }

  it('creates a draft that posts nothing', async () => {
    const { response, body } = await createReturn(1)
    expect(response.status).toBe(201)
    expect(body.status).toBe('DRAFT')

    const credits = await db
      .select()
      .from(supplierCreditNote)
      .where(eq(supplierCreditNote.returnId, body.id))
    expect(credits).toHaveLength(0)
  })

  it('posts the return: negative movement, credit note, reduced balance', async () => {
    const balanceBefore = await app.request('/api/payables/balances', {
      headers: authedHeaders(managerACookie),
    })
    const beforeBody = await readJson<{ balances: { supplierId: string; owedMinor: number }[] }>(
      balanceBefore,
    )
    const owedBefore =
      beforeBody.balances.find((row) => row.supplierId === supplierId)?.owedMinor ?? 0

    const { body, line } = await createReturn(2)
    const posted = await app.request(`/api/procurement/returns/${body.id}/post`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    expect(posted.status).toBe(200)

    const detail = await readJson<{
      supplierReturn: { status: string; creditNoteNumber: string | null }
      creditNote: { number: string; amountMinor: number } | null
    }>(posted)
    expect(detail.supplierReturn.status).toBe('POSTED')
    expect(detail.creditNote?.number).toMatch(/^SCN-/)

    const expectedCredit = 2 * (line?.unitCostMinor ?? 0)
    expect(detail.creditNote?.amountMinor).toBe(expectedCredit)

    const movements = await db
      .select()
      .from(stockMovement)
      .where(eq(stockMovement.referenceId, body.id))
    expect(movements).toHaveLength(1)
    expect(movements[0]?.type).toBe('SUPPLIER_RETURN')
    expect(movements[0]?.quantityDelta).toBe(-2)

    const balanceAfter = await app.request('/api/payables/balances', {
      headers: authedHeaders(managerACookie),
    })
    const afterBody = await readJson<{
      balances: { supplierId: string; owedMinor: number; creditMinor: number }[]
    }>(balanceAfter)
    const row = afterBody.balances.find((entry) => entry.supplierId === supplierId)
    expect(row?.owedMinor).toBe(owedBefore - expectedCredit)
    expect(row?.creditMinor).toBe(expectedCredit)
  })

  it('refuses to return more than was received', async () => {
    const { line } = await createReturn(1)
    const response = await app.request('/api/procurement/returns', {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        reason: 'Too many',
        idempotencyKey: randomUUID(),
        lines: [{ receiptLineId: line?.id, quantity: 999 }],
      }),
    })
    expect(response.status).toBe(400)
  })

  it('cancels a draft and refuses to cancel a posted return', async () => {
    const draft = await createReturn(1)
    const cancel = await app.request(`/api/procurement/returns/${draft.body.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ reason: 'Supplier accepted the goods after all' }),
    })
    expect(cancel.status).toBe(200)
    const cancelled = await readJson<{ supplierReturn: { status: string } }>(cancel)
    expect(cancelled.supplierReturn.status).toBe('CANCELLED')

    const posted = await createReturn(1)
    await app.request(`/api/procurement/returns/${posted.body.id}/post`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
    })
    const refuse = await app.request(`/api/procurement/returns/${posted.body.id}/cancel`, {
      method: 'POST',
      headers: authedHeaders(managerACookie),
      body: JSON.stringify({ reason: 'Changed my mind' }),
    })
    expect(refuse.status).toBe(409)
  })

  it('keeps credit notes out of the aging buckets', async () => {
    const aging = await app.request('/api/payables/aging', {
      headers: authedHeaders(managerACookie),
    })
    expect(aging.status).toBe(200)
    const body = await readJson<{
      suppliers: { supplierId: string; creditMinor: number; buckets: Record<string, number> }[]
      creditNotesMinor: number
    }>(aging)
    const row = body.suppliers.find((entry) => entry.supplierId === supplierId)
    expect(body.creditNotesMinor).toBeGreaterThan(0)
    // A credit note can be a supplier's only balance, and that supplier is still a row:
    // the ageing export's TOTAL is the sum of the rows it prints, so a credit it shows
    // cannot be invisible in the body above it.
    expect(row).toBeDefined()
    expect(row?.creditMinor).toBeGreaterThan(0)
    expect(body.suppliers.reduce((sum, entry) => sum + entry.creditMinor, 0)).toBe(
      body.creditNotesMinor,
    )
    // The credit is reported beside the buckets, never inside them.
    expect(Object.keys(row?.buckets ?? {}).sort()).toEqual(
      ['current', 'days1To30', 'days31To60', 'days61To90', 'over90'].sort(),
    )
  })

  it('keeps another branch out of the return', async () => {
    const line = await receiptLineFor(productAId)
    const response = await app.request('/api/procurement/returns', {
      method: 'POST',
      headers: authedHeaders(managerBCookie),
      body: JSON.stringify({
        branchId: branchAId,
        supplierId,
        reason: 'Cross branch',
        idempotencyKey: randomUUID(),
        lines: [{ receiptLineId: line?.id, quantity: 1 }],
      }),
    })
    expect(response.status).toBe(403)
  })

  it('says what is still returnable on a receipt', async () => {
    const line = await receiptLineFor(productAId)
    const response = await app.request(`/api/procurement/receipts/${line?.receiptId}/returnable`, {
      headers: authedHeaders(managerACookie),
    })
    expect(response.status, await response.clone().text()).toBe(200)
    const body = await readJson<{
      receipt: { id: string; number: string; purchaseOrderId: string | null }
      lines: {
        id: string
        receivedQuantity: number
        returnedQuantity: number
        returnableQuantity: number
      }[]
    }>(response)

    expect(body.receipt.id).toBe(line?.receiptId)
    const returnable = body.lines.find((candidate) => candidate.id === line?.id)
    expect(returnable).toBeDefined()
    // The first return leg posted against this receipt, so the cap has moved.
    expect(returnable?.returnedQuantity).toBeGreaterThan(0)
    expect(returnable?.returnableQuantity).toBe(
      (returnable?.receivedQuantity ?? 0) - (returnable?.returnedQuantity ?? 0),
    )

    const foreign = await app.request(`/api/procurement/receipts/${line?.receiptId}/returnable`, {
      headers: authedHeaders(managerBCookie),
    })
    expect(foreign.status).toBe(403)
  })
})
