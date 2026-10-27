#!/usr/bin/env node
/**
 * Phase 13 Plan 13 — the payments, refunds and Z-report walkthrough.
 *
 *   node .planning/phases/13-pos-payments-returns/evidence/walkthrough-payments.mjs
 *
 * Runs against the real API on :4000 in `PAYSTACK_MODE=mock`. Every fixture (branch, products,
 * stock, staff, customer, terminal, device session, shift) is created **through the API** with a
 * unique suffix, so a second run neither borrows nor collides with the demo seed or a previous
 * run.
 *
 * Three things are intentionally not plain HTTP:
 *
 *   1. **Read-only SQL** re-derives the figures the plan requires: the split's tender identity
 *      (`Σ sale_tender − change = total`), the credit ledger's charge, refund and repayment, and
 *      the Z-report's cash expectation. No fixture is ever inserted with SQL; the one `delete`
 *      is leg 28, which exists to prove a missing snapshot is a 500 rather than a recomputation.
 *   2. **The webhook** is posted the way Paystack posts it: a real HMAC-SHA512 over the raw body
 *      with `PAYSTACK_WEBHOOK_SECRET`. With that variable unset (the shipped `.env` value) the
 *      API fails closed on every body, so the three webhook legs report NOT-DRIVEN and name the
 *      blocker instead of pretending. Start the API with a throwaway secret to drive them.
 *   3. **Teardown** deletes the rows this run created in foreign-key order and reports what it
 *      removed.
 *
 * Prints `PASS n` / `FAIL n` / `NOT-DRIVEN n` and exits non-zero on any failure. The check that
 * on 2026-10-27 reported a drawer finding (leg 27.4, cash refunds missing from expected cash) is
 * now a passing assertion against the corrected arithmetic; 13-VERIFICATION.md records it.
 */
import { createHash, createHmac, randomUUID } from 'node:crypto'
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
const webhookSecret = process.env.PAYSTACK_WEBHOOK_SECRET ?? envValue('PAYSTACK_WEBHOOK_SECRET')
const CREDIT_LIMIT_MINOR = 200_000

if (!adminEmail || !adminPassword || !databaseUrl) {
  console.error('ADMIN_EMAIL / ADMIN_PASSWORD / DATABASE_URL are required in .env')
  process.exit(1)
}

const suffix = `${Date.now().toString(36)}${Math.random().toString(36).slice(2, 5)}`
const tail = suffix.toUpperCase().slice(-5)

let passed = 0
let notDriven = 0
const failures = []
const drivenLegs = new Set()
const skippedLegs = new Set()

function check(leg, label, condition, detail) {
  drivenLegs.add(leg.split('.')[0])
  if (condition) {
    passed += 1
    console.log(`PASS ${leg}  ${label}`)
    return true
  }
  failures.push(`${leg} ${label}`)
  console.log(
    `FAIL ${leg}  ${label}${detail === undefined ? '' : ` — ${typeof detail === 'string' ? detail : JSON.stringify(detail)}`}`,
  )
  return false
}

function skip(leg, label, reason, coveredBy) {
  notDriven += 1
  skippedLegs.add(leg.split('.')[0])
  console.log(`NOT-DRIVEN ${leg}  ${label} — ${reason}; covered by ${coveredBy}`)
}

function section(title) {
  console.log(`\n## ${title}`)
}

function note(text) {
  console.log(`     ${text}`)
}

const ghs = (minor) =>
  `GHS ${Math.trunc(minor / 100)}.${String(Math.abs(minor % 100)).padStart(2, '0')}`

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
  let payload = null
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
const put = (cookie, urlPath, body) => call(cookie, 'PUT', urlPath, body)

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
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  return { status: response.status, body: payload }
}

/** Posts a raw body with (or without) a real Paystack signature. */
async function postWebhook(rawBody, signature) {
  const response = await fetch(`${apiUrl}/api/payments/webhook/paystack`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(signature ? { 'x-paystack-signature': signature } : {}),
    },
    body: rawBody,
  })
  const text = await response.text()
  let payload = null
  if (text) {
    try {
      payload = JSON.parse(text)
    } catch {
      payload = text
    }
  }
  return { status: response.status, body: payload }
}

const sign = (rawBody, secret) => createHmac('sha512', secret).update(rawBody).digest('hex')
const key = () => randomUUID()

// ------------------------------------------------------------------- sql

const db = new Client({ connectionString: databaseUrl })
await db.connect()

async function rows(text, params = []) {
  return (await db.query(text, params)).rows
}

async function one(text, params = []) {
  return (await rows(text, params))[0] ?? null
}

async function count(table, where, params) {
  const row = await one(`select count(*)::int as total from ${table} where ${where}`, params)
  return row?.total ?? 0
}

async function onHand(branchId, productId) {
  const row = await one(
    'select quantity_on_hand::int as qty from stock_level where branch_id = $1 and product_id = $2',
    [branchId, productId],
  )
  return row?.qty ?? null
}

// -------------------------------------------------------------- fixtures

section('fixtures (created through the API)')

const adminCookie = await signIn(adminEmail, adminPassword)
note(`admin session minted for ${adminEmail}`)

const branchResponse = await post(adminCookie, '/api/branches', {
  code: `P13-${tail.slice(0, 4)}`,
  name: `Walk payments ${suffix}`,
  type: 'RETAIL',
  city: 'Accra',
})
const branchId = branchResponse.body?.branch?.id
if (!branchId) {
  console.error('could not create the branch', branchResponse.status, branchResponse.body)
  process.exit(1)
}

const categoryId = (await post(adminCookie, '/api/categories', { name: `Walk pay ${suffix}` })).body
  ?.category?.id
const uomId = (await post(adminCookie, '/api/uoms', { code: `P${tail}`, name: 'Piece' })).body?.uom
  ?.id
const supplierId = (
  await post(adminCookie, '/api/suppliers', {
    name: `Walk pay supplier ${suffix}`,
    paymentTermDays: 30,
  })
).body?.supplier?.id
if (!categoryId || !uomId || !supplierId) {
  console.error('could not create the catalogue foundations')
  process.exit(1)
}

/** The workhorse line: GHS 100.00 in ten GHS 10.00 units, so every refund is a whole unit. */
const UNIT_MINOR = 10_000
const UNIT_QUANTITY = 10
const productMain = (
  await post(adminCookie, '/api/products', {
    sku: `P13A${tail}`,
    name: `Walk pay A ${suffix}`,
    categoryId,
    uomId,
    basePriceMinor: UNIT_MINOR,
  })
).body?.product?.id
const productSecond = (
  await post(adminCookie, '/api/products', {
    sku: `P13B${tail}`,
    name: `Walk pay B ${suffix}`,
    categoryId,
    uomId,
    basePriceMinor: 25_000,
  })
).body?.product?.id
if (!productMain || !productSecond) {
  console.error('could not create the two products')
  process.exit(1)
}

const receipt = await post(adminCookie, '/api/inventory/receipts', {
  branchId,
  supplierId,
  lines: [
    { productId: productMain, quantity: 40, unitCostMinor: 5_000 },
    { productId: productSecond, quantity: 20, unitCostMinor: 12_000 },
  ],
})
if (receipt.status !== 201) {
  console.error('could not receive stock', receipt.status, receipt.body)
  process.exit(1)
}

async function createStaff({ name, role, password }) {
  const email = `walk13-${name.replace(/[^a-z0-9]+/g, '-')}-${suffix}@sceptre.test`
  const created = await post(adminCookie, '/api/staff', { email, name, role, branchId })
  if (created.status !== 201) {
    throw new Error(`staff create failed (${created.status}): ${JSON.stringify(created.body)}`)
  }
  const temporaryPassword = created.body.temporaryPassword
  let session = await signIn(email, temporaryPassword)
  const changed = await post(session, '/api/me/password', {
    currentPassword: temporaryPassword,
    newPassword: password,
  })
  if (changed.status !== 200 && changed.status !== 204) {
    throw new Error(`password change failed (${changed.status}): ${JSON.stringify(changed.body)}`)
  }
  session = await signIn(email, password)
  const staff = created.body.staff
  return { email, cookie: session, userId: staff.id, staffId: staff.staffId }
}

const cashier = await createStaff({
  name: `pay cashier ${suffix}`,
  role: 'CASHIER',
  password: `walk13-cashier-${suffix}`,
})
const manager = await createStaff({
  name: `pay manager ${suffix}`,
  role: 'MANAGER',
  password: `walk13-manager-${suffix}`,
})

const cashierPin = `${(Number.parseInt(tail.slice(-3), 36) % 89) + 10}${(Number.parseInt(tail.slice(0, 2), 36) % 89) + 10}`
const managerPin = `${(Number.parseInt(tail.slice(-2), 36) % 89) + 10}${(Number.parseInt(tail.slice(1, 3), 36) % 89) + 10}`
await post(adminCookie, `/api/staff/${cashier.userId}/pin`, { pin: cashierPin })
await post(adminCookie, `/api/staff/${manager.userId}/pin`, { pin: managerPin })
if (cashierPin === managerPin) {
  console.error('the two generated PINs collided; rerun')
  process.exit(1)
}

const phoneBase = `05${String(Date.now()).slice(-8)}`
const customerResponse = await post(adminCookie, '/api/customers', {
  name: `Walk pay credit ${suffix}`,
  phone: phoneBase,
  branchId,
})
const customer = customerResponse.body?.customer
if (!customer?.id) {
  console.error('could not create the customer', customerResponse.status, customerResponse.body)
  process.exit(1)
}
const limitSet = await put(adminCookie, `/api/credit/profiles/${customer.id}`, {
  branchId,
  limitMinor: CREDIT_LIMIT_MINOR,
})
if (limitSet.status !== 200) {
  console.error('could not set the credit limit', limitSet.status, limitSet.body)
  process.exit(1)
}

// A real terminal: enrolment code -> device token -> device JWT.
const terminal = (
  await post(adminCookie, '/api/terminals', { branchId, name: `Walk pay till ${suffix}` })
).body?.terminal
const enrollment = (await post(adminCookie, `/api/terminals/${terminal.id}/enrollment`)).body
  ?.enrollment
const redeemed = await post(adminCookie, '/api/enrollments/redeem', {
  code: enrollment.code,
  fingerprint: `walk13-${suffix}`,
})
const deviceToken = redeemed.body?.deviceToken
if (!deviceToken) {
  console.error('could not redeem the enrolment', redeemed.status, redeemed.body)
  process.exit(1)
}
const sessionResponse = await fetch(`${apiUrl}/api/pos/session`, {
  method: 'POST',
  headers: { authorization: `Bearer ${deviceToken}`, origin },
})
const device = await sessionResponse.json()
const deviceJwt = device.accessToken
if (!deviceJwt) {
  console.error('could not mint a device session', sessionResponse.status, device)
  process.exit(1)
}
const deviceId = device.deviceId

const cashierBinding = await deviceCall(deviceJwt, 'POST', '/api/pos/staff/authorize', {
  email: cashier.email,
  pin: cashierPin,
})
const managerBinding = await deviceCall(deviceJwt, 'POST', '/api/pos/staff/authorize', {
  email: manager.email,
  pin: managerPin,
})
if (cashierBinding.status !== 201 || managerBinding.status !== 201) {
  console.error(
    'could not authorize the staff on the terminal',
    cashierBinding.status,
    cashierBinding.body,
    managerBinding.status,
    managerBinding.body,
  )
  process.exit(1)
}

const cashierProof = {
  userId: cashier.userId,
  staffId: cashier.staffId,
  bindingId: cashierBinding.body.bindingId,
  bindingToken: cashierBinding.body.bindingToken,
  pinVersion: cashierBinding.body.pinVersion,
}
const cashierAsCloserProof = { ...cashierProof }
const managerProof = {
  userId: manager.userId,
  staffId: manager.staffId,
  bindingId: managerBinding.body.bindingId,
  bindingToken: managerBinding.body.bindingToken,
  pinVersion: managerBinding.body.pinVersion,
}

async function managerApproval(reasonCode) {
  return {
    staffId: manager.staffId,
    userId: manager.userId,
    bindingId: managerBinding.body.bindingId,
    pinVersion: managerBinding.body.pinVersion,
    reasonCode,
    note: 'Walkthrough approval',
    occurredAt: new Date().toISOString(),
  }
}

const shiftOne = {
  shiftId: key(),
  number: `W13-${tail}-A`,
  openingFloatMinor: 50_000,
}

async function upload(transactions) {
  const response = await deviceCall(deviceJwt, 'POST', '/api/pos/sync/upload', {
    batchId: key(),
    deviceId,
    terminalId: terminal.id,
    transactions: transactions.map((transaction) => ({
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      ...transaction,
    })),
  })
  if (response.status !== 200) {
    throw new Error(`upload failed (${response.status}): ${JSON.stringify(response.body)}`)
  }
  return response.body
}

async function uploadOne(transaction) {
  const body = await upload([transaction])
  return body.results[0]
}

// ---------------------------------------------------------------------- legs

// 1-4: enrolment, session, shift, two products ---------------------------------------------
section('legs 1-4 — enrolment, device session, shift, catalogue')

check(
  '1.1',
  'an admin session created a branch and a terminal through the API',
  Boolean(branchId && terminal?.id),
  { branch: branchResponse.status, terminal: terminal?.code },
)
check(
  '2.1',
  'an enrolment code redeemed into a device token',
  typeof deviceToken === 'string' && deviceToken.length > 20,
)
check(
  '2.2',
  'the device session minted a JWT for that terminal and branch',
  typeof deviceJwt === 'string' &&
    device.branch?.id === branchId &&
    device.terminal?.id === terminal.id,
  { terminal: device.terminal?.code },
)

const shiftOpen = await uploadOne({
  clientTransactionId: key(),
  type: 'SHIFT_OPEN',
  payload: {
    shiftId: shiftOne.shiftId,
    number: shiftOne.number,
    openingFloatMinor: shiftOne.openingFloatMinor,
    cashierUserId: cashier.userId,
    cashierStaffId: cashier.staffId,
    occurredAt: new Date().toISOString(),
  },
})
const shiftRow = await one(
  'select status, opening_float_minor::int as float from shift where id = $1',
  [shiftOne.shiftId],
)
check(
  '3.1',
  'the shift opened on the terminal (APPLIED, status OPEN, float stored)',
  shiftOpen.status === 'APPLIED' && shiftRow?.status === 'OPEN' && shiftRow?.float === 50_000,
  { upload: shiftOpen.status, shift: shiftRow },
)
check(
  '4.1',
  'two products were created and stocked at this branch',
  (await onHand(branchId, productMain)) === 40 && (await onHand(branchId, productSecond)) === 20,
  { main: await onHand(branchId, productMain), second: await onHand(branchId, productSecond) },
)
note(`cashier ${cashier.staffId} and manager ${manager.staffId} authorized on ${terminal.code}`)

// 5-7: a MoMo intent, its idempotency, and its settlement --------------------------------
section('legs 5-7 — a MoMo payment: PENDING, idempotent, PAID only when the server says so')

const momoClientPaymentId = key()
const momoBody = {
  clientPaymentId: momoClientPaymentId,
  shiftId: shiftOne.shiftId,
  method: 'MOMO',
  amountMinor: 60_000,
  mobileMoney: { provider: 'mtn', phone: '0551234987' },
}
const createdMomo = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', momoBody)
const momo = createdMomo.body?.payment
const expiryDeltaMs = momo?.expiresAt ? new Date(momo.expiresAt).getTime() - Date.now() : null
check(
  '5.1',
  'a MoMo charge is created PENDING with display text and a ~180 s expiry',
  createdMomo.status === 201 &&
    momo?.status === 'PENDING' &&
    typeof momo?.displayText === 'string' &&
    momo.displayText.length > 0 &&
    expiryDeltaMs !== null &&
    Math.abs(expiryDeltaMs - 180_000) < 5_000,
  { status: createdMomo.status, payment: momo?.status, expiresInMs: expiryDeltaMs },
)

const repeatedMomo = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', momoBody)
const momoRows = await rows(
  'select id, status, provider::text as provider, provider_reference from payment where client_payment_id = $1',
  [momoClientPaymentId],
)
check(
  '6.1',
  'the same clientPaymentId returns the same payment id',
  repeatedMomo.body?.payment?.id === momo?.id,
  { first: momo?.id, second: repeatedMomo.body?.payment?.id },
)
check(
  '6.2',
  'one payment row exists for that clientPaymentId (the provider call count is in-process, see payments.test.ts)',
  momoRows.length === 1 && momoRows[0]?.provider === 'MOCK',
  momoRows,
)

const settled = await post(adminCookie, '/api/payments/mock/settle', {
  reference: momo.providerReference,
  outcome: 'PAID',
})
const polledMomo = await deviceCall(deviceJwt, 'GET', `/api/pos/payments/${momo.id}?refresh=1`)
check(
  '7.1',
  'the mock harness settled it and the till’s poll read it back PAID with a paid time',
  settled.status === 200 &&
    settled.body?.ok === true &&
    polledMomo.body?.payment?.status === 'PAID' &&
    Boolean(polledMomo.body?.payment?.paidAt),
  { settle: settled.status, status: polledMomo.body?.payment?.status },
)

// 8-9: a split sale, its identity, and its replay -----------------------------------------
section('legs 8-9 — a cash + MoMo sale, its tender identity, and a replay')

const receiptA = `W13-${tail}-001`
const saleAId = key()

function saleTotals(priced, changeMinor) {
  return {
    subtotalMinor: priced.subtotalMinor,
    lineDiscountMinor: priced.lineDiscountMinor,
    saleDiscountMinor: priced.saleDiscountMinor,
    loyaltyDiscountMinor: priced.loyaltyDiscountMinor,
    vatMinor: priced.vatMinor,
    nhilMinor: priced.nhilMinor,
    getfundMinor: priced.getfundMinor,
    taxTotalMinor: priced.taxTotalMinor,
    totalMinor: priced.totalMinor,
    changeMinor,
  }
}

function salePayload({ receiptNumber, tenders, customer: saleCustomer = null, quantity }) {
  const priced = priceCart(
    [
      {
        productId: productMain,
        name: 'Walk pay A',
        sku: `P13A${tail}`,
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
    tenders.map((tender, index) => ({
      method: tender.method,
      amountMinor: tender.amountMinor,
      sequence: index + 1,
    })),
  )
  if (balance.problem)
    throw new Error(`the walkthrough built an impossible tender set: ${balance.problem}`)
  return {
    payload: {
      receiptNumber,
      shiftId: shiftOne.shiftId,
      cashier: cashierProof,
      customer: saleCustomer,
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
      tenders: tenders.map((tender) => ({
        method: tender.method,
        amountMinor: tender.amountMinor,
        paymentId: tender.paymentId ?? null,
        override: null,
      })),
      totals: saleTotals(priced, balance.changeMinor),
      occurredAt: new Date().toISOString(),
      appVersion: 'walkthrough',
    },
    priced,
    balance,
  }
}

const saleA = salePayload({
  receiptNumber: receiptA,
  quantity: UNIT_QUANTITY,
  tenders: [
    { method: 'CASH', amountMinor: 40_000 },
    { method: 'MOMO', amountMinor: 60_000, paymentId: momo.id },
  ],
})
const saleAResult = await uploadOne({
  clientTransactionId: saleAId,
  type: 'SALE',
  payload: saleA.payload,
})
const saleATenders = await rows(
  `select sequence, method::text as method, amount_minor::int as amount
     from sale_tender where sale_id = $1 order by sequence`,
  [saleAId],
)
const saleAIdentity = await one(
  `select s.total_minor::int as total, s.tender_total_minor::int as tendered, s.change_minor::int as change,
          (select coalesce(sum(amount_minor), 0)::int from sale_tender where sale_id = s.id) as sum_tenders,
          s.credit_amount_minor::int as credit
     from sale s where s.id = $1`,
  [saleAId],
)
check(
  '8.1',
  'a cash 40.00 + MoMo 60.00 sale applies with no conflict',
  saleAResult.status === 'APPLIED' && saleAResult.conflicts.length === 0,
  { status: saleAResult.status, conflicts: saleAResult.conflicts },
)
check(
  '8.2',
  'SQL: Σ tenders − change = total (the split identity), with two ordered tenders',
  saleAIdentity !== null &&
    saleAIdentity.sum_tenders - saleAIdentity.change === saleAIdentity.total &&
    saleAIdentity.total === 100_000 &&
    saleATenders.length === 2 &&
    saleATenders[0]?.sequence === 1 &&
    saleATenders[1]?.sequence === 2,
  { identity: saleAIdentity, tenders: saleATenders },
)
check(
  '8.3',
  'the tenders are the ones the till sent: 40 000 cash then 60 000 MoMo',
  saleATenders[0]?.method === 'CASH' &&
    saleATenders[0]?.amount === 40_000 &&
    saleATenders[1]?.method === 'MOMO' &&
    saleATenders[1]?.amount === 60_000,
  saleATenders,
)

const saleAReplay = await uploadOne({
  clientTransactionId: saleAId,
  type: 'SALE',
  payload: saleA.payload,
})
check(
  '9.1',
  're-uploading the same sale is REPLAYED, not applied twice',
  saleAReplay.status === 'REPLAYED' && saleAReplay.serverId === saleAId,
  saleAReplay,
)
check(
  '9.2',
  'SQL: one sale row, one stock movement and one tender set for that receipt',
  (await count('sale', 'id = $1', [saleAId])) === 1 &&
    (await count('stock_movement', "reference_id = $1 and type = 'SALE'", [saleAId])) === 1 &&
    (await count('sale_tender', 'sale_id = $1', [saleAId])) === 2,
  {
    sales: await count('sale', 'id = $1', [saleAId]),
    movements: await count('stock_movement', "reference_id = $1 and type = 'SALE'", [saleAId]),
    tenders: await count('sale_tender', 'sale_id = $1', [saleAId]),
  },
)

// 10-11: the webhook ----------------------------------------------------------------------
section('legs 10-11 — the webhook: replay is a no-op, a wrong key is a 401')

if (!webhookSecret) {
  skip(
    '10.1',
    'a signed charge.success is delivered and replayed',
    'PAYSTACK_WEBHOOK_SECRET (and PAYSTACK_SECRET_KEY) are empty, so env.ts resolves the secret to null and the route fails closed with 401 for every body',
    'payments.webhook.test.ts ("a replayed body inserts one event and changes nothing")',
  )
  skip(
    '10.2',
    'the duplicate delivery inserts exactly one payment_event',
    'no verifiable secret in this environment',
    'payments.webhook.test.ts',
  )
  skip(
    '11.1',
    'a body signed with the wrong key is 401 and no event',
    'the route cannot distinguish a wrong key from no key when the secret is null',
    'payments.webhook.test.ts ("a body signed with another key is 401")',
  )
} else {
  const webhookBody = JSON.stringify({
    event: 'charge.success',
    data: {
      id: 900001,
      reference: momo.providerReference,
      status: 'success',
      amount: 60_000,
      currency: 'GHS',
      channel: 'mobile_money',
      paid_at: new Date().toISOString(),
      gateway_response: 'Successful',
      authorization: {
        authorization_code: 'AUTH_should_not_persist',
        bin: '408408',
        last4: '4081',
      },
      customer: { email: 'buyer@example.com', phone: '+233551234987' },
    },
  })
  const firstDelivery = await postWebhook(webhookBody, sign(webhookBody, webhookSecret))
  const bodyHash = createHash('sha256').update(webhookBody).digest('hex')
  const secondDelivery = await postWebhook(webhookBody, sign(webhookBody, webhookSecret))
  const eventRows = await rows(
    'select id, event_type::text as event_type, status::text as status from payment_event where body_sha256 = $1',
    [bodyHash],
  )
  check(
    '10.1',
    'the same charge.success body delivered twice answers 200 twice',
    firstDelivery.status === 200 && secondDelivery.status === 200,
    { first: firstDelivery.status, second: secondDelivery.status },
  )
  check(
    '10.2',
    'SQL: the replay inserted exactly one payment_event for that body hash',
    eventRows.length === 1,
    eventRows,
  )
  // The mock payment is a MOCK row; a Paystack body may not move it (payments.service.ts
  // `findByReferenceForUpdate` requires provider === 'PAYSTACK'). That guard is the point.
  const momoAfterWebhook = await one('select status::text as status from payment where id = $1', [
    momo.id,
  ])
  check(
    '10.3',
    'the delivery did not move a MOCK payment (the event is recorded as IGNORED, the guard holds)',
    eventRows[0]?.status === 'IGNORED' && momoAfterWebhook?.status === 'PAID',
    { event: eventRows[0]?.status, payment: momoAfterWebhook?.status },
  )

  const eventsBefore = await count('payment_event', 'true', [])
  const forgedBody = JSON.stringify({ event: 'charge.success', data: { reference: 'sd-forged' } })
  const forged = await postWebhook(forgedBody, sign(forgedBody, 'not-the-real-webhook-secret'))
  check(
    '11.1',
    'a body signed with the wrong key is a 401 with INVALID_SIGNATURE',
    forged.status === 401 && forged.body?.error?.code === 'INVALID_SIGNATURE',
    forged,
  )
  check(
    '11.2',
    'SQL: the refused delivery inserted no payment_event',
    (await count('payment_event', 'true', [])) === eventsBefore,
    { before: eventsBefore, after: await count('payment_event', 'true', []) },
  )
}

// 12-13: card and bank transfer -----------------------------------------------------------
section('legs 12-13 — card checkout and a bank transfer account')

const cardClientPaymentId = key()
const createdCard = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', {
  clientPaymentId: cardClientPaymentId,
  shiftId: shiftOne.shiftId,
  method: 'CARD',
  amountMinor: 40_000,
})
const card = createdCard.body?.payment
check(
  '12.1',
  'card initialize returns a checkout.paystack.com authorization_url and stays PENDING',
  createdCard.status === 201 &&
    card?.status === 'PENDING' &&
    typeof card?.authorizationUrl === 'string' &&
    card.authorizationUrl.startsWith('https://checkout.paystack.com'),
  { status: createdCard.status, url: card?.authorizationUrl, payment: card?.status },
)

const createdBank = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', {
  clientPaymentId: key(),
  shiftId: shiftOne.shiftId,
  method: 'BANK_TRANSFER',
  amountMinor: 25_000,
})
const bank = createdBank.body?.payment
const bankExpiryDelta = bank?.expiresAt ? new Date(bank.expiresAt).getTime() - Date.now() : null
check(
  '13.1',
  'bank transfer returns an account number, account name and bank, expiring in ~15 minutes',
  createdBank.status === 201 &&
    Boolean(bank?.accountNumber) &&
    Boolean(bank?.accountName) &&
    Boolean(bank?.accountBank) &&
    bankExpiryDelta !== null &&
    Math.abs(bankExpiryDelta - 900_000) < 10_000,
  {
    account: bank?.accountNumber,
    name: bank?.accountName,
    bank: bank?.accountBank,
    expiresInMs: bankExpiryDelta,
  },
)

// 14: an amount mismatch on a settlement --------------------------------------------------
section('leg 14 — a settlement one pesewa too large')

skip(
  '14.1',
  'a charge.success one pesewa larger raises PAYMENT_AMOUNT_MISMATCH (HIGH) and leaves the payment PENDING',
  'the webhook only writes a payment whose provider is PAYSTACK, and PAYSTACK_MODE=mock never creates one; the walkthrough may not insert a fixture payment with SQL',
  'payments.webhook.test.ts ("a success whose amount differs is a HIGH conflict and no status change")',
)

// 15: abandonment and a late settlement ---------------------------------------------------
section('leg 15 — abandoning a payment, and money that arrives afterwards')

const abandoned = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', {
  clientPaymentId: key(),
  shiftId: shiftOne.shiftId,
  method: 'MOMO',
  amountMinor: 5_000,
  mobileMoney: { provider: 'mtn', phone: '0551234987' },
})
const abandonFirst = await deviceCall(
  deviceJwt,
  'POST',
  `/api/pos/payments/${abandoned.body.payment.id}/abandon`,
)
check(
  '15.1',
  'abandoning an unsettled MoMo payment flips it to EXPIRED',
  abandonFirst.status === 200 && abandonFirst.body?.payment?.status === 'EXPIRED',
  abandonFirst.body?.payment?.status,
)

const late = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', {
  clientPaymentId: key(),
  shiftId: shiftOne.shiftId,
  method: 'MOMO',
  amountMinor: 5_000,
  mobileMoney: { provider: 'mtn', phone: '0551234987' },
})
const latePayment = late.body.payment
// The provider settles while the till is still waiting; the till then gives up. `abandon`
// expires the row and its own verify call wins, which is exactly the late settlement P13-D9
// describes (in mock mode this is the only route to it: the webhook refuses MOCK rows).
await post(adminCookie, '/api/payments/mock/settle', {
  reference: latePayment.providerReference,
  outcome: 'PAID',
})
const abandonLate = await deviceCall(
  deviceJwt,
  'POST',
  `/api/pos/payments/${latePayment.id}/abandon`,
)
const lateConflicts = await rows(
  `select severity::text as severity, details from sync_conflict
    where type = 'PAYMENT_LATE_SETTLEMENT' and details->>'paymentId' = $1`,
  [latePayment.id],
)
check(
  '15.2',
  'a settlement that beat the abandon becomes PAID and orphaned',
  abandonLate.body?.payment?.status === 'PAID' && abandonLate.body?.payment?.orphaned === true,
  { status: abandonLate.body?.payment?.status, orphaned: abandonLate.body?.payment?.orphaned },
)
check(
  '15.3',
  'SQL: one HIGH PAYMENT_LATE_SETTLEMENT conflict names that payment, and no refund was issued',
  lateConflicts.length === 1 &&
    lateConflicts[0]?.severity === 'HIGH' &&
    lateConflicts[0]?.details?.amountMinor === 5_000 &&
    (await count('refund', 'id = $1', [latePayment.id])) === 0,
  lateConflicts,
)

// 16: a three-tender sale -----------------------------------------------------------------
section('leg 16 — cash + credit + card on one sale')

const settledCard = await post(adminCookie, '/api/payments/mock/settle', {
  reference: card.providerReference,
  outcome: 'PAID',
})
const polledCard = await deviceCall(deviceJwt, 'GET', `/api/pos/payments/${card.id}?refresh=1`)
if (settledCard.status !== 200 || polledCard.body?.payment?.status !== 'PAID') {
  console.error('the card payment did not settle', settledCard.status, polledCard.body)
  process.exit(1)
}

const receiptB = `W13-${tail}-002`
const saleBId = key()
const saleB = salePayload({
  receiptNumber: receiptB,
  quantity: UNIT_QUANTITY,
  customer: { id: customer.id, phone: customer.phone, name: customer.name },
  tenders: [
    { method: 'CASH', amountMinor: 30_000 },
    { method: 'CREDIT', amountMinor: 30_000 },
    { method: 'CARD', amountMinor: 40_000, paymentId: card.id },
  ],
})
const saleBResult = await uploadOne({
  clientTransactionId: saleBId,
  type: 'SALE',
  payload: saleB.payload,
})
const saleBTenders = await rows(
  `select id, sequence, method::text as method, amount_minor::int as amount
     from sale_tender where sale_id = $1 order by sequence`,
  [saleBId],
)
const creditCharge = await one(
  `select kind::text as kind, amount_minor::int as amount, reference_type::text as reference_type
     from credit_ledger_entry where reference_id = $1 order by created_at`,
  [saleBId],
)
const creditProfileAfterB = await one(
  'select balance_minor::int as balance, limit_minor::int as lim from credit_profile where customer_id = $1 and branch_id = $2',
  [customer.id, branchId],
)
check(
  '16.1',
  'a 30.00 cash / 30.00 credit / 40.00 card sale applies with no conflict',
  saleBResult.status === 'APPLIED' && saleBResult.conflicts.length === 0,
  { status: saleBResult.status, conflicts: saleBResult.conflicts },
)
check(
  '16.2',
  'SQL: three tenders in the order the cashier took them',
  saleBTenders.length === 3 &&
    saleBTenders.map((row) => `${row.sequence}:${row.method}:${row.amount}`).join(',') ===
      '1:CASH:30000,2:CREDIT:30000,3:CARD:40000',
  saleBTenders,
)
check(
  '16.3',
  'SQL: the credit ledger holds exactly the 30 000 credit tender, once',
  creditCharge?.kind === 'CHARGE' &&
    creditCharge?.amount === 30_000 &&
    creditProfileAfterB?.balance === 30_000,
  { entry: creditCharge, balance: creditProfileAfterB?.balance },
)

// 17: a payment may settle one tender only --------------------------------------------------
section('leg 17 — reusing a settled payment')

const saleCReuseId = key()
const replayedCard = await uploadOne({
  clientTransactionId: saleCReuseId,
  type: 'SALE',
  payload: salePayload({
    receiptNumber: `W13-${tail}-003`,
    quantity: 4,
    tenders: [{ method: 'CARD', amountMinor: 40_000, paymentId: card.id }],
  }).payload,
})
check(
  '17.1',
  'a second sale citing the same card payment is REJECTED INVALID_TENDER',
  replayedCard.status === 'REJECTED' && replayedCard.error?.code === 'INVALID_TENDER',
  replayedCard,
)
check(
  '17.2',
  'SQL: the refused sale wrote no sale row and no tender',
  (await count('sale', 'id = $1', [saleCReuseId])) === 0 &&
    (await count('sale_tender', 'sale_id = $1', [saleCReuseId])) === 0,
  {
    sales: await count('sale', 'id = $1', [saleCReuseId]),
    tenders: await count('sale_tender', 'sale_id = $1', [saleCReuseId]),
  },
)

// 18-20: refunds ---------------------------------------------------------------------------
section('legs 18-20 — a cash refund, a damaged line, and a credit refund')

const saleBBefore = await one(
  `select total_minor::int as total, tender_total_minor::int as tendered, change_minor::int as change,
          credit_amount_minor::int as credit, vat_minor::int as vat, tax_total_minor::int as tax
     from sale where id = $1`,
  [saleBId],
)
const saleBLine = await one(
  'select id, quantity::int as quantity, total_minor::int as total from sale_line where sale_id = $1',
  [saleBId],
)
const cashTenderB = saleBTenders.find((row) => row.method === 'CASH')
const creditTenderB = saleBTenders.find((row) => row.method === 'CREDIT')
const onHandBeforeRefund = await onHand(branchId, productMain)

const refundOneId = key()
const refundOneNo = `RF-${tail}-001`
const refundCash = await uploadOne({
  clientTransactionId: refundOneId,
  type: 'REFUND',
  payload: {
    saleId: saleBId,
    number: refundOneNo,
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    note: 'Two units back to the shelf',
    approval: await managerApproval('CUSTOMER_CHANGED_MIND'),
    lines: [{ saleLineId: saleBLine.id, quantity: 2, restock: 'RESALABLE', damageReason: null }],
    tenders: [{ saleTenderId: cashTenderB.id, amountMinor: 20_000 }],
    refundedMinor: 20_000,
    occurredAt: new Date().toISOString(),
  },
})
check(
  '18.1',
  'a 20.00 cash refund applies',
  refundCash.status === 'APPLIED' && refundCash.serverId === refundOneId,
  refundCash,
)
const saleBAfter = await one(
  `select total_minor::int as total, tender_total_minor::int as tendered, change_minor::int as change,
          credit_amount_minor::int as credit, vat_minor::int as vat, tax_total_minor::int as tax
     from sale where id = $1`,
  [saleBId],
)
check(
  '18.2',
  'SQL: the sale’s money columns are byte-identical after the refund',
  JSON.stringify(saleBBefore) === JSON.stringify(saleBAfter),
  { before: saleBBefore, after: saleBAfter },
)
const restockMovement = await one(
  `select type::text as type, quantity_delta::int as delta, reference_type::text as reference_type
     from stock_movement where reference_id = $1`,
  [refundOneId],
)
check(
  '18.3',
  'SQL: the resalable line posts one RETURN movement of +2 and the shelf grew by 2',
  restockMovement?.type === 'RETURN' &&
    restockMovement?.delta === 2 &&
    restockMovement?.reference_type === 'REFUND' &&
    (await onHand(branchId, productMain)) === onHandBeforeRefund + 2,
  { movement: restockMovement, onHand: await onHand(branchId, productMain) },
)

const refundTwoId = key()
const refundDamaged = await uploadOne({
  clientTransactionId: refundTwoId,
  type: 'REFUND',
  payload: {
    saleId: saleBId,
    number: `RF-${tail}-002`,
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'DEFECTIVE',
    note: 'Crushed in the bag',
    approval: await managerApproval('DEFECTIVE'),
    lines: [
      {
        saleLineId: saleBLine.id,
        quantity: 1,
        restock: 'DAMAGED',
        damageReason: 'Crushed in the delivery bag',
      },
    ],
    tenders: [{ saleTenderId: cashTenderB.id, amountMinor: 10_000 }],
    refundedMinor: 10_000,
    occurredAt: new Date().toISOString(),
  },
})
const damagedMovement = await count('stock_movement', 'reference_id = $1', [refundTwoId])
const damagedLine = await one(
  'select restock::text as restock, damage_reason from refund_line where refund_id = $1',
  [refundTwoId],
)
check(
  '19.1',
  'a DAMAGED line applies and stores its damage reason',
  refundDamaged.status === 'APPLIED' &&
    damagedLine?.restock === 'DAMAGED' &&
    damagedLine?.damage_reason === 'Crushed in the delivery bag',
  { status: refundDamaged.status, line: damagedLine },
)
check(
  '19.2',
  'SQL: zero stock_movement rows for the damaged refund, and the shelf did not move',
  damagedMovement === 0 && (await onHand(branchId, productMain)) === onHandBeforeRefund + 2,
  { movements: damagedMovement, onHand: await onHand(branchId, productMain) },
)

const refundThreeId = key()
const refundCredit = await uploadOne({
  clientTransactionId: refundThreeId,
  type: 'REFUND',
  payload: {
    saleId: saleBId,
    number: `RF-${tail}-003`,
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    note: 'Returned three units bought on account',
    approval: await managerApproval('CUSTOMER_CHANGED_MIND'),
    lines: [{ saleLineId: saleBLine.id, quantity: 3, restock: 'RESALABLE', damageReason: null }],
    tenders: [{ saleTenderId: creditTenderB.id, amountMinor: 30_000 }],
    refundedMinor: 30_000,
    occurredAt: new Date().toISOString(),
  },
})
const creditRefundEntry = await one(
  `select kind::text as kind, amount_minor::int as amount, reason_code::text as reason,
          reference_type::text as reference_type
     from credit_ledger_entry where reference_type = 'REFUND' and reference_id = $1`,
  [refundThreeId],
)
const balanceAfterCreditRefund = await one(
  'select balance_minor::int as balance from credit_profile where customer_id = $1 and branch_id = $2',
  [customer.id, branchId],
)
check(
  '20.1',
  'refunding the credit tender applies and pays no cash',
  refundCredit.status === 'APPLIED' &&
    (await count('refund_tender', "refund_id = $1 and status = 'SETTLED'", [refundThreeId])) === 1,
  { status: refundCredit.status },
)
check(
  '20.2',
  'SQL: one REFUND ledger entry of −30 000 on reference REFUND, and the balance is back to zero',
  creditRefundEntry?.kind === 'REFUND' &&
    creditRefundEntry?.amount === -30_000 &&
    creditRefundEntry?.reason === 'RETURN' &&
    creditRefundEntry?.reference_type === 'REFUND' &&
    balanceAfterCreditRefund?.balance === 0,
  { entry: creditRefundEntry, balance: balanceAfterCreditRefund?.balance },
)

// 21-23: a card sale, the tender cap and the approval boundary ------------------------------
section('legs 21-23 — a per-tender cap and a retrospective approval at exactly 20 000')

// The card payment is already spent on sale B, so sale C uses a fresh card payment.
const cardTwoClientId = key()
const createdCardTwo = await deviceCall(deviceJwt, 'POST', '/api/pos/payments', {
  clientPaymentId: cardTwoClientId,
  shiftId: shiftOne.shiftId,
  method: 'CARD',
  amountMinor: 40_000,
})
const cardTwo = createdCardTwo.body?.payment
await post(adminCookie, '/api/payments/mock/settle', {
  reference: cardTwo.providerReference,
  outcome: 'PAID',
})
await deviceCall(deviceJwt, 'GET', `/api/pos/payments/${cardTwo.id}?refresh=1`)

const saleCFinalId = key()
const saleCFinal = await uploadOne({
  clientTransactionId: saleCFinalId,
  type: 'SALE',
  payload: salePayload({
    receiptNumber: `W13-${tail}-005`,
    quantity: UNIT_QUANTITY,
    tenders: [
      { method: 'CARD', amountMinor: 40_000, paymentId: cardTwo.id },
      { method: 'CASH', amountMinor: 60_000 },
    ],
  }).payload,
})
const saleCTenders = await rows(
  `select id, sequence, method::text as method, amount_minor::int as amount
     from sale_tender where sale_id = $1 order by sequence`,
  [saleCFinalId],
)
const saleCLine = await one('select id from sale_line where sale_id = $1', [saleCFinalId])
check(
  '21.1',
  'a 40.00 card + 60.00 cash sale applies',
  saleCFinal.status === 'APPLIED' &&
    saleCTenders.length === 2 &&
    saleCTenders[0]?.method === 'CARD' &&
    saleCTenders[1]?.method === 'CASH',
  { status: saleCFinal.status, tenders: saleCTenders },
)

const overRefundId = key()
const overRefund = await uploadOne({
  clientTransactionId: overRefundId,
  type: 'REFUND',
  payload: {
    saleId: saleCFinalId,
    number: `RF-${tail}-004`,
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    note: 'Six units, all to the card',
    approval: await managerApproval('CUSTOMER_CHANGED_MIND'),
    lines: [{ saleLineId: saleCLine.id, quantity: 6, restock: 'RESALABLE', damageReason: null }],
    tenders: [{ saleTenderId: saleCTenders[0].id, amountMinor: 60_000 }],
    refundedMinor: 60_000,
    occurredAt: new Date().toISOString(),
  },
})
check(
  '21.2',
  'a 60.00 refund allocated to a 40.00 card tender is REJECTED REFUND_EXCEEDS_TENDER',
  overRefund.status === 'REJECTED' && overRefund.error?.code === 'REFUND_EXCEEDS_TENDER',
  overRefund.error ?? overRefund.status,
)

const thresholdRefundId = key()
const thresholdRefund = await uploadOne({
  clientTransactionId: thresholdRefundId,
  type: 'REFUND',
  payload: {
    saleId: saleCFinalId,
    number: `RF-${tail}-005`,
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'CUSTOMER_CHANGED_MIND',
    note: 'Exactly the approval threshold',
    approval: await managerApproval('CUSTOMER_CHANGED_MIND'),
    lines: [{ saleLineId: saleCLine.id, quantity: 2, restock: 'RESALABLE', damageReason: null }],
    tenders: [{ saleTenderId: saleCTenders[1].id, amountMinor: 20_000 }],
    refundedMinor: 20_000,
    occurredAt: new Date().toISOString(),
  },
})
const refundApprovals = await get(
  adminCookie,
  `/api/approvals?type=REFUND&entityId=${thresholdRefundId}&status=PENDING&limit=5`,
)
const refundApproval = refundApprovals.body?.approvals?.[0] ?? null
check(
  '22.1',
  'a refund of exactly 20 000 raises one PENDING approval with deciderRole ADMIN',
  thresholdRefund.status === 'APPLIED' &&
    refundApprovals.body?.approvals?.length === 1 &&
    refundApproval?.status === 'PENDING' &&
    refundApproval?.deciderRole === 'ADMIN',
  {
    status: thresholdRefund.status,
    approvals: refundApprovals.body?.approvals?.length,
    row: refundApproval,
  },
)

const refundBeforeDecision = await one(
  `select refunded_minor::int as refunded, base_minor::int as base, vat_minor::int as vat,
          tax_total_minor::int as tax, approval_id
     from refund where id = $1`,
  [thresholdRefundId],
)
const decidedRefund = await post(adminCookie, `/api/approvals/${refundApproval.id}/decide`, {
  decision: 'APPROVED',
  note: 'Verified against the receipt',
})
const refundAfterDecision = await one(
  `select refunded_minor::int as refunded, base_minor::int as base, vat_minor::int as vat,
          tax_total_minor::int as tax, approval_id
     from refund where id = $1`,
  [thresholdRefundId],
)
const approvalAfterDecision = await one(
  'select status::text as status, decided_by from approval where id = $1',
  [refundApproval.id],
)
check(
  '23.1',
  'the admin approves it',
  decidedRefund.status === 200 &&
    approvalAfterDecision?.status === 'APPROVED' &&
    Boolean(approvalAfterDecision?.decided_by),
  { status: decidedRefund.status, approval: approvalAfterDecision, body: decidedRefund.body },
)
check(
  '23.2',
  'SQL: the refund’s money columns are identical after the decision',
  JSON.stringify(refundBeforeDecision) === JSON.stringify(refundAfterDecision),
  { before: refundBeforeDecision, after: refundAfterDecision },
)

// 24: a repayment --------------------------------------------------------------------------
section('leg 24 — a cash repayment at the till')

// The customer needs a debt for a repayment to reduce; a second credit sale makes one.
const receiptD = `W13-${tail}-006`
const saleDId = key()
const saleD = await uploadOne({
  clientTransactionId: saleDId,
  type: 'SALE',
  payload: salePayload({
    receiptNumber: receiptD,
    quantity: 6,
    customer: { id: customer.id, phone: customer.phone, name: customer.name },
    tenders: [{ method: 'CREDIT', amountMinor: 60_000 }],
  }).payload,
})
const balanceBeforeRepayment = await one(
  'select balance_minor::int as balance from credit_profile where customer_id = $1 and branch_id = $2',
  [customer.id, branchId],
)
const repaymentNumber = `RP-${tail}-001`
const repayment = await uploadOne({
  clientTransactionId: key(),
  type: 'CREDIT_REPAYMENT',
  payload: {
    customerId: customer.id,
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    amountMinor: 50_000,
    method: 'CASH',
    number: repaymentNumber,
    note: 'Part payment at the counter',
    occurredAt: new Date().toISOString(),
  },
})
const balanceAfterRepayment = await one(
  'select balance_minor::int as balance from credit_profile where customer_id = $1 and branch_id = $2',
  [customer.id, branchId],
)
const repaymentEntry = await one(
  `select kind::text as kind, amount_minor::int as amount, reference_type::text as reference_type,
          reference_number, method::text as method
     from credit_ledger_entry
    where reference_type = 'POS_REPAYMENT' and kind = 'REPAYMENT'
    order by created_at desc limit 1`,
)
check(
  '24.1',
  'a cash repayment of 50 000 applies and the balance drops by exactly 50 000',
  saleD.status === 'APPLIED' &&
    repayment.status === 'APPLIED' &&
    balanceBeforeRepayment?.balance === 60_000 &&
    balanceAfterRepayment?.balance === 10_000 &&
    balanceBeforeRepayment.balance - balanceAfterRepayment.balance === 50_000,
  {
    sale: saleD.status,
    repayment: repayment.status,
    before: balanceBeforeRepayment,
    after: balanceAfterRepayment,
  },
)
check(
  '24.2',
  'SQL: the ledger row is −50 000 with the till’s own reference number',
  repaymentEntry?.kind === 'REPAYMENT' &&
    repaymentEntry?.amount === -50_000 &&
    repaymentEntry?.method === 'CASH' &&
    repaymentEntry?.reference_number === repaymentNumber,
  repaymentEntry,
)

// 25: cart void ----------------------------------------------------------------------------
section('leg 25 — a cart void needs a note when the reason is OTHER')

const voidNoNote = await uploadOne({
  clientTransactionId: key(),
  type: 'CART_VOID',
  payload: {
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'OTHER',
    note: null,
    itemCount: 2,
    grossMinor: 35_000,
    label: 'Counter two',
    lines: [
      { productId: productMain, name: 'Walk pay A', quantity: 1, unitPriceMinor: UNIT_MINOR },
    ],
    occurredAt: new Date().toISOString(),
  },
})
check(
  '25.1',
  'an OTHER void with no note is REJECTED',
  voidNoNote.status === 'REJECTED' && voidNoNote.error?.code === 'CART_VOID_NOTE_REQUIRED',
  voidNoNote.error ?? voidNoNote.status,
)
const voidId = key()
const voidWithNote = await uploadOne({
  clientTransactionId: voidId,
  type: 'CART_VOID',
  payload: {
    shiftId: shiftOne.shiftId,
    cashier: cashierProof,
    reasonCode: 'OTHER',
    note: 'Customer went to fetch a card',
    itemCount: 2,
    grossMinor: 35_000,
    label: 'Counter two',
    lines: [
      { productId: productMain, name: 'Walk pay A', quantity: 1, unitPriceMinor: UNIT_MINOR },
    ],
    occurredAt: new Date().toISOString(),
  },
})
const voidRow = await one(
  'select reason_code::text as reason, note, item_count::int as items, gross_minor::int as gross from cart_void where id = $1',
  [voidId],
)
check(
  '25.2',
  'the same void with a note applies and is stored with its reason',
  voidWithNote.status === 'APPLIED' &&
    voidRow?.reason === 'OTHER' &&
    voidRow?.note === 'Customer went to fetch a card' &&
    voidRow?.gross === 35_000,
  { status: voidWithNote.status, row: voidRow },
)

// 26-27: the close, the Z snapshot and its recomputation -----------------------------------
section('legs 26-27 — the Z snapshot, the X report, and every figure recomputed')

// The drawer's own arithmetic, including the cash refunds that left it: a settled
// CASH refund_tender on a refund belonging to this shift is money the till paid out,
// exactly as a cash-out movement is. The first run of this walkthrough (before the
// fix) omitted that term, which is what leg 27.4 originally reported.
const totalsBeforeClose = await one(
  `select
     (select coalesce(sum(st.amount_minor), 0)::int from sale_tender st join sale s on s.id = st.sale_id
       where s.shift_id = $1 and st.method = 'CASH') as cash_tenders,
     (select coalesce(sum(change_minor), 0)::int from sale where shift_id = $1) as change,
     (select coalesce(sum(rt.amount_minor), 0)::int from refund_tender rt join refund r on r.id = rt.refund_id
       where r.shift_id = $1 and rt.method = 'CASH' and rt.status = 'SETTLED') as cash_refunds`,
  [shiftOne.shiftId],
)
const expectedCash =
  shiftOne.openingFloatMinor +
  totalsBeforeClose.cash_tenders -
  totalsBeforeClose.change -
  totalsBeforeClose.cash_refunds
note(
  `drawer: float ${ghs(shiftOne.openingFloatMinor)} + cash ${ghs(totalsBeforeClose.cash_tenders)} − change ${ghs(totalsBeforeClose.change)} − cash refunds ${ghs(totalsBeforeClose.cash_refunds)} = ${ghs(expectedCash)}`,
)
const closeResult = await uploadOne({
  clientTransactionId: key(),
  type: 'SHIFT_CLOSE',
  payload: {
    shiftId: shiftOne.shiftId,
    countedCashMinor: expectedCash,
    clientExpectedCashMinor: expectedCash,
    closeNote: 'Walkthrough close',
    closedBy: cashierAsCloserProof,
    occurredAt: new Date().toISOString(),
  },
})
const shiftClosedRow = await one(
  `select status::text as status, counted_cash_minor::int as counted,
          server_expected_cash_minor::int as expected, variance_minor::int as variance
     from shift where id = $1`,
  [shiftOne.shiftId],
)
const zSnapshot = await one(
  'select count(*)::int as total, min(created_at) as created_at from shift_report where shift_id = $1',
  [shiftOne.shiftId],
)
check(
  '26.1',
  'closing the shift applies, the shift is CLOSED, and a Z snapshot exists',
  closeResult.status === 'APPLIED' &&
    shiftClosedRow?.status === 'CLOSED' &&
    zSnapshot?.total === 1 &&
    shiftClosedRow?.variance === 0,
  { upload: closeResult.status, shift: shiftClosedRow, snapshots: zSnapshot?.total },
)

const zReport = await deviceCall(
  deviceJwt,
  'GET',
  `/api/pos/shifts/${shiftOne.shiftId}/report?kind=Z`,
)
const xReport = await deviceCall(
  deviceJwt,
  'GET',
  `/api/pos/shifts/${shiftOne.shiftId}/report?kind=X`,
)
const z = zReport.body?.report
const x = xReport.body?.report
const xDiff =
  z && x
    ? Object.entries(z)
        .filter(
          ([field, value]) => field !== 'kind' && field !== 'generatedAt' && x[field] !== value,
        )
        .map(([field, value]) => `${field}: Z=${value} X=${x[field]}`)
    : ['no report']
check(
  '26.2',
  'the X report equals the Z snapshot except its kind and generation time',
  zReport.status === 200 && xReport.status === 200 && xDiff.length === 0,
  xDiff,
)

const recompute = await one(
  `select
     (select count(*)::int from sale where shift_id = $1) as sale_count,
     (select coalesce(sum(sl.quantity), 0)::int from sale_line sl join sale s on s.id = sl.sale_id
       where s.shift_id = $1) as item_count,
     (select coalesce(sum(total_minor), 0)::int from sale where shift_id = $1) as gross,
     (select coalesce(sum(refunded_minor), 0)::int from refund where shift_id = $1) as refunds,
     (select count(*)::int from refund where shift_id = $1) as refund_count,
     (select count(*)::int from cart_void where shift_id = $1) as void_count,
     (select coalesce(sum(line_discount_minor), 0)::int from sale where shift_id = $1) as line_discount,
     (select coalesce(sum(sale_discount_minor), 0)::int from sale where shift_id = $1) as sale_discount,
     (select coalesce(sum(loyalty_discount_minor), 0)::int from sale where shift_id = $1) as loyalty_discount,
     (select coalesce(sum(vat_minor), 0)::int from sale where shift_id = $1) as vat,
     (select coalesce(sum(nhil_minor), 0)::int from sale where shift_id = $1) as nhil,
     (select coalesce(sum(getfund_minor), 0)::int from sale where shift_id = $1) as getfund,
     (select coalesce(sum(tax_total_minor), 0)::int from sale where shift_id = $1) as tax_total,
     (select coalesce(sum(st.amount_minor) filter (where st.method = 'CASH'), 0)::int
        from sale_tender st join sale s on s.id = st.sale_id where s.shift_id = $1) as cash,
     (select coalesce(sum(st.amount_minor) filter (where st.method = 'CREDIT'), 0)::int
        from sale_tender st join sale s on s.id = st.sale_id where s.shift_id = $1) as credit,
     (select coalesce(sum(st.amount_minor) filter (where st.method = 'MOMO'), 0)::int
        from sale_tender st join sale s on s.id = st.sale_id where s.shift_id = $1) as momo,
     (select coalesce(sum(st.amount_minor) filter (where st.method = 'CARD'), 0)::int
        from sale_tender st join sale s on s.id = st.sale_id where s.shift_id = $1) as card,
     (select coalesce(sum(st.amount_minor) filter (where st.method = 'BANK_TRANSFER'), 0)::int
        from sale_tender st join sale s on s.id = st.sale_id where s.shift_id = $1) as bank,
     (select coalesce(sum(change_minor), 0)::int from sale where shift_id = $1) as change,
     (select coalesce(sum(amount_minor), 0)::int from cash_movement where shift_id = $1 and type = 'CASH_IN') as cash_in,
     (select coalesce(sum(amount_minor), 0)::int from cash_movement where shift_id = $1 and type = 'CASH_OUT') as cash_out,
     (select coalesce(sum(rt.amount_minor), 0)::int from refund_tender rt join refund r on r.id = rt.refund_id
       where r.shift_id = $1 and rt.method = 'CASH') as refund_cash`,
  [shiftOne.shiftId],
)
const expectedFromSql =
  shiftOne.openingFloatMinor +
  recompute.cash -
  recompute.change +
  recompute.cash_in -
  recompute.cash_out -
  recompute.refund_cash
const fieldChecks = [
  ['saleCount', recompute.sale_count],
  ['itemCount', recompute.item_count],
  ['grossMinor', recompute.gross],
  ['refundMinor', recompute.refunds],
  ['refundCount', recompute.refund_count],
  ['voidCount', recompute.void_count],
  ['netMinor', recompute.gross - recompute.refunds],
  ['lineDiscountMinor', recompute.line_discount],
  ['saleDiscountMinor', recompute.sale_discount],
  ['loyaltyDiscountMinor', recompute.loyalty_discount],
  ['baseMinor', z?.baseMinor],
  ['vatMinor', recompute.vat],
  ['nhilMinor', recompute.nhil],
  ['getfundMinor', recompute.getfund],
  ['taxTotalMinor', recompute.tax_total],
  ['cashMinor', recompute.cash],
  ['creditMinor', recompute.credit],
  ['momoMinor', recompute.momo],
  ['cardMinor', recompute.card],
  ['bankTransferMinor', recompute.bank],
  ['changeMinor', recompute.change],
  ['cashInMinor', recompute.cash_in],
  ['cashOutMinor', recompute.cash_out],
  ['expectedCashMinor', expectedFromSql],
]
const fieldProblems = fieldChecks
  .filter(([field, value]) => z?.[field] !== value)
  .map(([field, value]) => `${field}: report=${z?.[field]} sql=${value}`)
check(
  '27.1',
  'every Z figure equals a recomputation from sale, sale_tender, refund, cart_void and cash_movement',
  fieldProblems.length === 0,
  fieldProblems,
)
check(
  '27.2',
  'SQL: gross − refunds = net, and the tax components add to the tax total',
  z?.netMinor === z?.grossMinor - z?.refundMinor &&
    z?.taxTotalMinor === z?.vatMinor + z?.nhilMinor + z?.getfundMinor,
  { net: z?.netMinor, gross: z?.grossMinor, refunds: z?.refundMinor, tax: z?.taxTotalMinor },
)
check(
  '27.3',
  'SQL: Σ tenders over every sale of the shift equals the sale totals (no tender lost)',
  recompute.cash + recompute.credit + recompute.momo + recompute.card + recompute.bank ===
    recompute.gross + recompute.change,
  {
    tenders: recompute.cash + recompute.credit + recompute.momo + recompute.card + recompute.bank,
    gross: recompute.gross,
    change: recompute.change,
  },
)

// The drawer truth, computed independently of the report: what the drawer holds after
// every cash fact of the shift, including the refunds that left it. This is the check
// that failed as a FINDING on 2026-10-27 before the refund term was added to
// selectShiftCashTotals and computeExpectedCash; it is a regression guard now.
const drawerTruth =
  recompute.cash - recompute.change + shiftOne.openingFloatMinor - recompute.refund_cash
check(
  '27.4',
  'the expected cash equals what the drawer holds after cash refunds (and the refund term is exercised)',
  drawerTruth === z?.expectedCashMinor &&
    z?.expectedCashMinor === z?.countedCashMinor &&
    recompute.refund_cash > 0,
  {
    report: z?.expectedCashMinor,
    drawer: drawerTruth,
    counted: z?.countedCashMinor,
    cashRefunds: recompute.refund_cash,
  },
)

// 28: a missing snapshot is a 500, not a recomputation --------------------------------------
section('leg 28 — a Z-report whose snapshot is gone')

await db.query('delete from shift_report where shift_id = $1', [shiftOne.shiftId])
const missingZ = await deviceCall(
  deviceJwt,
  'GET',
  `/api/pos/shifts/${shiftOne.shiftId}/report?kind=Z`,
)
check(
  '28.1',
  'deleting the snapshot makes the Z-report a 500 SHIFT_REPORT_MISSING, not a recomputation',
  missingZ.status === 500 && missingZ.body?.error?.code === 'SHIFT_REPORT_MISSING',
  { status: missingZ.status, body: missingZ.body },
)

// 29: a manager closes another cashier's drawer ---------------------------------------------
section('leg 29 — a manager closes someone else’s drawer')

const shiftTwo = { shiftId: key(), number: `W13-${tail}-B`, openingFloatMinor: 20_000 }
const shiftTwoOpen = await uploadOne({
  clientTransactionId: key(),
  type: 'SHIFT_OPEN',
  payload: {
    shiftId: shiftTwo.shiftId,
    number: shiftTwo.number,
    openingFloatMinor: shiftTwo.openingFloatMinor,
    cashierUserId: cashier.userId,
    cashierStaffId: cashier.staffId,
    occurredAt: new Date().toISOString(),
  },
})
const shiftTwoClose = await uploadOne({
  clientTransactionId: key(),
  type: 'SHIFT_CLOSE',
  payload: {
    shiftId: shiftTwo.shiftId,
    countedCashMinor: shiftTwo.openingFloatMinor + 5_000,
    clientExpectedCashMinor: shiftTwo.openingFloatMinor,
    closeNote: 'Counted by the manager, five cedis over',
    closedBy: managerProof,
    occurredAt: new Date().toISOString(),
  },
})
const shiftTwoRow = await one(
  `select status::text as status, closed_by, review_status::text as review,
          variance_minor::int as variance
     from shift where id = $1`,
  [shiftTwo.shiftId],
)
const shiftTwoApproval = await one(
  `select id, requested_by, status::text as status, decider_role::text as decider_role,
          payload->>'closed_by' as payload_closed_by
     from approval where type = 'SHIFT_VARIANCE_REVIEW' and entity_id = $1`,
  [shiftTwo.shiftId],
)
check(
  '29.1',
  'a manager close with a 5 000 variance over tolerance is recorded against the manager',
  shiftTwoOpen.status === 'APPLIED' &&
    shiftTwoClose.status === 'APPLIED' &&
    shiftTwoRow?.closed_by === manager.staffId &&
    shiftTwoApproval?.requested_by === manager.staffId &&
    shiftTwoApproval?.payload_closed_by === manager.staffId,
  { close: shiftTwoClose.status, shift: shiftTwoRow, approval: shiftTwoApproval },
)
const selfDecision = await post(manager.cookie, `/api/approvals/${shiftTwoApproval.id}/decide`, {
  decision: 'APPROVED',
  note: 'My own close',
})
check(
  '29.2',
  'the manager cannot decide the review they raised (403)',
  selfDecision.status === 403,
  { status: selfDecision.status, body: selfDecision.body },
)
const adminDecision = await post(adminCookie, `/api/approvals/${shiftTwoApproval.id}/decide`, {
  decision: 'APPROVED',
  note: 'Counted a second time',
})
const shiftTwoAfter = await one(
  'select status::text as status, decided_by from approval where id = $1',
  [shiftTwoApproval.id],
)
check(
  '29.3',
  'the admin can, and the review is APPROVED with a reviewer',
  adminDecision.status === 200 &&
    shiftTwoAfter?.status === 'APPROVED' &&
    Boolean(shiftTwoAfter?.decided_by),
  { status: adminDecision.status, approval: shiftTwoAfter, body: adminDecision.body },
)

// ------------------------------------------------------------------ cleanup

section('cleanup (rows this run created, foreign-key order)')

const cleanup = [
  [
    'refund_tender',
    `delete from refund_tender where refund_id in (select id from refund where branch_id = $1)`,
    [branchId],
  ],
  [
    'refund_line',
    `delete from refund_line where refund_id in (select id from refund where branch_id = $1)`,
    [branchId],
  ],
  ['refund', 'delete from refund where branch_id = $1', [branchId]],
  ['cart_void', 'delete from cart_void where branch_id = $1', [branchId]],
  ['shift_report', 'delete from shift_report where branch_id = $1', [branchId]],
  [
    'payment_event',
    `delete from payment_event where provider_reference in
       (select provider_reference from payment where branch_id = $1)
       or provider_reference in (select provider_refund_reference from refund_tender
                                  where refund_id in (select id from refund where branch_id = $1))`,
    [branchId],
  ],
  [
    'sale_tender',
    'delete from sale_tender where sale_id in (select id from sale where branch_id = $1)',
    [branchId],
  ],
  [
    'sale_line',
    'delete from sale_line where sale_id in (select id from sale where branch_id = $1)',
    [branchId],
  ],
  ['sale', 'delete from sale where branch_id = $1', [branchId]],
  ['payment', 'delete from payment where branch_id = $1', [branchId]],
  ['cash_movement', 'delete from cash_movement where branch_id = $1', [branchId]],
  ['shift', 'delete from shift where branch_id = $1', [branchId]],
  ['sync_conflict', 'delete from sync_conflict where branch_id = $1', [branchId]],
  [
    'pos_sync_transaction',
    'delete from pos_sync_transaction where terminal_id in (select id from terminal where branch_id = $1)',
    [branchId],
  ],
  ['pos_staff_binding', 'delete from pos_staff_binding where branch_id = $1', [branchId]],
  [
    'device',
    'delete from device where terminal_id in (select id from terminal where branch_id = $1)',
    [branchId],
  ],
  ['terminal', 'delete from terminal where branch_id = $1', [branchId]],
  [
    'stock_receipt_line',
    'delete from stock_receipt_line where receipt_id in (select id from stock_receipt where branch_id = $1)',
    [branchId],
  ],
  ['stock_receipt', 'delete from stock_receipt where branch_id = $1', [branchId]],
  ['stock_movement', 'delete from stock_movement where branch_id = $1', [branchId]],
  ['stock_level', 'delete from stock_level where branch_id = $1', [branchId]],
  ['product_price', 'delete from product_price where branch_id = $1', [branchId]],
  ['credit_ledger_entry', 'delete from credit_ledger_entry where branch_id = $1', [branchId]],
  ['credit_profile', 'delete from credit_profile where branch_id = $1', [branchId]],
  [
    'loyalty_lot_consumption',
    `delete from loyalty_lot_consumption where lot_id in (select l.id from loyalty_lot l
       join loyalty_account a on a.id = l.account_id where a.customer_id = $1)`,
    [customer.id],
  ],
  [
    'loyalty_lot',
    `delete from loyalty_lot where account_id in (select id from loyalty_account where customer_id = $1)`,
    [customer.id],
  ],
  [
    'loyalty_ledger_entry',
    'delete from loyalty_ledger_entry where customer_id = $1',
    [customer.id],
  ],
  ['loyalty_account', 'delete from loyalty_account where customer_id = $1', [customer.id]],
  ['customer', 'delete from customer where id = $1', [customer.id]],
  ['document_sequence', 'delete from document_sequence where branch_id = $1', [branchId]],
  ['approval', 'delete from approval where branch_id = $1 or decider_branch_id = $1', [branchId]],
  ['product', 'delete from product where id = any($1::uuid[])', [[productMain, productSecond]]],
  ['supplier', 'delete from supplier where id = $1', [supplierId]],
  ['uom', 'delete from uom where id = $1', [uomId]],
  ['category', 'delete from category where id = $1', [categoryId]],
  [
    'staff user',
    'delete from "user" where id = any($1::text[])',
    [[cashier.userId, manager.userId]],
  ],
  ['branch', 'delete from branch where id = $1', [branchId]],
]
const cleanupProblems = []
for (const [label, statement, values] of cleanup) {
  try {
    await db.query(statement, values)
  } catch (error) {
    cleanupProblems.push(`${label}: ${error.message}`)
  }
}
const residual = await count('branch', 'id = $1', [branchId])
console.log(
  `CLEANUP  branch removed ${residual === 0 ? 1 : 0}/1${cleanupProblems.length > 0 ? ` — problems: ${cleanupProblems.join(' | ')}` : ''}`,
)
if (residual !== 0) failures.push('cleanup left the walkthrough branch behind')

await db.end()

// ------------------------------------------------------------------- result

const fullyDriven = [...drivenLegs].filter((leg) => !skippedLegs.has(leg)).length
console.log(
  `\nPASS ${passed}  FAIL ${failures.length}  NOT-DRIVEN ${notDriven}  (legs with a driven check ${drivenLegs.size}/29, fully driven ${fullyDriven}/29)`,
)
if (failures.length > 0) {
  console.log(failures.map((failure) => `  failed: ${failure}`).join('\n'))
  process.exit(1)
}
