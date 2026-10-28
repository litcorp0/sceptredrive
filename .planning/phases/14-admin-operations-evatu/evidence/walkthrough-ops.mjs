#!/usr/bin/env node
/**
 * Phase 14 Plan 13 — the admin-operations walkthrough.
 *
 *   node .planning/phases/14-admin-operations-evatu/evidence/walkthrough-ops.mjs
 *
 * Runs against the real API on :4000 with `PAYSTACK_MODE=mock` and `EVAT_PROVIDER=mock`.
 * Every fixture (branch, catalogue, stock, staff, customer, terminal, device, shift, sale,
 * refund, supplier invoice, transfer) is created **through the API** with a unique suffix, so a
 * second run neither borrows nor collides with the demo seed.
 *
 * Read-only SQL re-derives the figures the plan requires and takes the checksums that prove the
 * documents were not touched: the split identity (`Σ sale_tender − change = total`), the
 * receipt copy, the stock report's valuation, the drawer's expected cash, and the six-table
 * checksum around a conflict resolution and an E-VAT certification. No fixture is inserted with
 * SQL; the one `delete` outside teardown is the snapshot removal of leg F, which exists to prove
 * a missing Z is a refusal rather than a rebuild.
 *
 * Prints PASS / FAIL / NOT-DRIVEN and exits non-zero on any failure.
 */
import { randomUUID } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { priceCart, tenderBalance } from '@sceptre/shared'
import { Client } from 'pg'

const repoRoot = path.resolve(import.meta.dirname, '../../../..')
const envFile = fs.existsSync(path.join(repoRoot, '.env'))
  ? fs.readFileSync(path.join(repoRoot, '.env'), 'utf8')
  : ''
const envValue = (key) => (envFile.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]

const apiUrl = process.env.API_URL ?? envValue('API_URL') ?? 'http://localhost:4000'
const origin = process.env.ADMIN_URL ?? envValue('ADMIN_URL') ?? 'http://localhost:3000'
const adminEmail = envValue('ADMIN_EMAIL')
const adminPassword = envValue('ADMIN_PASSWORD')
const databaseUrl = envValue('DATABASE_URL')
const LIMIT_MINOR = 200_000

if (!adminEmail || !adminPassword || !databaseUrl) {
  console.error('ADMIN_EMAIL / ADMIN_PASSWORD / DATABASE_URL are required in .env')
  process.exit(1)
}

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const tail = suffix.toUpperCase().slice(-5)
let passed = 0
let notDriven = 0
const failures = []

function check(leg, label, condition, detail) {
  if (condition) {
    passed += 1
    console.log(`PASS ${leg}  ${label}`)
    return true
  }
  failures.push(`${leg} ${label}`)
  console.log(`FAIL ${leg}  ${label}${detail === undefined ? '' : ` — ${JSON.stringify(detail)}`}`)
  return false
}

function skip(leg, label, reason, coveredBy) {
  notDriven += 1
  console.log(`NOT-DRIVEN ${leg}  ${label} — ${reason}; covered by ${coveredBy}`)
}

const section = (title) => console.log(`\n## ${title}`)
const note = (text) => console.log(`     ${text}`)
const key = () => randomUUID()

// ------------------------------------------------------------------ http

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
  const text = await response.text()
  let parsed
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text }
  }
  return { status: response.status, body: parsed, text }
}

const get = (cookie, p) => call(cookie, 'GET', p)
const post = (cookie, p, b) => call(cookie, 'POST', p, b)
const put = (cookie, p, b) => call(cookie, 'PUT', p, b)
const patch = (cookie, p, b) => call(cookie, 'PATCH', p, b)

async function deviceCall(jwt, method, urlPath, body) {
  const response = await fetch(`${apiUrl}${urlPath}`, {
    method,
    headers: {
      authorization: `Bearer ${jwt}`,
      origin,
      ...(body === undefined ? {} : { 'content-type': 'application/json' }),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  const text = await response.text()
  return { status: response.status, body: text ? JSON.parse(text) : null }
}

// ------------------------------------------------------------ database (read-only)

const db = new Client({ connectionString: databaseUrl })
await db.connect()

async function one(text, params = []) {
  return (await db.query(text, params)).rows[0] ?? null
}

/** A deterministic checksum of one sale's money facts and every ledger row that names it. */
async function saleChecksum(saleId) {
  const row = await one(
    `select md5(concat_ws('|',
       (select string_agg(t::text, '~' order by t.id) from sale t where t.id = $1),
       (select string_agg(t::text, '~' order by t.id) from sale_line t where t.sale_id = $1),
       (select string_agg(t::text, '~' order by t.id) from sale_tender t where t.sale_id = $1),
       (select string_agg(t::text, '~' order by t.id) from stock_movement t where t.reference_id = $1),
       (select string_agg(t::text, '~' order by t.id) from credit_ledger_entry t where t.reference_id = $1),
       (select string_agg(t::text, '~' order by t.id) from loyalty_ledger_entry t where t.reference_id = $1)
     )) as checksum`,
    [saleId],
  )
  return row?.checksum
}

// ----------------------------------------------------------------- fixtures

section('fixtures (created through the API)')

const adminCookie = await signIn(adminEmail, adminPassword)
note(`admin session minted for ${adminEmail}`)

const branch = (
  await post(adminCookie, '/api/branches', {
    code: `P14-${tail.slice(0, 4)}`,
    name: `Walk ops ${suffix}`,
    type: 'RETAIL',
    city: 'Accra',
  })
).body?.branch
if (!branch?.id) {
  console.error('could not create the branch')
  process.exit(1)
}
const branchId = branch.id

const categoryId = (await post(adminCookie, '/api/categories', { name: `Walk ops ${suffix}` })).body
  ?.category?.id
const uomId = (await post(adminCookie, '/api/uoms', { code: `Q${tail}`, name: 'Piece' })).body?.uom
  ?.id
const supplier = (
  await post(adminCookie, '/api/suppliers', {
    name: `Walk ops supplier ${suffix}`,
    paymentTermDays: 30,
  })
).body?.supplier
if (!categoryId || !uomId || !supplier?.id) {
  console.error('could not create the catalogue foundations')
  process.exit(1)
}

await patch(adminCookie, '/api/settings', { key: 'tax.sellerTin', value: 'C0012345678' })
await patch(adminCookie, '/api/settings', { key: 'tax.sellerVatNumber', value: 'C0012345678' })

const UNIT_MINOR = 10_000
const productMain = (
  await post(adminCookie, '/api/products', {
    sku: `P14A${tail}`,
    name: `Walk ops A ${suffix}`,
    categoryId,
    uomId,
    basePriceMinor: UNIT_MINOR,
  })
).body?.product?.id
if (!productMain) {
  console.error('could not create the product')
  process.exit(1)
}

const receipt = await post(adminCookie, '/api/inventory/receipts', {
  branchId,
  supplierId: supplier.id,
  lines: [{ productId: productMain, quantity: 40, unitCostMinor: 5_000 }],
})
if (receipt.status !== 201) {
  console.error('could not receive stock', receipt.status, receipt.body)
  process.exit(1)
}

async function createStaff({ name, role, password }) {
  const email = `walk14-${name.replace(/[^a-z0-9]+/g, '-')}-${suffix}@sceptre.test`
  const created = await post(adminCookie, '/api/staff', { email, name, role, branchId })
  if (created.status !== 201) throw new Error(`staff create failed: ${created.text}`)
  let session = await signIn(email, created.body.temporaryPassword)
  await post(session, '/api/me/password', {
    currentPassword: created.body.temporaryPassword,
    newPassword: password,
  })
  session = await signIn(email, password)
  return {
    email,
    cookie: session,
    userId: created.body.staff.id,
    staffId: created.body.staff.staffId,
  }
}

const cashier = await createStaff({
  name: `ops cashier ${suffix}`,
  role: 'CASHIER',
  password: `walk14-cashier-${suffix}`,
})
const manager = await createStaff({
  name: `ops manager ${suffix}`,
  role: 'MANAGER',
  password: `walk14-manager-${suffix}`,
})
const cashierPin = `${(Number.parseInt(tail.slice(-3), 36) % 89) + 10}${(Number.parseInt(tail.slice(0, 2), 36) % 89) + 10}`
const managerPin = `${(Number.parseInt(tail.slice(-2), 36) % 89) + 10}${(Number.parseInt(tail.slice(1, 3), 36) % 89) + 10}`
await post(adminCookie, `/api/staff/${cashier.userId}/pin`, { pin: cashierPin })
await post(adminCookie, `/api/staff/${manager.userId}/pin`, { pin: managerPin })

const customerPhone = `02${String(Date.now()).slice(-8)}`
const customer = (
  await post(adminCookie, '/api/customers', {
    name: `Walk ops credit ${suffix}`,
    phone: customerPhone,
    branchId,
  })
).body?.customer
await put(adminCookie, `/api/credit/profiles/${customer.id}`, { branchId, limitMinor: LIMIT_MINOR })

const terminal = (
  await post(adminCookie, '/api/terminals', { branchId, name: `Walk ops till ${suffix}` })
).body?.terminal
const enrollment = (await post(adminCookie, `/api/terminals/${terminal.id}/enrollment`)).body
  ?.enrollment
const redeemed = await post(adminCookie, '/api/enrollments/redeem', {
  code: enrollment.code,
  fingerprint: `walk14-${suffix}`,
})
const sessionResponse = await fetch(`${apiUrl}/api/pos/session`, {
  method: 'POST',
  headers: { authorization: `Bearer ${redeemed.body?.deviceToken}`, origin },
})
const device = await sessionResponse.json()
const deviceJwt = device.accessToken
if (!deviceJwt) {
  console.error('could not mint a device session', sessionResponse.status, device)
  process.exit(1)
}

const cashierBinding = await deviceCall(deviceJwt, 'POST', '/api/pos/staff/authorize', {
  email: cashier.email,
  pin: cashierPin,
})
const managerBinding = await deviceCall(deviceJwt, 'POST', '/api/pos/staff/authorize', {
  email: manager.email,
  pin: managerPin,
})
const cashierProof = {
  userId: cashier.userId,
  staffId: cashier.staffId,
  bindingId: cashierBinding.body.bindingId,
  bindingToken: cashierBinding.body.bindingToken,
  pinVersion: cashierBinding.body.pinVersion,
}
const managerApproval = (reasonCode) => ({
  staffId: manager.staffId,
  userId: manager.userId,
  bindingId: managerBinding.body.bindingId,
  pinVersion: managerBinding.body.pinVersion,
  reasonCode,
  note: 'Walkthrough approval',
  occurredAt: new Date().toISOString(),
})

const shiftId = key()
async function upload(transactions) {
  const response = await deviceCall(deviceJwt, 'POST', '/api/pos/sync/upload', {
    batchId: key(),
    deviceId: device.deviceId,
    terminalId: terminal.id,
    transactions: transactions.map((t) => ({
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      ...t,
    })),
  })
  if (response.status !== 200) throw new Error(`upload failed: ${JSON.stringify(response.body)}`)
  return response.body
}
const uploadOne = async (t) => (await upload([t])).results[0]

await uploadOne({
  clientTransactionId: key(),
  type: 'SHIFT_OPEN',
  payload: {
    shiftId,
    number: `W14-${tail}`,
    openingFloatMinor: 50_000,
    cashierUserId: cashier.userId,
    cashierStaffId: cashier.staffId,
    occurredAt: new Date().toISOString(),
  },
})

function salePayload({ receiptNumber, quantity, tenders }) {
  const priced = priceCart(
    [
      {
        productId: productMain,
        name: 'Walk ops A',
        sku: `P14A${tail}`,
        quantity,
        unitPriceMinor: UNIT_MINOR,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      },
    ],
    { taxMode: 'INCLUSIVE', saleDiscountMinor: 0, loyaltyDiscountMinor: 0 },
  )
  const balance = tenderBalance(
    priced.totalMinor,
    tenders.map((t, i) => ({ method: t.method, amountMinor: t.amountMinor, sequence: i + 1 })),
  )
  if (balance.problem) throw new Error(`impossible tender set: ${balance.problem}`)
  return {
    receiptNumber,
    shiftId,
    cashier: cashierProof,
    customer: null,
    lines: [
      {
        productId: productMain,
        quantity,
        unitPriceMinor: UNIT_MINOR,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      },
    ],
    saleDiscount: null,
    loyalty: null,
    tenders: tenders.map((t) => ({
      method: t.method,
      amountMinor: t.amountMinor,
      paymentId: t.paymentId ?? null,
      override: null,
    })),
    totals: {
      subtotalMinor: priced.subtotalMinor,
      lineDiscountMinor: priced.lineDiscountMinor,
      saleDiscountMinor: priced.saleDiscountMinor,
      loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
      vatMinor: priced.vatMinor,
      nhilMinor: priced.nhilMinor,
      getfundMinor: priced.getfundMinor,
      taxTotalMinor: priced.taxTotalMinor,
      totalMinor: priced.totalMinor,
      changeMinor: balance.changeMinor,
    },
    occurredAt: new Date().toISOString(),
    appVersion: 'walkthrough',
  }
}

const momo = (
  await deviceCall(deviceJwt, 'POST', '/api/pos/payments', {
    clientPaymentId: key(),
    shiftId,
    method: 'MOMO',
    amountMinor: 60_000,
    mobileMoney: { provider: 'mtn', phone: '0551234987' },
  })
).body?.payment
if (!momo?.id) {
  console.error('could not create the MoMo intent')
  process.exit(1)
}
await post(adminCookie, '/api/payments/mock/settle', {
  reference: momo.providerReference,
  outcome: 'PAID',
})
const momoSettled = await deviceCall(deviceJwt, 'GET', `/api/pos/payments/${momo.id}?refresh=1`)
if (momoSettled.body?.payment?.status !== 'PAID') {
  console.error('the MoMo intent did not settle', momoSettled.status, momoSettled.body)
  process.exit(1)
}

// ------------------------------------------------------- leg 1: the sale

section('leg 1 — a split sale, and the identity the receipt copy must reproduce')

const saleId = key()
const saleReceipt = `W14-${tail}-001`
const saleResult = await uploadOne({
  clientTransactionId: saleId,
  type: 'SALE',
  payload: salePayload({
    receiptNumber: saleReceipt,
    quantity: 10,
    tenders: [
      { method: 'CASH', amountMinor: 40_000 },
      { method: 'MOMO', amountMinor: 60_000, paymentId: momo.id },
    ],
  }),
})
const saleRow = await one(
  `select total_minor::int as total, change_minor::int as change,
          (select coalesce(sum(amount_minor),0)::int from sale_tender where sale_id = $1) as tendered
     from sale where id = $1`,
  [saleId],
)
check('1.1', 'a cash 40.00 + MoMo 60.00 sale applies', saleResult.status === 'APPLIED', saleResult)
check(
  '1.2',
  'SQL: Σ tenders − change = total',
  saleRow && saleRow.tendered - saleRow.change === saleRow.total && saleRow.total === 100_000,
  saleRow,
)

// ------------------------------------------------- leg 2: the cash refund

section('leg 2 — a 10.00 cash refund with a manager’s approval')

const saleLine = await one(
  'select id, quantity::int as quantity from sale_line where sale_id = $1 order by line_number limit 1',
  [saleId],
)
const cashTender = await one("select id from sale_tender where sale_id = $1 and method = 'CASH'", [
  saleId,
])
const checksumBeforeRefund = await saleChecksum(saleId)
const refundId = key()
const refundResult = await uploadOne({
  clientTransactionId: refundId,
  type: 'REFUND',
  payload: {
    saleId,
    number: `W14-${tail}-RF1`,
    shiftId,
    cashier: cashierProof,
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    note: 'Walkthrough return',
    approval: managerApproval('CUSTOMER_CHANGED_MIND'),
    lines: [{ saleLineId: saleLine.id, quantity: 1, restock: 'RESALABLE', damageReason: null }],
    tenders: [{ saleTenderId: cashTender.id, amountMinor: 10_000 }],
    refundedMinor: 10_000,
    occurredAt: new Date().toISOString(),
  },
})
check(
  '2.1',
  'the refund applies and returns its server id',
  refundResult.status === 'APPLIED' && refundResult.serverId === refundId,
  refundResult,
)
check(
  '2.2',
  'SQL: the sale is byte-identical after the refund',
  (await saleChecksum(saleId)) === checksumBeforeRefund,
)

// --------------------------------------------- leg 3: oversight and the copy

section('leg 3 — oversight reads and the receipt copy')

const salesList = await get(
  adminCookie,
  `/api/pos/oversight/sales?branchId=${branchId}&receiptNumber=${saleReceipt}`,
)
const salesRow = salesList.body?.sales?.[0]
check(
  '3.1',
  'the sales list carries the sale id and its refunded total',
  salesRow?.id === saleId && salesRow?.refundedMinor === 10_000,
  salesList.body,
)
const saleDetail = await get(adminCookie, `/api/pos/oversight/sales/${saleId}`)
check(
  '3.2',
  'the detail carries two tenders in order and the refund that points at the sale',
  saleDetail.body?.tenders?.length === 2 &&
    saleDetail.body?.tenders?.[0]?.sequence === 1 &&
    saleDetail.body?.refunds?.[0]?.id === refundId,
  { tenders: saleDetail.body?.tenders, refunds: saleDetail.body?.refunds },
)
const copy = await get(adminCookie, `/api/pos/oversight/sales/${saleId}/receipt`)
const lineSum = (copy.body?.lines ?? []).reduce((sum, line) => sum + line.totalMinor, 0)
const tenderSum = (copy.body?.tenders ?? []).reduce((sum, t) => sum + t.amountMinor, 0)
check(
  '3.3',
  'the receipt copy’s lines and tenders reproduce the sale exactly',
  lineSum === 100_000 &&
    tenderSum - copy.body.changeMinor === 100_000 &&
    copy.body.totals.totalMinor === 100_000,
  { lineSum, tenderSum, totals: copy.body.totals },
)
check(
  '3.4',
  'the copy is labelled a copy, not a reprint',
  copy.body?.header?.isCopy === true && copy.body?.header?.reprint === false,
)
check(
  '3.5',
  'the full customer phone is absent from the payload (masked or omitted)',
  !copy.text.includes(customerPhone),
)

const refundsList = await get(adminCookie, `/api/pos/oversight/refunds?branchId=${branchId}`)
const refundRow = (refundsList.body?.refunds ?? []).find((row) => row.id === refundId)
check(
  '3.6',
  'a 10.00 refund below the 200.00 approval threshold is listed, with no approval',
  Boolean(refundRow) && refundRow.approvalId === null,
  refundRow,
)

// ------------------------------------------------ leg 4: conflict resolution

section('leg 4 — a conflict is resolved without touching the sale')

const oversell = await uploadOne({
  clientTransactionId: key(),
  type: 'SALE',
  payload: salePayload({
    receiptNumber: `W14-${tail}-002`,
    quantity: 35,
    tenders: [{ method: 'CASH', amountMinor: 350_000 }],
  }),
})
const oversellId = oversell.serverId
const oversellConflict = await one(
  "select id, status::text as status from sync_conflict where sale_id = $1 and type = 'STOCK_OVERSELL'",
  [oversellId],
)
check(
  '4.1',
  'selling past on-hand applies the sale and records a HIGH conflict',
  oversell.status === 'APPLIED' && Boolean(oversellConflict),
  { oversell: oversell.status, conflict: oversellConflict },
)
const oversellChecksum = await saleChecksum(oversellId)
const resolved = await patch(
  manager.cookie,
  `/api/pos/oversight/conflicts/${oversellConflict.id}`,
  {
    status: 'RESOLVED',
    code: 'CONFIRMED',
    note: 'Stock count booked for tomorrow',
  },
)
check(
  '4.2',
  'a manager resolves it with a code and a note',
  resolved.status === 200 &&
    resolved.body?.status === 'RESOLVED' &&
    resolved.body?.resolutionCode === 'CONFIRMED',
  resolved.body,
)
check(
  '4.3',
  'SQL: the sale and its six tables are byte-identical after resolution',
  (await saleChecksum(oversellId)) === oversellChecksum,
)
const secondResolve = await patch(
  manager.cookie,
  `/api/pos/oversight/conflicts/${oversellConflict.id}`,
  { status: 'DISMISSED', code: 'DUPLICATE', note: 'Second opinion' },
)
check('4.4', 'a second resolution is a 409', secondResolve.status === 409, secondResolve.status)
const deviceConflicts = await deviceCall(deviceJwt, 'GET', '/api/pos/sync/conflicts')
const deviceRow = (deviceConflicts.body?.conflicts ?? []).find(
  (row) => row.id === oversellConflict.id,
)
check(
  '4.5',
  'the till reads the same row as RESOLVED (its badge clears without a till change)',
  deviceRow?.status === 'RESOLVED',
  deviceRow,
)
const dismissNoNote = await patch(
  manager.cookie,
  `/api/pos/oversight/conflicts/${oversellConflict.id}`,
  { status: 'DISMISSED', code: 'DUPLICATE' },
)
check(
  '4.6',
  'a dismissal without a note is refused (and the row is already resolved, so 409 or 400)',
  dismissNoNote.status === 409 || dismissNoNote.status === 400,
  dismissNoNote.status,
)

// --------------------------------------------------------- leg 5: the Z

section('leg 5 — the Z stores the figure its drawer arithmetic subtracts')

const drawer = await one(
  `select coalesce(sum(st.amount_minor),0)::int as cash_tenders,
          (select coalesce(sum(change_minor),0)::int from sale where shift_id = $1) as change,
          (select coalesce(sum(rt.amount_minor),0)::int from refund_tender rt join refund r on r.id = rt.refund_id
            where r.shift_id = $1 and rt.method = 'CASH' and rt.status = 'SETTLED') as cash_refunds
     from sale_tender st join sale s on s.id = st.sale_id
     where s.shift_id = $1 and st.method = 'CASH'`,
  [shiftId],
)
const expected = 50_000 + drawer.cash_tenders - drawer.change - drawer.cash_refunds
const closeResult = await uploadOne({
  clientTransactionId: key(),
  type: 'SHIFT_CLOSE',
  payload: {
    shiftId,
    countedCashMinor: expected,
    clientExpectedCashMinor: expected,
    closeNote: 'Walkthrough close',
    closedBy: cashierProof,
    occurredAt: new Date().toISOString(),
  },
})
const shiftRow = await one(
  `select status::text as status, counted_cash_minor::int as counted, server_expected_cash_minor::int as expected,
          variance_minor::int as variance from shift where id = $1`,
  [shiftId],
)
check(
  '5.1',
  'the shift closes with zero variance on the refund-reduced expectation',
  closeResult.status === 'APPLIED' && shiftRow?.variance === 0 && shiftRow?.expected === expected,
  shiftRow,
)
const snapshot = await one(
  'select refund_minor::int as refunds, cash_refund_minor::int as cash_refunds from shift_report where shift_id = $1',
  [shiftId],
)
check(
  '5.2',
  'the snapshot stores the cash refund it subtracts',
  snapshot?.cash_refunds === 10_000,
  snapshot,
)
const z = await deviceCall(deviceJwt, 'GET', `/api/pos/shifts/${shiftId}/report?kind=Z`)
check(
  '5.3',
  'the device Z returns the stored figures',
  z.status === 200 && z.body?.report?.expectedCashMinor === expected,
  z.body?.report,
)
const zSession = await get(adminCookie, `/api/pos/oversight/shifts/${shiftId}?kind=Z`)
check(
  '5.4',
  'a manager reads the same Z over a session',
  zSession.status === 200 && zSession.body?.report?.expectedCashMinor === expected,
)
await db.query('delete from shift_report where shift_id = $1', [shiftId])
const zMissing = await get(adminCookie, `/api/pos/oversight/shifts/${shiftId}/report?kind=Z`)
check(
  '5.5',
  'a missing snapshot is refused, never rebuilt',
  zMissing.status >= 500 && zMissing.body?.error?.code === 'SHIFT_REPORT_MISSING',
  zMissing.body?.error,
)

// ------------------------------------------------------- leg 6: the reports

section('leg 6 — the stock report and two exports reconcile')

const stockReport = await get(adminCookie, `/api/inventory/stock/report?branchId=${branchId}`)
const stockSql = await one(
  'select coalesce(sum(quantity_on_hand * avg_cost_minor),0)::int as value, coalesce(sum(quantity_on_hand),0)::int as units from stock_level where branch_id = $1',
  [branchId],
)
check(
  '6.1',
  'the stock report total equals the projection',
  stockReport.body?.totals?.valueMinor === stockSql.value &&
    stockReport.body?.totals?.quantityOnHand === stockSql.units,
  { report: stockReport.body?.totals, sql: stockSql },
)
const managerStock = await get(manager.cookie, '/api/inventory/stock/report')
check(
  '6.2',
  'a manager’s report is their branch, not all branches',
  managerStock.body?.totals?.valueMinor === stockSql.value,
  managerStock.body?.totals,
)

const aging = await get(manager.cookie, '/api/credit/aging')
const agingCsv = await fetch(`${apiUrl}/api/credit/aging/export`, {
  headers: { cookie: manager.cookie, origin },
})
const agingCsvText = await agingCsv.text()
const agingTotal = aging.body?.branches?.[0]?.totals?.total ?? 0
check(
  '6.3',
  'the credit CSV’s TOTAL equals the report’s own total, and has a row',
  agingCsv.status === 200 &&
    agingCsv.headers.get('content-type')?.includes('text/csv') &&
    agingCsvText.includes('TOTAL') &&
    agingCsvText.trim().split(/\r?\n/).length >= 2 &&
    agingCsvText.includes(String(agingTotal)),
  { status: agingCsv.status, lines: agingCsvText.trim().split(/\r?\n/).length },
)

const auditCsv = await fetch(`${apiUrl}/api/audit/export`, {
  headers: { cookie: adminCookie, origin },
})
const auditCsvText = await auditCsv.text()
check(
  '6.4',
  'the audit CSV carries no payload, no customer phone and no email',
  auditCsv.status === 200 &&
    !auditCsvText.includes('before') &&
    !auditCsvText.includes(customerPhone) &&
    !auditCsvText.includes('@sceptre.test'),
  { status: auditCsv.status, length: auditCsvText.length },
)

// ------------------------------------------------------ leg 7: transfers

section('leg 7 — a supplier transfer is money only when it settles')

const detail = await post(adminCookie, `/api/suppliers/${supplier.id}/payment-details`, {
  method: 'BANK',
  label: 'Walk ops bank',
  accountName: 'Walk Ops Supplier',
  accountNumber: '1234567890',
  bankName: 'Test Bank',
  bankCode: '058',
  isDefault: true,
})
const detailId = (detail.body?.paymentDetail ?? detail.body?.detail)?.id
check(
  '7.1',
  'a BANK payment detail is created for the supplier',
  detail.status === 201 && Boolean(detailId),
  detail.body,
)

const invoice = await post(adminCookie, '/api/payables/invoices', {
  supplierId: supplier.id,
  branchId,
  supplierInvoiceNumber: `W14-SINV-${tail}`,
  invoiceDate: new Date().toISOString().slice(0, 10),
  dueDate: new Date(Date.now() + 30 * 86_400_000).toISOString().slice(0, 10),
  lines: [{ productId: productMain, quantity: 40, unitCostMinor: 5_000 }],
})
const invoiceId = invoice.body?.invoice?.invoice?.id
check(
  '7.2',
  'a supplier invoice exists to allocate against',
  invoice.status === 201 && Boolean(invoiceId),
  invoice.body,
)

const transfer = await post(adminCookie, '/api/payables/transfers', {
  supplierId: supplier.id,
  branchId,
  paymentDetailId: detailId,
  amountMinor: 50_000,
  allocations: [{ invoiceId, amountMinor: 50_000 }],
  note: 'Walkthrough transfer',
  idempotencyKey: key(),
})
const transferId = transfer.body?.transfer?.transfer?.id
check(
  '7.3',
  'the transfer is created as an intent, not a payment',
  transfer.status === 201 &&
    transfer.body?.transfer?.transfer?.status === 'PENDING' &&
    Boolean(transferId),
  transfer.body,
)
check(
  '7.4',
  'no supplier payment exists yet',
  (
    await one('select count(*)::int as n from supplier_payment where idempotency_key = $1', [
      `transfer:${transferId}`,
    ])
  )?.n === 0,
)

const settled = await post(adminCookie, '/api/payments/mock/settle-transfer', {
  reference: transfer.body.transfer.transfer.reference,
  outcome: 'SUCCESS',
})
const settledPayment = await one(
  'select id, amount_minor::int as amount, status::text as status from supplier_payment where idempotency_key = $1',
  [`transfer:${transferId}`],
)
check(
  '7.5',
  'settlement posts exactly one payment for the transfer amount',
  settled.status === 200 &&
    settledPayment?.amount === 50_000 &&
    settledPayment?.status === 'COMPLETED',
  { settled: settled.status, payment: settledPayment },
)
const replay = await post(adminCookie, '/api/payments/mock/settle-transfer', {
  reference: transfer.body.transfer.transfer.reference,
  outcome: 'SUCCESS',
})
check(
  '7.6',
  'a replayed settlement changes nothing (same payment)',
  replay.status === 200 && replay.body?.paymentId === settledPayment.id,
)

const failed = await post(adminCookie, '/api/payables/transfers', {
  supplierId: supplier.id,
  branchId,
  paymentDetailId: detailId,
  amountMinor: 30_000,
  allocations: [],
  note: 'Walkthrough failed transfer',
  idempotencyKey: key(),
})
await post(adminCookie, '/api/payments/mock/settle-transfer', {
  reference: failed.body.transfer.transfer.reference,
  outcome: 'FAILED',
})
check(
  '7.7',
  'a failed transfer posts no payment and leaves the supplier balance alone',
  (
    await one('select count(*)::int as n from supplier_payment where idempotency_key = $1', [
      `transfer:${failed.body.transfer.transfer.id}`,
    ])
  )?.n === 0,
)

const reconciliation = await get(
  adminCookie,
  `/api/payables/transfers/reconciliation?branchId=${branchId}`,
)
const states = new Set((reconciliation.body?.rows ?? []).map((row) => row.state ?? row.kind))
check(
  '7.8',
  'the reconciliation shows a settled transfer and an unposted one',
  states.has('settled') && states.has('unposted'),
  [...states],
)

// --------------------------------------------------------- leg 8: E-VAT

section('leg 8 — certification sits beside the document')

async function evatRow(id) {
  return one(
    `select status::text as status, serial, signature, qr_payload, provider_invoice_number
       from evat_submission where sale_id = $1`,
    [id],
  )
}
let submission = await evatRow(saleId)
for (let attempt = 0; attempt < 30 && submission?.status !== 'CERTIFIED'; attempt += 1) {
  await new Promise((resolve) => setTimeout(resolve, 1000))
  submission = await evatRow(saleId)
}
check(
  '8.1',
  'the sale has a certified submission with GRA’s fields and the mock’s own QR',
  submission?.status === 'CERTIFIED' &&
    Boolean(submission.serial) &&
    Boolean(submission.signature) &&
    submission.qr_payload?.includes('evat.mock.invalid') &&
    submission.provider_invoice_number === saleReceipt,
  submission,
)
check(
  '8.2',
  'SQL: certifying the sale left it byte-identical',
  (await saleChecksum(saleId)) === checksumBeforeRefund,
)
const evatList = await get(manager.cookie, '/api/evat/submissions')
check(
  '8.3',
  'a manager can read their branch’s submissions',
  evatList.status === 200 &&
    (evatList.body?.submissions ?? []).some((row) => row.saleId === saleId),
  evatList.status,
)
const retryDenied = await post(
  manager.cookie,
  `/api/evat/submissions/${submission ? (await one('select id from evat_submission where sale_id = $1', [saleId])).id : '00000000-0000-0000-0000-000000000000'}/retry`,
  {},
)
check(
  '8.4',
  'a manager cannot retry a submission (admin-only)',
  retryDenied.status === 403,
  retryDenied.status,
)
skip(
  '8.5',
  'the retry ladder and E700 adoption',
  'the mock’s refusal hooks are in-process test levers, not HTTP',
  'api/src/modules/evat/evat.test.ts',
)

// --------------------------------------------------- leg 9: the permission matrix

section('leg 9 — the permissions are enforced server-side')

check(
  '9.1',
  'a cashier cannot read oversight',
  (await get(cashier.cookie, '/api/pos/oversight/sales')).status === 403,
)
check(
  '9.2',
  'a cashier cannot resolve a conflict',
  (
    await patch(cashier.cookie, `/api/pos/oversight/conflicts/${oversellConflict.id}`, {
      status: 'RESOLVED',
      code: 'CONFIRMED',
    })
  ).status === 403,
)
check(
  '9.3',
  'a manager cannot read another branch’s sale',
  (await get(manager.cookie, `/api/pos/oversight/sales?branchId=${randomUUID()}`)).status === 403,
)
check('9.4', 'a manager cannot read the E-VAT retry surface as admin', retryDenied.status === 403)

// ---------------------------------------------------------------- teardown

section('teardown')

const userEmails = [cashier.email, manager.email]
await db.query('delete from evat_submission where branch_id = $1', [branchId])
await db.query(
  `delete from payment_event where supplier_transfer_id in (select id from supplier_transfer where branch_id = $1)`,
  [branchId],
)
await db.query(
  'delete from supplier_transfer_allocation where transfer_id in (select id from supplier_transfer where branch_id = $1)',
  [branchId],
)
await db.query('delete from supplier_transfer where branch_id = $1', [branchId])
await db.query(
  'delete from supplier_payment_allocation where payment_id in (select id from supplier_payment where branch_id = $1)',
  [branchId],
)
await db.query('delete from supplier_payment where branch_id = $1', [branchId])
await db.query(
  'delete from supplier_invoice_line where invoice_id in (select id from supplier_invoice where branch_id = $1)',
  [branchId],
)
await db.query('delete from supplier_invoice where branch_id = $1', [branchId])
await db.query('delete from supplier_payment_detail where supplier_id = $1', [supplier.id])
await db.query(
  'delete from refund_tender where refund_id in (select id from refund where branch_id = $1)',
  [branchId],
)
await db.query(
  'delete from refund_line where refund_id in (select id from refund where branch_id = $1)',
  [branchId],
)
await db.query('delete from refund where branch_id = $1', [branchId])
await db.query(
  'delete from sale_tender where sale_id in (select id from sale where branch_id = $1)',
  [branchId],
)
await db.query(
  'delete from sale_line where sale_id in (select id from sale where branch_id = $1)',
  [branchId],
)
await db.query('delete from credit_ledger_entry where branch_id = $1', [branchId])
await db.query('delete from loyalty_ledger_entry where branch_id = $1', [branchId])
await db.query(
  'delete from stock_receipt_line where receipt_id in (select id from stock_receipt where branch_id = $1)',
  [branchId],
)
await db.query('delete from stock_receipt where branch_id = $1', [branchId])
await db.query('delete from stock_movement where branch_id = $1', [branchId])
await db.query('delete from sale where branch_id = $1', [branchId])
await db.query('delete from payment where branch_id = $1', [branchId])
await db.query('delete from sync_conflict where branch_id = $1', [branchId])
await db.query('delete from pos_sync_transaction where terminal_id = $1', [terminal.id])
await db.query('delete from pos_staff_binding where device_id = $1', [device.deviceId])
await db.query('delete from cash_movement where shift_id = $1', [shiftId])
await db.query('delete from shift_report where shift_id = $1', [shiftId])
await db.query('delete from shift where branch_id = $1', [branchId])
await db.query('delete from device where terminal_id = $1', [terminal.id])
await db.query('delete from terminal_enrollment where terminal_id = $1', [terminal.id])
await db.query('delete from terminal where branch_id = $1', [branchId])
await db.query('delete from credit_profile where branch_id = $1', [branchId])
await db.query(
  'delete from loyalty_lot where account_id in (select id from loyalty_account where customer_id = $1)',
  [customer.id],
)
await db.query('delete from loyalty_account where customer_id = $1', [customer.id])
await db.query('delete from customer where id = $1', [customer.id])
await db.query('delete from stock_level where branch_id = $1', [branchId])
await db.query('delete from stock_threshold where branch_id = $1', [branchId])
await db.query('delete from product_price where product_id = $1', [productMain])
await db.query('delete from product where id = $1', [productMain])
await db.query('delete from supplier_product where supplier_id = $1', [supplier.id])
await db.query('delete from supplier where id = $1', [supplier.id])
for (const email of userEmails) {
  await db.query('delete from session where user_id in (select id from "user" where email = $1)', [
    email,
  ])
  await db.query('delete from account where user_id in (select id from "user" where email = $1)', [
    email,
  ])
  await db.query('delete from "user" where email = $1', [email])
}
await db.query('delete from audit_log where branch_id = $1', [branchId])
await db.query('delete from branch where id = $1', [branchId])
await db.end()

console.log(`\nPASS ${passed}  FAIL ${failures.length}  NOT-DRIVEN ${notDriven}`)
if (failures.length > 0) {
  console.log('Failures:')
  for (const failure of failures) console.log(`  - ${failure}`)
  process.exit(1)
}
