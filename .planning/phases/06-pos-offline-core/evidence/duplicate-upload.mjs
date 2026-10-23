#!/usr/bin/env bun
/**
 * Phase 6 Plan 09 — duplicate-upload drill (Task 3).
 *
 * Sends one credit sale three times: the same batch twice and then the same
 * transaction under a fresh batch id (a client retry after a lost response).
 * Exactly one sale, one ledger charge, one stock movement, one loyalty earn,
 * one audit row, and one idempotency reservation may exist; every replay must
 * return the original server id.
 *
 * Run with the API up:
 *   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos \
 *     bun run .planning/phases/06-pos-offline-core/evidence/duplicate-upload.mjs
 */
import { readFileSync } from 'node:fs'
import { priceCart } from '@gikautos/shared'
import { Client } from 'pg'

const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const ORIGIN = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5434/gikautos'
const STAMP = Date.now().toString(36).toUpperCase()
const PIN = '6382'

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

try {
  console.log(`Phase 6 duplicate-upload drill — ${STAMP}`)
  const admin = await adminSignIn()
  check('admin signs in', Boolean(admin))

  const branch = (
    await api('/api/branches', {
      method: 'POST',
      cookie: admin,
      body: {
        code: `DUP-${STAMP.slice(-3)}`,
        name: `Duplicate ${STAMP}`,
        type: 'RETAIL',
        city: 'Accra',
      },
    })
  ).body.branch
  check('a verification branch is created', Boolean(branch?.id))

  const createdTerminal = (
    await api('/api/terminals', {
      method: 'POST',
      cookie: admin,
      body: { branchId: branch.id, name: `Duplicate Counter ${STAMP}` },
    })
  ).body.terminal
  const enrollment = (
    await api(`/api/terminals/${createdTerminal.id}/enrollment`, {
      method: 'POST',
      cookie: admin,
    })
  ).body.enrollment
  const deviceToken = (
    await api('/api/enrollments/redeem', {
      method: 'POST',
      body: { code: enrollment.code, fingerprint: `duplicate-${STAMP}` },
    })
  ).body.deviceToken
  const session = (await api('/api/pos/session', { method: 'POST', bearer: deviceToken })).body
  const device = {
    deviceId: session.deviceId,
    terminalId: session.terminal.id,
    terminalCode: session.terminal.code,
    accessToken: session.accessToken,
  }
  check('the terminal is enrolled', Boolean(device.accessToken))

  const staff = (
    await api('/api/staff', {
      method: 'POST',
      cookie: admin,
      body: {
        email: `duplicate-${STAMP.toLowerCase()}@gikautos.test`,
        name: `Duplicate Cashier ${STAMP}`,
        role: 'CASHIER',
        branchId: branch.id,
      },
    })
  ).body.staff
  await api(`/api/staff/${staff.id}/pin`, { method: 'POST', cookie: admin, body: { pin: PIN } })
  const binding = (
    await api('/api/pos/staff/authorize', {
      method: 'POST',
      bearer: device.accessToken,
      body: { staffCode: staff.staffId, pin: PIN },
    })
  ).body
  check('the cashier is authorized', Boolean(binding.bindingToken))

  const categoryId = (await db.query(`SELECT id FROM category ORDER BY name LIMIT 1`)).rows[0]?.id
  const uomId = (await db.query(`SELECT id FROM uom ORDER BY code LIMIT 1`)).rows[0]?.id
  const product = (
    await api('/api/products', {
      method: 'POST',
      cookie: admin,
      body: {
        name: `Duplicate Unit ${STAMP}`,
        categoryId,
        uomId,
        basePriceMinor: 12_000,
        taxCategory: 'STANDARD',
      },
    })
  ).body.product
  await api('/api/inventory/receipts', {
    method: 'POST',
    cookie: admin,
    body: {
      branchId: branch.id,
      supplierName: 'Duplicate Supplier',
      lines: [{ productId: product.id, quantity: 10, unitCostMinor: 7_000 }],
    },
  })
  check('ten units are received', Boolean(product?.id))

  const shiftId = crypto.randomUUID()
  const shiftOpen = await api('/api/pos/sync/upload', {
    method: 'POST',
    bearer: device.accessToken,
    body: {
      batchId: crypto.randomUUID(),
      deviceId: device.deviceId,
      terminalId: device.terminalId,
      transactions: [
        {
          clientTransactionId: shiftId,
          type: 'SHIFT_OPEN',
          occurredAt: new Date().toISOString(),
          payloadVersion: 1,
          payload: {
            shiftId,
            number: `${device.terminalCode}-S-${day()}-01`,
            openingFloatMinor: 10_000,
            cashierUserId: staff.id,
            cashierStaffId: staff.staffId,
            occurredAt: new Date().toISOString(),
          },
        },
      ],
    },
  })
  check('the shift opens', shiftOpen.body?.results?.[0]?.status === 'APPLIED')

  const saleId = crypto.randomUUID()
  const draftCustomerId = crypto.randomUUID()
  const receiptNumber = `${device.terminalCode}-${day()}-8001`
  const cart = priceCart(
    [
      {
        productId: product.id,
        quantity: 2,
        unitPriceMinor: 12_000,
        lineDiscountMinor: 0,
        taxCategory: 'STANDARD',
      },
    ],
    { taxMode: 'INCLUSIVE' },
  )
  const occurredAt = new Date().toISOString()
  const sale = {
    clientTransactionId: saleId,
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
      customer: {
        id: draftCustomerId,
        phone: `+23325${String(Date.now()).slice(-7)}`,
        name: `Drill Customer ${STAMP}`,
      },
      lines: [
        {
          productId: product.id,
          quantity: 2,
          unitPriceMinor: 12_000,
          lineDiscountMinor: 0,
          taxCategory: 'STANDARD',
        },
      ],
      saleDiscount: null,
      loyalty: null,
      tenders: [{ method: 'CREDIT', amountMinor: cart.totalMinor }],
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
      appVersion: '0.1.0-duplicate',
    },
  }

  const batch = {
    batchId: crypto.randomUUID(),
    deviceId: device.deviceId,
    terminalId: device.terminalId,
    transactions: [sale],
  }
  const send = (body) =>
    api('/api/pos/sync/upload', { method: 'POST', bearer: device.accessToken, body })

  const first = await send(batch)
  const firstResult = first.body?.results?.[0]
  check('the first upload applies', firstResult?.status === 'APPLIED')
  const serverId = firstResult?.serverId

  const second = await send(batch)
  const secondResult = second.body?.results?.[0]
  check('the identical batch is REPLAYED', secondResult?.status === 'REPLAYED')
  check('the replay returns the original server id', secondResult?.serverId === serverId)

  // A client that never saw the response retries with a fresh batch id; the
  // per-transaction reservation (not the batch) owns idempotency.
  const third = await send({ ...batch, batchId: crypto.randomUUID() })
  const thirdResult = third.body?.results?.[0]
  check('a retried transaction under a new batch is REPLAYED', thirdResult?.status === 'REPLAYED')
  check('the retry returns the original server id', thirdResult?.serverId === serverId)
  check(
    'no response is an error status',
    [first, second, third].every((r) => r.status === 200),
  )

  const counts = (
    await db.query(
      `SELECT
         (SELECT count(*)::int FROM sale WHERE id = $1) AS sales,
         (SELECT count(*)::int FROM sale_line WHERE sale_id = $1) AS lines,
         (SELECT count(*)::int FROM sale_tender WHERE sale_id = $1) AS tenders,
         (SELECT count(*)::int FROM stock_movement WHERE reference_id = $1 AND type = 'SALE') AS movements,
         (SELECT count(*)::int FROM credit_ledger_entry WHERE reference_id = $1 AND kind = 'CHARGE') AS charges,
         (SELECT count(*)::int FROM loyalty_ledger_entry WHERE reference_id = $1 AND kind = 'EARN') AS earns,
         (SELECT count(*)::int FROM audit_log WHERE entity_id = $1::text AND action = 'pos.sale.applied') AS audits,
         (SELECT count(*)::int FROM pos_sync_transaction WHERE client_transaction_id = $1) AS reservations,
         (SELECT count(*)::int FROM customer WHERE id = $2) AS draft_customers`,
      [saleId, draftCustomerId],
    )
  ).rows[0]

  check('exactly one sale exists', counts.sales === 1)
  check('exactly one sale line exists', counts.lines === 1)
  check('exactly one tender exists', counts.tenders === 1)
  check('exactly one stock movement exists', counts.movements === 1)
  check('exactly one credit charge exists', counts.charges === 1)
  check('exactly one loyalty earn exists', counts.earns === 1)
  check('exactly one applied audit row exists', counts.audits === 1)
  check('exactly one idempotency reservation exists', counts.reservations === 1)
  check('the offline draft customer is created once', counts.draft_customers === 1)

  const reservation = (
    await db.query(
      `SELECT status, result->>'serverId' AS server_id
         FROM pos_sync_transaction WHERE client_transaction_id = $1`,
      [saleId],
    )
  ).rows[0]
  check('the reservation is APPLIED', reservation?.status === 'APPLIED')
  check('the reservation names the server id', reservation?.server_id === saleId)

  const reconciliation = await api(`/api/pos/reconciliation?branchId=${branch.id}`, {
    cookie: admin,
  })
  check(
    'reconciliation stays green after the retries',
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
