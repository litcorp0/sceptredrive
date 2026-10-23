#!/usr/bin/env bun
/**
 * Phase 6 Plan 09 — POS API + SQL walkthrough (fresh database only).
 *
 * Drives the real HTTP API (`:4000`) exactly as an enrolled terminal would and
 * proves the phase invariants directly in SQL:
 *
 *   1. enrollment / device JWTs / PowerSync tokens / revocation
 *   2. PIN authorization, binding hashing, PIN change, stale credentials
 *   3. shifts (one open per terminal, cash movements, server expected cash)
 *   4. cash sale + exactly-once replay
 *   5. credit sales (within limit, over limit, override, hold)
 *   6. loyalty (redeem, negative balance, rate drift)
 *   7. two-device last-unit race is in `race-last-unit.mjs` (Task 3)
 *   8. price/total drift, customer drafts, clock skew, unknown product
 *   9. reconciliation (sales + shifts) and audit/link SQL
 *  10. scoping and revocation
 *
 * Usage (repo root, fresh DB, API running against the same DATABASE_URL):
 *   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos \
 *     bun run .planning/phases/06-pos-offline-core/evidence/walkthrough-pos.mjs
 */
import { readFileSync } from 'node:fs'
import { priceCart } from '@gikautos/shared'
import { Client } from 'pg'

const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const ORIGIN = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5434/gikautos'
const DEMO_PASSWORD = process.env.DEMO_PASSWORD ?? 'demo-password-1234'

const STAMP = Date.now().toString(36).toUpperCase()
const TAX_MODE = 'INCLUSIVE'

let passed = 0
let failed = 0
const failures = []

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    failures.push(label)
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
}

function section(title) {
  console.log(`\n-- ${title} --`)
}

// --- HTTP -------------------------------------------------------------------

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

async function api(path, { method = 'GET', cookie, bearer, binding, body } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
  if (binding) headers['x-pos-binding'] = binding
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
  return { status: response.status, body: parsed, headers: response.headers }
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

// --- SQL --------------------------------------------------------------------

const db = new Client({ connectionString: DATABASE_URL })
await db.connect()

async function sqlRows(query, values = []) {
  const result = await db.query(query, values)
  return result.rows
}

async function sqlValue(query, values = []) {
  const rows = await sqlRows(query, values)
  const row = rows[0]
  return row ? Object.values(row)[0] : undefined
}

// --- POS payload builders ---------------------------------------------------

function priced(lines, { saleDiscountMinor = 0, loyaltyDiscountMinor = 0 } = {}) {
  return priceCart(lines, { taxMode: TAX_MODE, saleDiscountMinor, loyaltyDiscountMinor })
}

function baseTotals(pricedCart) {
  return {
    subtotalMinor: pricedCart.subtotalMinor,
    lineDiscountMinor: pricedCart.lineDiscountMinor,
    saleDiscountMinor: pricedCart.saleDiscountMinor,
    loyaltyDiscountMinor: pricedCart.loyaltyDiscountMinor,
    vatMinor: pricedCart.vatMinor,
    nhilMinor: pricedCart.nhilMinor,
    getfundMinor: pricedCart.getfundMinor,
    taxTotalMinor: pricedCart.taxTotalMinor,
    totalMinor: pricedCart.totalMinor,
    changeMinor: 0,
  }
}

function line(
  productId,
  unitPriceMinor,
  quantity = 1,
  lineDiscountMinor = 0,
  taxCategory = 'STANDARD',
) {
  return { productId, quantity, unitPriceMinor, lineDiscountMinor, taxCategory }
}

function cashierBlock(binding) {
  return {
    userId: binding.staff.userId,
    staffId: binding.staff.staffId,
    bindingId: binding.bindingId,
    bindingToken: binding.bindingToken,
    pinVersion: binding.pinVersion,
  }
}

/**
 * Builds one SALE transaction. `tender` is `{method:'CASH', amountMinor}` or
 * `{method:'CREDIT', amountMinor, override}`; omit it for a zero total.
 */
function saleTransaction({
  id,
  receiptNumber,
  shiftId,
  cashier,
  lines,
  customer = null,
  saleDiscount = null,
  loyalty = null,
  tender,
  totalsOverride = null,
  occurredAt = new Date().toISOString(),
}) {
  const saleDiscountMinor = saleDiscount?.amountMinor ?? 0
  const loyaltyDiscountMinor = loyalty?.redeemPoints
    ? priced(lines, { loyaltyDiscountMinor: loyalty?.discountMinor ?? 0 }).loyaltyDiscountMinor
    : 0
  const cart = priced(lines, { saleDiscountMinor, loyaltyDiscountMinor })
  const totals = { ...baseTotals(cart), ...(totalsOverride ?? {}) }

  const tenders = []
  if (tender?.method === 'CASH') {
    const changeMinor = tender.amountMinor - totals.totalMinor
    totals.changeMinor = changeMinor
    tenders.push({ method: 'CASH', amountMinor: tender.amountMinor })
  } else if (tender?.method === 'CREDIT') {
    tenders.push({
      method: 'CREDIT',
      amountMinor: tender.amountMinor,
      ...(tender.override ? { override: tender.override } : {}),
    })
  }

  return {
    clientTransactionId: id,
    type: 'SALE',
    occurredAt,
    payloadVersion: 1,
    payload: {
      receiptNumber,
      shiftId,
      cashier,
      customer,
      lines,
      saleDiscount,
      loyalty: loyalty
        ? {
            redeemPoints: loyalty.redeemPoints ?? 0,
            earnPreviewPoints: loyalty.earnPreviewPoints ?? 0,
          }
        : null,
      tenders,
      totals,
      occurredAt,
      appVersion: '0.1.0-verify',
    },
  }
}

function batch(device, transactions) {
  return {
    batchId: crypto.randomUUID(),
    deviceId: device.deviceId,
    terminalId: device.terminalId,
    transactions,
  }
}

async function upload(device, transactions) {
  return api('/api/pos/sync/upload', {
    method: 'POST',
    bearer: device.accessToken,
    body: batch(device, transactions),
  })
}

async function uploadOne(device, transaction) {
  const response = await upload(device, [transaction])
  return { status: response.status, result: response.body?.results?.[0] ?? null }
}

function conflictTypes(result) {
  return (result?.conflicts ?? []).map((conflict) => conflict.type)
}

async function enrollTerminal(adminCookie, branchId, name) {
  const created = await api('/api/terminals', {
    method: 'POST',
    cookie: adminCookie,
    body: { branchId, name },
  })
  const terminal = created.body?.terminal
  if (!terminal)
    throw new Error(`terminal create failed: ${created.status} ${JSON.stringify(created.body)}`)
  const enrollment = await api(`/api/terminals/${terminal.id}/enrollment`, {
    method: 'POST',
    cookie: adminCookie,
  })
  const code = enrollment.body?.enrollment?.code
  const redeemed = await api('/api/enrollments/redeem', {
    method: 'POST',
    body: { code, fingerprint: `verify-${name}-${STAMP}` },
  })
  const session = await api('/api/pos/session', {
    method: 'POST',
    bearer: redeemed.body?.deviceToken,
  })
  return {
    terminal,
    code,
    deviceToken: redeemed.body?.deviceToken,
    device: {
      deviceId: session.body?.deviceId,
      terminalId: session.body?.terminal?.id,
      accessToken: session.body?.accessToken,
      terminalCode: session.body?.terminal?.code,
    },
    session: session.body,
    enrollmentStatus: enrollment.status,
    redeemStatus: redeemed.status,
  }
}

console.log(`Phase 6 POS walkthrough — ${STAMP}`)
console.log(`API ${API}  DB ${DATABASE_URL.replace(/:[^:@/]+@/, ':***@')}`)

try {
  // ==========================================================================
  section('1. Enrollment, device JWTs, PowerSync tokens')

  const adminSession = await signIn(
    process.env.ADMIN_EMAIL ?? envValue('ADMIN_EMAIL'),
    envValue('ADMIN_PASSWORD'),
  )
  check('admin signs in', adminSession.status === 200, `status ${adminSession.status}`)
  const admin = adminSession.cookie

  const spx = (await sqlRows(`SELECT id, code FROM branch WHERE code = 'ACC-SPX'`))[0]
  const wh1 = (await sqlRows(`SELECT id, code FROM branch WHERE code = 'ACC-WH1'`))[0]
  check('seeded retail and warehouse branches exist', Boolean(spx && wh1))

  const terminalA = await enrollTerminal(admin, spx.id, `Verify A ${STAMP}`)
  const terminalB = await enrollTerminal(admin, spx.id, `Verify B ${STAMP}`)
  check('terminal A enrolls and redeems', terminalA.redeemStatus === 201)
  check('terminal B enrolls and redeems', terminalB.redeemStatus === 201)
  check(
    'the redeem response is a 32-byte token issued once',
    typeof terminalA.deviceToken === 'string' && terminalA.deviceToken.length === 43,
  )

  const storedDevice = (
    await sqlRows(`SELECT token_hash, status FROM device WHERE id = $1`, [
      terminalA.device.deviceId,
    ])
  )[0]
  check('only the device token hash is stored', storedDevice.token_hash !== terminalA.deviceToken)
  check('the device starts ACTIVE', storedDevice.status === 'ACTIVE')

  const reuse = await api('/api/enrollments/redeem', {
    method: 'POST',
    body: { code: terminalA.code },
  })
  check(
    'an enrollment code cannot be redeemed twice',
    reuse.status === 400,
    `status ${reuse.status}`,
  )

  check('session returns a device JWT', typeof terminalA.session?.accessToken === 'string')
  check('session reports the terminal branch', terminalA.session?.branch?.id === spx.id)
  check('session issues a device JWT', typeof terminalA.device.accessToken === 'string')
  check('config carries Africa/Accra', terminalA.session?.config?.serverTimeZone === 'Africa/Accra')
  check('config carries the tax mode', terminalA.session?.config?.taxMode === TAX_MODE)
  check(
    'the session never echoes the device token',
    !JSON.stringify(terminalA.session).includes(terminalA.deviceToken),
  )
  check(
    'the config snapshot carries no credentials',
    !/pinHash|pin_hash|"password"|deviceToken|refreshToken/i.test(
      JSON.stringify(terminalA.session?.config ?? {}),
    ),
  )

  const refresh = await api('/api/pos/session', {
    method: 'POST',
    bearer: terminalA.deviceToken,
  })
  check('the device token doubles as the refresh credential', refresh.status === 200)

  const syncToken = await api('/api/pos/powersync/token', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
  })
  const syncPayload = syncToken.body?.token?.split('.')[1]
  const syncClaims = syncPayload
    ? JSON.parse(Buffer.from(syncPayload, 'base64url').toString('utf8'))
    : {}
  check('PowerSync token endpoint returns 200', syncToken.status === 200)
  check('the PowerSync token is branch-scoped', syncClaims.branch_id === spx.id)
  check(
    'the PowerSync token names the terminal',
    syncClaims.terminal_id === terminalA.device.terminalId,
  )
  check(
    'the PowerSync token TTL is at most 15 minutes',
    typeof syncClaims.exp === 'number' &&
      typeof syncClaims.iat === 'number' &&
      syncClaims.exp - syncClaims.iat <= 900,
  )

  const jwks = await api('/.well-known/jwks.json')
  const jwk = jwks.body?.keys?.[0] ?? {}
  check('JWKS serves an Ed25519 public key', jwk.crv === 'Ed25519' && jwk.kty === 'OKP')
  check('JWKS never exposes the private key', jwk.d === undefined)

  const tampered = `${terminalA.device.accessToken.slice(0, -4)}AAAA`
  const tamperedResponse = await api('/api/pos/sync/state', { bearer: tampered })
  check('a tampered device JWT is rejected', tamperedResponse.status === 401)

  const wrongAudience = await api('/api/pos/sync/state', { bearer: syncToken.body?.token })
  check(
    'a PowerSync-audience token is rejected on the POS API',
    wrongAudience.status === 401,
    `status ${wrongAudience.status}`,
  )

  const warehouseTerminal = await api('/api/terminals', {
    method: 'POST',
    cookie: admin,
    body: { branchId: wh1.id, name: `Warehouse ${STAMP}` },
  })
  check(
    'a warehouse cannot host a POS terminal',
    warehouseTerminal.status === 409,
    `status ${warehouseTerminal.status}`,
  )

  const spare = await enrollTerminal(admin, spx.id, `Verify spare ${STAMP}`)
  await api(`/api/terminals/${spare.terminal.id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { isActive: false },
  })
  const inactiveSession = await api('/api/pos/session', {
    method: 'POST',
    bearer: spare.deviceToken,
  })
  check(
    'an inactive terminal cannot open a session',
    inactiveSession.status === 403,
    `status ${inactiveSession.status}`,
  )
  await api(`/api/terminals/${spare.terminal.id}`, {
    method: 'PATCH',
    cookie: admin,
    body: { isActive: true },
  })
  await sqlRows(`UPDATE device SET status = 'REVOKED', revoked_at = now() WHERE terminal_id = $1`, [
    spare.terminal.id,
  ])
  const revokedSession = await api('/api/pos/session', {
    method: 'POST',
    bearer: spare.deviceToken,
  })
  check('a revoked device cannot open a session', revokedSession.status === 403)
  const revokedSync = await api('/api/pos/powersync/token', {
    method: 'POST',
    bearer: spare.device.accessToken,
  })
  check('a revoked device cannot mint a PowerSync token', revokedSync.status === 403)

  // ==========================================================================
  section('2. PIN authorization, bindings, and stale credentials')

  const managerSession = await signIn('manager@gikautos.local', DEMO_PASSWORD)
  check('demo manager signs in', managerSession.status === 200, `status ${managerSession.status}`)
  await api('/api/me/password', {
    method: 'POST',
    cookie: managerSession.cookie,
    body: { currentPassword: DEMO_PASSWORD, newPassword: `Verify-manager-${STAMP}` },
  })
  const manager = managerSession.cookie

  const staffRows = await sqlRows(
    `SELECT id, staff_id, email, role, pin_version FROM "user" WHERE email IN ('cashier@gikautos.local','manager@gikautos.local','admin@gikautos.local')`,
  )
  const cashierStaff = staffRows.find((row) => row.role === 'CASHIER')
  const managerStaff = staffRows.find((row) => row.role === 'MANAGER')
  const adminStaff = staffRows.find((row) => row.role === 'ADMIN')

  const TEMP_PIN = '5739'
  const NEW_PIN = '8264'
  const MANAGER_PIN = '4817'
  const MANAGER_PIN_FINAL = '6238'

  const setTempPin = await api(`/api/staff/${cashierStaff.id}/pin`, {
    method: 'POST',
    cookie: manager,
    body: { pin: TEMP_PIN },
  })
  check(
    'a manager sets a cashier PIN in their branch',
    setTempPin.status === 200 || setTempPin.status === 201,
    `status ${setTempPin.status}`,
  )

  const statusAfterSet = await api(`/api/staff/${cashierStaff.id}/pin-status`, { cookie: manager })
  check('pin-status reports hasPin', statusAfterSet.body?.hasPin === true)
  check('a manager-set PIN must be changed', statusAfterSet.body?.pinMustChange === true)

  const managerOnAdmin = await api(`/api/staff/${adminStaff.id}/pin`, {
    method: 'POST',
    cookie: manager,
    body: { pin: '9183' },
  })
  check(
    'a manager cannot reset an admin PIN',
    managerOnAdmin.status === 403,
    `status ${managerOnAdmin.status}`,
  )

  const authorize = await api('/api/pos/staff/authorize', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    body: { staffCode: cashierStaff.staff_id, pin: TEMP_PIN },
  })
  const oldBinding = authorize.body
  check(
    'the cashier authorizes on device A',
    authorize.status === 201,
    `status ${authorize.status}`,
  )
  check('authorization reports mustChangePin', oldBinding?.mustChangePin === true)
  check(
    'the binding token is returned only in the response',
    typeof oldBinding?.bindingToken === 'string' && oldBinding.bindingToken.length >= 40,
  )

  const storedBinding = (
    await sqlRows(`SELECT binding_token_hash FROM pos_staff_binding WHERE id = $1`, [
      oldBinding?.bindingId,
    ])
  )[0]
  check(
    'only the binding token hash is stored',
    storedBinding?.binding_token_hash !== oldBinding?.bindingToken,
  )

  const wrongPin = await api('/api/pos/staff/authorize', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    body: { staffCode: cashierStaff.staff_id, pin: '1111' },
  })
  check('a wrong PIN is a generic 401', wrongPin.status === 401)
  check(
    'the error code does not distinguish the failure',
    wrongPin.body?.error?.code === 'PIN_INVALID',
  )

  const changePin = await api('/api/pos/staff/change-pin', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    binding: oldBinding.bindingToken,
    body: { currentPin: TEMP_PIN, newPin: NEW_PIN },
  })
  const changed = changePin.body
  check(
    'the cashier changes the temporary PIN',
    changePin.status === 200,
    `status ${changePin.status}`,
  )
  check('the PIN version advances', changed?.pinVersion > oldBinding?.pinVersion)

  const oldValidation = await api('/api/pos/staff/binding/validate', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    binding: oldBinding.bindingToken,
  })
  check(
    'the previous binding is dead after a PIN change',
    oldValidation.status === 200 && oldValidation.body?.valid === false,
  )
  const newValidation = await api('/api/pos/staff/binding/validate', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    binding: changed.bindingToken,
  })
  check('the replacement binding is valid', newValidation.body?.valid === true)

  const setManagerPin = await api(`/api/staff/${managerStaff.id}/pin`, {
    method: 'POST',
    cookie: admin,
    body: { pin: MANAGER_PIN },
  })
  check(
    'an admin sets the manager PIN',
    setManagerPin.status === 200 || setManagerPin.status === 201,
  )
  const managerAuthorize = await api('/api/pos/staff/authorize', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    body: { staffCode: managerStaff.staff_id, pin: MANAGER_PIN },
  })
  check('the manager authorizes on device A', managerAuthorize.status === 201)
  check('the manager PIN must be changed first', managerAuthorize.body?.mustChangePin === true)
  const managerChange = await api('/api/pos/staff/change-pin', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    binding: managerAuthorize.body.bindingToken,
    body: { currentPin: MANAGER_PIN, newPin: MANAGER_PIN_FINAL },
  })
  check('the manager changes the temporary PIN', managerChange.status === 200)
  const managerBinding = managerChange.body
  check('the manager binding needs no PIN change', managerBinding?.mustChangePin === false)

  const cashier = {
    staff: { userId: cashierStaff.id, staffId: cashierStaff.staff_id },
    bindingId: changed.bindingId,
    bindingToken: changed.bindingToken,
    pinVersion: changed.pinVersion,
  }

  // ==========================================================================
  section('3. Shifts: one per terminal, cash movements, server expected cash')

  const deviceB = {
    ...terminalB.device,
    cashier,
  }
  const managerBindingBResponse = await api('/api/pos/staff/authorize', {
    method: 'POST',
    bearer: terminalB.device.accessToken,
    body: { staffCode: managerStaff.staff_id, pin: MANAGER_PIN_FINAL },
  })
  check('the manager authorizes on device B', managerBindingBResponse.status === 201)
  const cashierBResponse = await api('/api/pos/staff/authorize', {
    method: 'POST',
    bearer: terminalB.device.accessToken,
    body: { staffCode: cashierStaff.staff_id, pin: NEW_PIN },
  })
  const cashierB = cashierBResponse.body
  check('the cashier authorizes on device B', cashierBResponse.status === 201)

  const shiftB = crypto.randomUUID()
  const shiftBNumber = `${terminalB.device.terminalCode}-S-${todayStamp()}-01`
  const openB = await uploadOne(deviceB, {
    clientTransactionId: shiftB,
    type: 'SHIFT_OPEN',
    occurredAt: new Date().toISOString(),
    payloadVersion: 1,
    payload: {
      shiftId: shiftB,
      number: shiftBNumber,
      openingFloatMinor: 20_000,
      cashierUserId: cashierStaff.id,
      cashierStaffId: cashierStaff.staff_id,
      occurredAt: new Date().toISOString(),
    },
  })
  check(
    'device B opens a shift',
    openB.result?.status === 'APPLIED',
    JSON.stringify(openB.result?.error),
  )
  check('the open result carries the shift id', openB.result?.resolved?.shiftId === shiftB)

  const duplicateOpen = await uploadOne(deviceB, {
    clientTransactionId: crypto.randomUUID(),
    type: 'SHIFT_OPEN',
    occurredAt: new Date().toISOString(),
    payloadVersion: 1,
    payload: {
      shiftId: crypto.randomUUID(),
      number: `${terminalB.device.terminalCode}-S-${todayStamp()}-02`,
      openingFloatMinor: 5_000,
      cashierUserId: cashierStaff.id,
      cashierStaffId: cashierStaff.staff_id,
      occurredAt: new Date().toISOString(),
    },
  })
  check(
    'a second open shift on the same terminal is rejected',
    duplicateOpen.result?.status === 'REJECTED',
  )
  const openShiftCount = await sqlValue(
    `SELECT count(*)::int FROM shift WHERE terminal_id = $1 AND status = 'OPEN'`,
    [terminalB.device.terminalId],
  )
  check('the partial unique index still allows exactly one open shift', openShiftCount === 1)

  const cashInId = crypto.randomUUID()
  const cashOutId = crypto.randomUUID()
  const cashIn = await uploadOne(
    deviceB,
    cashMovementTx(cashInId, shiftB, 'CASH_IN', 5_000, cashierStaff),
  )
  const cashOut = await uploadOne(
    deviceB,
    cashMovementTx(cashOutId, shiftB, 'CASH_OUT', 1_500, cashierStaff),
  )
  check('a cash-in movement applies', cashIn.result?.status === 'APPLIED')
  check('a cash-out movement applies', cashOut.result?.status === 'APPLIED')

  const serverExpected = 20_000 + 5_000 - 1_500
  const closeB = await uploadOne(deviceB, {
    clientTransactionId: crypto.randomUUID(),
    type: 'SHIFT_CLOSE',
    occurredAt: new Date().toISOString(),
    payloadVersion: 1,
    payload: {
      shiftId: shiftB,
      countedCashMinor: serverExpected - 700,
      clientExpectedCashMinor: serverExpected - 200,
      closeNote: 'verification: counted cash short, client total drifted',
      occurredAt: new Date().toISOString(),
    },
  })
  check('the shift closes', closeB.result?.status === 'APPLIED')
  check(
    'a client/server expected-cash difference raises SHIFT_VARIANCE_MISMATCH',
    conflictTypes(closeB.result).includes('SHIFT_VARIANCE_MISMATCH'),
  )
  const closedB = (
    await sqlRows(
      `SELECT status, server_expected_cash_minor, client_expected_cash_minor, variance_minor, counted_cash_minor FROM shift WHERE id = $1`,
      [shiftB],
    )
  )[0]
  check(
    'the server expected cash is authoritative',
    Number(closedB.server_expected_cash_minor) === serverExpected,
  )
  check('the variance is stored', Number(closedB.variance_minor) === -700)
  check('the shift is CLOSED', closedB.status === 'CLOSED')

  const shiftA = crypto.randomUUID()
  const openA = await uploadOne(terminalA.device, {
    clientTransactionId: shiftA,
    type: 'SHIFT_OPEN',
    occurredAt: new Date().toISOString(),
    payloadVersion: 1,
    payload: {
      shiftId: shiftA,
      number: `${terminalA.device.terminalCode}-S-${todayStamp()}-01`,
      openingFloatMinor: 30_000,
      cashierUserId: cashierStaff.id,
      cashierStaffId: cashierStaff.staff_id,
      occurredAt: new Date().toISOString(),
    },
  })
  check('device A opens the selling shift', openA.result?.status === 'APPLIED')

  // ==========================================================================
  section('4. Cash sale and exactly-once replay')

  const products = await sqlRows(
    `SELECT p.id, p.sku, p.base_price_minor, p.tax_category,
            pp.price_minor AS branch_price_minor
       FROM product p
       LEFT JOIN product_price pp ON pp.product_id = p.id AND pp.branch_id = $1
      WHERE p.sku IN ('GIK-00001','GIK-00002','GIK-00003','GIK-00004','GIK-00009','GIK-00011')`,
    [spx.id],
  )
  const bySku = Object.fromEntries(
    products.map((row) => [
      row.sku,
      {
        id: row.id,
        price: Number(row.branch_price_minor ?? row.base_price_minor),
        taxCategory: row.tax_category,
      },
    ]),
  )
  check('the demo catalogue is present', Boolean(bySku['GIK-00001'] && bySku['GIK-00009']))

  const customers = await sqlRows(
    `SELECT c.id, c.name, c.phone, cp.limit_minor, cp.balance_minor, la.balance_points
       FROM customer c
       LEFT JOIN credit_profile cp ON cp.customer_id = c.id AND cp.branch_id = $1
       LEFT JOIN loyalty_account la ON la.customer_id = c.id
      WHERE c.phone IN ('+233241000001','+233241000002')`,
    [spx.id],
  )
  const akosua = customers.find((row) => row.phone === '+233241000001')
  const kwame = customers.find((row) => row.phone === '+233241000002')
  check('the demo credit and loyalty customers are present', Boolean(akosua && kwame))
  const akosuaOpeningBalance = Number(akosua.balance_minor)
  const akosuaLimit = Number(akosua.limit_minor)

  const stockBefore = Number(
    await sqlValue(
      `SELECT quantity_on_hand FROM stock_level WHERE product_id = $1 AND branch_id = $2`,
      [bySku['GIK-00001'].id, spx.id],
    ),
  )

  const cashSaleId = crypto.randomUUID()
  const cashReceipt = `${terminalA.device.terminalCode}-${todayStamp()}-9001`
  const cashLines = [line(bySku['GIK-00001'].id, bySku['GIK-00001'].price)]
  const cashSale = saleTransaction({
    id: cashSaleId,
    receiptNumber: cashReceipt,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: cashLines,
    customer: { id: kwame.id, phone: kwame.phone, name: kwame.name },
    tender: { method: 'CASH', amountMinor: 10_000 },
  })
  const cashResult = await uploadOne(terminalA.device, cashSale)
  check(
    'a cash sale applies',
    cashResult.result?.status === 'APPLIED',
    JSON.stringify(cashResult.result?.error),
  )
  check(
    'the sale id is the client transaction id',
    cashResult.result?.resolved?.saleId === cashSaleId,
  )
  check('a clean cash sale raises no conflicts', conflictTypes(cashResult.result).length === 0)

  const cashHeader = (await sqlRows(`SELECT * FROM sale WHERE id = $1`, [cashSaleId]))[0]
  check(
    'the sale header stores the charged total',
    Number(cashHeader.total_minor) === cashSale.payload.totals.totalMinor,
  )
  check(
    'the cash change is stored',
    Number(cashHeader.change_minor) === cashSale.payload.totals.changeMinor,
  )
  check('the sale names the shift', cashHeader.shift_id === shiftA)
  check('the sale names the receipt', cashHeader.receipt_number === cashReceipt)

  const cashLinesRows = await sqlRows(`SELECT * FROM sale_line WHERE sale_id = $1`, [cashSaleId])
  check('the sale line is stored', cashLinesRows.length === 1)
  const cashTenderRows = await sqlRows(`SELECT * FROM sale_tender WHERE sale_id = $1`, [cashSaleId])
  check(
    'exactly one tender is stored',
    cashTenderRows.length === 1 && cashTenderRows[0].method === 'CASH',
  )

  const saleMovements = await sqlRows(
    `SELECT product_id, quantity_delta, reference_number, reference_type
       FROM stock_movement WHERE reference_id = $1 AND type = 'SALE'`,
    [cashSaleId],
  )
  check('one SALE movement is posted', saleMovements.length === 1)
  check('the movement references the receipt', saleMovements[0]?.reference_number === cashReceipt)
  check('the movement is negative', Number(saleMovements[0]?.quantity_delta) === -1)

  const stockAfter = Number(
    await sqlValue(
      `SELECT quantity_on_hand FROM stock_level WHERE product_id = $1 AND branch_id = $2`,
      [bySku['GIK-00001'].id, spx.id],
    ),
  )
  check('the stock projection moved by one', stockAfter === stockBefore - 1)

  const earnEntry = await sqlRows(
    `SELECT points_delta FROM loyalty_ledger_entry WHERE reference_id = $1 AND kind = 'EARN'`,
    [cashSaleId],
  )
  check(
    'the cash sale earns loyalty points',
    earnEntry.length === 1 && Number(earnEntry[0].points_delta) > 0,
  )

  const replay = await uploadOne(terminalA.device, cashSale)
  check('the same client transaction replays as REPLAYED', replay.result?.status === 'REPLAYED')
  check(
    'the replay returns the same server id',
    replay.result?.serverId === cashResult.result?.serverId,
  )
  const saleCount = await sqlValue(`SELECT count(*)::int FROM sale WHERE id = $1`, [cashSaleId])
  const movementCount = await sqlValue(
    `SELECT count(*)::int FROM stock_movement WHERE reference_id = $1 AND type = 'SALE'`,
    [cashSaleId],
  )
  const earnCount = await sqlValue(
    `SELECT count(*)::int FROM loyalty_ledger_entry WHERE reference_id = $1 AND kind = 'EARN'`,
    [cashSaleId],
  )
  check('the replay creates no second sale', saleCount === 1)
  check('the replay creates no second stock movement', movementCount === 1)
  check('the replay creates no second loyalty entry', earnCount === 1)

  // ==========================================================================
  section('5. Credit sales: within limit, over limit, manager override, hold')

  const creditWithinId = crypto.randomUUID()
  const creditWithin = saleTransaction({
    id: creditWithinId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9002`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00002'].id, bySku['GIK-00002'].price)],
    customer: { id: akosua.id, phone: akosua.phone, name: akosua.name },
    tender: { method: 'CREDIT', amountMinor: 8_000 },
  })
  const creditWithinResult = await uploadOne(terminalA.device, creditWithin)
  check('a credit sale within the limit applies', creditWithinResult.result?.status === 'APPLIED')
  check(
    'a credit sale within the limit raises no conflict',
    conflictTypes(creditWithinResult.result).length === 0,
  )
  const creditLedger = await sqlRows(
    `SELECT amount_minor, reference_number, kind FROM credit_ledger_entry WHERE reference_id = $1`,
    [creditWithinId],
  )
  check(
    'the credit charge is recorded once',
    creditLedger.length === 1 && creditLedger[0].kind === 'CHARGE',
  )
  check(
    'the credit charge references the receipt',
    creditLedger[0]?.reference_number === creditWithin.payload.receiptNumber,
  )
  const balanceAfterWithin = Number(
    await sqlValue(
      `SELECT balance_minor FROM credit_profile WHERE customer_id = $1 AND branch_id = $2`,
      [akosua.id, spx.id],
    ),
  )
  check(
    'the credit balance increased by the sale',
    balanceAfterWithin === akosuaOpeningBalance + 8_000,
  )

  const overLimitId = crypto.randomUUID()
  const overLimit = saleTransaction({
    id: overLimitId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9003`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00009'].id, bySku['GIK-00009'].price)],
    customer: { id: akosua.id, phone: akosua.phone, name: akosua.name },
    tender: { method: 'CREDIT', amountMinor: bySku['GIK-00009'].price },
  })
  const overLimitResult = await uploadOne(terminalA.device, overLimit)
  check('an over-limit credit sale still applies', overLimitResult.result?.status === 'APPLIED')
  check(
    'an over-limit credit sale raises CREDIT_OVER_LIMIT',
    conflictTypes(overLimitResult.result).includes('CREDIT_OVER_LIMIT'),
  )
  const overLimitLedger = await sqlRows(
    `SELECT amount_minor FROM credit_ledger_entry WHERE reference_id = $1 AND kind = 'CHARGE'`,
    [overLimitId],
  )
  check('the debt is still recorded', overLimitLedger.length === 1)

  const overrideProof = {
    staffId: managerStaff.staff_id,
    userId: managerStaff.id,
    bindingId: managerBinding.bindingId,
    pinVersion: managerBinding.pinVersion,
    reasonCode: 'CUSTOMER_REQUEST',
    note: 'verified in Plan 09 walkthrough',
    occurredAt: new Date().toISOString(),
  }
  const overrideId = crypto.randomUUID()
  const overrideSale = saleTransaction({
    id: overrideId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9004`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00011'].id, bySku['GIK-00011'].price, 2)],
    customer: { id: akosua.id, phone: akosua.phone, name: akosua.name },
    tender: {
      method: 'CREDIT',
      amountMinor: bySku['GIK-00011'].price * 2,
      override: overrideProof,
    },
  })
  const overrideResult = await uploadOne(terminalA.device, overrideSale)
  check(
    'an over-limit sale with a valid manager override applies',
    overrideResult.result?.status === 'APPLIED',
  )
  check(
    'a valid override suppresses CREDIT_OVER_LIMIT',
    !conflictTypes(overrideResult.result).includes('CREDIT_OVER_LIMIT'),
  )
  check(
    'a valid override raises no OVERRIDE_INVALID',
    !conflictTypes(overrideResult.result).includes('OVERRIDE_INVALID'),
  )
  const overrideAudit = await sqlRows(
    `SELECT a.action
       FROM audit_log a
       JOIN credit_ledger_entry e ON a.entity_id = e.id::text
      WHERE e.reference_id = $1 AND a.action = 'credit.override'`,
    [overrideId],
  )
  check('the override is audited on the credit entry', overrideAudit.length === 1)
  const overrideEntry = await sqlRows(
    `SELECT overridden_by, override_reason FROM credit_ledger_entry WHERE reference_id = $1`,
    [overrideId],
  )
  check(
    'the credit entry names the approver',
    overrideEntry[0]?.overridden_by !== null && overrideEntry[0]?.override_reason !== null,
  )

  const forgedProof = { ...overrideProof, bindingId: crypto.randomUUID() }
  const forgedId = crypto.randomUUID()
  const forgedSale = saleTransaction({
    id: forgedId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9005`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00011'].id, bySku['GIK-00011'].price, 2)],
    customer: { id: akosua.id, phone: akosua.phone, name: akosua.name },
    tender: {
      method: 'CREDIT',
      amountMinor: bySku['GIK-00011'].price * 2,
      override: forgedProof,
    },
  })
  const forgedResult = await uploadOne(terminalA.device, forgedSale)
  check('a forged override never blocks the sale', forgedResult.result?.status === 'APPLIED')
  check(
    'a forged override raises OVERRIDE_INVALID',
    conflictTypes(forgedResult.result).includes('OVERRIDE_INVALID'),
  )
  check(
    'a forged override still raises CREDIT_OVER_LIMIT',
    conflictTypes(forgedResult.result).includes('CREDIT_OVER_LIMIT'),
  )

  await api(`/api/credit/profiles/${akosua.id}`, {
    method: 'PUT',
    cookie: manager,
    body: { hold: true },
  })
  const heldId = crypto.randomUUID()
  const heldSale = saleTransaction({
    id: heldId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9006`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00002'].id, bySku['GIK-00002'].price)],
    customer: { id: akosua.id, phone: akosua.phone, name: akosua.name },
    tender: {
      method: 'CREDIT',
      amountMinor: 8_000,
      override: overrideProof,
    },
  })
  const heldResult = await uploadOne(terminalA.device, heldSale)
  check('a held account still completes the sale', heldResult.result?.status === 'APPLIED')
  check(
    'a held account raises CREDIT_HOLD',
    conflictTypes(heldResult.result).includes('CREDIT_HOLD'),
  )
  await api(`/api/credit/profiles/${akosua.id}`, {
    method: 'PUT',
    cookie: manager,
    body: { hold: false },
  })
  const holdCleared = await sqlValue(
    `SELECT hold FROM credit_profile WHERE customer_id = $1 AND branch_id = $2`,
    [akosua.id, spx.id],
  )
  check('the hold is released', holdCleared === false)

  // ==========================================================================
  section('6. Loyalty: redeem, negative balance, rate drift')

  const pointsBefore = Number(
    await sqlValue(`SELECT balance_points FROM loyalty_account WHERE customer_id = $1`, [kwame.id]),
  )
  const loyaltyCart = [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)]
  const redeem100 = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9007`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: loyaltyCart,
    customer: { id: kwame.id, phone: kwame.phone, name: kwame.name },
    loyalty: {
      redeemPoints: 100,
      discountMinor: 100,
      earnPreviewPoints: earnPreview(loyaltyCart, 100),
    },
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price },
  })
  const redeemResult = await uploadOne(terminalA.device, redeem100)
  check('a redemption within balance applies', redeemResult.result?.status === 'APPLIED')
  check(
    'a redemption within balance raises no loyalty conflict',
    !conflictTypes(redeemResult.result).some((type) => type.startsWith('LOYALTY')),
  )
  const redeemEntry = await sqlRows(
    `SELECT points_delta FROM loyalty_ledger_entry WHERE reference_id = $1 AND kind = 'REDEEM'`,
    [redeem100.clientTransactionId],
  )
  check(
    'one REDEEM entry is recorded',
    redeemEntry.length === 1 && Number(redeemEntry[0].points_delta) === -100,
  )
  const consumption = await sqlValue(
    `SELECT count(*)::int FROM loyalty_lot_consumption WHERE entry_id = (SELECT id FROM loyalty_ledger_entry WHERE reference_id = $1 AND kind = 'REDEEM')`,
    [redeem100.clientTransactionId],
  )
  check('the redemption consumes FEFO lots', consumption >= 1)
  const pointsAfterRedeem = Number(
    await sqlValue(`SELECT balance_points FROM loyalty_account WHERE customer_id = $1`, [kwame.id]),
  )
  check('the account balance dropped by the redemption', pointsAfterRedeem < pointsBefore)

  const beyondCart = [line(bySku['GIK-00009'].id, bySku['GIK-00009'].price)]
  const beyond = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9008`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: beyondCart,
    customer: { id: kwame.id, phone: kwame.phone, name: kwame.name },
    loyalty: {
      redeemPoints: 5_000,
      discountMinor: 5_000,
      earnPreviewPoints: earnPreview(beyondCart, 5_000),
    },
    tender: { method: 'CASH', amountMinor: bySku['GIK-00009'].price },
  })
  const beyondResult = await uploadOne(terminalA.device, beyond)
  check('a redemption beyond balance still applies', beyondResult.result?.status === 'APPLIED')
  check(
    'a redemption beyond balance raises LOYALTY_NEGATIVE',
    conflictTypes(beyondResult.result).includes('LOYALTY_NEGATIVE'),
  )
  const negativeBalance = Number(
    await sqlValue(`SELECT balance_points FROM loyalty_account WHERE customer_id = $1`, [kwame.id]),
  )
  check('the account balance is allowed to go negative', negativeBalance < 0)

  await api('/api/settings', {
    method: 'PATCH',
    cookie: admin,
    body: { key: 'loyalty.pointsPerCedi', value: 50 },
  })
  const rateChange = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9009`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    customer: { id: kwame.id, phone: kwame.phone, name: kwame.name },
    loyalty: {
      redeemPoints: 100,
      discountMinor: 100,
      earnPreviewPoints: earnPreview([line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)], 100),
    },
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price },
  })
  const rateChangeResult = await uploadOne(terminalA.device, rateChange)
  check('a rate drift sale still applies', rateChangeResult.result?.status === 'APPLIED')
  check(
    'a rate drift raises LOYALTY_RATE_CHANGED',
    conflictTypes(rateChangeResult.result).includes('LOYALTY_RATE_CHANGED'),
  )
  await api('/api/settings', {
    method: 'PATCH',
    cookie: admin,
    body: { key: 'loyalty.pointsPerCedi', value: 100 },
  })

  const earnDrift = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9010`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    customer: { id: kwame.id, phone: kwame.phone, name: kwame.name },
    loyalty: { redeemPoints: 0, earnPreviewPoints: 999 },
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price },
  })
  const earnDriftResult = await uploadOne(terminalA.device, earnDrift)
  check('an earn-preview drift sale still applies', earnDriftResult.result?.status === 'APPLIED')
  check(
    'an earn-preview drift raises LOYALTY_RATE_CHANGED',
    conflictTypes(earnDriftResult.result).includes('LOYALTY_RATE_CHANGED'),
  )

  // ==========================================================================
  section('7. Pricing, customer drafts, clock skew, unknown product')

  const priceMismatchId = crypto.randomUUID()
  const priceMismatch = saleTransaction({
    id: priceMismatchId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9011`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00004'].id, bySku['GIK-00004'].price - 1_000)],
    tender: { method: 'CASH', amountMinor: 20_000 },
  })
  const priceMismatchResult = await uploadOne(terminalA.device, priceMismatch)
  check('a price drift sale applies', priceMismatchResult.result?.status === 'APPLIED')
  check(
    'a price drift raises PRICE_MISMATCH',
    conflictTypes(priceMismatchResult.result).includes('PRICE_MISMATCH'),
  )
  const chargedPrice = await sqlValue(`SELECT unit_price_minor FROM sale_line WHERE sale_id = $1`, [
    priceMismatchId,
  ])
  check('the charged price is kept', Number(chargedPrice) === bySku['GIK-00004'].price - 1_000)

  const totalMismatchId = crypto.randomUUID()
  const totalMismatch = saleTransaction({
    id: totalMismatchId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9012`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price + 100 },
    totalsOverride: {
      subtotalMinor: bySku['GIK-00003'].price + 100,
      totalMinor: bySku['GIK-00003'].price + 100,
    },
  })
  const totalMismatchResult = await uploadOne(terminalA.device, totalMismatch)
  check(
    'a consistent-but-different header applies',
    totalMismatchResult.result?.status === 'APPLIED',
  )
  check(
    'a header drift raises TOTAL_MISMATCH',
    conflictTypes(totalMismatchResult.result).includes('TOTAL_MISMATCH'),
  )
  const storedTotal = await sqlValue(`SELECT total_minor FROM sale WHERE id = $1`, [
    totalMismatchId,
  ])
  check('the charged total is stored', Number(storedTotal) === bySku['GIK-00003'].price + 100)

  const inconsistentId = crypto.randomUUID()
  const inconsistent = saleTransaction({
    id: inconsistentId,
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9013`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price + 500 },
    totalsOverride: { totalMinor: bySku['GIK-00003'].price + 500 },
  })
  const inconsistentResult = await uploadOne(terminalA.device, inconsistent)
  check(
    'an internally inconsistent header is rejected',
    inconsistentResult.result?.status === 'REJECTED',
  )
  check(
    'the rejection code is INVALID_TOTALS',
    inconsistentResult.result?.error?.code === 'INVALID_TOTALS',
  )

  const duplicateDraftId = crypto.randomUUID()
  const duplicateDraft = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9014`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    customer: { id: duplicateDraftId, phone: akosua.phone, name: 'Misspelled Name' },
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price },
  })
  const duplicateResult = await uploadOne(terminalA.device, duplicateDraft)
  check('a duplicate phone still completes the sale', duplicateResult.result?.status === 'APPLIED')
  check(
    'a duplicate phone raises DUPLICATE_CUSTOMER',
    conflictTypes(duplicateResult.result).includes('DUPLICATE_CUSTOMER'),
  )
  check(
    'the sale links the existing customer',
    duplicateResult.result?.resolved?.customerId === akosua.id,
  )
  const draftRows = await sqlValue(`SELECT count(*)::int FROM customer WHERE id = $1`, [
    duplicateDraftId,
  ])
  check('no duplicate customer row is created', draftRows === 0)

  const invalidCustomer = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9015`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    customer: { id: crypto.randomUUID(), phone: '123', name: 'Bad Phone' },
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price },
  })
  const invalidResult = await uploadOne(terminalA.device, invalidCustomer)
  check('an invalid phone still completes the sale', invalidResult.result?.status === 'APPLIED')
  check(
    'an invalid phone raises INVALID_CUSTOMER',
    conflictTypes(invalidResult.result).includes('INVALID_CUSTOMER'),
  )

  const skewedAt = new Date(Date.now() - 2 * 60 * 60 * 1000).toISOString()
  const skewSale = saleTransaction({
    id: crypto.randomUUID(),
    receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9016`,
    shiftId: shiftA,
    cashier: cashierBlock(cashier),
    lines: [line(bySku['GIK-00003'].id, bySku['GIK-00003'].price)],
    tender: { method: 'CASH', amountMinor: bySku['GIK-00003'].price },
    occurredAt: skewedAt,
  })
  const skewResult = await uploadOne(terminalA.device, skewSale)
  check('a clock-skewed sale still applies', skewResult.result?.status === 'APPLIED')
  check(
    'clock skew beyond tolerance raises CLOCK_SKEW',
    conflictTypes(skewResult.result).includes('CLOCK_SKEW'),
  )

  const unknownId = crypto.randomUUID()
  const afterUnknown = crypto.randomUUID()
  const mixedBatch = await upload(terminalA.device, [
    saleTransaction({
      id: unknownId,
      receiptNumber: `${terminalA.device.terminalCode}-${todayStamp()}-9017`,
      shiftId: shiftA,
      cashier: cashierBlock(cashier),
      lines: [line(crypto.randomUUID(), 1_000)],
      tender: { method: 'CASH', amountMinor: 1_000 },
    }),
    cashMovementTx(afterUnknown, shiftA, 'CASH_IN', 250, cashierStaff),
  ])
  const [unknownResult, afterResult] = mixedBatch.body?.results ?? []
  check('an unknown product is rejected', unknownResult?.status === 'REJECTED')
  check(
    'the unknown-product rejection code is UNKNOWN_PRODUCT',
    unknownResult?.error?.code === 'UNKNOWN_PRODUCT',
  )
  check(
    'an unknown product writes a conflict',
    (unknownResult?.conflicts ?? []).some((conflict) => conflict.type === 'UNKNOWN_PRODUCT'),
  )
  check('the following transaction still applies', afterResult?.status === 'APPLIED')

  // ==========================================================================
  section('8. Reconciliation and SQL invariants')

  // Snapshot before the deliberate total-drift sale is excluded: reconciliation
  // must be clean except for that by-design divergence (D33 documents it).
  const reconciliation = await api(`/api/pos/reconciliation?branchId=${spx.id}`, { cookie: admin })
  check('reconciliation returns 200 for an admin', reconciliation.status === 200)
  const divergences = [
    ...(reconciliation.body?.sales ?? []),
    ...(reconciliation.body?.shifts ?? []),
  ]
  const expectedDrift = divergences.filter(
    (divergence) => divergence.receiptNumber === totalMismatch.payload.receiptNumber,
  )
  const unexpected = divergences.filter(
    (divergence) => divergence.receiptNumber !== totalMismatch.payload.receiptNumber,
  )
  check(
    'reconciliation reports no unexpected divergence',
    unexpected.length === 0,
    JSON.stringify(unexpected.slice(0, 2)),
  )
  check(
    'reconciliation flags exactly the charged-header drift',
    expectedDrift.length === 1 && expectedDrift[0].check === 'HEADER_TOTALS',
  )

  const ledgerCheck = await sqlRows(
    `SELECT sl.product_id,
            sl.quantity_on_hand::int AS projection,
            COALESCE(SUM(sm.quantity_delta), 0)::int AS ledger
       FROM stock_level sl
       LEFT JOIN stock_movement sm
         ON sm.product_id = sl.product_id AND sm.branch_id = sl.branch_id
      WHERE sl.branch_id = $1
      GROUP BY sl.product_id, sl.quantity_on_hand
     HAVING sl.quantity_on_hand <> COALESCE(SUM(sm.quantity_delta), 0)`,
    [spx.id],
  )
  check('the stock projection equals the movement ledger', ledgerCheck.length === 0)

  const shiftInvariant = await sqlRows(
    `SELECT terminal_id, count(*)::int AS open_shifts
       FROM shift WHERE branch_id = $1 AND status = 'OPEN'
      GROUP BY terminal_id HAVING count(*) > 1`,
    [spx.id],
  )
  check('each terminal has at most one open shift', shiftInvariant.length === 0)

  const orphanTenders = await sqlValue(
    `SELECT count(*)::int FROM sale_tender t LEFT JOIN sale s ON s.id = t.sale_id WHERE s.id IS NULL`,
  )
  check('no tender is orphaned', orphanTenders === 0)
  const orphanMovements = await sqlValue(
    `SELECT count(*)::int FROM stock_movement sm
      WHERE sm.type = 'SALE' AND NOT EXISTS (SELECT 1 FROM sale s WHERE s.id = sm.reference_id)`,
  )
  check('every SALE movement references a stored sale', orphanMovements === 0)
  const creditMismatch = await sqlRows(
    `SELECT s.id FROM sale s
      JOIN credit_ledger_entry e ON e.reference_id = s.id AND e.reference_type = 'SALE' AND e.kind = 'CHARGE'
      WHERE s.credit_amount_minor > 0
      GROUP BY s.id, s.credit_amount_minor
     HAVING SUM(e.amount_minor) <> s.credit_amount_minor`,
  )
  check('every credit sale has one matching charge', creditMismatch.length === 0)

  const auditActions = await sqlRows(
    `SELECT action, count(*)::int AS count FROM audit_log
      WHERE branch_id = $1 AND action LIKE 'pos.%'
      GROUP BY action`,
    [spx.id],
  )
  const auditMap = Object.fromEntries(auditActions.map((row) => [row.action, Number(row.count)]))
  check(
    'shifts are audited on open and close',
    auditMap['pos.shift.opened'] >= 2 && auditMap['pos.shift.closed'] >= 1,
  )
  check('cash movements are audited', auditMap['pos.cash.movement'] >= 3)
  check('applied sales are audited', auditMap['pos.sale.applied'] >= 10)
  check('conflicts are audited', auditMap['pos.sale.conflict'] >= 5)

  const unlinkedConflicts = await sqlValue(
    `SELECT count(*)::int FROM sync_conflict
      WHERE branch_id = $1 AND sale_id IS NULL AND shift_id IS NULL AND type <> 'UNKNOWN_PRODUCT'`,
    [spx.id],
  )
  check('every business conflict links a sale or shift', unlinkedConflicts === 0)

  const conflictCountA = await sqlValue(
    `SELECT count(*)::int FROM sync_conflict WHERE terminal_id = $1`,
    [terminalA.device.terminalId],
  )
  const conflictCountB = await sqlValue(
    `SELECT count(*)::int FROM sync_conflict WHERE terminal_id = $1`,
    [terminalB.device.terminalId],
  )
  check('device A produced business conflicts', conflictCountA >= 8)
  check('device B produced its shift-variance conflict', conflictCountB >= 1)

  // ==========================================================================
  section('9. Scoping and revocation')

  const deviceAConflicts = await api('/api/pos/sync/conflicts', {
    bearer: terminalA.device.accessToken,
  })
  check('a device reads its own conflicts', deviceAConflicts.status === 200)
  const deviceAConflictIds = new Set((deviceAConflicts.body?.conflicts ?? []).map((row) => row.id))
  const deviceBConflictIds = (
    await sqlRows(`SELECT id FROM sync_conflict WHERE terminal_id = $1`, [
      terminalB.device.terminalId,
    ])
  ).map((row) => row.id)
  check(
    'device A cannot see device B conflicts',
    deviceBConflictIds.every((id) => !deviceAConflictIds.has(id)),
  )
  check(
    'conflict reads expose no customer PII',
    !/phone|name|address|email/i.test(JSON.stringify(deviceAConflicts.body?.conflicts ?? [])),
  )

  const stateA = await api('/api/pos/sync/state', { bearer: terminalA.device.accessToken })
  check('device sync state returns 200', stateA.status === 200)
  check(
    'sync state reports its own pending conflicts',
    Number(stateA.body?.pendingConflicts) === conflictCountA,
  )
  check('sync state reports the config version', typeof stateA.body?.configVersion === 'string')

  const managerOnDevice = await api('/api/pos/sync/state', { cookie: manager })
  check('a manager session cannot call device endpoints', managerOnDevice.status === 401)

  const deviceOnAdmin = await api(`/api/pos/reconciliation?branchId=${spx.id}`, {
    bearer: terminalA.device.accessToken,
  })
  check('a device JWT cannot call admin endpoints', deviceOnAdmin.status === 401)

  const cashierSession = await signIn('cashier@gikautos.local', DEMO_PASSWORD)
  await api('/api/me/password', {
    method: 'POST',
    cookie: cashierSession.cookie,
    body: { currentPassword: DEMO_PASSWORD, newPassword: `Verify-cashier-${STAMP}` },
  })
  const cashierOnReconciliation = await api(`/api/pos/reconciliation?branchId=${spx.id}`, {
    cookie: cashierSession.cookie,
  })
  check(
    'a cashier cannot read reconciliation',
    cashierOnReconciliation.status === 403,
    `status ${cashierOnReconciliation.status}`,
  )

  await api(`/api/staff/${cashierStaff.id}/deactivate`, { method: 'POST', cookie: admin, body: {} })
  const deactivatedAuthorize = await api('/api/pos/staff/authorize', {
    method: 'POST',
    bearer: terminalA.device.accessToken,
    body: { staffCode: cashierStaff.staff_id, pin: NEW_PIN },
  })
  check('a deactivated cashier cannot authorize', deactivatedAuthorize.status === 401)
  await api(`/api/staff/${cashierStaff.id}/reactivate`, { method: 'POST', cookie: admin, body: {} })
  const reactivatedPinVersion = await sqlValue(`SELECT pin_version FROM "user" WHERE id = $1`, [
    cashierStaff.id,
  ])
  check(
    'reactivation advances the PIN version',
    Number(reactivatedPinVersion) > Number(cashier.pinVersion),
  )

  await sqlRows(`UPDATE device SET status = 'REVOKED', revoked_at = now() WHERE id = $1`, [
    terminalA.device.deviceId,
  ])
  const revokedUpload = await uploadOne(
    terminalA.device,
    cashMovementTx(crypto.randomUUID(), shiftA, 'CASH_IN', 100, cashierStaff),
  )
  check(
    'a revoked device is refused on upload',
    revokedUpload.status === 403,
    `status ${revokedUpload.status}`,
  )
  const revokedState = await api('/api/pos/sync/state', { bearer: terminalA.device.accessToken })
  check('a revoked device is refused on sync state', revokedState.status === 403)
} catch (error) {
  failed += 1
  failures.push(`unhandled: ${error.message}`)
  console.error('\nUNHANDLED ERROR', error)
} finally {
  await db.end()
}

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}

// --- helpers ----------------------------------------------------------------

function envValue(key) {
  const env = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8')
  return (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
}

function todayStamp() {
  const date = new Date()
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`
}

function earnPreview(lines, loyaltyDiscountMinor = 0) {
  const cart = priced(lines, { loyaltyDiscountMinor })
  return Math.floor((cart.baseMinor * 1) / 100)
}

function cashMovementTx(id, shiftId, type, amountMinor, staff) {
  return {
    clientTransactionId: id,
    type: 'CASH_MOVEMENT',
    occurredAt: new Date().toISOString(),
    payloadVersion: 1,
    payload: {
      id,
      shiftId,
      type,
      amountMinor,
      reason: `verification ${type.toLowerCase()}`,
      occurredAt: new Date().toISOString(),
      staffUserId: staff.id,
      staffStaffId: staff.staff_id,
    },
  }
}
