import { execFileSync } from 'node:child_process'
import { createHmac } from 'node:crypto'
import { readFileSync } from 'node:fs'

// Phase 5 phase-verification walkthrough: drives the real HTTP API against a
// freshly migrated + seeded database and proves the payables invariants in SQL.
// Fresh-DB-only: the demo seed creates SUP-00001/2, SINV-00001/2 and PAY-00001/2
// and advances the sequences to 3.
//
// Run with the API pointed at the verification database:
//   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5432/gikautos_test \
//     node .planning/phases/05-suppliers-payables/evidence/walkthrough-payables.mjs
//
// Local Postgres (not Docker); SQL runs through psql on 127.0.0.1:5432.

const API = 'http://localhost:4000'
const ORIGIN = 'http://localhost:3000'
const REPO = '/home/litcorp/Projects/Fullstack/gikautos'
const DB = process.env.VERIFY_DB ?? 'gikautos_test'
const PGPASSWORD = process.env.PGPASSWORD ?? 'gikautos'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234'
const WALKTHROUGH_MANAGER_PASSWORD = 'walkthrough-manager-2026'
const WALKTHROUGH_CASHIER_PASSWORD = 'walkthrough-cashier-2026'
const TOTP_FILE = '/tmp/opencode/admin-totp.json'

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
    'psql',
    ['-h', '127.0.0.1', '-p', '5432', '-U', 'gikautos', '-d', DB, '-tAc', query],
    { encoding: 'utf8', env: { ...process.env, PGPASSWORD } },
  ).trim()
}

/** SQL string literal (single-quote escape). */
function q(value) {
  return `'${String(value).replace(/'/g, "''")}'`
}

function makeJar() {
  const jar = new Map()
  return {
    header: () => [...jar.entries()].map(([name, value]) => `${name}=${value}`).join('; '),
    update(response) {
      for (const raw of response.headers.getSetCookie()) {
        const pair = raw.split(';')[0]
        const index = pair.indexOf('=')
        if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
      }
    },
  }
}

async function request(path, { method = 'GET', cookie = '', body } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${path}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { status: response.status, body: parsed }
}

async function signIn(email, password) {
  const jar = makeJar()
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({ email, password }),
  })
  jar.update(response)
  const body = await response.json().catch(() => null)
  return { status: response.status, body, cookie: jar.header() }
}

function base32Decode(secret) {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ234567'
  let bits = ''
  for (const char of secret.replace(/=+$/, '').toUpperCase()) {
    const value = alphabet.indexOf(char)
    if (value === -1) continue
    bits += value.toString(2).padStart(5, '0')
  }
  const bytes = []
  for (let i = 0; i + 8 <= bits.length; i += 8) bytes.push(Number.parseInt(bits.slice(i, i + 8), 2))
  return Buffer.from(bytes)
}

function totpCode(secret) {
  const counter = Math.floor(Date.now() / 1000 / 30)
  const buffer = Buffer.alloc(8)
  buffer.writeUInt32BE(Math.floor(counter / 2 ** 32), 0)
  buffer.writeUInt32BE(counter % 2 ** 32, 4)
  const digest = createHmac('sha1', base32Decode(secret)).update(buffer).digest()
  const offset = digest[digest.length - 1] & 0x0f
  const code =
    (((digest[offset] & 0x7f) << 24) |
      (digest[offset + 1] << 16) |
      (digest[offset + 2] << 8) |
      digest[offset + 3]) %
    1_000_000
  return String(code).padStart(6, '0')
}

async function adminSignIn() {
  const env = readFileSync(`${REPO}/.env`, 'utf8')
  const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
  const secret = JSON.parse(readFileSync(TOTP_FILE, 'utf8')).secret

  const jar = makeJar()
  const first = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: envValue('ADMIN_EMAIL'),
      password: envValue('ADMIN_PASSWORD'),
    }),
  })
  jar.update(first)
  await first.json().catch(() => null)

  const second = await fetch(`${API}/api/auth/two-factor/verify-totp`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json', cookie: jar.header() },
    body: JSON.stringify({ code: totpCode(secret) }),
  })
  jar.update(second)
  return { status: second.status, cookie: jar.header() }
}

function today(offsetDays = 0) {
  const date = new Date()
  date.setUTCDate(date.getUTCDate() + offsetDays)
  return date.toISOString().slice(0, 10)
}

const stamp = Date.now().toString(36)
console.log(`Phase 5 walkthrough — fresh database ${DB}, stamp ${stamp}\n`)

// ---------------------------------------------------------------- sessions
console.log('-- Sessions and permissions --')
const adminSession = await adminSignIn()
check('admin signs in with password + TOTP', adminSession.status === 200, `status ${adminSession.status}`)
const admin = adminSession.cookie

let res = await request('/api/branches', { cookie: admin })
check('admin session is accepted', res.status === 200, `status ${res.status}`)
const branches = res.body?.branches ?? []
const spx = branches.find((branch) => branch.code === 'ACC-SPX')
const wh1 = branches.find((branch) => branch.code === 'ACC-WH1')
check('seeded branches ACC-SPX and ACC-WH1 exist', Boolean(spx && wh1))

const managerSession = await signIn('manager@gikautos.local', DEMO_PASSWORD)
check('demo manager signs in', managerSession.status === 200, `status ${managerSession.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: managerSession.cookie,
  body: { currentPassword: DEMO_PASSWORD, newPassword: WALKTHROUGH_MANAGER_PASSWORD },
})
check('manager clears the forced password change', res.status === 200, `status ${res.status}`)
const manager = managerSession.cookie

const cashierSession = await signIn('cashier@gikautos.local', DEMO_PASSWORD)
check('demo cashier signs in', cashierSession.status === 200, `status ${cashierSession.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: cashierSession.cookie,
  body: { currentPassword: DEMO_PASSWORD, newPassword: WALKTHROUGH_CASHIER_PASSWORD },
})
check('cashier clears the forced password change', res.status === 200, `status ${res.status}`)
const cashier = cashierSession.cookie

res = await request('/api/suppliers', { cookie: cashier })
check('cashier cannot read suppliers', res.status === 403, `status ${res.status}`)
res = await request('/api/payables/invoices', { cookie: cashier })
check('cashier cannot read payables', res.status === 403, `status ${res.status}`)
res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: cashier,
  body: { supplierId: '00000000-0000-0000-0000-000000000000' },
})
check('cashier cannot create invoices', res.status === 403, `status ${res.status}`)

res = await request('/api/suppliers', {
  method: 'POST',
  cookie: manager,
  body: { name: 'Manager attempt' },
})
check('manager cannot create suppliers', res.status === 403, `status ${res.status}`)
res = await request('/api/suppliers/00000000-0000-0000-0000-000000000000/archive', {
  method: 'POST',
  cookie: manager,
  body: {},
})
check('manager cannot archive suppliers', res.status === 403, `status ${res.status}`)
res = await request('/api/settings', {
  method: 'PATCH',
  cookie: manager,
  body: { key: 'supplier.codePrefix', value: 'MGR' },
})
check('manager cannot write global settings', res.status === 403, `status ${res.status}`)

// Seeded payables shape (used by several sections).
res = await request('/api/suppliers?q=Accra%20Parts&pageSize=10', { cookie: manager })
const seededSupplier = res.body?.suppliers?.find((row) => row.code === 'SUP-00001')
check('seed supplier SUP-00001 is visible to the manager', Boolean(seededSupplier))
res = await request('/api/suppliers?q=GikAutos%20Imports&pageSize=10', { cookie: manager })
const importsSupplier = res.body?.suppliers?.find((row) => row.code === 'SUP-00002')
check('seed supplier SUP-00002 is visible', Boolean(importsSupplier))

res = await request('/api/payables/invoices?pageSize=20', { cookie: manager })
const seededInvoices = res.body?.invoices ?? []
const seededReceiptInvoice = seededInvoices.find((row) => row.number === 'SINV-00001')
const seededStandalone = seededInvoices.find((row) => row.number === 'SINV-00002')
check(
  'seed invoices SINV-00001 (partial) and SINV-00002 (open) exist',
  seededReceiptInvoice?.status === 'PARTIAL' && seededStandalone?.status === 'OPEN',
  JSON.stringify({
    first: seededReceiptInvoice?.status,
    second: seededStandalone?.status,
  }),
)
res = await request('/api/payables/payments?pageSize=20', { cookie: manager })
const seededPayments = res.body?.payments ?? []
check(
  'seed payments PAY-00001 and PAY-00002 exist',
  seededPayments.some((row) => row.number === 'PAY-00001') &&
    seededPayments.some((row) => row.number === 'PAY-00002'),
)

// --------------------------------------------- Section 1: archived supplier guard
console.log('\n-- Archived supplier selection --')
res = await request('/api/suppliers', {
  method: 'POST',
  cookie: admin,
  body: { name: `Walkthrough Archived ${stamp}`, paymentTermDays: 0 },
})
const archivedSupplierId = res.body?.supplier?.id
check(
  'admin creates a throwaway supplier as SUP-00003',
  res.status === 201 && res.body?.supplier?.code === 'SUP-00003',
  res.body?.supplier?.code,
)
res = await request(`/api/suppliers/${archivedSupplierId}/archive`, {
  method: 'POST',
  cookie: admin,
  body: {},
})
check('throwaway supplier archives at zero owed', res.status === 200, `status ${res.status}`)

// ------------------------------------------------------- Section 2: supplier master
console.log('\n-- Supplier master --')
res = await request('/api/suppliers', {
  method: 'POST',
  cookie: admin,
  body: {
    name: `Walkthrough Supply ${stamp}`,
    contactName: 'Ama Walkthrough',
    phone: '0241234567',
    email: `walkthrough-${stamp}@example.com`,
    address: '12 Verification Road, Accra',
    tin: 'C0099009900',
    vatNumber: 'V0099009900',
    paymentTermDays: 21,
    notes: 'phase 5 walkthrough',
  },
})
const supplier = res.body?.supplier
check('supplier creation returns SUP-00004 (after the archived probe)', supplier?.code === 'SUP-00004', supplier?.code)
check('local phone normalises to +233', supplier?.phone === '+233241234567', supplier?.phone)

res = await request(`/api/suppliers?q=${encodeURIComponent('Walkthrough Supply')}&pageSize=10`, {
  cookie: admin,
})
check(
  'search by name fragment finds the supplier',
  res.body?.suppliers?.some((row) => row.id === supplier.id),
)
res = await request(`/api/suppliers?q=${supplier.code}&pageSize=10`, { cookie: admin })
check(
  'search by code finds the supplier',
  res.body?.suppliers?.some((row) => row.id === supplier.id),
)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    branchId: wh1.id,
    supplierInvoiceNumber: `WD-${stamp}-XBR`,
    invoiceDate: today(),
    lines: [{ description: 'Cross-branch probe', quantity: 1, unitCostMinor: 100 }],
  },
})
check('manager cannot invoice another branch', res.status === 403, `status ${res.status}`)

res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    branchId: wh1.id,
    method: 'CASH',
    amountMinor: 100,
    paidAt: new Date().toISOString(),
  },
})
check('manager cannot pay from another branch', res.status === 403, `status ${res.status}`)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: archivedSupplierId,
    supplierInvoiceNumber: `WD-${stamp}-ARCH`,
    invoiceDate: today(),
    lines: [{ description: 'Archived supplier probe', quantity: 1, unitCostMinor: 100 }],
  },
})
check('archived supplier cannot take a new invoice (409)', res.status === 409, `status ${res.status}`)

res = await request(`/api/suppliers/${supplier.id}`, {
  method: 'PATCH',
  cookie: admin,
  body: { contactName: 'Ama Updated', paymentTermDays: 30 },
})
check(
  'supplier update persists',
  res.status === 200 &&
    res.body?.supplier?.contactName === 'Ama Updated' &&
    res.body?.supplier?.paymentTermDays === 30,
)

res = await request(`/api/suppliers/${supplier.id}/payment-details`, {
  method: 'POST',
  cookie: admin,
  body: {
    method: 'BANK',
    label: 'Walkthrough bank',
    accountName: 'Walkthrough Supply Ltd',
    accountNumber: '5550001110',
    bankName: 'GCB Bank',
    bankCode: 'GCB',
    isDefault: true,
  },
})
const bankDetail = res.body?.paymentDetail
check('bank detail added and default', res.status === 201 && bankDetail?.isDefault === true)
res = await request(`/api/suppliers/${supplier.id}/payment-details`, {
  method: 'POST',
  cookie: admin,
  body: {
    method: 'MOMO',
    label: 'Walkthrough MoMo',
    momoNetwork: 'MTN',
    phone: '0244555001',
  },
})
const momoDetail = res.body?.paymentDetail
check('MoMo detail added', res.status === 201 && Boolean(momoDetail?.id))
res = await request(`/api/suppliers/${supplier.id}/payment-details/${momoDetail.id}`, {
  method: 'PATCH',
  cookie: admin,
  body: { isDefault: true },
})
check('MoMo default switch succeeds', res.status === 200 && res.body?.paymentDetail?.isDefault === true)
res = await request(`/api/suppliers/${supplier.id}`, { cookie: admin })
const detail = res.body
const bankAfter = detail?.paymentDetails?.find((row) => row.id === bankDetail.id)
const momoAfter = detail?.paymentDetails?.find((row) => row.id === momoDetail.id)
check(
  'exactly one default after the switch',
  bankAfter?.isDefault === false && momoAfter?.isDefault === true,
)
check(
  'detail payload shows the raw number and the mask',
  bankAfter?.accountNumber === '5550001110' && bankAfter?.accountNumberMasked === '•••• 1110',
)
const defaultRows = sql(
  `select count(*) from supplier_payment_detail where supplier_id = ${q(supplier.id)} and is_default and is_active`,
)
check('SQL confirms one active default', defaultRows === '1', `rows ${defaultRows}`)

res = await request(`/api/suppliers/${supplier.id}/payment-details`, {
  method: 'POST',
  cookie: admin,
  body: {
    method: 'BANK',
    accountName: 'Duplicate',
    accountNumber: '5550001110',
    bankName: 'GCB Bank',
  },
})
check('duplicate (method, account) is a 409', res.status === 409, `status ${res.status}`)

res = await request('/api/products?q=GIK-00001&limit=5', { cookie: admin })
const productOne = res.body?.products?.find((row) => row.sku === 'GIK-00001')
res = await request('/api/products?q=GIK-00002&limit=5', { cookie: admin })
const productTwo = res.body?.products?.find((row) => row.sku === 'GIK-00002')
res = await request('/api/products?q=GIK-00003&limit=5', { cookie: admin })
const productThree = res.body?.products?.find((row) => row.sku === 'GIK-00003')
check('demo products are available', Boolean(productOne && productTwo && productThree))

res = await request(`/api/suppliers/${supplier.id}/products`, {
  method: 'POST',
  cookie: admin,
  body: { productId: productTwo.id, supplierSku: `WD-${stamp}-P2`, leadTimeDays: 5 },
})
const mappingTwo = res.body?.mapping
check(
  'product mapping returns the joined view',
  res.status === 201 && mappingTwo?.productSku === 'GIK-00002' && Boolean(mappingTwo?.productName),
)
res = await request(`/api/suppliers/${supplier.id}/products`, {
  method: 'POST',
  cookie: admin,
  body: { productId: productTwo.id },
})
check('duplicate product mapping is a 409', res.status === 409, `status ${res.status}`)

res = await request(`/api/suppliers/${supplier.id}/products`, {
  method: 'POST',
  cookie: admin,
  body: { productId: productOne.id, supplierSku: `WD-${stamp}-P1`, isPreferred: true },
})
check('preferred mapping created', res.status === 201 && res.body?.mapping?.isPreferred === true)
const preferredRows = sql(
  `select count(*) from supplier_product where product_id = ${q(productOne.id)} and is_preferred`,
)
check(
  'preferred switch leaves one preferred supplier per product',
  preferredRows === '1',
  `rows ${preferredRows}`,
)
const seedPreferred = sql(
  `select is_preferred from supplier_product where supplier_id = ${q(seededSupplier.id)} and product_id = ${q(productOne.id)}`,
)
check('the seed supplier lost preferred for that product', seedPreferred === 'f')

sql(`update product set is_active = false where id = ${q(productThree.id)}`)
res = await request(`/api/suppliers/${supplier.id}/products`, {
  method: 'POST',
  cookie: admin,
  body: { productId: productThree.id },
})
check('archived product cannot be mapped (409)', res.status === 409, `status ${res.status}`)
sql(`update product set is_active = true where id = ${q(productThree.id)}`)

// -------------------------------------------------- Section 3: receipt → invoice
console.log('\n-- Receipt → invoice --')
res = await request('/api/inventory/receipts', {
  method: 'POST',
  cookie: manager,
  body: {
    branchId: spx.id,
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-R`,
    note: 'Walkthrough goods receipt',
    lines: [{ productId: productOne.id, quantity: 3, unitCostMinor: 4_500 }],
  },
})
const receipt = res.body?.receipt
check(
  'receipt recorded with the supplier link',
  res.status === 201 && receipt?.supplierId === supplier.id,
  `status ${res.status}`,
)
check('receipt total equals 3 × GHS 45.00', receipt?.totalCostMinor === 13_500)
const receiptSnapshot = sql(
  `select supplier_name from stock_receipt where id = ${q(receipt.id)}`,
)
check(
  'receipt stores the supplier name snapshot',
  receiptSnapshot === `Walkthrough Supply ${stamp}`,
  receiptSnapshot,
)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-RCV`,
    invoiceDate: today(),
    receiptId: receipt.id,
    copyFromReceipt: true,
  },
})
const receiptInvoice = res.body?.invoice
check(
  'receipt invoice copies lines and gets SINV-00003',
  res.status === 201 && receiptInvoice?.invoice?.number === 'SINV-00003',
  receiptInvoice?.invoice?.number,
)
const receiptInvoiceRow = receiptInvoice?.invoice
check(
  'tax split sums exactly to the receipt total',
  receiptInvoiceRow?.subtotalMinor +
    receiptInvoiceRow?.vatMinor +
    receiptInvoiceRow?.nhilMinor +
    receiptInvoiceRow?.getfundMinor ===
    receiptInvoiceRow?.totalMinor &&
    receiptInvoiceRow.totalMinor === receipt.totalCostMinor,
  JSON.stringify({
    subtotal: receiptInvoiceRow?.subtotalMinor,
    vat: receiptInvoiceRow?.vatMinor,
    nhil: receiptInvoiceRow?.nhilMinor,
    getfund: receiptInvoiceRow?.getfundMinor,
    total: receiptInvoiceRow?.totalMinor,
  }),
)
check('invoice payload links the receipt', receiptInvoice?.receipt?.id === receipt.id)
const invoiceReceiptSql = sql(
  `select receipt_id = ${q(receipt.id)} and supplier_id = ${q(supplier.id)} from supplier_invoice where id = ${q(receiptInvoiceRow.id)}`,
)
check('SQL proves the invoice ↔ receipt ↔ supplier links', invoiceReceiptSql === 't')

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-DUP-RCV`,
    invoiceDate: today(),
    receiptId: receipt.id,
    copyFromReceipt: true,
  },
})
check(
  'a receipt carries only one invoice (409 + existing id)',
  res.status === 409 && res.body?.error?.details?.existingInvoiceId === receiptInvoiceRow.id,
  JSON.stringify(res.body?.error?.details),
)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-RCV`,
    invoiceDate: today(),
    lines: [{ description: 'Duplicate number probe', quantity: 1, unitCostMinor: 100 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
check(
  'duplicate supplier invoice number is a 409 with the existing id',
  res.status === 409 && res.body?.error?.details?.existingInvoiceId === receiptInvoiceRow.id,
  JSON.stringify(res.body?.error?.details),
)

const idemBody = {
  supplierId: supplier.id,
  supplierInvoiceNumber: `WD-${stamp}-IDEM`,
  invoiceDate: today(),
  lines: [{ description: 'Idempotent line', quantity: 1, unitCostMinor: 1_000 }],
  vatMinor: 0,
  nhilMinor: 0,
  getfundMinor: 0,
  idempotencyKey: `wd-${stamp}-idem`,
}
res = await request('/api/payables/invoices', { method: 'POST', cookie: manager, body: idemBody })
const idemInvoice = res.body?.invoice?.invoice
check('idempotent invoice recorded', res.status === 201 && Boolean(idemInvoice?.id))
res = await request('/api/payables/invoices', { method: 'POST', cookie: manager, body: idemBody })
check(
  'same key replays the same invoice',
  res.status === 200 && res.body?.replayed === true && res.body?.invoice?.invoice?.id === idemInvoice.id,
)

const raceBody = {
  supplierId: supplier.id,
  supplierInvoiceNumber: `WD-${stamp}-RACE`,
  invoiceDate: today(),
  lines: [{ description: 'Race line', quantity: 1, unitCostMinor: 700 }],
  vatMinor: 0,
  nhilMinor: 0,
  getfundMinor: 0,
  idempotencyKey: `wd-${stamp}-race`,
}
const [raceA, raceB] = await Promise.all([
  request('/api/payables/invoices', { method: 'POST', cookie: manager, body: raceBody }),
  request('/api/payables/invoices', { method: 'POST', cookie: manager, body: raceBody }),
])
const raceIds = new Set([
  raceA.body?.invoice?.invoice?.id,
  raceB.body?.invoice?.invoice?.id,
].filter(Boolean))
check(
  'parallel same-key race yields one invoice',
  [raceA.status, raceB.status].sort().join(',') === '200,201' &&
    raceIds.size === 1,
  `statuses ${raceA.status}/${raceB.status}`,
)
const raceRows = sql(
  `select count(*) from supplier_invoice where idempotency_key = ${q(`wd-${stamp}-race`)}`,
)
check('SQL confirms one row for the raced key', raceRows === '1', `rows ${raceRows}`)

// ---------------------------------------------------- Section 4: standalone invoice
console.log('\n-- Standalone invoice and validation --')
res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-STD`,
    invoiceDate: today(),
    dueDate: today(7),
    lines: [{ description: 'Freight and clearing — walkthrough', quantity: 1, unitCostMinor: 25_000 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
const standalone = res.body?.invoice?.invoice
check(
  'description-only invoice records with no tax',
  res.status === 201 && standalone?.totalMinor === 25_000 && standalone?.vatMinor === 0,
)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-NOLINE`,
    invoiceDate: today(),
  },
})
check('invoice without lines is rejected (400)', res.status === 400, `status ${res.status}`)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-BOTH`,
    invoiceDate: today(),
    lines: [
      { productId: productOne.id, description: 'Both', quantity: 1, unitCostMinor: 100 },
    ],
  },
})
check('a line with product and description is rejected (400)', res.status === 400)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-PASTDUE`,
    invoiceDate: today(),
    dueDate: today(-1),
    lines: [{ description: 'Due in the past', quantity: 1, unitCostMinor: 100 }],
  },
})
check('due date before invoice date is rejected (400)', res.status === 400)

// ------------------------------------------------------------------ Section 5: payments
console.log('\n-- Payments, allocations, and balances --')
async function balanceFor(supplierId, branchId) {
  const response = await request(`/api/payables/balances?branchId=${branchId}`, { cookie: admin })
  return response.body?.balances?.find((row) => row.supplierId === supplierId) ?? null
}

res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'MOMO',
    amountMinor: 5_000,
    paidAt: new Date().toISOString(),
    allocations: [{ invoiceId: receiptInvoiceRow.id, amountMinor: 5_000 }],
  },
})
check('partial payment recorded', res.status === 201, `status ${res.status}`)
res = await request(`/api/payables/invoices/${receiptInvoiceRow.id}`, { cookie: manager })
check(
  'invoice flips to PARTIAL with the right outstanding',
  res.body?.invoice?.status === 'PARTIAL' &&
    res.body?.invoice?.amountPaidMinor === 5_000 &&
    res.body?.invoice?.outstandingMinor === 8_500,
  JSON.stringify({
    status: res.body?.invoice?.status,
    paid: res.body?.invoice?.amountPaidMinor,
    outstanding: res.body?.invoice?.outstandingMinor,
  }),
)
const partialSql = sql(
  `select amount_paid_minor from supplier_invoice where id = ${q(receiptInvoiceRow.id)}`,
)
check('SQL amount_paid matches the allocation', partialSql === '5000', partialSql)

res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'CASH',
    amountMinor: 10_000,
    paidAt: new Date().toISOString(),
    allocations: [{ invoiceId: receiptInvoiceRow.id, amountMinor: 8_600 }],
  },
})
check(
  'over-allocation is a 409 naming the invoice',
  res.status === 409 && res.body?.error?.details?.invoiceId === receiptInvoiceRow.id,
  JSON.stringify(res.body?.error?.details),
)

res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'CASH',
    amountMinor: 1_000,
    paidAt: new Date().toISOString(),
    allocations: [{ invoiceId: seededStandalone.id, amountMinor: 1_000 }],
  },
})
check('cross-supplier allocation is a 409', res.status === 409, `status ${res.status}`)

// A voided invoice cannot receive allocations.
res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-VOIDTARGET`,
    invoiceDate: today(),
    lines: [{ description: 'Void target', quantity: 1, unitCostMinor: 1_200 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
const voidTarget = res.body?.invoice?.invoice
res = await request(`/api/payables/invoices/${voidTarget.id}/void`, {
  method: 'POST',
  cookie: manager,
  body: { reason: 'ERROR' },
})
check('untouched invoice voids', res.status === 200, `status ${res.status}`)
res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'CASH',
    amountMinor: 1_200,
    paidAt: new Date().toISOString(),
    allocations: [{ invoiceId: voidTarget.id, amountMinor: 1_200 }],
  },
})
check('allocation to a VOID invoice is a 409', res.status === 409, `status ${res.status}`)

const beforeOnAccount = await balanceFor(supplier.id, spx.id)
res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'BANK',
    amountMinor: 2_000,
    paidAt: new Date().toISOString(),
    reference: `ONACCT-${stamp}`,
  },
})
check('payment without allocations records', res.status === 201, `status ${res.status}`)
const afterOnAccount = await balanceFor(supplier.id, spx.id)
check(
  'balances report the on-account remainder',
  (afterOnAccount?.onAccountMinor ?? 0) - (beforeOnAccount?.onAccountMinor ?? 0) === 2_000,
  JSON.stringify({
    before: beforeOnAccount?.onAccountMinor,
    after: afterOnAccount?.onAccountMinor,
  }),
)

// Multi-invoice payment, then settle the standalone invoice.
res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'BANK',
    amountMinor: 13_500,
    paidAt: new Date().toISOString(),
    reference: `MULTI-${stamp}`,
    allocations: [
      { invoiceId: receiptInvoiceRow.id, amountMinor: 8_500 },
      { invoiceId: standalone.id, amountMinor: 5_000 },
    ],
  },
})
check('multi-invoice payment records', res.status === 201, `status ${res.status}`)
res = await request(`/api/payables/invoices/${receiptInvoiceRow.id}`, { cookie: manager })
check('first invoice settles to PAID', res.body?.invoice?.status === 'PAID')
res = await request(`/api/payables/invoices/${standalone.id}`, { cookie: manager })
check(
  'second invoice stays PARTIAL',
  res.body?.invoice?.status === 'PARTIAL' && res.body?.invoice?.outstandingMinor === 20_000,
)
res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'BANK',
    amountMinor: 20_000,
    paidAt: new Date().toISOString(),
    allocations: [{ invoiceId: standalone.id, amountMinor: 20_000 }],
  },
})
res = await request(`/api/payables/invoices/${standalone.id}`, { cookie: manager })
check('standalone invoice settles to PAID', res.body?.invoice?.status === 'PAID')

// Parallel payments on one invoice never over-allocate.
res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-RACEPAY`,
    invoiceDate: today(),
    lines: [{ description: 'Parallel payment target', quantity: 1, unitCostMinor: 10_000 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
const racePayInvoice = res.body?.invoice?.invoice
const payBody = (key) => ({
  supplierId: supplier.id,
  method: 'CASH',
  amountMinor: 8_000,
  paidAt: new Date().toISOString(),
  allocations: [{ invoiceId: racePayInvoice.id, amountMinor: 8_000 }],
  idempotencyKey: key,
})
const [payA, payB] = await Promise.all([
  request('/api/payables/payments', { method: 'POST', cookie: manager, body: payBody(`race-pay-${stamp}-a`) }),
  request('/api/payables/payments', { method: 'POST', cookie: manager, body: payBody(`race-pay-${stamp}-b`) }),
])
check(
  'one parallel payment wins, the other is refused',
  [payA.status, payB.status].sort().join(',') === '201,409',
  `statuses ${payA.status}/${payB.status}`,
)
res = await request(`/api/payables/invoices/${racePayInvoice.id}`, { cookie: manager })
check(
  'parallel payments never over-allocate',
  res.body?.invoice?.amountPaidMinor === 8_000 && res.body?.invoice?.status === 'PARTIAL',
)

// ------------------------------------------------------------------ Section 6: voids
console.log('\n-- Voids and releases --')
res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-VOIDPAY`,
    invoiceDate: today(),
    lines: [{ description: 'Void payment target', quantity: 1, unitCostMinor: 9_000 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
const voidPayInvoice = res.body?.invoice?.invoice
res = await request('/api/payables/payments', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    method: 'CASH',
    amountMinor: 4_000,
    paidAt: new Date().toISOString(),
    allocations: [{ invoiceId: voidPayInvoice.id, amountMinor: 4_000 }],
  },
})
const voidablePayment = res.body?.payment?.payment
check('payment to void recorded', res.status === 201 && Boolean(voidablePayment?.id))
const balanceBeforeVoid = await balanceFor(supplier.id, spx.id)
res = await request(`/api/payables/payments/${voidablePayment.id}/void`, {
  method: 'POST',
  cookie: manager,
  body: { reason: 'RETURNED' },
})
check('payment voids', res.status === 200, `status ${res.status}`)
const releaseSql = sql(
  `select amount_minor, reverses_allocation_id is not null from supplier_payment_allocation where payment_id = ${q(voidablePayment.id)} and kind = 'RELEASE'`,
)
check('SQL shows an equal-and-opposite RELEASE row', releaseSql === '-4000|t', releaseSql)
res = await request(`/api/payables/invoices/${voidPayInvoice.id}`, { cookie: manager })
check(
  'invoice flips back to OPEN with zero paid',
  res.body?.invoice?.status === 'OPEN' && res.body?.invoice?.amountPaidMinor === 0,
)
const balanceAfterVoid = await balanceFor(supplier.id, spx.id)
check(
  'balances restore after the payment void',
  (balanceAfterVoid?.owedMinor ?? 0) - (balanceBeforeVoid?.owedMinor ?? 0) === 4_000,
  JSON.stringify({ before: balanceBeforeVoid?.owedMinor, after: balanceAfterVoid?.owedMinor }),
)
res = await request(`/api/payables/payments/${voidablePayment.id}/void`, {
  method: 'POST',
  cookie: manager,
  body: { reason: 'ERROR' },
})
check('re-voiding a payment is a 409', res.status === 409, `status ${res.status}`)

res = await request(`/api/payables/invoices/${receiptInvoiceRow.id}/void`, {
  method: 'POST',
  cookie: manager,
  body: { reason: 'ERROR' },
})
check('voiding an invoice with allocations is a 409', res.status === 409, `status ${res.status}`)

res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-REUSE`,
    invoiceDate: today(),
    lines: [{ description: 'Reusable supplier number', quantity: 1, unitCostMinor: 500 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
const reusable = res.body?.invoice?.invoice
res = await request(`/api/payables/invoices/${reusable.id}/void`, {
  method: 'POST',
  cookie: manager,
  body: { reason: 'DUPLICATE' },
})
check('untouched invoice voids for number reuse', res.status === 200)
res = await request('/api/payables/invoices', {
  method: 'POST',
  cookie: manager,
  body: {
    supplierId: supplier.id,
    supplierInvoiceNumber: `WD-${stamp}-REUSE`,
    invoiceDate: today(),
    lines: [{ description: 'Reused supplier number', quantity: 1, unitCostMinor: 600 }],
    vatMinor: 0,
    nhilMinor: 0,
    getfundMinor: 0,
  },
})
check(
  'voided supplier numbers can be re-entered',
  res.status === 201 && res.body?.invoice?.invoice?.id !== reusable.id,
)

// ----------------------------------------------------- Section 7: aging and SQL truth
console.log('\n-- Aging and reconciliation --')
res = await request('/api/suppliers', {
  method: 'POST',
  cookie: admin,
  body: { name: `Walkthrough Aging ${stamp}`, paymentTermDays: 0 },
})
const agingSupplier = res.body?.supplier
check('aging supplier created', res.status === 201 && Boolean(agingSupplier?.id))

const agingAsOf = '2026-12-31'
const agingPlan = [
  ['current', '2027-01-05', 1_000],
  ['days1To30', '2026-12-21', 2_000],
  ['days31To60', '2026-11-21', 3_000],
  ['days61To90', '2026-10-22', 4_000],
  ['over90', '2026-09-22', 5_000],
]
for (const [bucket, dueDate, amountMinor] of agingPlan) {
  const invoiceDate = new Date(`${dueDate}T00:00:00.000Z`)
  invoiceDate.setUTCDate(invoiceDate.getUTCDate() - 10)
  res = await request('/api/payables/invoices', {
    method: 'POST',
    cookie: admin,
    body: {
      supplierId: agingSupplier.id,
      branchId: spx.id,
      supplierInvoiceNumber: `WD-${stamp}-AGE-${bucket}`,
      invoiceDate: invoiceDate.toISOString().slice(0, 10),
      dueDate,
      lines: [{ description: `Aging ${bucket}`, quantity: 1, unitCostMinor: amountMinor }],
      vatMinor: 0,
      nhilMinor: 0,
      getfundMinor: 0,
    },
  })
  check(`aging invoice ${bucket} recorded`, res.status === 201, `status ${res.status}`)
}

res = await request(
  `/api/payables/aging?asOf=${agingAsOf}&supplierId=${agingSupplier.id}&branchId=${spx.id}`,
  { cookie: admin },
)
const agingRow = res.body?.suppliers?.[0]
check(
  'each fixed bucket holds its invoice',
  agingRow?.buckets?.current === 1_000 &&
    agingRow?.buckets?.days1To30 === 2_000 &&
    agingRow?.buckets?.days31To60 === 3_000 &&
    agingRow?.buckets?.days61To90 === 4_000 &&
    agingRow?.buckets?.over90 === 5_000,
  JSON.stringify(agingRow?.buckets),
)
check('aging total outstanding is 15,000', agingRow?.totalOutstandingMinor === 15_000)

res = await request(`/api/payables/aging?asOf=2026-10-20&supplierId=${importsSupplier.id}`, {
  cookie: admin,
})
const seedAgingBefore = res.body?.suppliers?.[0]
check(
  'past as-of keeps the seed invoice current before its due date',
  seedAgingBefore?.buckets?.current === 35_000 && seedAgingBefore?.onAccountMinor === 20_000,
  JSON.stringify({ buckets: seedAgingBefore?.buckets, onAccount: seedAgingBefore?.onAccountMinor }),
)
res = await request(`/api/payables/aging?asOf=2026-10-25&supplierId=${importsSupplier.id}`, {
  cookie: admin,
})
const seedAgingAfter = res.body?.suppliers?.[0]
check(
  'later as-of moves the seed invoice into 1–30',
  seedAgingAfter?.buckets?.days1To30 === 35_000,
  JSON.stringify(seedAgingAfter?.buckets),
)
res = await request(`/api/payables/aging?asOf=${agingAsOf}&branchId=${spx.id}`, { cookie: admin })
const agingBody = res.body
const bucketSum = (agingBody?.suppliers ?? []).reduce(
  (sum, row) => sum + row.totalOutstandingMinor,
  0,
)
check(
  'aging totals equal the sum of supplier rows',
  bucketSum === agingBody?.totalOutstandingMinor &&
    (agingBody?.suppliers ?? []).every(
      (row) =>
        Object.values(row.buckets).reduce((sum, value) => sum + value, 0) ===
        row.totalOutstandingMinor,
    ),
)

const mismatch = sql(`
  select count(*) from supplier_invoice i
  left join (
    select invoice_id, sum(amount_minor) as net from supplier_payment_allocation group by invoice_id
  ) a on a.invoice_id = i.id
  where i.amount_paid_minor <> coalesce(a.net, 0)
`)
check('SQL: every invoice paid amount equals its signed allocations', mismatch === '0', `rows ${mismatch}`)
const voidWithNet = sql(
  `select count(*) from supplier_invoice where status = 'VOID' and amount_paid_minor <> 0`,
)
check('SQL: void invoices carry zero net allocation', voidWithNet === '0', `rows ${voidWithNet}`)

const claimed = await balanceFor(agingSupplier.id, spx.id)
const outstandingSql = sql(`
  select coalesce(sum(total_minor - amount_paid_minor), 0) from supplier_invoice
  where supplier_id = ${q(agingSupplier.id)} and branch_id = ${q(spx.id)} and status <> 'VOID'
`)
const onAccountSql = sql(`
  select
    (select coalesce(sum(amount_minor), 0) from supplier_payment
      where supplier_id = ${q(agingSupplier.id)} and branch_id = ${q(spx.id)} and status = 'COMPLETED')
    -
    (select coalesce(sum(a.amount_minor), 0)
      from supplier_payment_allocation a
      join supplier_payment p on p.id = a.payment_id
      where p.supplier_id = ${q(agingSupplier.id)} and p.branch_id = ${q(spx.id)} and p.status = 'COMPLETED')
`)
check(
  'SQL independently reproduces the claimed supplier balance',
  claimed?.invoiceOutstandingMinor === Number(outstandingSql) &&
    claimed?.onAccountMinor === Number(onAccountSql) &&
    claimed?.owedMinor === Number(outstandingSql) - Number(onAccountSql),
  JSON.stringify({ api: claimed, outstandingSql, onAccountSql }),
)

const tables = [
  'supplier',
  'supplier_payment_detail',
  'supplier_product',
  'supplier_invoice',
  'supplier_invoice_line',
  'supplier_payment',
  'supplier_payment_allocation',
]
const missingTables = tables.filter(
  (table) => sql(`select to_regclass('public.${table}')`) !== table,
)
check('SQL: every Phase 5 table exists', missingTables.length === 0, missingTables.join(','))
res = await request('/api/settings', { cookie: admin })
const resolvedKeys = new Set((res.body?.settings ?? []).map((row) => row.key))
check(
  'settings API resolves all six Phase 5 keys',
  [
    'supplier.codePrefix',
    'supplier.codeSequence',
    'payable.invoicePrefix',
    'payable.invoiceSequence',
    'payable.paymentPrefix',
    'payable.paymentSequence',
  ].every((key) => resolvedKeys.has(key)),
)
check(
  'SQL: the three Phase 5 sequences advanced past the seeded 3',
  ['payable.invoiceSequence', 'payable.paymentSequence', 'supplier.codeSequence'].every(
    (key) => Number(sql(`select value from setting where key = ${q(key)}`)) > 3,
  ),
)

const auditActions = [
  'supplier.created',
  'supplier.updated',
  'supplier.archived',
  'supplier_payment_detail.created',
  'supplier_payment_detail.updated',
  'supplier_product.created',
  'supplier_invoice.created',
  'supplier_invoice.voided',
  'supplier_payment.created',
  'supplier_payment.voided',
]
const missingAudit = auditActions.filter(
  (action) => sql(`select count(*) from audit_log where action = ${q(action)}`) === '0',
)
check('SQL: every Phase 5 audit action is recorded', missingAudit.length === 0, missingAudit.join(','))

// Restore demo credentials so the console walkthrough can sign in as the manager.
res = await request('/api/me/password', {
  method: 'POST',
  cookie: manager,
  body: { currentPassword: WALKTHROUGH_MANAGER_PASSWORD, newPassword: DEMO_PASSWORD },
})
check('manager password restored to the demo credential', res.status === 200, `status ${res.status}`)
res = await request('/api/me/password', {
  method: 'POST',
  cookie: cashier,
  body: { currentPassword: WALKTHROUGH_CASHIER_PASSWORD, newPassword: DEMO_PASSWORD },
})
check('cashier password restored to the demo credential', res.status === 200, `status ${res.status}`)

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failed > 0) {
  console.error(`${failed} check(s) failed`)
  process.exit(1)
}
