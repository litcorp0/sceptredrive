#!/usr/bin/env bun
/**
 * Phase 12 Plan 13 — the branch-operations walkthrough.
 *
 *   bun .planning/phases/12-branch-ops-approvals/evidence/walkthrough-branch-ops.mjs
 *
 * Runs against the real API on :4000 with the dev database seeded. Every fixture (branches,
 * products, stock, staff, terminal, customers) is created **through the API** with a unique
 * suffix, so a second run neither borrows nor collides with the demo seed or a previous run.
 *
 * Three things are intentionally not plain HTTP:
 *
 *   1. **Read-only SQL** re-derives the three figures the plan requires: the approved write-off
 *      value (header, lines, ledger and approval), the transfer source level after dispatch, and
 *      the accuracy basis points. No fixture is ever inserted with SQL.
 *   2. **Legs 24–26** have no HTTP trigger by design — the nightly pg-boss jobs own them
 *      (P12-D34) — so the script enqueues the real job through pg-boss, the same queue the API
 *      worker consumes, and waits for the worker to finish. The counts themselves are created by
 *      the product's own worker code.
 *   3. **Teardown** deletes the rows this run created, in foreign-key order (approvals before
 *      branches, because `approval.branch_id` is RESTRICT), and reports what it removed.
 *
 * Shift open/close is not a REST endpoint: it is driven the way a terminal drives it, through
 * `POST /api/pos/sync/upload` with a device JWT minted by redeeming a real enrollment code.
 *
 * Prints `PASS n` / `FAIL n` / `NOT-DRIVEN n`, exits non-zero on any failure, and is committed
 * as `walkthrough-branch-ops.txt`.
 */
import { execFileSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { Client } from 'pg'
import { PgBoss } from 'pg-boss'

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
const created = {
  branches: [],
  products: [],
  customers: [],
  staff: [],
  approvals: [],
}

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
const del = (cookie, urlPath) => call(cookie, 'DELETE', urlPath)

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

function key() {
  return crypto.randomUUID()
}

// ------------------------------------------------------------------- sql

const db = new Client({ connectionString: databaseUrl })
await db.connect()

async function rows(text, params = []) {
  return (await db.query(text, params)).rows
}

async function one(text, params = []) {
  return (await rows(text, params))[0] ?? null
}

async function level(branchId, productId) {
  const row = await one(
    `select quantity_on_hand::int as qty, avg_cost_minor::int as cost
       from stock_level where branch_id = $1 and product_id = $2`,
    [branchId, productId],
  )
  return { qty: row?.qty ?? null, cost: row?.cost ?? null }
}

async function movementSum(branchId, productId) {
  const row = await one(
    `select coalesce(sum(quantity_delta), 0)::int as total
       from stock_movement where branch_id = $1 and product_id = $2`,
    [branchId, productId],
  )
  return row?.total ?? 0
}

async function approvalRow(approvalId) {
  return one(
    `select id, type, entity_id, branch_id, status, requested_by, decider_role,
            decider_branch_id, amount_minor, decided_by, decision_reason_code, decision_note
       from approval where id = $1`,
    [approvalId],
  )
}

async function approvalCount(where, params) {
  const row = await one(`select count(*)::int as total from approval where ${where}`, params)
  return row?.total ?? 0
}

async function auditRows(where, params) {
  return rows(`select * from audit_log where ${where} order by created_at`, params)
}

/**
 * Enqueues one of the nightly inventory jobs through the real queue. There is no
 * HTTP trigger by design (P12-D34: the nightly worker owns it), so the walkthrough
 * enqueues the same job the API worker consumes and waits for it to finish.
 */
const boss = new PgBoss({ connectionString: databaseUrl, instanceName: 'walkthrough-branch-ops' })
await boss.start()

async function runJob(queue) {
  const jobId = await boss.send(queue, {})
  if (!jobId) throw new Error(`could not enqueue ${queue}`)
  const deadline = Date.now() + 60_000
  for (;;) {
    const row = await one('select state from pgboss.job where id = $1', [jobId])
    if (!row) return 'deleted'
    if (['completed', 'failed', 'cancelled'].includes(row.state)) return row.state
    if (Date.now() > deadline) throw new Error(`job ${queue} did not finish within 60s`)
    await new Promise((resolve) => setTimeout(resolve, 250))
  }
}

// -------------------------------------------------------------- fixtures

const adminCookie = await signIn(adminEmail, adminPassword)

async function createStaff(admin, { name, role, branchId, password }) {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
  const email = `walk12-${slug}-${suffix}@sceptre.test`
  const createdStaff = await post(admin, '/api/staff', { email, name, role, branchId })
  if (createdStaff.status !== 201) {
    throw new Error(
      `staff create failed (${createdStaff.status}): ${JSON.stringify(createdStaff.body)}`,
    )
  }
  const temporaryPassword = createdStaff.body.temporaryPassword
  let session = await signIn(email, temporaryPassword)
  const changed = await post(session, '/api/me/password', {
    currentPassword: temporaryPassword,
    newPassword: password,
  })
  if (changed.status !== 200 && changed.status !== 204) {
    throw new Error(`password change failed (${changed.status}): ${JSON.stringify(changed.body)}`)
  }
  session = await signIn(email, password)
  const staff = createdStaff.body.staff
  created.staff.push(staff.id)
  return { email, cookie: session, userId: staff.id, staffId: staff.staffId }
}

section('fixtures (created through the API)')

const branchResponses = []
for (const spec of [
  { code: `WA-${tail.slice(0, 4)}`, name: `Walk source ${suffix}`, type: 'RETAIL', city: 'Accra' },
  {
    code: `WB-${tail.slice(0, 4)}`,
    name: `Walk destination ${suffix}`,
    type: 'RETAIL',
    city: 'Accra',
  },
  {
    code: `WC-${tail.slice(0, 4)}`,
    name: `Walk store ${suffix}`,
    type: 'WAREHOUSE',
    city: 'Accra',
  },
  {
    code: `WD-${tail.slice(0, 4)}`,
    name: `Walk foreign ${suffix}`,
    type: 'RETAIL',
    city: 'Kumasi',
  },
]) {
  branchResponses.push(await post(adminCookie, '/api/branches', spec))
}
const branchIds = branchResponses.map((response) => response.body?.branch?.id)
if (branchIds.some((id) => !id)) {
  console.error('could not create branches', JSON.stringify(branchResponses.map((r) => r.body)))
  process.exit(1)
}
const [srcId, dstId, whId, foreignId] = branchIds
created.branches = branchIds
note(
  `branches: src=${branchIds[0].slice(0, 8)} dst=${branchIds[1].slice(0, 8)} wh=${branchIds[2].slice(0, 8)} foreign=${branchIds[3].slice(0, 8)}`,
)

const categoryMain = (await post(adminCookie, '/api/categories', { name: `Walk main ${suffix}` }))
  .body?.category?.id
const categoryCount = (await post(adminCookie, '/api/categories', { name: `Walk count ${suffix}` }))
  .body?.category?.id
const uomId = (
  await post(adminCookie, '/api/uoms', { code: `U${tail}`, name: `Walk unit ${suffix}` })
).body?.uom?.id
const supplierId = (
  await post(adminCookie, '/api/suppliers', {
    name: `Walk supplier ${suffix}`,
    paymentTermDays: 30,
  })
).body?.supplier?.id
if (!categoryMain || !categoryCount || !uomId || !supplierId) {
  console.error('could not create catalogue foundations')
  process.exit(1)
}

const productIds = []
for (let index = 1; index <= 12; index += 1) {
  const createdProduct = await post(adminCookie, '/api/products', {
    sku: `W12${String(index).padStart(2, '0')}${tail}`,
    name: `Walk product ${index} ${suffix}`,
    categoryId: index >= 10 ? categoryCount : categoryMain,
    uomId,
    basePriceMinor: 100_000,
  })
  const id = createdProduct.body?.product?.id
  if (!id) {
    console.error('could not create product', index, createdProduct.body)
    process.exit(1)
  }
  productIds.push(id)
}
created.products = productIds
const [p1, p2, p3, p4, p5, p6, p7, p8, p9, p10, p11, p12] = productIds

async function receive(branchId, productId, quantity, unitCostMinor) {
  const response = await post(adminCookie, '/api/inventory/receipts', {
    branchId,
    supplierId,
    lines: [{ productId, quantity, unitCostMinor }],
  })
  if (response.status !== 201) {
    throw new Error(`receipt failed (${response.status}): ${JSON.stringify(response.body)}`)
  }
}

for (const [productId, quantity] of [
  [p1, 20],
  [p2, 20],
  [p3, 20],
  [p4, 10],
  [p5, 2],
  [p6, 5],
  [p7, 8],
  [p8, 2],
  [p9, 2],
  [p10, 10],
]) {
  await receive(srcId, productId, quantity, 50_000)
}
await receive(whId, p1, 10, 50_000)

const managerSrc = await createStaff(adminCookie, {
  name: `Walk manager src ${suffix}`,
  role: 'MANAGER',
  branchId: srcId,
  password: `walk12-src-${suffix}`,
})
const managerSrc2 = await createStaff(adminCookie, {
  name: `Walk manager src two ${suffix}`,
  role: 'MANAGER',
  branchId: srcId,
  password: `walk12-src2-${suffix}`,
})
const managerDst = await createStaff(adminCookie, {
  name: `Walk manager dst ${suffix}`,
  role: 'MANAGER',
  branchId: dstId,
  password: `walk12-dst-${suffix}`,
})
const managerForeign = await createStaff(adminCookie, {
  name: `Walk manager foreign ${suffix}`,
  role: 'MANAGER',
  branchId: foreignId,
  password: `walk12-foreign-${suffix}`,
})
const cashier = await createStaff(adminCookie, {
  name: `Walk cashier ${suffix}`,
  role: 'CASHIER',
  branchId: srcId,
  password: `walk12-cashier-${suffix}`,
})

const customerPhoneBase = String(Date.now()).slice(-7)
const customerOneResponse = await post(adminCookie, '/api/customers', {
  name: `Walk credit one ${suffix}`,
  phone: `024${customerPhoneBase}`,
  branchId: srcId,
})
const customerTwoResponse = await post(adminCookie, '/api/customers', {
  name: `Walk credit two ${suffix}`,
  phone: `020${customerPhoneBase}`,
  branchId: srcId,
})
const customerOne = customerOneResponse.body?.customer
const customerTwo = customerTwoResponse.body?.customer
if (!customerOne?.id || !customerTwo?.id) {
  console.error(
    'could not create customers',
    customerOneResponse.status,
    JSON.stringify(customerOneResponse.body),
    customerTwoResponse.status,
    JSON.stringify(customerTwoResponse.body),
  )
  process.exit(1)
}
created.customers = [customerOne.id, customerTwo.id]

// A real terminal: enrolment code -> device token -> device JWT. Shift open/close and sales
// only exist on the device surface, so the walkthrough becomes a terminal.
const terminal = (
  await post(adminCookie, '/api/terminals', { branchId: srcId, name: `Walk till ${suffix}` })
).body?.terminal
const enrollment = (await post(adminCookie, `/api/terminals/${terminal.id}/enrollment`)).body
  ?.enrollment
const redeemed = await post(adminCookie, '/api/enrollments/redeem', {
  code: enrollment.code,
  fingerprint: `walkthrough-${suffix}`,
})
const deviceToken = redeemed.body?.deviceToken
const deviceSession = await fetch(`${apiUrl}/api/pos/session`, {
  method: 'POST',
  headers: { authorization: `Bearer ${deviceToken}`, origin },
})
const device = await deviceSession.json()
const deviceJwt = device.accessToken
if (!deviceJwt) {
  console.error('could not mint a device session', device)
  process.exit(1)
}
note(`terminal ${device.terminal.code} enrolled; device JWT minted`)

// The cashier's PIN is set by an admin, then the terminal authorises it, exactly like a
// morning shift start. A sale without a live binding is flagged STALE_CREDENTIALS; this
// walkthrough wants the honest path.
const cashierPin = `${(Number.parseInt(tail.slice(-3), 36) % 89) + 10}${(Number.parseInt(tail.slice(0, 2), 36) % 89) + 10}`
await post(adminCookie, `/api/staff/${cashier.userId}/pin`, { pin: cashierPin })
const binding = await deviceCall(deviceJwt, 'POST', '/api/pos/staff/authorize', {
  email: cashier.email,
  pin: cashierPin,
})
if (binding.status !== 201) {
  console.error('could not authorise the cashier on the terminal', binding.status, binding.body)
  process.exit(1)
}

async function setLimit(cookie, customerId, limitMinor) {
  return put(cookie, `/api/credit/profiles/${customerId}`, { branchId: srcId, limitMinor })
}

async function decide(cookie, approvalId, body) {
  return post(cookie, `/api/approvals/${approvalId}/decide`, body)
}

async function findApproval(entityId, type) {
  const response = await get(
    adminCookie,
    `/api/approvals?type=${type}&entityId=${entityId}&sort=newest&limit=5`,
  )
  return response.body?.approvals?.[0] ?? null
}

async function transferRequest(cookie, { fromBranchId, toBranchId, productId, quantity, note }) {
  return post(cookie, '/api/transfers', {
    fromBranchId,
    toBranchId,
    ...(note ? { note } : {}),
    lines: [{ productId, quantityRequested: quantity }],
  })
}

// ---------------------------------------------------------------------- legs

section('1: sessions and branch scope')

const adminBranches = await get(adminCookie, '/api/branches')
const adminBranchIds = (adminBranches.body?.branches ?? []).map((row) => row.id)
check(
  '1.1',
  'the admin session reads every branch, including the four walk branches',
  adminBranches.status === 200 && branchIds.every((id) => adminBranchIds.includes(id)),
  `${adminBranches.status} ${adminBranchIds.length} branches`,
)

const managerBranches = await get(managerSrc.cookie, '/api/branches')
const managerScoped = (managerBranches.body?.branches ?? []).map((row) => row.id)
check(
  '1.2',
  'the manager session is scoped to their own branch on /api/branches',
  managerBranches.status === 200 && managerScoped.length === 1 && managerScoped[0] === srcId,
  JSON.stringify(managerScoped),
)

const directory = await get(managerSrc.cookie, '/api/branches/directory')
const directoryIds = (directory.body?.branches ?? []).map((row) => row.id)
check(
  '1.3',
  'the manager can name a transfer source through /api/branches/directory',
  directory.status === 200 &&
    directoryIds.includes(srcId) &&
    directoryIds.includes(whId) &&
    directoryIds.includes(dstId),
  `${directory.status} ${directoryIds.length} entries`,
)

section('2: a manager raises a branch-to-branch transfer request')

const srcP1Before = await level(srcId, p1)
const requestedAmount = 2 * srcP1Before.cost
const transferOne = await transferRequest(managerDst.cookie, {
  fromBranchId: srcId,
  toBranchId: dstId,
  productId: p1,
  quantity: 2,
  note: `Walk transfer ${suffix}`,
})
const transferOneId = transferOne.body?.transfer?.id
check(
  '2.1',
  'the request is REQUESTED with a PENDING approval',
  transferOne.status === 201 &&
    transferOne.body?.transfer?.status === 'REQUESTED' &&
    transferOne.body?.transfer?.approval?.status === 'PENDING',
  `${transferOne.status} ${JSON.stringify(transferOne.body?.transfer?.status)} ${JSON.stringify(
    transferOne.body?.transfer?.approval?.status,
  )}`,
)

const transferOneApproval = await findApproval(transferOneId, 'TRANSFER_REQUEST')
if (transferOneApproval) created.approvals.push(transferOneApproval.id)
check(
  '2.2',
  'the source manager is the decider (deciderRole MANAGER, deciderBranchId = source)',
  transferOneApproval?.deciderRole === 'MANAGER' && transferOneApproval?.deciderBranchId === srcId,
  `${transferOneApproval?.deciderRole} ${transferOneApproval?.deciderBranchId}`,
)

check(
  '2.3',
  'the amount is hand-computed quantity x average cost, re-read from SQL',
  transferOneApproval?.amountMinor === requestedAmount,
  `expected ${requestedAmount}, got ${transferOneApproval?.amountMinor} (avg cost ${srcP1Before.cost})`,
)

section('3: dispatch before approval is refused and moves nothing')

const earlyDispatch = await post(managerSrc.cookie, `/api/transfers/${transferOneId}/dispatch`, {
  lines: [{ productId: p1, quantityDispatched: 2 }],
})
const srcP1AfterEarly = await level(srcId, p1)
check(
  '3.1',
  'dispatching a REQUESTED transfer is a 409',
  earlyDispatch.status === 409,
  earlyDispatch.status,
)
check(
  '3.2',
  'the source level did not move on the refusal (SQL)',
  srcP1AfterEarly.qty === srcP1Before.qty,
  `${srcP1Before.qty} -> ${srcP1AfterEarly.qty}`,
)

section('4: the source manager approves, dispatches, and the destination receives')

const approveOne = await decide(managerSrc.cookie, transferOneApproval.id, {
  decision: 'APPROVED',
  note: 'Stock is on the shelf',
})
check(
  '4.1',
  'the source manager approves the request',
  approveOne.status === 200 && approveOne.body?.approval?.status === 'APPROVED',
  `${approveOne.status} ${approveOne.body?.approval?.status}`,
)

const dispatched = await post(managerSrc.cookie, `/api/transfers/${transferOneId}/dispatch`, {
  lines: [{ productId: p1, quantityDispatched: 2 }],
})
const srcP1AfterDispatch = await level(srcId, p1)
const dispatchDetail = dispatched.body?.transfer
check(
  '4.2',
  'dispatch moves the transfer to DISPATCHED',
  dispatched.status === 200 && dispatchDetail?.status === 'DISPATCHED',
  `${dispatched.status} ${dispatchDetail?.status}`,
)
check(
  '4.3',
  'the source level after dispatch is re-derived from SQL and equals the API figure',
  srcP1AfterDispatch.qty === srcP1Before.qty - 2 &&
    dispatchDetail?.lines?.[0]?.fromOnHand === srcP1AfterDispatch.qty,
  `SQL ${srcP1Before.qty} - 2 = ${srcP1AfterDispatch.qty}; API fromOnHand ${dispatchDetail?.lines?.[0]?.fromOnHand}`,
)
note(
  `transfer source level after dispatch: SQL ${srcP1Before.qty} - 2 = ${srcP1AfterDispatch.qty}; API fromOnHand ${dispatchDetail?.lines?.[0]?.fromOnHand}`,
)

const received = await post(managerDst.cookie, `/api/transfers/${transferOneId}/receive`, {
  lines: [{ productId: p1, quantityReceived: 2 }],
})
check(
  '4.4',
  'the destination manager receives it and the transfer is RECEIVED',
  received.status === 200 && received.body?.transfer?.status === 'RECEIVED',
  `${received.status} ${received.body?.transfer?.status}`,
)

const srcP1Ledger = await movementSum(srcId, p1)
const dstP1Ledger = await movementSum(dstId, p1)
const srcP1Level = await level(srcId, p1)
const dstP1Level = await level(dstId, p1)
check(
  '4.5',
  'the ledger equals on hand on both sides of the transfer (SQL)',
  srcP1Ledger === srcP1Level.qty && dstP1Ledger === dstP1Level.qty,
  `src ${srcP1Ledger}/${srcP1Level.qty} dst ${dstP1Ledger}/${dstP1Level.qty}`,
)

section('5: the source manager rejects a request; nothing moves')

const transferTwo = await transferRequest(managerDst.cookie, {
  fromBranchId: srcId,
  toBranchId: dstId,
  productId: p2,
  quantity: 1,
})
const transferTwoId = transferTwo.body?.transfer?.id
const transferTwoApproval = await findApproval(transferTwoId, 'TRANSFER_REQUEST')
if (transferTwoApproval) created.approvals.push(transferTwoApproval.id)
const rejectTwo = await decide(managerSrc.cookie, transferTwoApproval.id, {
  decision: 'REJECTED',
  reasonCode: 'OUT_OF_POLICY',
  note: 'Not this week',
})
const transferTwoMovements = await one(
  `select count(*)::int as total from stock_movement where reference_type = 'TRANSFER' and reference_id = $1`,
  [transferTwoId],
)
check(
  '5.1',
  'the rejection is REJECTED on the transfer and the approval',
  rejectTwo.status === 200 &&
    rejectTwo.body?.approval?.status === 'REJECTED' &&
    (await get(managerDst.cookie, `/api/transfers/${transferTwoId}`)).body?.transfer?.status ===
      'REJECTED',
  `${rejectTwo.status} ${rejectTwo.body?.approval?.status}`,
)
check(
  '5.2',
  'a rejected transfer has zero movements (SQL)',
  transferTwoMovements.total === 0,
  transferTwoMovements.total,
)

section('6: the requester withdraws a pending request')

const transferThree = await transferRequest(managerDst.cookie, {
  fromBranchId: srcId,
  toBranchId: dstId,
  productId: p3,
  quantity: 1,
})
const transferThreeId = transferThree.body?.transfer?.id
const transferThreeApproval = await findApproval(transferThreeId, 'TRANSFER_REQUEST')
if (transferThreeApproval) created.approvals.push(transferThreeApproval.id)
const withdrawn = await post(managerDst.cookie, `/api/transfers/${transferThreeId}/cancel`)
const withdrawnApproval = await approvalRow(transferThreeApproval.id)
check(
  '6.1',
  'the requester can cancel their own pending request',
  withdrawn.status === 200 &&
    (await get(managerDst.cookie, `/api/transfers/${transferThreeId}`)).body?.transfer?.status ===
      'CANCELLED',
  `${withdrawn.status}`,
)
check(
  '6.2',
  'the approval is WITHDRAWN, never deleted',
  withdrawnApproval?.status === 'WITHDRAWN',
  withdrawnApproval?.status,
)

section('7: a warehouse source is an admin decision')

const transferWh = await transferRequest(managerDst.cookie, {
  fromBranchId: whId,
  toBranchId: dstId,
  productId: p1,
  quantity: 2,
})
const transferWhId = transferWh.body?.transfer?.id
const transferWhApproval = await findApproval(transferWhId, 'TRANSFER_REQUEST')
if (transferWhApproval) created.approvals.push(transferWhApproval.id)
check(
  '7.1',
  'a warehouse source names an ADMIN decider with no branch binding',
  transferWhApproval?.deciderRole === 'ADMIN' && transferWhApproval?.deciderBranchId === null,
  `${transferWhApproval?.deciderRole} ${transferWhApproval?.deciderBranchId}`,
)
const managerOnWarehouse = await decide(managerSrc.cookie, transferWhApproval.id, {
  decision: 'APPROVED',
})
check(
  '7.2',
  'a manager cannot decide an ADMIN-authority row, even at the source',
  managerOnWarehouse.status === 403,
  managerOnWarehouse.status,
)
const adminOnWarehouse = await decide(adminCookie, transferWhApproval.id, {
  decision: 'APPROVED',
  note: 'Warehouse release agreed',
})
check(
  '7.3',
  'the admin decides it',
  adminOnWarehouse.status === 200 && adminOnWarehouse.body?.approval?.status === 'APPROVED',
  `${adminOnWarehouse.status} ${adminOnWarehouse.body?.approval?.status}`,
)
await post(adminCookie, `/api/transfers/${transferWhId}/dispatch`, {
  lines: [{ productId: p1, quantityDispatched: 2 }],
})
const whReceived = await post(managerDst.cookie, `/api/transfers/${transferWhId}/receive`, {
  lines: [{ productId: p1, quantityReceived: 2 }],
})
check(
  '7.4',
  'the warehouse transfer completes end to end',
  whReceived.status === 200 && whReceived.body?.transfer?.status === 'RECEIVED',
  `${whReceived.status} ${whReceived.body?.transfer?.status}`,
)

section('8: a write-off is valued at request time and posted when approved')

const p4Before = await level(srcId, p4)
const writeOffValue = 3 * p4Before.cost
const writeOffOne = await post(managerSrc.cookie, '/api/write-offs', {
  lines: [{ productId: p4, quantity: 3, reason: 'DAMAGE', note: 'Pallet dropped' }],
})
const writeOffOneId = writeOffOne.body?.writeOff?.id
const writeOffOneApproval = writeOffOne.body?.approval?.id
if (writeOffOneApproval) created.approvals.push(writeOffOneApproval)
check(
  '8.1',
  'the write-off is PENDING_APPROVAL and valued at quantity x average cost',
  writeOffOne.status === 201 &&
    writeOffOne.body?.writeOff?.status === 'PENDING_APPROVAL' &&
    writeOffOne.body?.writeOff?.valueMinor === writeOffValue,
  `${writeOffOne.status} ${writeOffOne.body?.writeOff?.status} value ${writeOffOne.body?.writeOff?.valueMinor} vs ${writeOffValue}`,
)

const approveWriteOff = await decide(adminCookie, writeOffOneApproval, {
  decision: 'APPROVED',
  note: 'Confirmed on the shelf',
})
check(
  '8.2',
  'approval posts the write-off (APPROVED with postedAt)',
  approveWriteOff.status === 200 &&
    approveWriteOff.body?.approval?.status === 'APPROVED' &&
    (await get(managerSrc.cookie, `/api/write-offs/${writeOffOneId}`)).body?.writeOff?.postedAt !==
      null,
  `${approveWriteOff.status} ${approveWriteOff.body?.approval?.status}`,
)

const writeOffMovements = await rows(
  `select type, quantity_delta, unit_cost_minor from stock_movement
    where reference_type = 'WRITE_OFF' and reference_id = $1 order by created_at`,
  [writeOffOneId],
)
const p4After = await level(srcId, p4)
check(
  '8.3',
  'the WRITE_OFF movements post -3 and the level drops',
  writeOffMovements.length === 1 &&
    writeOffMovements[0].type === 'WRITE_OFF' &&
    writeOffMovements[0].quantity_delta === -3 &&
    p4After.qty === p4Before.qty - 3,
  `${JSON.stringify(writeOffMovements)} level ${p4Before.qty} -> ${p4After.qty}`,
)

// The approved value, re-derived from SQL: header, lines and the ledger the decision posted.
const writeOffValueSql = await one(
  `select w.value_minor::int as header,
          (select coalesce(sum(l.quantity * l.unit_cost_minor), 0)::int
             from stock_write_off_line l where l.write_off_id = w.id) as line_value,
          (select coalesce(sum(abs(m.quantity_delta) * m.unit_cost_minor), 0)::int
             from stock_movement m
            where m.reference_type = 'WRITE_OFF' and m.reference_id = w.id) as ledger_value,
          a.amount_minor::int as approval_value
     from stock_write_off w
     join approval a on a.id = $2
    where w.id = $1`,
  [writeOffOneId, writeOffOneApproval],
)
check(
  '8.4',
  'the approved write-off value re-derived from SQL equals header, ledger and approval',
  writeOffValueSql.header === writeOffValue &&
    writeOffValueSql.line_value === writeOffValue &&
    writeOffValueSql.ledger_value === writeOffValue &&
    writeOffValueSql.approval_value === writeOffValue,
  JSON.stringify(writeOffValueSql),
)
note(
  `approved write-off value: header=${writeOffValueSql.header} lines=${writeOffValueSql.line_value} ledger=${writeOffValueSql.ledger_value} approval=${writeOffValueSql.approval_value} (expected ${writeOffValue})`,
)

check(
  '8.5',
  'the ledger equals on hand after the write-off (SQL)',
  (await movementSum(srcId, p4)) === p4After.qty,
  `${await movementSum(srcId, p4)} vs ${p4After.qty}`,
)

section('9: a rejected write-off moves nothing')

const p4BeforeReject = await level(srcId, p4)
const writeOffTwo = await post(managerSrc.cookie, '/api/write-offs', {
  lines: [{ productId: p4, quantity: 2, reason: 'EXPIRY', note: 'Batch expires this week' }],
})
const writeOffTwoId = writeOffTwo.body?.writeOff?.id
const writeOffTwoApproval = writeOffTwo.body?.approval?.id
if (writeOffTwoApproval) created.approvals.push(writeOffTwoApproval)
const rejectWriteOff = await decide(adminCookie, writeOffTwoApproval, {
  decision: 'REJECTED',
  reasonCode: 'INCOMPLETE',
  note: 'Recount first',
})
const writeOffTwoMovements = await one(
  `select count(*)::int as total from stock_movement where reference_type = 'WRITE_OFF' and reference_id = $1`,
  [writeOffTwoId],
)
const p4AfterReject = await level(srcId, p4)
check(
  '9.1',
  'the rejection sets REJECTED',
  rejectWriteOff.status === 200 &&
    (await get(managerSrc.cookie, `/api/write-offs/${writeOffTwoId}`)).body?.writeOff?.status ===
      'REJECTED',
  `${rejectWriteOff.status} ${rejectWriteOff.body?.approval?.status}`,
)
check(
  '9.2',
  'a rejected write-off posts zero movements and leaves the level unchanged (SQL)',
  writeOffTwoMovements.total === 0 && p4AfterReject.qty === p4BeforeReject.qty,
  `movements ${writeOffTwoMovements.total}, level ${p4BeforeReject.qty} -> ${p4AfterReject.qty}`,
)

section('10: a write-off that would go negative is refused')

const p5Before = await level(srcId, p5)
const writeOffThree = await post(managerSrc.cookie, '/api/write-offs', {
  lines: [{ productId: p5, quantity: p5Before.qty + 3, reason: 'DAMAGE' }],
})
const writeOffThreeId = writeOffThree.body?.writeOff?.id
const writeOffThreeApproval = writeOffThree.body?.approval?.id
if (writeOffThreeApproval) created.approvals.push(writeOffThreeApproval)
const overdraw = await decide(adminCookie, writeOffThreeApproval, { decision: 'APPROVED' })
const writeOffThreeAfter = await get(managerSrc.cookie, `/api/write-offs/${writeOffThreeId}`)
check(
  '10.1',
  'approving an impossible write-off is a 409',
  overdraw.status === 409,
  `${overdraw.status} ${overdraw.body?.error?.message ?? ''}`,
)
check(
  '10.2',
  'the refusal leaves the write-off PENDING_APPROVAL and the level intact (SQL)',
  writeOffThreeAfter.body?.writeOff?.status === 'PENDING_APPROVAL' &&
    (await level(srcId, p5)).qty === p5Before.qty,
  `${writeOffThreeAfter.body?.writeOff?.status} level ${(await level(srcId, p5)).qty}`,
)
const cancelWriteOffThree = await post(
  managerSrc.cookie,
  `/api/write-offs/${writeOffThreeId}/cancel`,
)
check(
  '10.3',
  'the manager can cancel the impossible request',
  cancelWriteOffThree.status === 200,
  cancelWriteOffThree.status,
)

section('11: shrinkage is not an adjustment')

const managerShrink = await post(managerSrc.cookie, '/api/inventory/adjustments', {
  branchId: srcId,
  productId: p6,
  quantityDelta: -1,
  reasonCode: 'DAMAGE',
  note: 'Broken in the aisle',
})
check(
  '11.1',
  'a manager posting a negative DAMAGE adjustment is refused with a 400',
  managerShrink.status === 400,
  `${managerShrink.status} ${managerShrink.body?.error?.message ?? ''}`,
)
const adminShrink = await post(adminCookie, '/api/inventory/adjustments', {
  branchId: srcId,
  productId: p6,
  quantityDelta: -1,
  reasonCode: 'DAMAGE',
  note: 'Broken in the aisle',
})
check(
  '11.2',
  'the same call from an admin is accepted',
  adminShrink.status === 201,
  adminShrink.status,
)

section('12: a price inside the band applies, and the audit says so')

const insideBand = await put(managerSrc.cookie, `/api/products/${p1}/prices`, {
  branchId: srcId,
  priceMinor: 110_000,
})
const pricesAfterInside = await get(adminCookie, `/api/products/${p1}/prices`)
const p1Override = (pricesAfterInside.body?.overrides ?? []).find((row) => row.branchId === srcId)
check(
  '12.1',
  'exactly 10% is APPLIED with the new price',
  insideBand.status === 200 &&
    insideBand.body?.status === 'APPLIED' &&
    insideBand.body?.priceMinor === 110_000,
  `${insideBand.status} ${JSON.stringify(insideBand.body)}`,
)
check('12.2', 'the price row changed', p1Override?.priceMinor === 110_000, p1Override?.priceMinor)
const bandAudit = await auditRows(
  `action = 'product.price.override_set' and entity_id = $1 and branch_id = $2 and after ->> 'via' = 'BAND'`,
  [p1, srcId],
)
check(
  '12.3',
  "the audit row records via: 'BAND'",
  bandAudit.length === 1 && bandAudit[0].after?.priceMinor === 110_000,
  bandAudit.map((row) => row.after).join(','),
)

section('13: one pesewa beyond the band waits for a decision')

// A fresh product, so "one pesewa beyond" is measured from a 100,000 base: the band
// admits at most 110,000, and 110,001 is the first price it refuses.
const beyondBand = await put(managerSrc.cookie, `/api/products/${p11}/prices`, {
  branchId: srcId,
  priceMinor: 110_001,
})
const pricesAfterBeyond = await get(adminCookie, `/api/products/${p11}/prices`)
const p11OverrideAfterBeyond = (pricesAfterBeyond.body?.overrides ?? []).find(
  (row) => row.branchId === srcId,
)
check(
  '13.1',
  '110,001 pesewas is PENDING_APPROVAL, not APPLIED',
  beyondBand.status === 200 && beyondBand.body?.status === 'PENDING_APPROVAL',
  `${beyondBand.status} ${JSON.stringify(beyondBand.body)}`,
)
check(
  '13.2',
  'the price row is unchanged',
  p11OverrideAfterBeyond === undefined,
  JSON.stringify(p11OverrideAfterBeyond),
)

section('14: approving a price applies it once')

const p11PriceApproval = await findApproval(p11, 'PRICE_CHANGE')
if (p11PriceApproval) created.approvals.push(p11PriceApproval.id)
const approvePrice = await decide(adminCookie, p11PriceApproval.id, { decision: 'APPROVED' })
const pricesAfterApprove = await get(adminCookie, `/api/products/${p11}/prices`)
const p11OverrideApproved = (pricesAfterApprove.body?.overrides ?? []).find(
  (row) => row.branchId === srcId,
)
check(
  '14.1',
  'the approved request writes the proposed price',
  approvePrice.status === 200 &&
    approvePrice.body?.approval?.status === 'APPROVED' &&
    p11OverrideApproved?.priceMinor === 110_001,
  `${approvePrice.status} price ${p11OverrideApproved?.priceMinor}`,
)
const approveTwice = await decide(adminCookie, p11PriceApproval.id, { decision: 'APPROVED' })
const pricesAfterTwice = await get(adminCookie, `/api/products/${p11}/prices`)
const p11OverrideTwice = (pricesAfterTwice.body?.overrides ?? []).find(
  (row) => row.branchId === srcId,
)
check(
  '14.2',
  'a second decision is a 409 and the row is untouched',
  approveTwice.status === 409 && p11OverrideTwice?.priceMinor === 110_001,
  `${approveTwice.status} price ${p11OverrideTwice?.priceMinor}`,
)

section('15: a price that moved underneath a pending request cannot be applied')

const staleRequest = await put(managerSrc.cookie, `/api/products/${p2}/prices`, {
  branchId: srcId,
  priceMinor: 120_000,
})
const staleApproval = await findApproval(p2, 'PRICE_CHANGE')
if (staleApproval) created.approvals.push(staleApproval.id)
check(
  '15.1',
  'the out-of-band request is pending and wrote nothing',
  staleRequest.body?.status === 'PENDING_APPROVAL',
  JSON.stringify(staleRequest.body),
)
const adminMovedIt = await put(adminCookie, `/api/products/${p2}/prices`, {
  branchId: srcId,
  priceMinor: 115_000,
})
check(
  '15.2',
  'an admin moves the price directly while the request waits',
  adminMovedIt.body?.status === 'APPLIED' && adminMovedIt.body?.priceMinor === 115_000,
  JSON.stringify(adminMovedIt.body),
)
const staleDecision = await decide(adminCookie, staleApproval.id, { decision: 'APPROVED' })
const p2Prices = await get(adminCookie, `/api/products/${p2}/prices`)
const p2Override = (p2Prices.body?.overrides ?? []).find((row) => row.branchId === srcId)
check(
  '15.3',
  'approving the stale request is a 409 and the live price stays 115,000',
  staleDecision.status === 409 && p2Override?.priceMinor === 115_000,
  `${staleDecision.status} price ${p2Override?.priceMinor}`,
)
await decide(adminCookie, staleApproval.id, {
  decision: 'REJECTED',
  reasonCode: 'OTHER',
  note: 'Stale after the direct change',
})

section('16: removing an out-of-band override is a request, not a delete')

const adminSetsP3 = await put(adminCookie, `/api/products/${p3}/prices`, {
  branchId: srcId,
  priceMinor: 200_000,
})
const removalRequest = await del(managerSrc.cookie, `/api/products/${p3}/prices/${srcId}`)
const p3Prices = await get(adminCookie, `/api/products/${p3}/prices`)
const p3Override = (p3Prices.body?.overrides ?? []).find((row) => row.branchId === srcId)
check(
  '16.1',
  'the manager cannot delete an override outside the band',
  adminSetsP3.body?.status === 'APPLIED' &&
    removalRequest.body?.status === 'PENDING_APPROVAL' &&
    p3Override?.priceMinor === 200_000,
  `${removalRequest.body?.status} price ${p3Override?.priceMinor}`,
)
const removalApproval = await findApproval(p3, 'PRICE_CHANGE')
if (removalApproval) created.approvals.push(removalApproval.id)
const approveRemoval = await decide(adminCookie, removalApproval.id, { decision: 'APPROVED' })
const p3PricesAfter = await get(adminCookie, `/api/products/${p3}/prices`)
check(
  '16.2',
  'approving the request removes the override',
  approveRemoval.status === 200 &&
    (p3PricesAfter.body?.overrides ?? []).every((row) => row.branchId !== srcId),
  `${approveRemoval.status} overrides ${JSON.stringify(p3PricesAfter.body?.overrides)}`,
)

section('17: a credit limit decrease is direct')

const setLimitOne = await setLimit(adminCookie, customerOne.id, 500_000)
const decrease = await setLimit(managerSrc.cookie, customerOne.id, 300_000)
check(
  '17.1',
  'a manager lowering a limit applies immediately',
  setLimitOne.status === 200 &&
    decrease.status === 200 &&
    decrease.body?.profile?.limitMinor === 300_000,
  `${decrease.status} ${decrease.body?.profile?.limitMinor}`,
)
const decreaseAudit = await auditRows(
  `action = 'credit.profile_updated' and entity_id = $1 and branch_id = $2 and after ->> 'via' = 'DIRECT_DECREASE'`,
  [decrease.body?.profile?.id, srcId],
)
check(
  '17.2',
  "the audit records via: 'DIRECT_DECREASE'",
  decreaseAudit.length === 1,
  decreaseAudit.length,
)

section('18: a credit limit increase is not direct')

const profileOne = (
  await get(adminCookie, `/api/credit/profiles?customerId=${customerOne.id}&branchId=${srcId}`)
).body?.profiles?.[0]
const directIncrease = await setLimit(managerSrc.cookie, customerOne.id, 400_000)
check(
  '18.1',
  'a manager raising a limit directly is refused with a 403',
  directIncrease.status === 403,
  `${directIncrease.status} ${directIncrease.body?.error?.message ?? ''}`,
)
check(
  '18.2',
  'zero limit-change approvals exist for that profile (SQL)',
  (await approvalCount(`type = 'CREDIT_LIMIT_CHANGE' and entity_id = $1`, [profileOne.id])) === 0,
  await approvalCount(`type = 'CREDIT_LIMIT_CHANGE' and entity_id = $1`, [profileOne.id]),
)
const unchanged = (
  await get(adminCookie, `/api/credit/profiles?customerId=${customerOne.id}&branchId=${srcId}`)
).body?.profiles?.[0]
check('18.3', 'the limit is unchanged', unchanged?.limitMinor === 300_000, unchanged?.limitMinor)

section('19: a credit limit increase is requested and approved')

const ledgerBefore = await one(
  `select count(*)::int as entries, coalesce(sum(amount_minor), 0)::int as total
     from credit_ledger_entry where customer_id = $1 and branch_id = $2`,
  [customerOne.id, srcId],
)
const raiseRequest = await post(
  managerSrc.cookie,
  `/api/credit/profiles/${customerOne.id}/limit-requests`,
  { proposedLimitMinor: 400_000, reason: 'Customer restocking for the season' },
)
const duringRequest = (
  await get(adminCookie, `/api/credit/profiles?customerId=${customerOne.id}&branchId=${srcId}`)
).body?.profiles?.[0]
check(
  '19.1',
  'the request is accepted and the limit has not moved',
  raiseRequest.status === 201 &&
    raiseRequest.body?.status === 'PENDING' &&
    duringRequest?.limitMinor === 300_000,
  `${raiseRequest.status} limit ${duringRequest?.limitMinor}`,
)
check(
  '19.2',
  'the ledger and the balance are untouched by the request (SQL)',
  (
    await one(
      `select count(*)::int as entries, coalesce(sum(amount_minor), 0)::int as total
       from credit_ledger_entry where customer_id = $1 and branch_id = $2`,
      [customerOne.id, srcId],
    )
  ).entries === ledgerBefore.entries,
  JSON.stringify(ledgerBefore),
)
if (raiseRequest.body?.approvalId) created.approvals.push(raiseRequest.body.approvalId)
const creditApproval = await approvalRow(raiseRequest.body?.approvalId)
const approveRaise = await decide(adminCookie, creditApproval.id, {
  decision: 'APPROVED',
  note: 'Seasonal restock approved',
})
const afterRaise = (
  await get(adminCookie, `/api/credit/profiles?customerId=${customerOne.id}&branchId=${srcId}`)
).body?.profiles?.[0]
const ledgerAfter = await one(
  `select count(*)::int as entries, coalesce(sum(amount_minor), 0)::int as total
     from credit_ledger_entry where customer_id = $1 and branch_id = $2`,
  [customerOne.id, srcId],
)
check(
  '19.3',
  'approval moves the limit to the proposal',
  approveRaise.status === 200 && afterRaise?.limitMinor === 400_000,
  `${approveRaise.status} limit ${afterRaise?.limitMinor}`,
)
check(
  '19.4',
  'the ledger entries and the balance are unchanged by the approval (SQL)',
  ledgerAfter.entries === ledgerBefore.entries &&
    ledgerAfter.total === ledgerBefore.total &&
    afterRaise?.balanceMinor === duringRequest?.balanceMinor,
  `entries ${ledgerBefore.entries}->${ledgerAfter.entries} total ${ledgerBefore.total}->${ledgerAfter.total} balance ${duringRequest?.balanceMinor}->${afterRaise?.balanceMinor}`,
)

section('20: the over-limit list and the analytics count are the same rows')

await setLimit(adminCookie, customerTwo.id, 50_000)
// An admin may post a charge past the limit with a reason-coded override; that is how
// an over-limit customer exists in the first place (the POS records it as a conflict).
const charge = await post(adminCookie, '/api/credit/entries', {
  customerId: customerTwo.id,
  branchId: srcId,
  kind: 'CHARGE',
  amountMinor: 80_000,
  reasonCode: 'OPENING_BALANCE',
  note: 'Brought forward',
  override: { reasonCode: 'TEMPORARY_APPROVAL', note: 'Walkthrough opening balance' },
})
const overLimitList = await get(adminCookie, `/api/credit/over-limit?branchId=${srcId}&limit=100`)
const today = new Date().toISOString().slice(0, 10)
const thirtyDaysAgo = new Date(Date.now() - 30 * 86_400_000).toISOString().slice(0, 10)
const analytics = await get(
  adminCookie,
  `/api/analytics/credit?from=${thirtyDaysAgo}&to=${today}&branchId=${srcId}`,
)
const overLimitRows = overLimitList.body?.customers ?? []
check(
  '20.1',
  'the list total equals its rows and names the over-limit customer',
  charge.status === 201 &&
    overLimitList.body?.total === overLimitRows.length &&
    overLimitRows.some((row) => row.customerId === customerTwo.id && row.overByMinor === 30_000),
  `charge ${charge.status} ${JSON.stringify(charge.body?.error ?? '')}; total ${overLimitList.body?.total} rows ${JSON.stringify(overLimitRows.map((row) => [row.customerId === customerTwo.id, row.overByMinor]))}`,
)
check(
  '20.2',
  'analytics counts exactly the list total',
  analytics.body?.totals?.overLimitCount === overLimitList.body?.total,
  `analytics ${analytics.body?.totals?.overLimitCount} vs list ${overLimitList.body?.total}`,
)

section('21-23: shift variance review (driven through the device upload)')
note(
  'a shift is opened and closed by the terminal, so these legs POST /api/pos/sync/upload with the device JWT minted above, exactly as the POS does',
)

const settings = await get(adminCookie, `/api/settings?branchId=${srcId}`)
const settingValue = (settingKey) =>
  (settings.body?.settings ?? []).find((row) => row.key === settingKey)?.value
const shiftTolerance = settingValue('pos.shiftVarianceToleranceMinor')
const countTolerance = settingValue('inventory.countVarianceToleranceMinor')
if (typeof shiftTolerance !== 'number' || typeof countTolerance !== 'number') {
  console.error('could not read the Phase 12 tolerances', JSON.stringify(settings.body))
  process.exit(1)
}
note(
  `shift tolerance ${shiftTolerance} pesewas, count variance tolerance ${countTolerance} pesewas`,
)

async function uploadShiftOpen(shift) {
  const response = await deviceCall(deviceJwt, 'POST', '/api/pos/sync/upload', {
    batchId: key(),
    deviceId: device.deviceId,
    terminalId: device.terminal.id,
    transactions: [
      {
        clientTransactionId: key(),
        type: 'SHIFT_OPEN',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: {
          shiftId: shift.shiftId,
          number: shift.number,
          openingFloatMinor: shift.openingFloatMinor,
          cashierUserId: shift.cashierUserId,
          cashierStaffId: shift.cashierStaffId,
          occurredAt: new Date().toISOString(),
        },
      },
    ],
  })
  if (response.status !== 200 || response.body?.results?.[0]?.status !== 'APPLIED') {
    throw new Error(`shift open failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
}

async function uploadShiftClose(shiftId, countedCashMinor, clientExpectedCashMinor) {
  const response = await deviceCall(deviceJwt, 'POST', '/api/pos/sync/upload', {
    batchId: key(),
    deviceId: device.deviceId,
    terminalId: device.terminal.id,
    transactions: [
      {
        clientTransactionId: key(),
        type: 'SHIFT_CLOSE',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: {
          shiftId,
          countedCashMinor,
          clientExpectedCashMinor,
          closeNote: 'Walkthrough close',
          occurredAt: new Date().toISOString(),
        },
      },
    ],
  })
  if (response.status !== 200) {
    throw new Error(`shift close failed: ${response.status} ${JSON.stringify(response.body)}`)
  }
  return response.body.results[0]
}

async function shiftRow(shiftId) {
  return one(
    `select status, review_status, opening_float_minor::int as float_minor,
            counted_cash_minor::int as counted_minor,
            client_expected_cash_minor::int as client_expected_minor,
            server_expected_cash_minor::int as server_expected_minor,
            variance_minor::int as variance_minor,
            reviewed_by, reviewed_at, review_note, closed_at
       from shift where id = $1`,
    [shiftId],
  )
}

const shiftA = {
  shiftId: key(),
  number: `WS-${tail}-A`,
  openingFloatMinor: 50_000,
  cashierUserId: cashier.userId,
  cashierStaffId: cashier.staffId,
}
await uploadShiftOpen(shiftA)
const closeA = await uploadShiftClose(
  shiftA.shiftId,
  shiftA.openingFloatMinor + shiftTolerance,
  shiftA.openingFloatMinor,
)
const shiftARow = await shiftRow(shiftA.shiftId)
check(
  '21.1',
  'a close exactly at tolerance is not a review (review_status NONE)',
  closeA.status === 'APPLIED' &&
    shiftARow.review_status === 'NONE' &&
    shiftARow.variance_minor === shiftTolerance,
  `${closeA.status} review ${shiftARow.review_status} variance ${shiftARow.variance_minor}`,
)
check(
  '21.2',
  'the at-tolerance close raised zero approvals (SQL)',
  (await approvalCount('entity_id = $1', [shiftA.shiftId])) === 0,
  await approvalCount('entity_id = $1', [shiftA.shiftId]),
)

const shiftB = {
  shiftId: key(),
  number: `WS-${tail}-B`,
  openingFloatMinor: 40_000,
  // The manager counts this drawer, so the requester and the closer are one person —
  // leg 23 proves the server refuses them the decision.
  cashierUserId: managerSrc.userId,
  cashierStaffId: managerSrc.staffId,
}
await uploadShiftOpen(shiftB)
const overBy = shiftTolerance + 1
const closeB = await uploadShiftClose(
  shiftB.shiftId,
  shiftB.openingFloatMinor + overBy,
  shiftB.openingFloatMinor,
)
const shiftBRow = await shiftRow(shiftB.shiftId)
const shiftBApproval = await findApproval(shiftB.shiftId, 'SHIFT_VARIANCE_REVIEW')
if (shiftBApproval) created.approvals.push(shiftBApproval.id)
check(
  '22.1',
  'a close one pesewa over tolerance is REQUIRED',
  closeB.status === 'APPLIED' &&
    shiftBRow.review_status === 'REQUIRED' &&
    shiftBRow.variance_minor === overBy,
  `${closeB.status} review ${shiftBRow.review_status} variance ${shiftBRow.variance_minor}`,
)
check(
  '22.2',
  'exactly one approval exists and it carries |variance|',
  (await approvalCount('entity_id = $1 and type = $2', [
    shiftB.shiftId,
    'SHIFT_VARIANCE_REVIEW',
  ])) === 1 && shiftBApproval?.amountMinor === overBy,
  `count ${await approvalCount('entity_id = $1 and type = $2', [shiftB.shiftId, 'SHIFT_VARIANCE_REVIEW'])} amount ${shiftBApproval?.amountMinor} vs ${overBy}`,
)

const moneyBefore = await shiftRow(shiftB.shiftId)
const ownDecision = await decide(managerSrc.cookie, shiftBApproval.id, {
  decision: 'APPROVED',
  note: 'Counted it myself',
})
check(
  '23.1',
  'the closer cannot decide their own variance (403)',
  ownDecision.status === 403,
  `${ownDecision.status} ${ownDecision.body?.error?.message ?? ''}`,
)
const otherDecision = await decide(managerSrc2.cookie, shiftBApproval.id, {
  decision: 'APPROVED',
  note: 'Drawer recount agreed with the cashier',
})
const moneyAfter = await shiftRow(shiftB.shiftId)
const moneyColumns = (row) => ({
  float: row.float_minor,
  counted: row.counted_minor,
  clientExpected: row.client_expected_minor,
  serverExpected: row.server_expected_minor,
  variance: row.variance_minor,
  closedAt: row.closed_at?.toISOString?.() ?? row.closed_at,
})
check(
  '23.2',
  'a different manager in the same branch records REVIEWED',
  otherDecision.status === 200 &&
    moneyAfter.review_status === 'REVIEWED' &&
    moneyAfter.review_note?.length > 0,
  `${otherDecision.status} review ${moneyAfter.review_status}`,
)
check(
  '23.3',
  'the money columns are byte-identical before and after the decision',
  JSON.stringify(moneyColumns(moneyBefore)) === JSON.stringify(moneyColumns(moneyAfter)),
  `${JSON.stringify(moneyColumns(moneyBefore))} -> ${JSON.stringify(moneyColumns(moneyAfter))}`,
)

section('24: a count schedule runs once per due period')
note(
  'no HTTP trigger exists for the nightly inventory jobs (P12-D34), so each "run" enqueues the real pg-boss job the API worker consumes and waits for it to finish',
)

const schedule = await post(adminCookie, '/api/count-schedules', {
  branchId: srcId,
  scope: 'CATEGORY',
  categoryId: categoryCount,
  frequency: 'WEEKLY',
  firstDueAt: today,
  assignedTo: 'Walk counter',
})
const scheduleId = schedule.body?.schedule?.id
check(
  '24.1',
  'the schedule is created due today',
  schedule.status === 201 && schedule.body?.schedule?.nextDueAt === today,
  `${schedule.status} due ${schedule.body?.schedule?.nextDueAt}`,
)

const jobOne = await runJob('inventory-count-schedule')
const countsAfterOne = await rows(
  `select id, count_type, schedule_id, line_count from (
     select sc.id, sc.count_type, sc.schedule_id,
            (select count(*) from stock_count_line l where l.count_id = sc.id)::int as line_count
       from stock_count sc where sc.schedule_id = $1) rows`,
  [scheduleId],
)
const scheduleAfterOne = await one('select next_due_at from count_schedule where id = $1', [
  scheduleId,
])
const scheduledCountId = countsAfterOne[0]?.id
check(
  '24.2',
  'the first run creates exactly one SCHEDULED count and advances next_due_at',
  jobOne === 'completed' &&
    countsAfterOne.length === 1 &&
    countsAfterOne[0].count_type === 'SCHEDULED' &&
    scheduleAfterOne.next_due_at.toISOString().slice(0, 10) !== today,
  `${jobOne} counts ${countsAfterOne.length} next ${scheduleAfterOne?.next_due_at}`,
)

const jobTwo = await runJob('inventory-count-schedule')
const countsAfterTwo = await rows('select id from stock_count where schedule_id = $1', [scheduleId])
const scheduleAfterTwo = await one('select next_due_at from count_schedule where id = $1', [
  scheduleId,
])
check(
  '24.3',
  'the second run creates none and advances nothing',
  jobTwo === 'completed' &&
    countsAfterTwo.length === 1 &&
    scheduleAfterTwo.next_due_at.getTime() === scheduleAfterOne.next_due_at.getTime(),
  `${jobTwo} counts ${countsAfterTwo.length}`,
)
const zeroLevelLine = await one(
  `select l.counted_qty, l.snapshot_qty from stock_count_line l where l.count_id = $1 and l.product_id = $2`,
  [scheduledCountId, p11],
)
check(
  '24.4',
  'a never-stocked product is in the count at snapshot zero',
  zeroLevelLine !== null && zeroLevelLine.snapshot_qty === 0,
  JSON.stringify(zeroLevelLine),
)

section('25: a posted variance over tolerance raises one trigger count')

const manualCount = await post(managerSrc.cookie, '/api/counts', {
  branchId: srcId,
  categoryId: categoryCount,
  note: `Walk count ${suffix}`,
})
const manualCountId = manualCount.body?.count?.id
const countLines = manualCount.body?.count?.lines ?? []
const p10Line = countLines.find((line) => line.productId === p10)
const p11Line = countLines.find((line) => line.productId === p11)
check(
  '25.1',
  'a manual count opens with the snapshot book',
  manualCount.status === 201 &&
    p10Line?.snapshotQty === (await level(srcId, p10)).qty &&
    p11Line?.snapshotQty === 0,
  `${manualCount.status} p10 ${p10Line?.snapshotQty} p11 ${p11Line?.snapshotQty}`,
)
const countedLines = await call(managerSrc.cookie, 'PATCH', `/api/counts/${manualCountId}/lines`, {
  lines: [
    { productId: p10, countedQty: 5 },
    { productId: p11, countedQty: 0 },
  ],
})
const postedCount = await post(managerSrc.cookie, `/api/counts/${manualCountId}/post`)
const varianceValue = Math.abs(5 - (p10Line?.snapshotQty ?? 0)) * (await level(srcId, p10)).cost
check(
  '25.2',
  'the counted lines are recorded against the snapshot',
  countedLines.status === 200 &&
    countedLines.body?.count?.lines?.find((line) => line.productId === p10)?.countedQty === 5,
  `${countedLines.status} ${JSON.stringify(countedLines.body?.error ?? countedLines.body?.count?.countedCount)}`,
)
check(
  '25.3',
  'posting records the variance and posts the count',
  postedCount.status === 200 && postedCount.body?.count?.status === 'POSTED',
  `${postedCount.status} ${JSON.stringify(postedCount.body?.error ?? postedCount.body?.count?.status)}`,
)
const triggerAfterPost = await rows(
  `select id from stock_count where trigger_product_id = $1 and branch_id = $2 and count_type = 'TRIGGER'`,
  [p10, srcId],
)
check(
  '25.4',
  'one TRIGGER count exists for the product, because the variance value exceeds tolerance',
  varianceValue > countTolerance && triggerAfterPost.length === 1,
  `variance value ${varianceValue} vs tolerance ${countTolerance}; trigger counts ${triggerAfterPost.length}`,
)
// A second posted variance for the same product would ask for a second trigger. The open
// trigger is the partial unique's job: the second request must be a no-op, not a duplicate.
const secondCount = await post(managerSrc.cookie, '/api/counts', {
  branchId: srcId,
  categoryId: categoryCount,
  note: `Walk count two ${suffix}`,
})
const secondCountId = secondCount.body?.count?.id
await call(managerSrc.cookie, 'PATCH', `/api/counts/${secondCountId}/lines`, {
  lines: [
    { productId: p10, countedQty: (await level(srcId, p10)).qty - 1 },
    { productId: p11, countedQty: 0 },
  ],
})
const postedSecond = await post(managerSrc.cookie, `/api/counts/${secondCountId}/post`)
const triggersAfterSecond = await rows(
  `select id from stock_count where trigger_product_id = $1 and branch_id = $2 and count_type = 'TRIGGER'`,
  [p10, srcId],
)
check(
  '25.5',
  'a second posted variance for the same product raises no second trigger count',
  postedSecond.status === 200 && triggersAfterSecond.length === 1,
  `${postedSecond.status} trigger counts ${triggersAfterSecond.length}`,
)

section('26: two oversell conflicts raise one trigger count, once')

const shiftC = {
  shiftId: key(),
  number: `WS-${tail}-C`,
  openingFloatMinor: 20_000,
  cashierUserId: cashier.userId,
  cashierStaffId: cashier.staffId,
}
await uploadShiftOpen(shiftC)

const unitPriceMinor = 100_000
const saleTotals = {
  subtotalMinor: unitPriceMinor,
  lineDiscountMinor: 0,
  saleDiscountMinor: 0,
  loyaltyDiscountMinor: 0,
  vatMinor: 12_501,
  nhilMinor: 2_083,
  getfundMinor: 2_083,
  taxTotalMinor: 16_667,
  totalMinor: unitPriceMinor,
  changeMinor: 0,
}

async function uploadOversellSale(receiptNumber) {
  const response = await deviceCall(deviceJwt, 'POST', '/api/pos/sync/upload', {
    batchId: key(),
    deviceId: device.deviceId,
    terminalId: device.terminal.id,
    transactions: [
      {
        clientTransactionId: key(),
        type: 'SALE',
        occurredAt: new Date().toISOString(),
        payloadVersion: 1,
        payload: {
          receiptNumber,
          shiftId: shiftC.shiftId,
          cashier: {
            userId: cashier.userId,
            staffId: cashier.staffId,
            bindingId: binding.body.bindingId,
            bindingToken: binding.body.bindingToken,
            pinVersion: binding.body.pinVersion,
          },
          customer: null,
          lines: [
            {
              productId: p12,
              quantity: 1,
              unitPriceMinor,
              lineDiscountMinor: 0,
              taxCategory: 'STANDARD',
            },
          ],
          loyalty: null,
          tenders: [{ method: 'CASH', amountMinor: unitPriceMinor }],
          totals: saleTotals,
          occurredAt: new Date().toISOString(),
          appVersion: 'walkthrough-branch-ops',
        },
      },
    ],
  })
  return response
}

const saleOne = await uploadOversellSale(`WO-${tail}-1`)
const saleTwo = await uploadOversellSale(`WO-${tail}-2`)
const oversellConflicts = await one(
  `select count(*)::int as total from sync_conflict
    where branch_id = $1 and type = 'STOCK_OVERSELL' and details ->> 'productId' = $2`,
  [srcId, p12],
)
check(
  '26.1',
  'two sales of a zero-stock product record two STOCK_OVERSELL conflicts and still sell',
  saleOne.body?.results?.[0]?.status === 'APPLIED' &&
    saleTwo.body?.results?.[0]?.status === 'APPLIED' &&
    oversellConflicts.total === 2,
  `statuses ${saleOne.body?.results?.[0]?.status}/${saleTwo.body?.results?.[0]?.status} conflicts ${oversellConflicts.total}`,
)

const p12Level = await level(srcId, p12)
check(
  '26.2',
  'the oversell is applied, not blocked (level below zero, ledger agrees)',
  p12Level.qty === -2 && (await movementSum(srcId, p12)) === -2,
  `level ${p12Level.qty} ledger ${await movementSum(srcId, p12)}`,
)

const shiftCExpected = shiftC.openingFloatMinor + 2 * unitPriceMinor
await uploadShiftClose(shiftC.shiftId, shiftCExpected, shiftCExpected)
const shiftCRow = await shiftRow(shiftC.shiftId)
check(
  '26.3',
  'the drawer with cash sales closes with the server expected cash',
  shiftCRow.status === 'CLOSED' &&
    shiftCRow.server_expected_minor === shiftCExpected &&
    shiftCRow.variance_minor === 0,
  `${shiftCRow.status} expected ${shiftCRow.server_expected_minor} variance ${shiftCRow.variance_minor}`,
)

const jobScanTwo = await runJob('inventory-trigger-scan')
const p12Triggers = await rows(
  `select id, trigger_reason from stock_count
    where trigger_product_id = $1 and branch_id = $2 and count_type = 'TRIGGER'`,
  [p12, srcId],
)
check(
  '26.4',
  'the scan raises one OVERSELL trigger count',
  jobScanTwo === 'completed' &&
    p12Triggers.length === 1 &&
    p12Triggers[0].trigger_reason === 'OVERSELL',
  `${jobScanTwo} ${JSON.stringify(p12Triggers.map((row) => row.trigger_reason))}`,
)
const jobScanThree = await runJob('inventory-trigger-scan')
const p12TriggersAgain = await rows(
  `select id from stock_count where trigger_product_id = $1 and branch_id = $2 and count_type = 'TRIGGER'`,
  [p12, srcId],
)
check(
  '26.5',
  'a third scan creates none',
  jobScanThree === 'completed' && p12TriggersAgain.length === 1,
  `${jobScanThree} trigger counts ${p12TriggersAgain.length}`,
)

section('27: ABC classes are derived, manual overrides survive, clearing restores the derivation')

const abcRecompute = await post(adminCookie, '/api/counts/abc/recompute', { branchId: srcId })
const abcList = await get(adminCookie, `/api/counts/abc?branchId=${srcId}`)
const abcByProduct = new Map((abcList.body?.classes ?? []).map((row) => [row.productId, row]))

// Hand-computation from the same two inputs the service uses: stock value + 90-day ex-tax sales.
const abcInputs = await rows(
  `select p.id as product_id,
          coalesce(sl.quantity_on_hand, 0)::int as qty,
          coalesce(sl.avg_cost_minor, 0)::int as cost,
          coalesce((select sum(line.base_minor) from sale_line line
                     join sale s on s.id = line.sale_id
                    where line.product_id = p.id and s.branch_id = $1
                      and s.occurred_at >= now() - interval '90 days'), 0)::int as sold_minor
     from product p
     left join stock_level sl on sl.product_id = p.id and sl.branch_id = $1
    where p.id = any($2::uuid[])`,
  [srcId, productIds],
)
const aThresholdBp = settingValue('inventory.abcAThresholdBp')
const bThresholdBp = settingValue('inventory.abcBThresholdBp')
const ranked = abcInputs
  .map((row) => ({
    productId: row.product_id,
    score: row.qty * row.cost + row.sold_minor,
  }))
  .sort((left, right) => right.score - left.score || left.productId.localeCompare(right.productId))
const totalScore = ranked.reduce((sum, row) => sum + row.score, 0)
let cumulative = 0
const expectedClass = new Map()
for (const row of ranked) {
  cumulative += row.score
  const shareBp = Math.round((cumulative * 10_000) / totalScore)
  expectedClass.set(
    row.productId,
    shareBp <= aThresholdBp ? 'A' : shareBp <= bThresholdBp ? 'B' : 'C',
  )
}
const observed = (productId) => abcByProduct.get(productId)?.class
// One representative per class: the highest-scoring product the hand-computation puts in it.
const representative = (letter) =>
  ranked.find((row) => expectedClass.get(row.productId) === letter)?.productId
const [classA, classB, classC] = ['A', 'B', 'C'].map(representative)
const representatives = [classA, classB, classC]
check(
  '27.1',
  'the recompute assigns A, B and C by the hand-computed cumulative share',
  abcRecompute.status === 200 &&
    representatives.every((productId) => productId !== undefined) &&
    new Set(representatives).size === 3 &&
    representatives.every((productId) => observed(productId) === expectedClass.get(productId)),
  JSON.stringify({
    expected: representatives.map((productId) => [
      productId?.slice(0, 8),
      expectedClass.get(productId),
    ]),
    observed: representatives.map((productId) => [productId?.slice(0, 8), observed(productId)]),
    aThresholdBp,
    bThresholdBp,
  }),
)
note(
  `ABC representatives: A=${classA?.slice(0, 8)} B=${classB?.slice(0, 8)} C=${classC?.slice(0, 8)} (A <= ${aThresholdBp}bp, B <= ${bThresholdBp}bp cumulative)`,
)

const manualClass = await call(adminCookie, 'PATCH', `/api/counts/abc/${classB}`, {
  branchId: srcId,
  abcClass: 'A',
  manual: true,
})
await post(adminCookie, '/api/counts/abc/recompute', { branchId: srcId })
const abcAfterManual = await get(adminCookie, `/api/counts/abc?branchId=${srcId}`)
const manualRow = (abcAfterManual.body?.classes ?? []).find((row) => row.productId === classB)
check(
  '27.2',
  'a manual class survives a recompute',
  manualClass.status === 200 && manualRow?.class === 'A' && manualRow?.isManual === true,
  `${manualClass.status} ${manualRow?.class} manual=${manualRow?.isManual}`,
)

const cleared = await call(adminCookie, 'PATCH', `/api/counts/abc/${classB}`, {
  branchId: srcId,
  abcClass: 'C',
  manual: false,
})
await post(adminCookie, '/api/counts/abc/recompute', { branchId: srcId })
const abcAfterClear = await get(adminCookie, `/api/counts/abc?branchId=${srcId}`)
const clearedRow = (abcAfterClear.body?.classes ?? []).find((row) => row.productId === classB)
check(
  '27.3',
  'clearing the override lets the derivation overwrite it',
  cleared.status === 200 &&
    clearedRow?.isManual === false &&
    clearedRow?.class === expectedClass.get(classB),
  `${clearedRow?.class} vs ${expectedClass.get(classB)} manual=${clearedRow?.isManual}`,
)

section('28: accuracy re-derived from SQL')

const accuracy = await get(
  adminCookie,
  `/api/counts/accuracy?branchId=${srcId}&from=${thirtyDaysAgo}&to=${today}`,
)
const accuracySql = await one(
  `with posted as (
     select sc.id from stock_count sc
      where sc.status = 'POSTED' and sc.branch_id = $1
        and sc.posted_at >= $2::date and sc.posted_at < ($3::date + interval '1 day')),
   counted as (
     select l.counted_qty, l.snapshot_qty from stock_count_line l join posted p on p.id = l.count_id
      where l.counted_qty is not null)
   select (select count(*) from counted)::int as counted_lines,
          (select count(*) from counted where counted_qty = snapshot_qty)::int as matched_lines,
          (select coalesce(sum(abs(sm.quantity_delta) * sm.unit_cost_minor), 0)::int
             from stock_movement sm join posted p on p.id = sm.reference_id
            where sm.reference_type = 'COUNT') as variance_value_minor`,
  [srcId, thirtyDaysAgo, today],
)
const expectedBp =
  accuracySql.counted_lines === 0
    ? null
    : Math.round((accuracySql.matched_lines * 10_000) / accuracySql.counted_lines)
check(
  '28.1',
  'accuracy counts and basis points match the SQL re-derivation',
  accuracy.body?.countedLines === accuracySql.counted_lines &&
    accuracy.body?.matchedLines === accuracySql.matched_lines &&
    accuracy.body?.accuracyBp === expectedBp,
  `API ${accuracy.body?.matchedLines}/${accuracy.body?.countedLines} = ${accuracy.body?.accuracyBp}bp; SQL ${accuracySql.matched_lines}/${accuracySql.counted_lines} = ${expectedBp}bp`,
)
note(`accuracy: ${accuracySql.matched_lines}/${accuracySql.counted_lines} = ${expectedBp}bp`)
check(
  '28.2',
  'the variance value equals the COUNT_VARIANCE movements (SQL)',
  accuracy.body?.varianceValueMinor === accuracySql.variance_value_minor,
  `${accuracy.body?.varianceValueMinor} vs ${accuracySql.variance_value_minor}`,
)
const noCounts = await get(
  adminCookie,
  `/api/counts/accuracy?branchId=${dstId}&from=${thirtyDaysAgo}&to=${today}`,
)
check(
  '28.3',
  'a branch with no posted counts answers null, never zero',
  noCounts.status === 200 && noCounts.body?.accuracyBp === null,
  JSON.stringify(noCounts.body),
)

section('29: the inbox sorts, filters and summarises consistently')

const inbox = await get(adminCookie, `/api/approvals?branchId=${srcId}&sort=oldest&limit=200`)
const inboxRows = inbox.body?.approvals ?? []
const ascending = inboxRows.every(
  (row, index) =>
    index === 0 ||
    new Date(inboxRows[index - 1].requestedAt).getTime() <= new Date(row.requestedAt).getTime(),
)
check(
  '29.1',
  'sort=oldest is ascending by requestedAt',
  inbox.status === 200 && ascending,
  `${inbox.status} ${inboxRows.length} rows`,
)

const entityFilter = await get(
  adminCookie,
  `/api/approvals?entityId=${writeOffOneId}&type=STOCK_WRITE_OFF&limit=50`,
)
const entityRows = entityFilter.body?.approvals ?? []
check(
  '29.2',
  'the entityId filter returns that document and nothing else',
  entityFilter.status === 200 &&
    entityRows.length === 1 &&
    entityRows.every((row) => row.entityId === writeOffOneId),
  JSON.stringify(entityRows.map((row) => row.entityId)),
)

const summary = await get(adminCookie, `/api/approvals/summary?branchId=${srcId}`)
const byType = summary.body?.byType ?? {}
const types = Object.keys(byType)
let listsTotal = 0
const mismatches = []
for (const type of types) {
  const list = await get(
    adminCookie,
    `/api/approvals?branchId=${srcId}&type=${type}&status=PENDING&limit=200`,
  )
  const total = list.body?.total ?? 0
  listsTotal += total
  if (total !== byType[type]) mismatches.push(`${type}:${byType[type]}!=${total}`)
}
check(
  '29.3',
  'every per-type pending count equals that list endpoint total',
  summary.status === 200 && mismatches.length === 0,
  mismatches.join(', '),
)
check(
  '29.4',
  'the summary pending total is the sum of the lists',
  summary.body?.pending === listsTotal,
  `${summary.body?.pending} vs ${listsTotal}`,
)

section('30: OWASP A01 — authority, IDOR and a smuggled branch')

const pendingSelfChecks = []

const selfTransfer = await transferRequest(managerDst.cookie, {
  fromBranchId: srcId,
  toBranchId: dstId,
  productId: p1,
  quantity: 1,
})
const selfTransferApproval = await findApproval(selfTransfer.body?.transfer?.id, 'TRANSFER_REQUEST')
if (selfTransferApproval) created.approvals.push(selfTransferApproval.id)
pendingSelfChecks.push([
  'TRANSFER_REQUEST',
  selfTransferApproval.id,
  await decide(managerDst.cookie, selfTransferApproval.id, { decision: 'APPROVED' }),
])

const selfWriteOff = await post(managerSrc.cookie, '/api/write-offs', {
  lines: [{ productId: p4, quantity: 1, reason: 'OBSOLESCENCE' }],
})
const selfWriteOffApproval = selfWriteOff.body?.approval?.id
if (selfWriteOffApproval) created.approvals.push(selfWriteOffApproval)
pendingSelfChecks.push([
  'STOCK_WRITE_OFF',
  selfWriteOffApproval,
  await decide(managerSrc.cookie, selfWriteOffApproval, { decision: 'APPROVED' }),
])

const selfPrice = await put(managerSrc.cookie, `/api/products/${p5}/prices`, {
  branchId: srcId,
  priceMinor: 150_000,
})
const selfPriceApproval = await findApproval(p5, 'PRICE_CHANGE')
if (selfPriceApproval) created.approvals.push(selfPriceApproval.id)
pendingSelfChecks.push([
  'PRICE_CHANGE',
  selfPriceApproval.id,
  await decide(managerSrc.cookie, selfPriceApproval.id, { decision: 'APPROVED' }),
])

const selfCredit = await post(
  managerSrc.cookie,
  `/api/credit/profiles/${customerTwo.id}/limit-requests`,
  { proposedLimitMinor: 500_000, reason: 'Grow the account' },
)
if (selfCredit.body?.approvalId) created.approvals.push(selfCredit.body.approvalId)
pendingSelfChecks.push([
  'CREDIT_LIMIT_CHANGE',
  selfCredit.body?.approvalId,
  await decide(managerSrc.cookie, selfCredit.body?.approvalId, { decision: 'APPROVED' }),
])

const selfViolations = pendingSelfChecks.filter(([, , response]) => response.status !== 403)
const selfStates = [
  selfTransfer.body?.transfer?.status,
  selfWriteOff.body?.writeOff?.status,
  selfPrice.body?.status,
  selfCredit.body?.status,
]
check(
  '30.1',
  'a requester cannot decide their own transfer, write-off, price or credit request',
  pendingSelfChecks.length === 4 &&
    selfStates.join(',') === 'REQUESTED,PENDING_APPROVAL,PENDING_APPROVAL,PENDING' &&
    selfViolations.length === 0,
  `${selfStates.join(',')}; decisions ${pendingSelfChecks.map(([type, , response]) => `${type}:${response.status}`).join(', ')}`,
)
note('the shift variance requester was covered by leg 23.1: the closer is refused their own review')

const idorRoutes = [
  ['transfer', await get(managerForeign.cookie, `/api/transfers/${transferOneId}`)],
  ['write-off', await get(managerForeign.cookie, `/api/write-offs/${writeOffOneId}`)],
  ['count', await get(managerForeign.cookie, `/api/counts/${manualCountId}`)],
  ['approval', await get(managerForeign.cookie, `/api/approvals/${writeOffOneApproval}`)],
  [
    'credit profile',
    await get(
      managerForeign.cookie,
      `/api/credit/profiles?customerId=${customerOne.id}&branchId=${srcId}`,
    ),
  ],
]
const idorLeaks = idorRoutes.filter(([, response]) => response.status !== 403)
note(
  `foreign-branch reads refused: ${idorRoutes.map(([label, response]) => `${label} ${response.status}`).join(', ')}`,
)
check(
  '30.2',
  'a foreign branch gets a 403 on every document read that names a branch',
  idorLeaks.length === 0,
  idorRoutes.map(([label, response]) => `${label}:${response.status}`).join(', '),
)

const smuggledWriteOff = await post(managerSrc.cookie, '/api/write-offs', {
  branchId: dstId,
  lines: [{ productId: p4, quantity: 1, reason: 'DAMAGE' }],
})
const smuggledCount = await post(managerForeign.cookie, '/api/counts', { branchId: srcId })
const smuggledCredit = await post(
  managerSrc.cookie,
  `/api/credit/profiles/${customerOne.id}/limit-requests`,
  { proposedLimitMinor: 900_000, reason: 'Smuggled branch', branchId: dstId },
)
const smuggledTransfer = await post(managerDst.cookie, '/api/transfers', {
  branchId: srcId,
  fromBranchId: srcId,
  toBranchId: dstId,
  lines: [{ productId: p1, quantityRequested: 1 }],
})
const foreignDestination = await transferRequest(managerForeign.cookie, {
  fromBranchId: srcId,
  toBranchId: dstId,
  productId: p1,
  quantity: 1,
})
check(
  '30.3',
  'a branchId smuggled into a body is refused, never honoured',
  smuggledWriteOff.status === 400 &&
    smuggledCount.status === 403 &&
    smuggledCredit.status === 400 &&
    smuggledTransfer.status === 400 &&
    foreignDestination.status === 403,
  `write-off ${smuggledWriteOff.status}, count ${smuggledCount.status}, credit ${smuggledCredit.status}, transfer body ${smuggledTransfer.status}, foreign destination ${foreignDestination.status}`,
)

section('31: every decision is audited, and every effect has its own row')

const decisions = await rows(
  `select a.id, a.type, a.status, a.decision_reason_code, a.decided_by
     from approval a
    where (a.entity_id = any($1::uuid[]) or a.entity_id = any($2::uuid[]))
      and a.status in ('APPROVED', 'REJECTED')`,
  [
    [
      transferOneId,
      transferTwoId,
      transferWhId,
      writeOffOneId,
      writeOffTwoId,
      writeOffThreeId,
      shiftB.shiftId,
      profileOne.id,
    ].filter(Boolean),
    [p1, p2, p3, p5, p11],
  ],
)
const missing = []
for (const decision of decisions) {
  const audit = await one(
    `select actor_id, actor_staff_id, before, after from audit_log
      where action = 'approval.decided' and entity_id = $1 order by created_at desc limit 1`,
    [decision.id],
  )
  const ok =
    audit !== null &&
    (audit.actor_staff_id !== null || audit.actor_id !== null) &&
    audit.before?.status === 'PENDING' &&
    audit.after?.status === decision.status &&
    (decision.status !== 'REJECTED' || decision.decision_reason_code !== null)
  if (!ok) missing.push(`${decision.type}:${decision.id.slice(0, 8)}`)
}
check(
  '31.1',
  'every decided approval has an approval.decided row naming actor, before and after',
  decisions.length > 0 && missing.length === 0,
  `${decisions.length} decisions, missing ${missing.join(',') || 'none'}`,
)

const effectRows = await rows(
  `select distinct action from audit_log
    where (entity_id = any($1::text[]) or entity_id = any($2::text[]) or entity_id = any($3::text[]))`,
  [
    [transferOneId, transferTwoId, transferWhId, writeOffOneId, writeOffTwoId],
    [p1, p2, p3, p11],
    [shiftB.shiftId, profileOne.id],
  ],
)
const effectActions = new Set(effectRows.map((row) => row.action))
const expectedEffects = [
  ['transfer.approved', 'the transfer decision'],
  ['transfer.rejected', 'the rejected transfer'],
  ['transfer.dispatched', 'the dispatch'],
  ['transfer.received', 'the receipt'],
  ['stock_write_off.approved', 'the approved write-off'],
  ['stock_write_off.rejected', 'the rejected write-off'],
  ['product.price.override_set', 'the applied price'],
  ['credit.profile_updated', 'the credit limit'],
  ['pos.shift.reviewed', 'the variance review'],
]
const missingEffects = expectedEffects.filter(([action]) => !effectActions.has(action))
check(
  '31.2',
  'every effect has its own action row',
  missingEffects.length === 0,
  missingEffects.map(([action]) => action).join(', ') || [...effectActions].join(', '),
)

section('32: the POS is untouched')

function git(args) {
  return execFileSync('git', args, { cwd: repoRoot, encoding: 'utf8' }).trim()
}
// The phase starts where its implementation starts: the parent of the first commit after
// the plan set that changes `api/` or `packages/`. The plan set and the planning
// amendments before it are not implementation, and a POS-only fix that landed in between
// is named below rather than folded into the phase.
const phaseFolderCommit = git([
  'log',
  '--diff-filter=A',
  '--format=%H',
  '--',
  '.planning/phases/12-branch-ops-approvals/README.md',
])
  .split('\n')
  .filter(Boolean)
  .pop()
let phaseStart = null
for (const sha of git(['log', '--reverse', '--format=%H', `${phaseFolderCommit}..HEAD`])
  .split('\n')
  .filter(Boolean)) {
  const changed = git(['show', '--name-only', '--format=', '--no-renames', sha])
    .split('\n')
    .filter(Boolean)
  if (changed.some((file) => file.startsWith('api/') || file.startsWith('packages/'))) {
    phaseStart = git(['rev-parse', `${sha}^`])
    note(
      `phase start ${phaseStart.slice(0, 8)} (before ${sha.slice(0, 8)} ${git(['log', '-1', '--format=%s', sha])})`,
    )
    break
  }
}
const lastPosCommit = git([
  'log',
  '-1',
  '--format=%h %ad %s',
  '--date=short',
  '--',
  'desktop/',
  'powersync/',
])
note(`last commit touching desktop/ or powersync/: ${lastPosCommit}`)
const posDiff = phaseStart
  ? git(['diff', '--stat', `${phaseStart}..HEAD`, '--', 'desktop/', 'powersync/'])
  : 'unknown'
check(
  '32.1',
  'git diff over desktop/ and powersync/ is empty since the phase started',
  phaseStart !== null && posDiff === '',
  `base ${phaseStart?.slice(0, 8)}, diff: ${posDiff || '(empty)'}`,
)
skip(
  '32.2',
  'the desktop suite still passes at its committed count',
  'the desktop suite is a repository-wide gate and this walkthrough must not restart the API or run another workspace suite',
  'evidence/suites.txt (51 files, 427 tests, recorded by run-suites.sh)',
)

// ------------------------------------------------------------------ cleanup

section('cleanup (rows this run created, foreign-key order)')

const params = {
  branches: [branchIds],
  customers: [created.customers],
  products: [productIds],
  supplier: [supplierId],
  uom: [uomId],
  categories: [[categoryMain, categoryCount]],
  staff: [created.staff],
}
const cleanupStatements = [
  ['sale', 'delete from sale where branch_id = any($1::uuid[])', params.branches],
  ['cash_movement', 'delete from cash_movement where branch_id = any($1::uuid[])', params.branches],
  ['shift', 'delete from shift where branch_id = any($1::uuid[])', params.branches],
  ['sync_conflict', 'delete from sync_conflict where branch_id = any($1::uuid[])', params.branches],
  [
    'pos_sync_transaction',
    'delete from pos_sync_transaction where terminal_id in (select id from terminal where branch_id = any($1::uuid[]))',
    params.branches,
  ],
  [
    'pos_staff_binding',
    'delete from pos_staff_binding where branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'device',
    'delete from device where terminal_id in (select id from terminal where branch_id = any($1::uuid[]))',
    params.branches,
  ],
  ['terminal', 'delete from terminal where branch_id = any($1::uuid[])', params.branches],
  [
    'stock_write_off',
    'delete from stock_write_off where branch_id = any($1::uuid[])',
    params.branches,
  ],
  ['stock_count', 'delete from stock_count where branch_id = any($1::uuid[])', params.branches],
  [
    'count_schedule',
    'delete from count_schedule where branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'transfer',
    'delete from transfer where from_branch_id = any($1::uuid[]) or to_branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'stock_receipt_line',
    'delete from stock_receipt_line where receipt_id in (select id from stock_receipt where branch_id = any($1::uuid[]))',
    params.branches,
  ],
  ['stock_receipt', 'delete from stock_receipt where branch_id = any($1::uuid[])', params.branches],
  [
    'stock_movement',
    'delete from stock_movement where branch_id = any($1::uuid[])',
    params.branches,
  ],
  ['stock_level', 'delete from stock_level where branch_id = any($1::uuid[])', params.branches],
  [
    'stock_threshold',
    'delete from stock_threshold where branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'stock_abc_class',
    'delete from stock_abc_class where branch_id = any($1::uuid[])',
    params.branches,
  ],
  ['product_price', 'delete from product_price where branch_id = any($1::uuid[])', params.branches],
  [
    'credit_ledger_entry',
    'delete from credit_ledger_entry where branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'credit_profile',
    'delete from credit_profile where branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'loyalty_ledger_entry',
    'delete from loyalty_ledger_entry where customer_id = any($1::uuid[])',
    params.customers,
  ],
  [
    'loyalty_account',
    'delete from loyalty_account where customer_id = any($1::uuid[])',
    params.customers,
  ],
  ['customer', 'delete from customer where id = any($1::uuid[])', params.customers],
  [
    'document_sequence',
    'delete from document_sequence where branch_id = any($1::uuid[])',
    params.branches,
  ],
  [
    'approval',
    'delete from approval where branch_id = any($1::uuid[]) or decider_branch_id = any($1::uuid[])',
    params.branches,
  ],
  ['product', 'delete from product where id = any($1::uuid[])', params.products],
  ['supplier', 'delete from supplier where id = $1', params.supplier],
  ['uom', 'delete from uom where id = $1', params.uom],
  ['category', 'delete from category where id = any($1::uuid[])', params.categories],
  // Better Auth's account/session/two_factor rows cascade from the user; the user rows are
  // the throwaway accounts this run created.
  ['staff user', 'delete from "user" where id = any($1::text[])', params.staff],
  ['branch', 'delete from branch where id = any($1::uuid[])', params.branches],
]

const cleanupProblems = []
for (const [label, statement, values] of cleanupStatements) {
  try {
    await db.query(statement, values)
  } catch (error) {
    cleanupProblems.push(`${label}: ${error.message}`)
  }
}
const residualBranches = await one(
  'select count(*)::int as total from branch where id = any($1::uuid[])',
  [branchIds],
)
const residualProducts = await one(
  'select count(*)::int as total from product where id = any($1::uuid[])',
  [productIds],
)
console.log(
  `CLEANUP  branches removed ${branchIds.length - (residualBranches?.total ?? 0)}/${branchIds.length}, products removed ${productIds.length - (residualProducts?.total ?? 0)}/${productIds.length}`,
)
if (cleanupProblems.length > 0) {
  console.log(`CLEANUP  problems: ${cleanupProblems.join(' | ')}`)
}
if ((residualBranches?.total ?? 0) > 0 || (residualProducts?.total ?? 0) > 0) {
  failures.push('cleanup left rows behind')
}

await boss.stop({ timeout: 5_000 })
await db.end()

// ------------------------------------------------------------------- result

const fullyDriven = [...drivenLegs].filter((leg) => !skippedLegs.has(leg)).length
console.log(
  `\nPASS ${passed}  FAIL ${failures.length}  NOT-DRIVEN ${notDriven}  (legs with a driven check ${drivenLegs.size}/32, fully driven ${fullyDriven}/32)`,
)
if (failures.length > 0) {
  console.log(failures.map((failure) => `  failed: ${failure}`).join('\n'))
  process.exit(1)
}
