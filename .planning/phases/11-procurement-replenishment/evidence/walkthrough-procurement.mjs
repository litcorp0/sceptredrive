#!/usr/bin/env node
/**
 * Phase 11 Plan 11 — the procurement walkthrough.
 *
 *   bun .planning/phases/11-procurement-replenishment/evidence/walkthrough-procurement.mjs
 *
 * Runs against the real API on :4000 with a fresh, migrated and demo-seeded database. Every
 * fixture is created through the API with a unique suffix, so a second run neither borrows nor
 * collides with the demo seed's supplier (Phase 9's demo month has already invoiced it).
 *
 * Prints `PASS n` / `FAIL n (…)` per leg, exits non-zero on any failure, and is committed as
 * `walkthrough-procurement.txt`. SQL is read-only: the three suggestion facts are re-derived
 * from the database to prove the screen's number is reproducible.
 */
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const env = fs.existsSync(path.join(repoRoot, '.env'))
  ? fs.readFileSync(path.join(repoRoot, '.env'), 'utf8')
  : ''
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]

const apiUrl = process.env.API_URL ?? envValue('API_URL') ?? 'http://localhost:4000'
const origin = process.env.ADMIN_URL ?? envValue('ADMIN_URL') ?? 'http://localhost:3000'
const adminEmail = envValue('ADMIN_EMAIL')
const adminPassword = envValue('ADMIN_PASSWORD')
const databaseUrl = envValue('DATABASE_URL')

if (!adminEmail || !adminPassword) {
  console.error('ADMIN_EMAIL / ADMIN_PASSWORD are required in .env')
  process.exit(1)
}

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const tail = suffix.toUpperCase().slice(-5)

let passed = 0
const failures = []

function check(label, condition, detail) {
  const index = passed + failures.length + 1
  if (condition) {
    passed += 1
    console.log(`PASS ${index}  ${label}`)
    return true
  }
  failures.push(label)
  console.log(`FAIL ${index}  ${label}${detail === undefined ? '' : ` — got ${detail}`}`)
  return false
}

function section(title) {
  console.log(`\n## ${title}`)
}

async function signIn(email, password) {
  const response = await fetch(`${apiUrl}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin },
    body: JSON.stringify({ email, password }),
  })
  if (response.status !== 200) {
    throw new Error(`sign-in failed for ${email} (${response.status}): ${await response.text()}`)
  }
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function call(cookie, method, urlPath, body) {
  const response = await fetch(`${apiUrl}${urlPath}`, {
    method,
    headers: {
      cookie,
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  let payload = null
  const text = await response.text()
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  return { status: response.status, body: payload }
}

const get = (cookie, urlPath) => call(cookie, 'GET', urlPath)
const post = (cookie, urlPath, body) => call(cookie, 'POST', urlPath, body)
const patch = (cookie, urlPath, body) => call(cookie, 'PATCH', urlPath, body)

function key() {
  return crypto.randomUUID()
}

async function createStaff(adminCookie, { name, role, branchId, password }) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const temporaryEmail = `walk-${slug}-${suffix}@sceptre.test`
  const created = await post(adminCookie, '/api/staff', {
    email: temporaryEmail,
    name,
    role,
    branchId,
  })
  if (created.status !== 201 && created.status !== 200) {
    throw new Error(`staff create failed (${created.status}): ${JSON.stringify(created.body)}`)
  }
  const temporaryPassword = created.body.temporaryPassword
  let session = await signIn(temporaryEmail, temporaryPassword)
  const changed = await post(session, '/api/me/password', {
    currentPassword: temporaryPassword,
    newPassword: password,
  })
  if (changed.status !== 200 && changed.status !== 204) {
    throw new Error(`password change failed (${changed.status}): ${JSON.stringify(changed.body)}`)
  }
  session = await signIn(temporaryEmail, password)
  return { email: temporaryEmail, cookie: session }
}

const adminCookie = await signIn(adminEmail, adminPassword)

// ------------------------------------------------------------------ fixtures

section('fixtures (created through the API)')

const branches = await Promise.all([
  post(adminCookie, '/api/branches', {
    code: `WR-${tail.slice(0, 4)}`,
    name: `Walk retail ${suffix}`,
    type: 'RETAIL',
    city: 'Accra',
  }),
  post(adminCookie, '/api/branches', {
    code: `WW-${tail.slice(0, 4)}`,
    name: `Walk warehouse ${suffix}`,
    type: 'WAREHOUSE',
    city: 'Accra',
  }),
  post(adminCookie, '/api/branches', {
    code: `WC-${tail.slice(0, 4)}`,
    name: `Walk foreign ${suffix}`,
    type: 'RETAIL',
    city: 'Kumasi',
  }),
])
const [retailId, warehouseId, foreignId] = branches.map((response) => response.body?.branch?.id)
if (!retailId || !warehouseId || !foreignId) {
  console.error('could not create branches', JSON.stringify(branches.map((b) => b.body)))
  process.exit(1)
}

const categoryResponse = await post(adminCookie, '/api/categories', {
  name: `Walk category ${suffix}`,
})
const uomResponse = await post(adminCookie, '/api/uoms', {
  code: `W${tail}`,
  name: `Walk unit ${suffix}`,
})
const categoryId = categoryResponse.body?.category?.id
const uomId = uomResponse.body?.uom?.id
if (!categoryId || !uomId) {
  console.error('could not create category/uom', categoryResponse.body, uomResponse.body)
  process.exit(1)
}

const supplierNames = [
  `Walk supplier one ${suffix}`,
  `Walk supplier two ${suffix}`,
  `Walk supplier three ${suffix}`,
]
const supplierResponses = []
for (const name of supplierNames) {
  supplierResponses.push(await post(adminCookie, '/api/suppliers', { name, paymentTermDays: 30 }))
}
const supplierIds = supplierResponses.map((response) => response.body?.supplier?.id)
if (supplierIds.some((id) => !id)) {
  console.error(
    'could not create suppliers',
    supplierResponses.map((s) => s.body),
  )
  process.exit(1)
}
const [supplierOne, supplierTwo, supplierThree] = supplierIds

const products = []
for (let index = 1; index <= 12; index += 1) {
  const response = await post(adminCookie, '/api/products', {
    sku: `WP${String(index).padStart(2, '0')}${tail}`,
    name: `Walk product ${index} ${suffix}`,
    categoryId,
    uomId,
    basePriceMinor: 100_000,
  })
  const id = response.body?.product?.id
  if (!id) {
    console.error('could not create product', index, response.body)
    process.exit(1)
  }
  products.push(id)
}
const [p1, p2, p3, , , , , , , , p11, p12] = products

for (const productId of products.slice(0, 11)) {
  await post(adminCookie, `/api/suppliers/${supplierOne}/products`, {
    productId,
    leadTimeDays: 7,
    isPreferred: true,
  })
}
await post(adminCookie, `/api/suppliers/${supplierTwo}/products`, {
  productId: p2,
  leadTimeDays: 3,
})
await post(adminCookie, `/api/suppliers/${supplierThree}/products`, {
  productId: p3,
  leadTimeDays: 21,
})

await fetch(`${apiUrl}/api/inventory/thresholds`, {
  method: 'PUT',
  headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
  body: JSON.stringify({
    branchId: retailId,
    productId: p1,
    threshold: 10,
    maxQuantity: 20,
    minOrderQuantity: 5,
  }),
})
await fetch(`${apiUrl}/api/inventory/thresholds`, {
  method: 'PUT',
  headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
  body: JSON.stringify({ branchId: retailId, productId: p11, threshold: 5, maxQuantity: 20 }),
})
await fetch(`${apiUrl}/api/inventory/thresholds`, {
  method: 'PUT',
  headers: { cookie: adminCookie, origin, 'content-type': 'application/json' },
  body: JSON.stringify({ branchId: retailId, productId: p12, threshold: 10, maxQuantity: 20 }),
})

const managerA = await createStaff(adminCookie, {
  name: `Walk manager A ${suffix}`,
  role: 'MANAGER',
  branchId: retailId,
  password: `walk-manager-a-${suffix}`,
})
const managerForeign = await createStaff(adminCookie, {
  name: `Walk manager foreign ${suffix}`,
  role: 'MANAGER',
  branchId: foreignId,
  password: `walk-manager-f-${suffix}`,
})
const cashier = await createStaff(adminCookie, {
  name: `Walk cashier ${suffix}`,
  role: 'CASHIER',
  branchId: retailId,
  password: `walk-cashier-${suffix}`,
})

const units = { P1_COST: 50_000, P1_PRICE: 100_000 }

async function createOrder(
  cookie,
  { quantity, unitCostMinor, productId = p1, branchId = retailId },
) {
  const response = await post(cookie, '/api/procurement/orders', {
    branchId,
    supplierId: supplierOne,
    expectedDate: '2026-12-01',
    idempotencyKey: key(),
    lines: [{ productId, quantity, unitCostMinor }],
  })
  return response
}

async function submit(cookie, orderId) {
  return post(cookie, `/api/procurement/orders/${orderId}/submit`)
}

async function orderDetail(cookie, orderId) {
  return get(cookie, `/api/procurement/orders/${orderId}`)
}

async function stock(cookie, productId, branchId = retailId) {
  const response = await get(cookie, `/api/inventory/stock/${productId}?branchId=${branchId}`)
  return response.body?.stock
}

async function onHand(cookie, productId, branchId = retailId) {
  return (await stock(cookie, productId, branchId))?.quantityOnHand ?? 0
}

// ---------------------------------------------------------------------- legs

section('1–9: the order lifecycle and the threshold')

const draft = await createOrder(managerA.cookie, { quantity: 10, unitCostMinor: units.P1_COST })
const draftOrder = draft.body?.order
check('1a manager can raise a DRAFT order', draft.status === 201, draft.status)
check(
  '1b the number is branch-month-sequential',
  /^PO-[A-Z0-9]+(?:-[A-Z0-9]+)*-\d{6}-\d{4}$/.test(draftOrder?.number ?? ''),
  draftOrder?.number,
)
check(
  '1c the goods value is Σ quantity × unit cost',
  draft.body?.goodsValueMinor === 10 * units.P1_COST,
  draft.body?.goodsValueMinor,
)
check(
  '1d an order with no human decision has no approval row',
  draft.body?.approval === null,
  JSON.stringify(draft.body?.approval),
)

const submittedBelow = await submit(managerA.cookie, draftOrder.id)
check(
  '2a a below-limit order submits to APPROVED',
  submittedBelow.body?.order?.status === 'APPROVED',
  submittedBelow.body?.order?.status,
)
check(
  '2b it was approved without a human',
  submittedBelow.body?.approval === null,
  JSON.stringify(submittedBelow.body?.approval),
)

const adminDraft = await createOrder(adminCookie, { quantity: 30, unitCostMinor: units.P1_COST })
const adminSubmitted = await submit(adminCookie, adminDraft.body.order.id)
check(
  "3a an admin's own order is approved regardless of value",
  adminSubmitted.body?.order?.status === 'APPROVED',
  adminSubmitted.body?.order?.status,
)
check(
  '3b it writes no approval row',
  adminSubmitted.body?.approval === null,
  JSON.stringify(adminSubmitted.body?.approval),
)

const atLimit = await createOrder(managerA.cookie, { quantity: 20, unitCostMinor: units.P1_COST })
const atLimitSubmitted = await submit(managerA.cookie, atLimit.body.order.id)
check(
  '4a exactly at the limit waits for a decision',
  atLimitSubmitted.body?.order?.status === 'PENDING_APPROVAL',
  atLimitSubmitted.body?.order?.status,
)

const pendingApprovals = await get(
  adminCookie,
  '/api/approvals?type=PURCHASE_ORDER&status=PENDING&limit=200',
)
const pendingRow = (pendingApprovals.body?.approvals ?? []).find(
  (row) => row.entityId === atLimit.body.order.id,
)
check(
  '4b the approval carries the goods value',
  pendingRow?.amountMinor === 20 * units.P1_COST,
  pendingRow?.amountMinor,
)

const managerDecision = await post(managerA.cookie, `/api/approvals/${pendingRow?.id}/decide`, {
  decision: 'APPROVED',
})
check('5 a manager cannot decide an order', managerDecision.status === 403, managerDecision.status)

const adminDecision = await post(adminCookie, `/api/approvals/${pendingRow?.id}/decide`, {
  decision: 'APPROVED',
  note: 'Checked the quote',
})
check(
  '6a the admin decides it',
  adminDecision.body?.approval?.status === 'APPROVED',
  adminDecision.body?.approval?.status,
)
check(
  '6b the decider is not the requester',
  adminDecision.body?.approval?.decidedBy !== adminDecision.body?.approval?.requestedBy,
  `${adminDecision.body?.approval?.decidedBy} vs ${adminDecision.body?.approval?.requestedBy}`,
)

const secondDecision = await post(adminCookie, `/api/approvals/${pendingRow?.id}/decide`, {
  decision: 'APPROVED',
})
check('7 deciding twice is a conflict', secondDecision.status === 409, secondDecision.status)

const editApproved = await patch(
  managerA.cookie,
  `/api/procurement/orders/${atLimit.body.order.id}`,
  {
    note: 'late edit',
  },
)
check('8 an approved order cannot be edited', editApproved.status === 409, editApproved.status)

// ------------------------------------------------------------------ receiving

section('9–13: sending and receiving')

const receiveOrderResponse = await createOrder(managerA.cookie, {
  quantity: 10,
  unitCostMinor: units.P1_COST,
})
const receivingOrderId = receiveOrderResponse.body.order.id
await submit(managerA.cookie, receivingOrderId)
const sent = await post(managerA.cookie, `/api/procurement/orders/${receivingOrderId}/send`)
check('9a sending records SENT', sent.body?.order?.status === 'SENT', sent.body?.order?.status)
check(
  '9b it stamps sent_at',
  typeof sent.body?.order?.sentAt === 'string',
  sent.body?.order?.sentAt,
)

const lines = (await orderDetail(managerA.cookie, receivingOrderId)).body.lines
const lineId = lines[0].id
const onHandBefore = await onHand(managerA.cookie, p1)

const firstReceipt = await post(
  managerA.cookie,
  `/api/procurement/orders/${receivingOrderId}/receive`,
  {
    idempotencyKey: key(),
    lines: [{ purchaseOrderLineId: lineId, quantity: 6, unitCostMinor: units.P1_COST }],
  },
)
check(
  '10a 6 of 10 leaves the order partly received',
  firstReceipt.body?.order?.order?.status === 'PARTIALLY_RECEIVED',
  firstReceipt.body?.order?.order?.status,
)
check(
  '10b 4 are still outstanding',
  firstReceipt.body?.order?.lines?.[0]?.outstandingQuantity === 4,
  firstReceipt.body?.order?.lines?.[0]?.outstandingQuantity,
)
check(
  '10c the receipt is numbered GRN-',
  /^GRN-/.test(firstReceipt.body?.receipt?.number ?? ''),
  firstReceipt.body?.receipt?.number,
)
check(
  '10d stock rose by 6',
  (await onHand(managerA.cookie, p1)) === onHandBefore + 6,
  await onHand(managerA.cookie, p1),
)

const supplierDetail = await get(adminCookie, `/api/suppliers/${supplierOne}`)
const link = (supplierDetail.body?.products ?? []).find((row) => row.productId === p1)
check(
  '10e the first delivery created the supplier-product cost',
  link?.lastCostMinor === units.P1_COST,
  link?.lastCostMinor,
)

const secondReceipt = await post(
  managerA.cookie,
  `/api/procurement/orders/${receivingOrderId}/receive`,
  {
    idempotencyKey: key(),
    lines: [{ purchaseOrderLineId: lineId, quantity: 4, unitCostMinor: units.P1_COST }],
  },
)
check(
  '11a the balance arrives and the order is RECEIVED',
  secondReceipt.body?.order?.order?.status === 'RECEIVED',
  secondReceipt.body?.order?.order?.status,
)
check(
  '11b stock rose by 10 in total',
  (await onHand(managerA.cookie, p1)) === onHandBefore + 10,
  await onHand(managerA.cookie, p1),
)

const overOrder = await createOrder(managerA.cookie, { quantity: 10, unitCostMinor: units.P1_COST })
await submit(managerA.cookie, overOrder.body.order.id)
await post(managerA.cookie, `/api/procurement/orders/${overOrder.body.order.id}/send`)
const overLineId = (await orderDetail(managerA.cookie, overOrder.body.order.id)).body.lines[0].id
await post(managerA.cookie, `/api/procurement/orders/${overOrder.body.order.id}/receive`, {
  idempotencyKey: key(),
  lines: [{ purchaseOrderLineId: overLineId, quantity: 6, unitCostMinor: units.P1_COST }],
})
const overBlocked = await post(
  managerA.cookie,
  `/api/procurement/orders/${overOrder.body.order.id}/receive`,
  {
    idempotencyKey: key(),
    lines: [{ purchaseOrderLineId: overLineId, quantity: 6, unitCostMinor: units.P1_COST }],
  },
)
check(
  '12 an over-delivery without a reason is refused',
  overBlocked.status === 400,
  overBlocked.status,
)

const overAllowed = await post(
  managerA.cookie,
  `/api/procurement/orders/${overOrder.body.order.id}/receive`,
  {
    idempotencyKey: key(),
    lines: [
      {
        purchaseOrderLineId: overLineId,
        quantity: 6,
        unitCostMinor: units.P1_COST,
        overReceiptReason: 'SUPPLIER_SENT_MORE',
        overReceiptNote: 'Supplier sent a spare box',
      },
    ],
  },
)
check(
  '13a an over-delivery with a reason is accepted',
  overAllowed.status === 201,
  overAllowed.status,
)
check(
  '13b the excess is recorded, not clamped',
  overAllowed.body?.order?.lines?.[0]?.receivedQuantity === 12,
  overAllowed.body?.order?.lines?.[0]?.receivedQuantity,
)

// ------------------------------------------------------------------- invoices

section('14–17: invoice matching')

const invoiceBase = {
  supplierId: supplierOne,
  branchId: retailId,
  invoiceDate: '2026-10-20',
}

const invoiceBody = (extra) => ({ ...invoiceBase, ...extra, idempotencyKey: key() })

const matchedInvoice = await post(
  adminCookie,
  '/api/payables/invoices',
  invoiceBody({
    supplierInvoiceNumber: `MATCH-${tail}`,
    purchaseOrderId: receivingOrderId,
    lines: [{ productId: p1, quantity: 10, unitCostMinor: units.P1_COST }],
  }),
)
check(
  '14a a matched invoice posts',
  matchedInvoice.status === 201,
  `${matchedInvoice.status} ${JSON.stringify(matchedInvoice.body)}`,
)
const invoiceIdOf = (response) => response.body?.invoice?.invoice?.id
const matchedDetail = await get(
  adminCookie,
  `/api/payables/invoices/${invoiceIdOf(matchedInvoice)}`,
)
check(
  '14b it is MATCHED against the order',
  matchedDetail.body?.match?.status === 'MATCHED',
  `${matchedDetail.status} ${JSON.stringify(matchedDetail.body?.match)} poId=${matchedDetail.body?.invoice?.purchaseOrderId}`,
)

// A second order, fully received, so a price variance cannot also be a quantity variance.
const varianceOrder = await createOrder(managerA.cookie, {
  quantity: 4,
  unitCostMinor: units.P1_COST,
})
const varianceOrderId = varianceOrder.body.order.id
await submit(managerA.cookie, varianceOrderId)
await post(managerA.cookie, `/api/procurement/orders/${varianceOrderId}/send`)
const varianceLineId = (await orderDetail(managerA.cookie, varianceOrderId)).body.lines[0].id
await post(managerA.cookie, `/api/procurement/orders/${varianceOrderId}/receive`, {
  idempotencyKey: key(),
  lines: [{ purchaseOrderLineId: varianceLineId, quantity: 4, unitCostMinor: units.P1_COST }],
})

const priceInvoice = await post(
  adminCookie,
  '/api/payables/invoices',
  invoiceBody({
    supplierInvoiceNumber: `PRICE-${tail}`,
    purchaseOrderId: varianceOrderId,
    lines: [{ productId: p1, quantity: 2, unitCostMinor: 60_000 }],
  }),
)
const priceDetail = await get(adminCookie, `/api/payables/invoices/${invoiceIdOf(priceInvoice)}`)
check(
  '15a a higher price is flagged',
  priceDetail.body?.match?.status === 'PRICE_VARIANCE',
  priceDetail.body?.match?.status,
)
check('15b and the payable still posts', priceInvoice.status === 201, priceInvoice.status)
const priceLine = priceDetail.body?.match?.lines?.find((row) => row.productId === p1)
check(
  '15c both values are visible',
  priceLine?.invoicedUnitCostMinor === 60_000 && priceLine?.orderedUnitCostMinor === units.P1_COST,
  `${priceLine?.invoicedUnitCostMinor} vs ${priceLine?.orderedUnitCostMinor}`,
)

const quantityInvoice = await post(
  adminCookie,
  '/api/payables/invoices',
  invoiceBody({
    supplierInvoiceNumber: `QTY-${tail}`,
    purchaseOrderId: varianceOrderId,
    lines: [{ productId: p1, quantity: 999, unitCostMinor: units.P1_COST }],
  }),
)
const quantityDetail = await get(
  adminCookie,
  `/api/payables/invoices/${invoiceIdOf(quantityInvoice)}`,
)
check(
  '16a more than received is a quantity variance',
  quantityDetail.body?.match?.status === 'QUANTITY_VARIANCE',
  quantityDetail.body?.match?.status,
)
check('16b and it still posts', quantityInvoice.status === 201, quantityInvoice.status)

const cancelled = await createOrder(managerA.cookie, { quantity: 1, unitCostMinor: units.P1_COST })
const cancelledId = cancelled.body.order.id
await post(managerA.cookie, `/api/procurement/orders/${cancelledId}/cancel`, {
  reason: 'Raised twice',
})
const cancelledInvoice = await post(
  adminCookie,
  '/api/payables/invoices',
  invoiceBody({
    supplierInvoiceNumber: `CANCELLED-${tail}`,
    purchaseOrderId: cancelledId,
    lines: [{ productId: p1, quantity: 1, unitCostMinor: units.P1_COST }],
  }),
)
check(
  '17 invoicing a cancelled order is refused',
  cancelledInvoice.status === 409,
  cancelledInvoice.status,
)

// -------------------------------------------------------------------- returns

section('18–20: purchase returns and the credit they create')

const balancesBefore = await get(adminCookie, `/api/payables/balances?branchId=${retailId}`)
const owedBefore =
  (balancesBefore.body?.balances ?? []).find((row) => row.supplierId === supplierOne)?.owedMinor ??
  0
const movementsBefore = await get(
  adminCookie,
  `/api/inventory/movements?branchId=${retailId}&productId=${p1}&limit=200`,
)
const movementCountBefore = movementsBefore.body?.movements?.length ?? 0

const returnable = await get(
  adminCookie,
  `/api/procurement/receipts/${firstReceipt.body?.receipt?.id}/returnable`,
)
check(
  '18a-pre the returnable read answers',
  returnable.status === 200,
  `${returnable.status} ${JSON.stringify(returnable.body)}`,
)
const returnableLine = (returnable.body?.lines ?? []).find((row) => row.productId === p1)
check(
  '18a the returnable read caps at received − returned',
  returnableLine?.returnableQuantity ===
    returnableLine?.receivedQuantity - returnableLine?.returnedQuantity,
  `${returnableLine?.returnableQuantity} vs ${returnableLine?.receivedQuantity} - ${returnableLine?.returnedQuantity}`,
)

const returnDraft = await post(managerA.cookie, '/api/procurement/returns', {
  branchId: retailId,
  supplierId: supplierOne,
  purchaseOrderId: receivingOrderId,
  receiptId: firstReceipt.body?.receipt?.id,
  reason: 'Two pads were damaged',
  idempotencyKey: key(),
  lines: [{ receiptLineId: returnableLine.id, quantity: 2 }],
})
check(
  '18b a return starts as a DRAFT',
  returnDraft.body?.supplierReturn?.status === 'DRAFT',
  returnDraft.body?.supplierReturn?.status,
)
const movementsAfterDraft = await get(
  adminCookie,
  `/api/inventory/movements?branchId=${retailId}&productId=${p1}&limit=200`,
)
check(
  '18c a draft return moves no stock',
  (movementsAfterDraft.body?.movements?.length ?? 0) === movementCountBefore,
  movementsAfterDraft.body?.movements?.length,
)

const posted = await post(
  managerA.cookie,
  `/api/procurement/returns/${returnDraft.body.supplierReturn.id}/post`,
)
check(
  '18d posting creates the credit note',
  /^SCN-/.test(posted.body?.creditNote?.number ?? ''),
  posted.body?.creditNote?.number,
)
check(
  '18e the credit is 2 × the receipted unit cost',
  posted.body?.creditNote?.amountMinor === 2 * units.P1_COST,
  posted.body?.creditNote?.amountMinor,
)

const movementsAfterPost = await get(
  adminCookie,
  `/api/inventory/movements?branchId=${retailId}&productId=${p1}&limit=200`,
)
const returnMovement = (movementsAfterPost.body?.movements ?? []).find(
  (row) => row.type === 'SUPPLIER_RETURN',
)
check(
  '18f a negative SUPPLIER_RETURN movement posts',
  returnMovement?.quantityDelta === -2,
  returnMovement?.quantityDelta,
)

const balancesAfter = await get(adminCookie, `/api/payables/balances?branchId=${retailId}`)
const balanceAfter = (balancesAfter.body?.balances ?? []).find(
  (row) => row.supplierId === supplierOne,
)
check(
  '18g the supplier balance dropped by exactly the credit',
  balanceAfter?.owedMinor === owedBefore - 2 * units.P1_COST,
  `${balanceAfter?.owedMinor} vs ${owedBefore} - ${2 * units.P1_COST}`,
)

const overReturn = await post(managerA.cookie, '/api/procurement/returns', {
  branchId: retailId,
  supplierId: supplierOne,
  purchaseOrderId: receivingOrderId,
  receiptId: firstReceipt.body?.receipt?.id,
  reason: 'Impossible quantity',
  idempotencyKey: key(),
  lines: [{ receiptLineId: returnableLine.id, quantity: 999 }],
})
check(
  '19 returning more than was received is refused',
  overReturn.status === 400,
  overReturn.status,
)

check(
  '20 owed = invoice outstanding − credit notes',
  balanceAfter?.owedMinor === balanceAfter?.invoiceOutstandingMinor - balanceAfter?.creditMinor,
  `${balanceAfter?.owedMinor} vs ${balanceAfter?.invoiceOutstandingMinor} - ${balanceAfter?.creditMinor}`,
)

// ----------------------------------------------------------- ledgers and cost

section('21–22: the ledger and the derived catalogue cost')

const movements = await get(
  adminCookie,
  `/api/inventory/movements?branchId=${retailId}&productId=${p1}&limit=200`,
)
const ledgerSum = (movements.body?.movements ?? []).reduce(
  (total, row) => total + row.quantityDelta,
  0,
)
check(
  '21a the stock ledger equals on hand',
  ledgerSum === (await onHand(adminCookie, p1)),
  `${ledgerSum} vs ${await onHand(adminCookie, p1)}`,
)

const productAfterReceipt = await get(adminCookie, `/api/products/${p1}`)
const latestReceiptCost = productAfterReceipt.body?.product?.costPriceMinor
check(
  '22a the catalogue cost is the latest receipt cost',
  latestReceiptCost === units.P1_COST,
  latestReceiptCost,
)

// A receipt into the warehouse is the newest receipt, so it moves the catalogue cost.
await post(adminCookie, '/api/inventory/receipts', {
  branchId: warehouseId,
  supplierId: supplierOne,
  lines: [{ productId: p1, quantity: 5, unitCostMinor: 70_000 }],
})
const afterWarehouseReceipt = await get(adminCookie, `/api/products/${p1}`)
check(
  '22b a warehouse receipt is still a receipt',
  afterWarehouseReceipt.body?.product?.costPriceMinor === 70_000,
  afterWarehouseReceipt.body?.product?.costPriceMinor,
)

const transfer = await post(adminCookie, '/api/transfers', {
  fromBranchId: warehouseId,
  toBranchId: retailId,
  note: `Walk transfer ${suffix}`,
  lines: [{ productId: p1, quantity: 5 }],
})
const transferId = transfer.body?.transfer?.id
await post(adminCookie, `/api/transfers/${transferId}/dispatch`, {
  lines: [{ productId: p1, quantityDispatched: 5 }],
})
await post(adminCookie, `/api/transfers/${transferId}/receive`, {
  lines: [{ productId: p1, quantityReceived: 5 }],
})
const afterTransfer = await get(adminCookie, `/api/products/${p1}`)
check(
  '22c a transfer-in does not change the catalogue cost',
  afterTransfer.body?.product?.costPriceMinor === 70_000,
  afterTransfer.body?.product?.costPriceMinor,
)

// ------------------------------------------------------------------ replenishment

section('23–24: suggestions, by hand')

const db = new Client({ connectionString: databaseUrl })
await db.connect()

async function suggestionRow(productId) {
  const response = await get(
    managerA.cookie,
    `/api/replenishment/suggestions?branchId=${retailId}&limit=200`,
  )
  const rows = [
    ...(response.body?.groups ?? []).flatMap((group) => group.rows),
    ...(response.body?.unassigned?.rows ?? []),
  ]
  return { row: rows.find((candidate) => candidate.productId === productId), body: response.body }
}

const handFacts = async (productId) => {
  const level = await db.query(
    'select quantity_on_hand from stock_level where product_id = $1 and branch_id = $2',
    [productId, retailId],
  )
  const sold = await db.query(
    `select coalesce(sum(sl.quantity), 0)::int as units
       from sale_line sl join sale s on s.id = sl.sale_id
      where sl.product_id = $1 and s.branch_id = $2
        and s.occurred_at >= now() - interval '90 days'`,
    [productId, retailId],
  )
  const onOrder = await db.query(
    `select coalesce(sum(pol.quantity), 0)::int - coalesce(sum(srl.quantity), 0)::int as outstanding
       from purchase_order_line pol
       join purchase_order po on po.id = pol.order_id
       left join stock_receipt_line srl on srl.purchase_order_line_id = pol.id
      where pol.product_id = $1 and po.branch_id = $2
        and po.status in ('APPROVED','SENT','PARTIALLY_RECEIVED')`,
    [productId, retailId],
  )
  return {
    onHand: level.rows[0]?.quantity_on_hand ?? 0,
    unitsSold: sold.rows[0]?.units ?? 0,
    onOrder: Math.max(onOrder.rows[0]?.outstanding ?? 0, 0),
  }
}

const p1Facts = await handFacts(p1)
const p1Suggestion = await suggestionRow(p1)
check(
  "23a the suggestion's inputs are the database's facts",
  p1Suggestion.row?.onHand === p1Facts.onHand &&
    p1Suggestion.row?.unitsSold === p1Facts.unitsSold &&
    p1Suggestion.row?.onOrder === p1Facts.onOrder,
  JSON.stringify({ row: p1Suggestion.row, facts: p1Facts }),
)
const expectedCoverage = Math.ceil(
  (p1Facts.unitsSold * (p1Suggestion.row.leadTimeDays + p1Suggestion.body.settings.safetyDays)) /
    p1Suggestion.body.settings.velocityDays,
)
check(
  '23b coverage is the published formula',
  p1Suggestion.row?.coverageLevel === expectedCoverage,
  `${p1Suggestion.row?.coverageLevel} vs ${expectedCoverage}`,
)
const expectedTarget = Math.max(p1Suggestion.row.maxLevel ?? 0, expectedCoverage)
const expectedSuggested = Math.max(
  Math.min(Math.max(expectedTarget - (p1Facts.onHand + p1Facts.onOrder), 0), expectedTarget),
  p1Suggestion.row.minOrderQuantity,
)
check(
  '23c suggested is target − position, floored by the MOQ',
  p1Suggestion.row?.suggested === expectedSuggested,
  `${p1Suggestion.row?.suggested} vs ${expectedSuggested}`,
)

const neverStocked = p1Suggestion.body
const neverStockedRow = [
  ...(neverStocked.groups ?? []).flatMap((group) => group.rows),
  ...(neverStocked.unassigned?.rows ?? []),
].find((row) => row.productId === p11)
check(
  '23d a never-stocked part appears with on hand 0',
  neverStockedRow?.onHand === 0 && neverStockedRow?.suggested > 0,
  JSON.stringify({ onHand: neverStockedRow?.onHand, suggested: neverStockedRow?.suggested }),
)

const unassignedRow = [...(neverStocked.unassigned?.rows ?? [])].find(
  (row) => row.productId === p12,
)
check(
  '23e a part with no preferred supplier is unassigned',
  unassignedRow !== undefined,
  JSON.stringify(neverStocked.unassigned?.rows?.map((row) => row.productId)),
)

const openOrder = await createOrder(managerA.cookie, { quantity: 5, unitCostMinor: units.P1_COST })
await submit(managerA.cookie, openOrder.body.order.id)
const withOnOrder = await suggestionRow(p1)
check(
  '24 an open order stops the same part being suggested again',
  withOnOrder.row?.onOrder === p1Facts.onOrder + 5,
  `${withOnOrder.row?.onOrder} vs ${p1Facts.onOrder + 5}`,
)

const fromSuggestions = await post(managerA.cookie, '/api/procurement/orders/from-suggestions', {
  branchId: retailId,
  supplierId: supplierOne,
  idempotencyKey: key(),
  lines: [{ productId: p1, quantity: withOnOrder.row?.suggested ?? 1 }],
})
check(
  "24b a suggestion becomes a DRAFT at the supplier's last cost",
  fromSuggestions.status === 201 && fromSuggestions.body?.order?.status === 'DRAFT',
  `${fromSuggestions.status} ${fromSuggestions.body?.order?.status}`,
)
check(
  '24c the suggested order does not submit itself',
  fromSuggestions.body?.approval === null && fromSuggestions.body?.order?.status === 'DRAFT',
  fromSuggestions.body?.order?.status,
)

// -------------------------------------------------------------- product approval

section('25: product submission and approval')

const proposedName = `Walk proposed part ${suffix}`
const submission = await post(managerA.cookie, '/api/products/submissions', {
  name: proposedName,
  categoryId,
  uomId,
  proposedBasePriceMinor: 123_400,
  note: 'Ask the owner',
})
check(
  '25a a manager can submit a product',
  submission.status === 200 || submission.status === 201,
  `${submission.status} ${JSON.stringify(submission.body)}`,
)

const productsBefore = await get(adminCookie, `/api/products?q=${encodeURIComponent(proposedName)}`)
check(
  '25b it is not a product yet',
  (productsBefore.body?.products ?? []).length === 0,
  (productsBefore.body?.products ?? []).length,
)

const productApprovals = await get(
  adminCookie,
  '/api/approvals?type=PRODUCT_CREATE&status=PENDING&limit=200',
)
const productApproval = (productApprovals.body?.approvals ?? []).find(
  (row) => row.payload?.name === proposedName,
)
check(
  '25c it waits as a PRODUCT_CREATE approval',
  productApproval !== undefined,
  JSON.stringify(productApprovals.body?.total),
)

const approvedProduct = await post(adminCookie, `/api/approvals/${productApproval?.id}/decide`, {
  decision: 'APPROVED',
})
check(
  '25d the admin decides it',
  approvedProduct.body?.approval?.status === 'APPROVED',
  approvedProduct.body?.approval?.status,
)
const productsAfter = await get(adminCookie, `/api/products?q=${encodeURIComponent(proposedName)}`)
check(
  '25e approval created exactly one product',
  (productsAfter.body?.products ?? []).length === 1,
  (productsAfter.body?.products ?? []).length,
)
const createdProductId = productsAfter.body?.products?.[0]?.id
const createdProduct = await get(adminCookie, `/api/products/${createdProductId}`)
check(
  "25f the new product's cost is derived, so it starts at zero",
  createdProduct.body?.product?.costPriceMinor === 0,
  createdProduct.body?.product?.costPriceMinor,
)

const rejectedName = `Walk rejected part ${suffix}`
await post(managerA.cookie, '/api/products/submissions', {
  name: rejectedName,
  categoryId,
  uomId,
  proposedBasePriceMinor: 50_000,
})
const rejectedApprovals = await get(
  adminCookie,
  '/api/approvals?type=PRODUCT_CREATE&status=PENDING&limit=200',
)
const rejectedApproval = (rejectedApprovals.body?.approvals ?? []).find(
  (row) => row.payload?.name === rejectedName,
)
await post(adminCookie, `/api/approvals/${rejectedApproval?.id}/decide`, {
  decision: 'REJECTED',
  reasonCode: 'OUT_OF_POLICY',
})
const rejectedProducts = await get(
  adminCookie,
  `/api/products?q=${encodeURIComponent(rejectedName)}`,
)
check(
  '25g a rejected proposal creates nothing',
  (rejectedProducts.body?.products ?? []).length === 0,
  (rejectedProducts.body?.products ?? []).length,
)

// ----------------------------------------------------------------------- IDOR

section('26–27: deny by default')

const foreignOrderRead = await orderDetail(managerForeign.cookie, receivingOrderId)
check(
  '26a a foreign branch cannot read an order',
  foreignOrderRead.status === 403,
  foreignOrderRead.status,
)

const foreignReceive = await post(
  managerForeign.cookie,
  `/api/procurement/orders/${overOrder.body.order.id}/receive`,
  {
    idempotencyKey: key(),
    lines: [{ purchaseOrderLineId: overLineId, quantity: 1, unitCostMinor: units.P1_COST }],
  },
)
check(
  '26b a foreign branch cannot receive against it',
  foreignReceive.status === 403,
  foreignReceive.status,
)

const foreignReturn = await post(managerForeign.cookie, '/api/procurement/returns', {
  branchId: retailId,
  supplierId: supplierOne,
  reason: 'Cross branch',
  idempotencyKey: key(),
  lines: [{ receiptLineId: returnableLine.id, quantity: 1 }],
})
check(
  '26c a foreign branch cannot return its goods',
  foreignReturn.status === 403,
  foreignReturn.status,
)

const foreignDecision = await post(
  managerForeign.cookie,
  `/api/approvals/${pendingRow?.id}/decide`,
  {
    decision: 'APPROVED',
  },
)
check(
  '26d a foreign branch cannot decide its approvals',
  foreignDecision.status === 403,
  foreignDecision.status,
)

const foreignList = await get(managerForeign.cookie, `/api/procurement/orders?branchId=${retailId}`)
check('26e a foreign branch filter is refused', foreignList.status === 403, foreignList.status)

const cashierRoutes = [
  ['GET', '/api/procurement/orders'],
  ['GET', '/api/procurement/returns'],
  ['GET', '/api/replenishment/suggestions'],
  ['GET', '/api/replenishment/suppliers/performance'],
  ['GET', '/api/approvals'],
]
let cashierDenied = 0
for (const [method, route] of cashierRoutes) {
  const response = await call(cashier.cookie, method, route)
  if (response.status === 403) cashierDenied += 1
}
check(
  '27 a cashier is refused every procurement and replenishment route',
  cashierDenied === cashierRoutes.length,
  `${cashierDenied}/${cashierRoutes.length}`,
)

// ----------------------------------------------------------------- validation

section('28: strict bodies')

const strictBodies = [
  [
    'order create',
    await post(managerA.cookie, '/api/procurement/orders', {
      branchId: retailId,
      supplierId: supplierOne,
      idempotencyKey: key(),
      lines: [{ productId: p1, quantity: 1, unitCostMinor: 100 }],
      extra: true,
    }),
  ],
  [
    'receive',
    await post(managerA.cookie, `/api/procurement/orders/${overOrder.body.order.id}/receive`, {
      idempotencyKey: key(),
      lines: [],
      extra: true,
    }),
  ],
  [
    'return create',
    await post(managerA.cookie, '/api/procurement/returns', {
      branchId: retailId,
      supplierId: supplierOne,
      reason: 'x',
      idempotencyKey: key(),
      lines: [],
      extra: true,
    }),
  ],
  [
    'from suggestions',
    await post(managerA.cookie, '/api/procurement/orders/from-suggestions', {
      branchId: retailId,
      supplierId: supplierOne,
      idempotencyKey: key(),
      lines: [],
      extra: true,
    }),
  ],
  [
    'approval decide',
    await post(adminCookie, `/api/approvals/${pendingRow?.id}/decide`, {
      decision: 'APPROVED',
      extra: true,
    }),
  ],
]
for (const [label, response] of strictBodies) {
  check(`28 ${label} rejects an unknown field`, response.status === 400, response.status)
}

// -------------------------------------------------------------------- audit

section('A09: every state change is audited')

const auditRows = await db.query(
  `select action, count(*)::int as total from audit_log
    where branch_id = $1 and entity in ('purchase_order','supplier_return','supplier_credit_note','stock_threshold','approval')
    group by action order by action`,
  [retailId],
)
const actions = new Set(auditRows.rows.map((row) => row.action))
for (const action of [
  'purchase_order.created',
  'purchase_order.auto_approved',
  'purchase_order.submitted',
  'purchase_order.approved',
  'purchase_order.sent',
  'purchase_order.received',
  'purchase_order.cancelled',
  'supplier_return.created',
  'supplier_return.posted',
  'stock_threshold.updated',
]) {
  check(`audit has ${action}`, actions.has(action), [...actions].join(', '))
}
console.log(auditRows.rows.map((row) => `  ${row.action}: ${row.total}`).join('\n'))

await db.end()

// --------------------------------------------------------------------- result

console.log(`\n${passed} passed, ${failures.length} failed`)
if (failures.length > 0) {
  console.log(failures.map((failure) => `  failed: ${failure}`).join('\n'))
  process.exit(1)
}
