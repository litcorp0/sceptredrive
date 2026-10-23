#!/usr/bin/env bun
/**
 * Phase 6 Plan 09 — two-device last-unit race (Task 3).
 *
 * Two enrolled terminals in one branch upload a sale for the same product at the
 * same instant with one unit on hand. Both must apply (never block a sale), the
 * loser must carry exactly one STOCK_OVERSELL conflict, on-hand must end at -1,
 * and the append-only ledger must still equal the projection.
 *
 * Run against a fresh database with the API up:
 *   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos \
 *     bun run .planning/phases/06-pos-offline-core/evidence/race-last-unit.mjs
 */
import { readFileSync } from 'node:fs'
import { priceCart } from '@gikautos/shared'
import { Client } from 'pg'

const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const ORIGIN = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5434/gikautos'
const STAMP = Date.now().toString(36).toUpperCase()
const PIN = '5927'

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

const db = new Client({ connectionString: DATABASE_URL })
await db.connect()

function envValue(key) {
  const env = readFileSync(new URL('../../../../.env', import.meta.url), 'utf8')
  return (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
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

async function api(path, { method = 'GET', cookie, bearer, body } = {}) {
  const headers = { origin: ORIGIN }
  if (cookie) headers.cookie = cookie
  if (bearer) headers.authorization = `Bearer ${bearer}`
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

async function adminSignIn() {
  const jar = makeJar()
  const response = await fetch(`${API}/api/auth/sign-in/email`, {
    method: 'POST',
    headers: { origin: ORIGIN, 'content-type': 'application/json' },
    body: JSON.stringify({
      email: process.env.ADMIN_EMAIL ?? envValue('ADMIN_EMAIL'),
      password: envValue('ADMIN_PASSWORD'),
    }),
  })
  jar.update(response)
  await response.json().catch(() => null)
  return jar.header()
}

function line(productId, unitPriceMinor) {
  return { productId, quantity: 1, unitPriceMinor, lineDiscountMinor: 0, taxCategory: 'STANDARD' }
}

function salePayload({ id, receiptNumber, shiftId, binding, productId, price }) {
  const cart = priceCart([line(productId, price)], { taxMode: 'INCLUSIVE' })
  const occurredAt = new Date().toISOString()
  return {
    clientTransactionId: id,
    type: 'SALE',
    occurredAt,
    payloadVersion: 1,
    payload: {
      receiptNumber,
      shiftId,
      cashier: {
        userId: binding.staff.userId,
        staffId: binding.staff.staffId,
        bindingId: binding.bindingId,
        bindingToken: binding.bindingToken,
        pinVersion: binding.pinVersion,
      },
      customer: null,
      lines: [line(productId, price)],
      saleDiscount: null,
      loyalty: null,
      tenders: [{ method: 'CASH', amountMinor: cart.totalMinor }],
      totals: {
        subtotalMinor: cart.subtotalMinor,
        lineDiscountMinor: cart.lineDiscountMinor,
        saleDiscountMinor: cart.saleDiscountMinor,
        loyaltyDiscountMinor: cart.loyaltyDiscountMinor,
        vatMinor: cart.vatMinor,
        nhilMinor: cart.nhilMinor,
        getfundMinor: cart.getfundMinor,
        taxTotalMinor: cart.taxTotalMinor,
        totalMinor: cart.totalMinor,
        changeMinor: 0,
      },
      occurredAt,
      appVersion: '0.1.0-race',
    },
  }
}

async function enroll(admin, branchId, name) {
  const terminal = (
    await api('/api/terminals', { method: 'POST', cookie: admin, body: { branchId, name } })
  ).body.terminal
  const code = (
    await api(`/api/terminals/${terminal.id}/enrollment`, { method: 'POST', cookie: admin })
  ).body.enrollment.code
  const redeemed = await api('/api/enrollments/redeem', {
    method: 'POST',
    body: { code, fingerprint: `race-${name}-${STAMP}` },
  })
  const session = await api('/api/pos/session', {
    method: 'POST',
    bearer: redeemed.body.deviceToken,
  })
  return {
    terminal,
    device: {
      deviceId: session.body.deviceId,
      terminalId: session.body.terminal.id,
      terminalCode: session.body.terminal.code,
      accessToken: session.body.accessToken,
    },
  }
}

try {
  console.log(`Phase 6 last-unit race — ${STAMP}`)
  const admin = await adminSignIn()
  check('admin signs in', Boolean(admin))

  const branch = (
    await api('/api/branches', {
      method: 'POST',
      cookie: admin,
      body: {
        code: `RCE-${STAMP.slice(-4)}`,
        name: `Race ${STAMP}`,
        type: 'RETAIL',
        city: 'Accra',
      },
    })
  ).body.branch
  check('a verification branch is created', Boolean(branch?.id))

  const terminalA = await enroll(admin, branch.id, `Race A ${STAMP}`)
  const terminalB = await enroll(admin, branch.id, `Race B ${STAMP}`)
  check(
    'two terminals are enrolled',
    Boolean(terminalA.device.accessToken && terminalB.device.accessToken),
  )

  const staff = (
    await api('/api/staff', {
      method: 'POST',
      cookie: admin,
      body: {
        email: `race-${STAMP.toLowerCase()}@gikautos.test`,
        name: `Race Cashier ${STAMP}`,
        role: 'CASHIER',
        branchId: branch.id,
      },
    })
  ).body.staff
  await api(`/api/staff/${staff.id}/pin`, { method: 'POST', cookie: admin, body: { pin: PIN } })
  const bindingA = (
    await api('/api/pos/staff/authorize', {
      method: 'POST',
      bearer: terminalA.device.accessToken,
      body: { staffCode: staff.staffId, pin: PIN },
    })
  ).body
  const bindingB = (
    await api('/api/pos/staff/authorize', {
      method: 'POST',
      bearer: terminalB.device.accessToken,
      body: { staffCode: staff.staffId, pin: PIN },
    })
  ).body
  check(
    'the cashier is authorized on both terminals',
    Boolean(bindingA.bindingToken && bindingB.bindingToken),
  )

  const categoryId = (await db.query(`SELECT id FROM category ORDER BY name LIMIT 1`)).rows[0]?.id
  const uomId = (await db.query(`SELECT id FROM uom ORDER BY code LIMIT 1`)).rows[0]?.id
  const product = (
    await api('/api/products', {
      method: 'POST',
      cookie: admin,
      body: {
        name: `Last Unit ${STAMP}`,
        categoryId,
        uomId,
        basePriceMinor: 10_000,
        taxCategory: 'STANDARD',
      },
    })
  ).body.product
  check('the race product is created', Boolean(product?.id))

  const receipt = await api('/api/inventory/receipts', {
    method: 'POST',
    cookie: admin,
    body: {
      branchId: branch.id,
      supplierName: 'Race Supplier',
      lines: [{ productId: product.id, quantity: 1, unitCostMinor: 6_000 }],
    },
  })
  check('exactly one unit is received', receipt.status === 201 || receipt.status === 200)

  const shiftA = crypto.randomUUID()
  const shiftB = crypto.randomUUID()
  const openTransaction = (shiftId, number) => ({
    clientTransactionId: shiftId,
    type: 'SHIFT_OPEN',
    occurredAt: new Date().toISOString(),
    payloadVersion: 1,
    payload: {
      shiftId,
      number,
      openingFloatMinor: 10_000,
      cashierUserId: staff.id,
      cashierStaffId: staff.staffId,
      occurredAt: new Date().toISOString(),
    },
  })
  const opened = await Promise.all([
    api('/api/pos/sync/upload', {
      method: 'POST',
      bearer: terminalA.device.accessToken,
      body: {
        batchId: crypto.randomUUID(),
        deviceId: terminalA.device.deviceId,
        terminalId: terminalA.device.terminalId,
        transactions: [openTransaction(shiftA, `${terminalA.device.terminalCode}-S-${day()}-01`)],
      },
    }),
    api('/api/pos/sync/upload', {
      method: 'POST',
      bearer: terminalB.device.accessToken,
      body: {
        batchId: crypto.randomUUID(),
        deviceId: terminalB.device.deviceId,
        terminalId: terminalB.device.terminalId,
        transactions: [openTransaction(shiftB, `${terminalB.device.terminalCode}-S-${day()}-01`)],
      },
    }),
  ])
  check(
    'both terminals open a shift',
    opened.every((response) => response.body?.results?.[0]?.status === 'APPLIED'),
  )

  const saleAId = crypto.randomUUID()
  const saleBId = crypto.randomUUID()
  const saleA = salePayload({
    id: saleAId,
    receiptNumber: `${terminalA.device.terminalCode}-${day()}-7001`,
    shiftId: shiftA,
    binding: bindingA,
    productId: product.id,
    price: 10_000,
  })
  const saleB = salePayload({
    id: saleBId,
    receiptNumber: `${terminalB.device.terminalCode}-${day()}-7001`,
    shiftId: shiftB,
    binding: bindingB,
    productId: product.id,
    price: 10_000,
  })

  const [responseA, responseB] = await Promise.all([
    api('/api/pos/sync/upload', {
      method: 'POST',
      bearer: terminalA.device.accessToken,
      body: {
        batchId: crypto.randomUUID(),
        deviceId: terminalA.device.deviceId,
        terminalId: terminalA.device.terminalId,
        transactions: [saleA],
      },
    }),
    api('/api/pos/sync/upload', {
      method: 'POST',
      bearer: terminalB.device.accessToken,
      body: {
        batchId: crypto.randomUUID(),
        deviceId: terminalB.device.deviceId,
        terminalId: terminalB.device.terminalId,
        transactions: [saleB],
      },
    }),
  ])

  const resultA = responseA.body?.results?.[0]
  const resultB = responseB.body?.results?.[0]
  check('both uploads return HTTP 200', responseA.status === 200 && responseB.status === 200)
  check('both sales apply', resultA?.status === 'APPLIED' && resultB?.status === 'APPLIED')
  const oversellA = (resultA?.conflicts ?? []).filter(
    (conflict) => conflict.type === 'STOCK_OVERSELL',
  )
  const oversellB = (resultB?.conflicts ?? []).filter(
    (conflict) => conflict.type === 'STOCK_OVERSELL',
  )
  check('exactly one sale carries STOCK_OVERSELL', oversellA.length + oversellB.length === 1)

  const sales = await db.query(`SELECT id, receipt_number FROM sale WHERE branch_id = $1`, [
    branch.id,
  ])
  check('both sales are stored', sales.rowCount === 2)

  const level = await db.query(
    `SELECT quantity_on_hand FROM stock_level WHERE product_id = $1 AND branch_id = $2`,
    [product.id, branch.id],
  )
  check('on-hand ends at minus one', Number(level.rows[0]?.quantity_on_hand) === -1)

  const ledger = await db.query(
    `SELECT COALESCE(SUM(quantity_delta), 0)::int AS total
       FROM stock_movement WHERE product_id = $1 AND branch_id = $2`,
    [product.id, branch.id],
  )
  check('the movement ledger nets to minus one', Number(ledger.rows[0]?.total) === -1)

  const movementCount = await db.query(
    `SELECT count(*)::int AS count FROM stock_movement
      WHERE product_id = $1 AND branch_id = $2 AND type = 'SALE'`,
    [product.id, branch.id],
  )
  check('both sales posted a SALE movement', Number(movementCount.rows[0]?.count) === 2)

  const oversellConflict = await db.query(
    `SELECT sale_id, terminal_id, severity FROM sync_conflict
      WHERE branch_id = $1 AND type = 'STOCK_OVERSELL'`,
    [branch.id],
  )
  check('one STOCK_OVERSELL conflict is stored', oversellConflict.rowCount === 1)
  check('the oversell conflict is HIGH', oversellConflict.rows[0]?.severity === 'HIGH')
  check(
    'the oversell conflict references the losing sale',
    [saleAId, saleBId].includes(oversellConflict.rows[0]?.sale_id),
  )

  const reconciliation = await api(`/api/pos/reconciliation?branchId=${branch.id}`, {
    cookie: admin,
  })
  check(
    'reconciliation stays green after the race',
    (reconciliation.body?.sales ?? []).length === 0 &&
      (reconciliation.body?.shifts ?? []).length === 0,
    JSON.stringify(reconciliation.body?.sales ?? []),
  )
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

function day() {
  const date = new Date()
  return `${date.getUTCFullYear()}${String(date.getUTCMonth() + 1).padStart(2, '0')}${String(
    date.getUTCDate(),
  ).padStart(2, '0')}`
}
