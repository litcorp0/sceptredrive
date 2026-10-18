import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Phase 3 phase-verification walkthrough: drives the real HTTP API against the
// freshly migrated+seeded dev database and asserts the ledger invariant directly
// in SQL. Mirrors the console flows the browser walkthrough exercises.

const API = 'http://localhost:4000'
const ORIGIN = 'http://localhost:3000'
const REPO = '/home/litcorp/Projects/Fullstack/gikautos'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234'

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function sql(query) {
  return execFileSync(
    'docker',
    ['exec', 'gikautos-postgres', 'psql', '-U', 'gikautos', '-d', 'gikautos', '-tAc', query],
    { encoding: 'utf8' },
  ).trim()
}

function cookiesFrom(response) {
  return response.headers
    .getSetCookie()
    .map((cookie) => cookie.split(';')[0])
    .join('; ')
}

async function request(path, { method = 'GET', cookie = '', body } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  })
  const text = await response.text()
  let json = null
  try {
    json = text ? JSON.parse(text) : null
  } catch {
    json = text
  }
  return { status: response.status, body: json }
}

async function login(email, password) {
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { 'content-type': 'application/json', origin: ORIGIN },
    body: JSON.stringify({ email, password }),
  })
  if (response.status !== 200) {
    throw new Error(`login failed for ${email}: ${response.status} ${await response.text()}`)
  }
  return cookiesFrom(response)
}

const env = readFileSync(`${REPO}/.env`, 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
const ADMIN_EMAIL = envValue('ADMIN_EMAIL')
const ADMIN_PASSWORD = envValue('ADMIN_PASSWORD')

console.log('== Phase 3 inventory & transfers walkthrough (HTTP + SQL) ==\n')

const adminCookie = await login(ADMIN_EMAIL, ADMIN_PASSWORD)

// ---------- Setup: resolve demo fixtures ----------
console.log('-- Setup: fresh-database fixtures --')
let res = await request('/api/branches', { cookie: adminCookie })
check('admin lists branches', res.status === 200 && Array.isArray(res.body?.branches))
const branches = res.body?.branches ?? []
const spx = branches.find((row) => row.code === 'ACC-SPX')
const wh1 = branches.find((row) => row.code === 'ACC-WH1')
check(
  'demo branches present (retail + warehouse)',
  spx?.type === 'RETAIL' && wh1?.type === 'WAREHOUSE',
  `spx=${spx?.type} wh1=${wh1?.type}`,
)

res = await request(`/api/inventory/stock?branchId=${wh1.id}&limit=200`, { cookie: adminCookie })
check('admin lists warehouse stock', res.status === 200, `status ${res.status}`)
const whRows = res.body?.stock ?? []
const whBySku = new Map(whRows.map((row) => [row.sku, row]))
check('warehouse has all 12 demo products', whRows.length === 12, `rows=${whRows.length}`)
check(
  'opening stock GRN: GIK-00001 @ ACC-WH1 = 40',
  whBySku.get('GIK-00001')?.quantityOnHand === 40,
  `got ${whBySku.get('GIK-00001')?.quantityOnHand}`,
)
const p1 = whBySku.get('GIK-00001')?.productId
const p2 = whBySku.get('GIK-00002')?.productId
const p3 = whBySku.get('GIK-00003')?.productId
const p4 = whBySku.get('GIK-00004')?.productId

const movementsAtStart = Number(sql('SELECT count(*) FROM stock_movement'))

async function stockDetail(cookie, productId, branchId) {
  const response = await request(`/api/inventory/stock/${productId}?branchId=${branchId}`, {
    cookie,
  })
  return response.body?.stock
}

// ---------- Criterion 2: receipt with supplier invoice ----------
console.log('\n-- Criterion 2: receipt raises stock, records cost + supplier invoice --')
const p1Before = await stockDetail(adminCookie, p1, spx.id)
check(
  'retail baseline GIK-00001 = 6 @ GHS 45.00 cost',
  p1Before?.quantityOnHand === 6 && p1Before?.avgCostMinor === 4_500,
  JSON.stringify({ qty: p1Before?.quantityOnHand, avg: p1Before?.avgCostMinor }),
)

res = await request('/api/inventory/receipts', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    branchId: spx.id,
    supplierName: 'Walkthrough Supplies Ltd',
    supplierInvoiceNumber: 'WS-INV-0001',
    lines: [{ productId: p1, quantity: 4, unitCostMinor: 5_000 }],
  },
})
check('admin posts a receipt', res.status === 201, `status ${res.status}`)
const receipt = res.body?.receipt
check('receipt allocated GRN-00003', receipt?.number === 'GRN-00003', `number ${receipt?.number}`)
check(
  'receipt stores supplier name and invoice number',
  receipt?.supplierName === 'Walkthrough Supplies Ltd' &&
    receipt?.supplierInvoiceNumber === 'WS-INV-0001',
)

const p1AfterReceipt = await stockDetail(adminCookie, p1, spx.id)
check(
  'receipt raises on-hand 6 → 10',
  p1AfterReceipt?.quantityOnHand === 10,
  `got ${p1AfterReceipt?.quantityOnHand}`,
)
check(
  'branch average cost blends to the exact integer (6@4500 + 4@5000 → 4700)',
  p1AfterReceipt?.avgCostMinor === 4_700,
  `got ${p1AfterReceipt?.avgCostMinor}`,
)

res = await request(`/api/inventory/receipts/${receipt.id}`, { cookie: adminCookie })
check(
  'receipt detail keeps lines and totals',
  res.status === 200 &&
    res.body?.receipt?.lines?.length === 1 &&
    res.body?.receipt?.totalCostMinor === 20_000,
)
const payablesTable = sql("SELECT to_regclass('public.payable') IS NULL")
check('no payables table yet (Phase 5 scope, documented)', payablesTable === 't', payablesTable)

// ---------- Criterion 3: adjustments require a reason and are audited ----------
console.log('\n-- Criterion 3: adjustments require a reason and appear in the audit log --')
res = await request('/api/inventory/adjustments', {
  method: 'POST',
  cookie: adminCookie,
  body: { branchId: spx.id, productId: p2, quantityDelta: -2 },
})
check('adjustment without a reason is rejected 400', res.status === 400, `status ${res.status}`)

res = await request('/api/inventory/adjustments', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    branchId: spx.id,
    productId: p2,
    quantityDelta: -2,
    reasonCode: 'DAMAGE',
    note: 'Walkthrough damaged unit',
  },
})
check('adjustment with reason succeeds', res.status === 201, `status ${res.status}`)
check(
  'adjustment response carries movement + level (9 → 7)',
  res.body?.level?.quantityOnHand === 7,
  `level ${res.body?.level?.quantityOnHand}`,
)

const adjustAudit = sql(
  `SELECT actor_staff_id || '|' || branch_id || '|' || (before->>'quantityOnHand') || '|' || (after->>'quantityOnHand') || '|' || (after->>'reasonCode') FROM audit_log WHERE action = 'stock.adjusted' ORDER BY created_at DESC LIMIT 1`,
)
check(
  'audit row has actor, branch, before/after, reason',
  adjustAudit === `GA-0001|${spx.id}|9|7|DAMAGE`,
  adjustAudit,
)

res = await request('/api/inventory/adjustments', {
  method: 'POST',
  cookie: adminCookie,
  body: { branchId: spx.id, productId: p2, quantityDelta: -100, reasonCode: 'LOSS' },
})
check('adjustment below zero is rejected 409', res.status === 409, `status ${res.status}`)

// ---------- Criterion 4: transfers ----------
console.log('\n-- Criterion 4: dispatch, partial receive, short-close, cost carry --')
res = await request('/api/transfers', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    fromBranchId: wh1.id,
    toBranchId: spx.id,
    lines: [{ productId: p1, quantityRequested: 5 }],
  },
})
check('admin drafts a transfer', res.status === 201, `status ${res.status}`)
const transfer = res.body?.transfer
check('transfer allocated TRF-00001', transfer?.number === 'TRF-00001', transfer?.number)

const detail = (await request(`/api/transfers/${transfer.id}`, { cookie: adminCookie })).body
  ?.transfer
check(
  'detail exposes source and destination on-hand context (40 → 10)',
  detail?.lines?.[0]?.fromOnHand === 40 && detail?.lines?.[0]?.toOnHand === 10,
  JSON.stringify(
    detail?.lines?.[0] && {
      from: detail.lines[0].fromOnHand,
      to: detail.lines[0].toOnHand,
    },
  ),
)

res = await request(`/api/transfers/${transfer.id}/dispatch`, {
  method: 'POST',
  cookie: adminCookie,
  body: { lines: [{ productId: p1, quantityDispatched: 50 }] },
})
check(
  'dispatching more than requested is rejected 400',
  res.status === 400 && /more than requested/.test(res.body?.error?.message ?? ''),
  `status ${res.status} ${res.body?.error?.message}`,
)

res = await request(`/api/transfers/${transfer.id}/dispatch`, {
  method: 'POST',
  cookie: adminCookie,
  body: { lines: [{ productId: p1, quantityDispatched: 4 }] },
})
check('dispatch (4 of 5 requested) succeeds', res.status === 200, `status ${res.status}`)
check('transfer status is DISPATCHED', res.body?.transfer?.status === 'DISPATCHED')

const whAfterDispatch = await stockDetail(adminCookie, p1, wh1.id)
check(
  'dispatch deducts the source (40 → 36)',
  whAfterDispatch?.quantityOnHand === 36,
  `got ${whAfterDispatch?.quantityOnHand}`,
)

// A requested quantity above the source on-hand is refused by the ledger guard (409).
res = await request('/api/transfers', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    fromBranchId: wh1.id,
    toBranchId: spx.id,
    lines: [{ productId: p1, quantityRequested: 45 }],
  },
})
const overTransfer = res.body?.transfer
check(
  'draft requesting more than the source holds',
  res.status === 201 && overTransfer?.number === 'TRF-00002',
)
res = await request(`/api/transfers/${overTransfer.id}/dispatch`, {
  method: 'POST',
  cookie: adminCookie,
  body: { lines: [{ productId: p1, quantityDispatched: 45 }] },
})
check(
  'dispatch beyond source on-hand is rejected 409 by the ledger guard',
  res.status === 409 && /Insufficient stock/.test(res.body?.error?.message ?? ''),
  `status ${res.status} ${res.body?.error?.message}`,
)
res = await request(`/api/transfers/${overTransfer.id}/cancel`, {
  method: 'POST',
  cookie: adminCookie,
})
check(
  'the refused over-request transfer can be cancelled',
  res.status === 200,
  `status ${res.status}`,
)

res = await request(`/api/transfers/${transfer.id}/receive`, {
  method: 'POST',
  cookie: adminCookie,
  body: { lines: [{ productId: p1, quantityReceived: 5 }] },
})
check('over-receive beyond dispatched is rejected 409', res.status === 409, `status ${res.status}`)

res = await request(`/api/transfers/${transfer.id}/receive`, {
  method: 'POST',
  cookie: adminCookie,
  body: { lines: [{ productId: p1, quantityReceived: 3 }] },
})
check('partial receive (3 of 4 dispatched) succeeds', res.status === 200, `status ${res.status}`)
check(
  'partial receive leaves the transfer DISPATCHED with 1 pending',
  res.body?.transfer?.status === 'DISPATCHED' && res.body?.transfer?.lines?.[0]?.pending === 1,
  JSON.stringify({
    status: res.body?.transfer?.status,
    pending: res.body?.transfer?.lines?.[0]?.pending,
  }),
)

const p1AfterReceive = await stockDetail(adminCookie, p1, spx.id)
check(
  'destination receives the units (10 → 13)',
  p1AfterReceive?.quantityOnHand === 13,
  `got ${p1AfterReceive?.quantityOnHand}`,
)
check(
  'destination average blends carried cost (10@4700 + 3@4500 → 4654 half-up)',
  p1AfterReceive?.avgCostMinor === 4_654,
  `got ${p1AfterReceive?.avgCostMinor}`,
)

res = await request(`/api/transfers/${transfer.id}/short-close`, {
  method: 'POST',
  cookie: adminCookie,
  body: { note: 'One unit lost in transit — walkthrough' },
})
check('short-close with note succeeds', res.status === 200, `status ${res.status}`)
check(
  'short-close records status, note, and closer',
  res.body?.transfer?.status === 'SHORT_CLOSED' &&
    /lost in transit/.test(res.body?.transfer?.note ?? '') &&
    res.body?.transfer?.closedBy === 'GA-0001',
  JSON.stringify({ status: res.body?.transfer?.status, closedBy: res.body?.transfer?.closedBy }),
)

res = await request(`/api/transfers/${transfer.id}/receive`, {
  method: 'POST',
  cookie: adminCookie,
  body: { lines: [{ productId: p1, quantityReceived: 1 }] },
})
check('receiving after short-close is rejected 409', res.status === 409, `status ${res.status}`)

// ---------- Criterion 5: counts ----------
console.log('\n-- Criterion 5: count snapshot, posting, variance movements, guards --')
const spxBeforeCount = (
  await request(`/api/inventory/stock?branchId=${spx.id}&limit=200`, { cookie: adminCookie })
).body?.stock
const levelByProduct = new Map(spxBeforeCount.map((row) => [row.productId, row.quantityOnHand]))

res = await request('/api/counts', {
  method: 'POST',
  cookie: adminCookie,
  body: { branchId: spx.id, note: 'Walkthrough count' },
})
check('admin opens a stock count', res.status === 201, `status ${res.status}`)
const count = res.body?.count
check('count allocated CNT-00001', count?.number === 'CNT-00001', count?.number)
check(
  'snapshot equals the level book for every line',
  count?.lines?.every((line) => line.snapshotQty === levelByProduct.get(line.productId)),
)

res = await request(`/api/counts/${count.id}/lines`, {
  method: 'PATCH',
  cookie: adminCookie,
  body: {
    lines: [
      { productId: p1, countedQty: 12 },
      { productId: p2, countedQty: 7 },
      { productId: p3, countedQty: 14 },
    ],
  },
})
check('admin records counted quantities', res.status === 200, `status ${res.status}`)

res = await request(`/api/counts/${count.id}/post`, { method: 'POST', cookie: adminCookie })
check('post succeeds', res.status === 200, `status ${res.status}`)
check(
  'post reports 3 counted lines with net variance +1',
  res.body?.count?.countedCount === 3 && res.body?.count?.varianceUnits === 1,
  JSON.stringify({
    counted: res.body?.count?.countedCount,
    variance: res.body?.count?.varianceUnits,
  }),
)

const p1AfterCount = await stockDetail(adminCookie, p1, spx.id)
const p3AfterCount = await stockDetail(adminCookie, p3, spx.id)
check(
  'final level = current-before-post + variance (13 → 12)',
  p1AfterCount?.quantityOnHand === 12,
  `got ${p1AfterCount?.quantityOnHand}`,
)
check(
  'overage line posts upward (12 → 14)',
  p3AfterCount?.quantityOnHand === 14,
  `got ${p3AfterCount?.quantityOnHand}`,
)
const varianceMovements = sql(
  `SELECT count(*) FROM stock_movement WHERE type = 'COUNT_VARIANCE' AND reference_number = '${count.number}'`,
)
check(
  'variance movements are written (2 lines changed)',
  varianceMovements === '2',
  varianceMovements,
)

// Negative guard: snapshot first, drain the shelf, then count above zero.
res = await request('/api/counts', {
  method: 'POST',
  cookie: adminCookie,
  body: { branchId: spx.id, note: 'Walkthrough guard count' },
})
const guardCount = res.body?.count
check('second count opens CNT-00002', guardCount?.number === 'CNT-00002', guardCount?.number)
await request('/api/inventory/adjustments', {
  method: 'POST',
  cookie: adminCookie,
  body: { branchId: spx.id, productId: p3, quantityDelta: -14, reasonCode: 'CORRECTION' },
})
await request(`/api/counts/${guardCount.id}/lines`, {
  method: 'PATCH',
  cookie: adminCookie,
  body: { lines: [{ productId: p3, countedQty: 1 }] },
})
res = await request(`/api/counts/${guardCount.id}/post`, { method: 'POST', cookie: adminCookie })
check(
  'posting a count that would go negative is rejected 409 naming the product',
  res.status === 409 && /Denso Air Filter Corolla/.test(res.body?.error?.message ?? ''),
  `status ${res.status} message ${res.body?.error?.message}`,
)

res = await request(`/api/counts/${guardCount.id}/cancel`, { method: 'POST', cookie: adminCookie })
check('cancelling the open count succeeds', res.status === 200, `status ${res.status}`)

// ---------- Criterion 6: warehouse guard + low stock ----------
console.log('\n-- Criterion 6: warehouse terminals and low-stock lists --')
res = await request('/api/terminals', {
  method: 'POST',
  cookie: adminCookie,
  body: { branchId: wh1.id, name: 'Warehouse Counter' },
})
check(
  'terminal creation on a warehouse is rejected 409',
  res.status === 409 && /Warehouses cannot host POS terminals/.test(res.body?.error?.message ?? ''),
  `status ${res.status} message ${res.body?.error?.message}`,
)

const lowStock = await request(`/api/inventory/low-stock?branchId=${spx.id}&limit=200`, {
  cookie: adminCookie,
})
const lowSkus = (lowStock.body?.stock ?? []).map((row) => row.sku).sort()
check(
  'low stock returns exactly the rows at/below threshold (GIK-00007, GIK-00011)',
  JSON.stringify(lowSkus) === JSON.stringify(['GIK-00007', 'GIK-00011']),
  JSON.stringify(lowSkus),
)

res = await request('/api/inventory/thresholds', {
  method: 'PUT',
  cookie: adminCookie,
  body: { branchId: spx.id, productId: p4, threshold: 15 },
})
check('admin sets a threshold at the current level', res.status === 200, `status ${res.status}`)
let lowWithP4 = (
  await request(`/api/inventory/low-stock?branchId=${spx.id}&limit=200`, { cookie: adminCookie })
).body?.stock
check(
  'threshold equal to on-hand appears in low stock (at/below semantics)',
  lowWithP4.some((row) => row.sku === 'GIK-00004'),
)
res = await request(`/api/inventory/thresholds/${p4}?branchId=${spx.id}`, {
  method: 'DELETE',
  cookie: adminCookie,
})
check('threshold removal succeeds', res.status === 200, `status ${res.status}`)
lowWithP4 = (
  await request(`/api/inventory/low-stock?branchId=${spx.id}&limit=200`, { cookie: adminCookie })
).body?.stock
check(
  'removed threshold leaves low stock correct',
  !lowWithP4.some((row) => row.sku === 'GIK-00004'),
)

// ---------- Archive guard ----------
console.log('\n-- Archive guard --')
res = await request(`/api/products/${p1}/archive`, { method: 'POST', cookie: adminCookie })
check(
  'archiving a product with stock is rejected 409',
  res.status === 409 && /stock/i.test(res.body?.error?.message ?? ''),
  `status ${res.status}`,
)

const categories = (await request('/api/categories', { cookie: adminCookie })).body?.categories
const uoms = (await request('/api/uoms', { cookie: adminCookie })).body?.uoms
res = await request('/api/products', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    name: 'Walkthrough Temp Product',
    categoryId: categories?.[0]?.id,
    uomId: uoms?.[0]?.id,
    basePriceMinor: 1_000,
  },
})
check('admin creates a zero-stock product (auto SKU)', res.status === 201, `status ${res.status}`)
const tempProduct = res.body?.product
res = await request(`/api/products/${tempProduct.id}/archive`, {
  method: 'POST',
  cookie: adminCookie,
})
check('archiving a zero-stock product is allowed', res.status === 200, `status ${res.status}`)

// ---------- Permission matrix spot checks ----------
console.log('\n-- Permission matrix: manager vs other branches --')
// The demo manager is seeded with mustChangePassword, so the API gates it until the
// forced change is complete. Prove that gate, then run the matrix with the new session.
const WALKTHROUGH_MANAGER_PASSWORD = `${DEMO_PASSWORD}-walkthrough`
const managerBefore = await login('manager@gikautos.local', DEMO_PASSWORD)
res = await request(`/api/inventory/stock?branchId=${spx.id}`, { cookie: managerBefore })
check(
  'manager is gated 403 while mustChangePassword is set',
  res.status === 403,
  `status ${res.status}`,
)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: managerBefore,
  body: { currentPassword: DEMO_PASSWORD, newPassword: WALKTHROUGH_MANAGER_PASSWORD },
})
check('manager completes the forced password change', res.status === 200, `status ${res.status}`)
const managerSession = await login('manager@gikautos.local', WALKTHROUGH_MANAGER_PASSWORD)

res = await request(`/api/inventory/stock?branchId=${wh1.id}`, { cookie: managerSession })
check('manager reading another branch stock is 403', res.status === 403, `status ${res.status}`)
res = await request(`/api/inventory/stock?branchId=${spx.id}`, { cookie: managerSession })
check('manager reading own branch stock is 200', res.status === 200, `status ${res.status}`)

res = await request('/api/inventory/receipts', {
  method: 'POST',
  cookie: managerSession,
  body: { branchId: wh1.id, lines: [{ productId: p2, quantity: 1, unitCostMinor: 1_000 }] },
})
check('manager receiving into another branch is 403', res.status === 403, `status ${res.status}`)
res = await request('/api/inventory/adjustments', {
  method: 'POST',
  cookie: managerSession,
  body: { branchId: wh1.id, productId: p2, quantityDelta: 1, reasonCode: 'FOUND' },
})
check('manager adjusting another branch is 403', res.status === 403, `status ${res.status}`)
res = await request('/api/counts', {
  method: 'POST',
  cookie: managerSession,
  body: { branchId: wh1.id },
})
check('manager counting another branch is 403', res.status === 403, `status ${res.status}`)

res = await request('/api/branches', {
  method: 'POST',
  cookie: adminCookie,
  body: { code: 'ACC-TMP', name: 'Walkthrough Temp Branch', type: 'RETAIL', city: 'Accra' },
})
const tempBranch = res.body?.branch
check(
  'admin creates a third branch for wrong-side checks',
  res.status === 201,
  `status ${res.status}`,
)
res = await request('/api/transfers', {
  method: 'POST',
  cookie: adminCookie,
  body: {
    fromBranchId: wh1.id,
    toBranchId: tempBranch.id,
    lines: [{ productId: p2, quantityRequested: 1 }],
  },
})
const outsideTransfer = res.body?.transfer
check(
  'admin drafts a transfer between two other branches',
  res.status === 201,
  `status ${res.status}`,
)
res = await request(`/api/transfers/${outsideTransfer.id}`, { cookie: managerSession })
check(
  'manager reading a transfer on the wrong side is 403',
  res.status === 403,
  `status ${res.status}`,
)
res = await request(`/api/transfers/${outsideTransfer.id}/dispatch`, {
  method: 'POST',
  cookie: managerSession,
  body: { lines: [{ productId: p2, quantityDispatched: 1 }] },
})
check(
  'manager dispatching another branch transfer is 403',
  res.status === 403,
  `status ${res.status}`,
)
res = await request(`/api/transfers/${outsideTransfer.id}/cancel`, {
  method: 'POST',
  cookie: managerSession,
})
check(
  'manager cancelling another branch transfer is 403',
  res.status === 403,
  `status ${res.status}`,
)

res = await request('/api/counts', {
  method: 'POST',
  cookie: managerSession,
  body: { branchId: spx.id, note: 'Manager walkthrough count' },
})
check('manager opens a count on their own branch', res.status === 201, `status ${res.status}`)
const managerCount = res.body?.count
check(
  'manager count allocated CNT-00003',
  managerCount?.number === 'CNT-00003',
  managerCount?.number,
)
res = await request(`/api/counts/${managerCount.id}/cancel`, {
  method: 'POST',
  cookie: managerSession,
})
check('manager cancels their own open count', res.status === 200, `status ${res.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: managerSession,
  body: { currentPassword: WALKTHROUGH_MANAGER_PASSWORD, newPassword: DEMO_PASSWORD },
})
check('manager password restored to the demo value', res.status === 200, `status ${res.status}`)

// ---------- Ledger invariant + append-only ----------
console.log('\n-- Ledger invariant and append-only ledger --')
const levelDiscrepancies = sql(
  `SELECT count(*) FROM stock_level l LEFT JOIN (SELECT branch_id, product_id, SUM(quantity_delta) AS ledger FROM stock_movement GROUP BY 1, 2) m ON m.branch_id = l.branch_id AND m.product_id = l.product_id WHERE l.quantity_on_hand <> COALESCE(m.ledger, 0)`,
)
check(
  'SQL: on-hand equals SUM(quantity_delta) for every product/branch',
  levelDiscrepancies === '0',
  `discrepancies=${levelDiscrepancies}`,
)
const orphanMovements = sql(
  `SELECT count(*) FROM (SELECT DISTINCT branch_id, product_id FROM stock_movement) m LEFT JOIN stock_level l ON l.branch_id = m.branch_id AND l.product_id = m.product_id WHERE l.id IS NULL`,
)
check('SQL: every movement has a projection row', orphanMovements === '0', orphanMovements)

const movementsAtEnd = Number(sql('SELECT count(*) FROM stock_movement'))
check(
  'movements only append (count strictly grew)',
  movementsAtEnd > movementsAtStart,
  `${movementsAtStart} → ${movementsAtEnd}`,
)

const repositorySource = readFileSync(
  `${REPO}/api/src/modules/inventory/inventory.repository.ts`,
  'utf8',
)
check(
  'no update/delete path for stock_movement exists in the data layer',
  !/update\(stockMovement\)|delete\(stockMovement\)/.test(repositorySource),
)

// ---------- Audit coverage ----------
console.log('\n-- Audit coverage --')
const actions = sql(
  `SELECT string_agg(DISTINCT action, ',' ORDER BY action) FROM audit_log WHERE action IN ('stock_receipt.created','stock.adjusted','stock_threshold.updated','stock_threshold.removed','transfer.created','transfer.dispatched','transfer.received','transfer.short_closed','count.created','count.updated','count.posted','count.cancelled','product.created','product.archived')`,
).split(',')
for (const action of [
  'stock_receipt.created',
  'stock.adjusted',
  'stock_threshold.updated',
  'stock_threshold.removed',
  'transfer.created',
  'transfer.dispatched',
  'transfer.received',
  'transfer.short_closed',
  'count.created',
  'count.updated',
  'count.posted',
  'count.cancelled',
  'product.created',
  'product.archived',
]) {
  check(`audit row present: ${action}`, actions.includes(action))
}
const auditActor = sql(
  `SELECT DISTINCT actor_staff_id FROM audit_log WHERE action = 'transfer.dispatched' AND actor_staff_id IS NOT NULL LIMIT 1`,
)
check('transfer audit actor is the staff label GA-0001', auditActor === 'GA-0001', auditActor)

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
