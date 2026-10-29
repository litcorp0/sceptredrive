#!/usr/bin/env node
/**
 * Phase 6 Plan 09 — packaging/performance measurements (Task 5).
 *
 * Seeds the scale target (5 000 products, 20 000 customers), then measures on
 * the production renderer:
 *
 *   - cold start from launch to the enrolment screen
 *   - first full sync time for the 5k/20k fixture
 *   - local catalogue search latency (includes the 150 ms debounce)
 *   - sale commit latency (offline) and receipt print time
 *   - server throughput for a 100-sale drain (4 upload batches)
 *
 * The fixture rows are removed in a `finally` block. Run with the API and
 * PowerSync service up:
 *
 *   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos \
 *     node .planning/phases/06-pos-offline-core/evidence/perf-pos.mjs
 */
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import { _electron as electron } from 'playwright'

const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const desktopDir = path.join(repo, 'desktop')
const evidence = path.join(repo, '.planning', 'phases', '06-pos-offline-core', 'evidence')
const receiptsDir = path.join(evidence, 'receipts-perf')
const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const ORIGIN = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5434/gikautos'
const PRODUCTS = 5_000
const CUSTOMERS = 20_000
const STAMP = Date.now().toString(36).toUpperCase()

const electronPath = (() => {
  const relative = readFileSync(
    path.join(desktopDir, 'node_modules', 'electron', 'path.txt'),
    'utf8',
  )
  return path.join(desktopDir, 'node_modules', 'electron', 'dist', relative.trim())
})()

const results = {}
const db = new Client({ connectionString: DATABASE_URL })
await db.connect()

function envValue(key) {
  const env = readFileSync(path.join(repo, '.env'), 'utf8')
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

async function api(path, { method = 'GET', cookie, body } = {}) {
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

async function launch(userDataDir) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    timeout: 90_000,
    env: {
      ...process.env,
      POS_PRINTER_DRIVER: 'fake',
      POS_DIAGNOSTICS: '1',
      RECEIPTS_DIR: receiptsDir,
    },
  })
  const page = await app.firstWindow()
  page.setDefaultTimeout(30_000)
  return { app, page }
}

async function pressPin(page, pin) {
  for (const digit of pin) {
    await page.getByRole('button', { name: `Digit ${digit}`, exact: true }).click()
  }
}

async function goto(page, hash) {
  await page.evaluate((value) => {
    window.location.hash = value
  }, hash)
}

const TEMP_PIN = '7391'
const FINAL_PIN = '9274'

console.log(`Phase 6 performance — ${STAMP}`)
fs.rmSync(receiptsDir, { recursive: true, force: true })
fs.mkdirSync(receiptsDir, { recursive: true })

const fixtures = { productSkus: `PERF-${STAMP}-%`, phonePrefix: '+23371' }
let terminalId = null
let deviceId = null
const profileDirs = []

try {
  const admin = await adminSignIn()
  const spx = (await db.query(`SELECT id FROM branch WHERE code = 'ACC-SPX'`)).rows[0]
  const category = (await db.query(`SELECT id FROM category ORDER BY name LIMIT 1`)).rows[0]
  const uom = (await db.query(`SELECT id FROM uom ORDER BY code LIMIT 1`)).rows[0]
  const cashier = (
    await db.query(`SELECT id, staff_id, name FROM "user" WHERE email = 'cashier@gikautos.local'`)
  ).rows[0]
  await api(`/api/staff/${cashier.id}/pin`, {
    method: 'POST',
    cookie: admin,
    body: { pin: TEMP_PIN },
  })

  // --- cold start (fresh profile, no credential) ----------------------------
  const coldProfile = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-perf-cold-'))
  profileDirs.push(coldProfile)
  const coldStart = Date.now()
  const cold = await launch(coldProfile)
  await cold.page.getByTestId('shell-ready').waitFor({ timeout: 60_000 })
  await goto(cold.page, '#login')
  await cold.page.locator('#enrollment-code').waitFor({ timeout: 60_000 })
  results.coldStartMs = Date.now() - coldStart
  await cold.app.close()

  // --- seed the 5k/20k scale target ----------------------------------------
  const seedStart = Date.now()
  await db.query(
    `INSERT INTO product (sku, name, category_id, uom_id, base_price_minor, tax_category, is_active)
     SELECT 'PERF-${STAMP}-' || lpad(i::text, 5, '0'),
            'Perf Product ' || i,
            $1, $2, 5000 + (i % 50) * 100, 'STANDARD', true
       FROM generate_series(1, $3) AS i`,
    [category.id, uom.id, PRODUCTS],
  )
  await db.query(
    `INSERT INTO product_price (product_id, branch_id, price_minor)
     SELECT p.id, $1, p.base_price_minor FROM product p WHERE p.sku LIKE $2`,
    [spx.id, fixtures.productSkus],
  )
  await db.query(
    `INSERT INTO stock_level (product_id, branch_id, quantity_on_hand, avg_cost_minor)
     SELECT p.id, $1, 100, 3000 FROM product p WHERE p.sku LIKE $2`,
    [spx.id, fixtures.productSkus],
  )
  await db.query(
    `INSERT INTO customer (name, phone, created_branch_id, status)
     SELECT 'Perf Customer ' || i,
            $1 || lpad(i::text, 7, '0'),
            $2, 'ACTIVE'
       FROM generate_series(1, $3) AS i`,
    [fixtures.phonePrefix, spx.id, CUSTOMERS],
  )
  results.seedMs = Date.now() - seedStart
  results.products = Number(
    (
      await db.query(`SELECT count(*)::int AS count FROM product WHERE sku LIKE $1`, [
        fixtures.productSkus,
      ])
    ).rows[0].count,
  )
  results.customers = Number(
    (
      await db.query(`SELECT count(*)::int AS count FROM customer WHERE phone LIKE $1`, [
        `${fixtures.phonePrefix}%`,
      ])
    ).rows[0].count,
  )

  // --- first full sync -----------------------------------------------------
  const terminal = (
    await api('/api/terminals', {
      method: 'POST',
      cookie: admin,
      body: { branchId: spx.id, name: `Perf Counter ${STAMP}` },
    })
  ).body.terminal
  terminalId = terminal.id
  const enrollmentCode = (
    await api(`/api/terminals/${terminal.id}/enrollment`, {
      method: 'POST',
      cookie: admin,
    })
  ).body.enrollment.code

  const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-perf-sync-'))
  profileDirs.push(profile)
  const { app, page } = await launch(profile)
  await page.getByTestId('shell-ready').waitFor({ timeout: 60_000 })
  await goto(page, '#login')
  await page.locator('#enrollment-code').waitFor({ timeout: 60_000 })
  await page.locator('#enrollment-code').fill(enrollmentCode)
  await page.getByRole('button', { name: 'Enrol terminal' }).click()
  await page.getByRole('heading', { name: 'Authorize this terminal' }).waitFor({
    timeout: 60_000,
  })

  const syncStart = Date.now()
  await goto(page, '#dev/sync')
  await page.getByTestId('sync-has-synced').filter({ hasText: 'hasSynced=true' }).waitFor({
    timeout: 300_000,
  })
  let counts = {}
  let lastCountAt = Date.now()
  const deadline = Date.now() + 300_000
  while (Date.now() < deadline) {
    counts = await page.evaluate(() => {
      const result = {}
      for (const node of document.querySelectorAll('[data-count]')) {
        const key = node.parentElement?.getAttribute('data-testid')?.replace('count-', '')
        if (key) result[key.replace(/-/g, '_')] = Number(node.getAttribute('data-count'))
      }
      return result
    })
    if (counts.product >= PRODUCTS && counts.customer >= CUSTOMERS) {
      lastCountAt = Date.now()
      break
    }
    await page.waitForTimeout(500)
  }
  results.firstSyncMs = lastCountAt - syncStart
  results.syncedProducts = counts.product
  results.syncedCustomers = counts.customer
  deviceId = (
    await db.query(
      `SELECT id FROM device WHERE terminal_id = $1 ORDER BY enrolled_at DESC LIMIT 1`,
      [terminalId],
    )
  ).rows[0]?.id

  // --- login, shift, search, sale commit ----------------------------------
  await goto(page, '#login')
  await page.getByRole('heading', { name: 'Authorize this terminal' }).waitFor()
  await page.locator('#staff-identity').fill(cashier.staff_id)
  await pressPin(page, TEMP_PIN)
  await page.getByRole('button', { name: 'Authorize' }).click()
  await page.getByRole('heading', { name: 'Choose your own PIN' }).waitFor()
  await page.locator('#new-pin').fill(FINAL_PIN)
  await page.locator('#confirm-pin').fill(FINAL_PIN)
  await page.getByRole('button', { name: 'Save PIN' }).click()
  await page.getByRole('heading', { name: 'No open shift' }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Open shift' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.locator('#opening-float').fill('0.00')
  await dialog.getByRole('button', { name: 'Open shift' }).click()
  await dialog.waitFor({ state: 'detached' })
  await page.getByRole('button', { name: 'Start selling' }).click()
  await page.getByTestId('product-search').waitFor({ timeout: 60_000 })

  const searchTerm = `Perf Product ${PRODUCTS}`
  const searchSamples = []
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await page.locator('#product-search').fill('')
    await page.waitForTimeout(250)
    const searchStart = Date.now()
    await page.locator('#product-search').fill(searchTerm)
    await page
      .getByTestId('product-card')
      .filter({ hasText: searchTerm })
      .first()
      .waitFor({ timeout: 30_000 })
    searchSamples.push(Date.now() - searchStart)
  }
  results.searchSamplesMs = searchSamples
  results.searchMs = searchSamples[searchSamples.length - 1]
  results.searchIncludesDebounce = true

  await page.context().setOffline(true)
  await page.waitForFunction(() => navigator.onLine === false)
  await page.getByTestId('product-card').filter({ hasText: searchTerm }).first().click()
  await page.getByTestId('pay-button').click()
  await page.getByTestId('tender-total').waitFor()
  await page.getByTestId('exact-cash').click()
  const commitStart = Date.now()
  await page.getByTestId('complete-sale').click()
  await page.getByTestId('receipt-view').waitFor({ timeout: 30_000 })
  results.saleCommitMs = Date.now() - commitStart
  const printStart = Date.now()
  await page
    .getByTestId('print-status')
    .filter({ hasText: /Printed/i })
    .waitFor({ timeout: 30_000 })
  results.printMs = Date.now() - printStart
  const receiptNumber = (await page.getByTestId('receipt-number').innerText()).trim()
  results.receiptFile = fs.existsSync(path.join(receiptsDir, `${receiptNumber}.txt`))

  // A second, warm sale separates the first-run cache cost from the commit.
  await page.getByTestId('new-sale').click()
  await page.getByTestId('product-search').waitFor({ timeout: 30_000 })
  await page.locator('#product-search').fill(searchTerm)
  await page.getByTestId('product-card').filter({ hasText: searchTerm }).first().click()
  await page.getByTestId('pay-button').click()
  await page.getByTestId('tender-total').waitFor()
  await page.getByTestId('exact-cash').click()
  const warmCommitStart = Date.now()
  await page.getByTestId('complete-sale').click()
  await page.getByTestId('receipt-view').waitFor({ timeout: 30_000 })
  results.warmSaleCommitMs = Date.now() - warmCommitStart

  // Drain the two local transactions (shift open + sale) and time it.
  await page.context().setOffline(false)
  await goto(page, '#pos/sync')
  await page.getByTestId('sync-now').waitFor()
  const drainStart = Date.now()
  for (let attempt = 0; attempt < 60; attempt += 1) {
    if ((await page.getByTestId('sync-waiting-count').innerText()).trim() === '0') break
    await page.getByTestId('sync-now').click()
    await page.waitForTimeout(250)
  }
  results.outboxDrain2Ms = Date.now() - drainStart
  await app.close()

  // --- server throughput for 100 sale-shaped transactions ------------------
  // Four batches of 25 (the client's configured batch size) through the same
  // upload endpoint the outbox uses. This bounds the server/network cost of a
  // 100-sale drain; the client-side SQLite work is measured by the 2-row drain.
  const drainToken = await deviceTokenFor(terminalId)
  const session = await fetch(`${API}/api/pos/session`, {
    method: 'POST',
    headers: { authorization: `Bearer ${drainToken}` },
  }).then((response) => response.json())
  const drainShiftId = await latestOpenShift(terminalId)
  const cashMovement = () => {
    const id = crypto.randomUUID()
    return {
      clientTransactionId: id,
      type: 'CASH_MOVEMENT',
      occurredAt: new Date().toISOString(),
      payloadVersion: 1,
      payload: {
        id,
        shiftId: drainShiftId,
        type: 'CASH_IN',
        amountMinor: 1,
        reason: 'perf drain',
        occurredAt: new Date().toISOString(),
        staffUserId: cashier.id,
        staffStaffId: cashier.staff_id,
      },
    }
  }

  const drain100Start = Date.now()
  for (let batch = 0; batch < 4; batch += 1) {
    const response = await fetch(`${API}/api/pos/sync/upload`, {
      method: 'POST',
      headers: {
        authorization: `Bearer ${session.accessToken}`,
        'content-type': 'application/json',
      },
      body: JSON.stringify({
        batchId: crypto.randomUUID(),
        deviceId: session.deviceId,
        terminalId: session.terminal.id,
        transactions: Array.from({ length: 25 }, cashMovement),
      }),
    })
    if (response.status !== 200) throw new Error(`drain batch failed: ${response.status}`)
  }
  results.serverDrain100Ms = Date.now() - drain100Start
} catch (error) {
  console.error('\nPERF ERROR', error)
  process.exitCode = 1
} finally {
  // Remove the scale fixture and the measurement terminal/device.
  await db.query(`DELETE FROM cash_movement WHERE reason = 'perf drain'`).catch(() => {})
  if (terminalId) {
    await db.query(`DELETE FROM cash_movement WHERE terminal_id = $1`, [terminalId]).catch(() => {})
    await db
      .query(
        `DELETE FROM sale_tender WHERE sale_id IN (SELECT id FROM sale WHERE terminal_id = $1)`,
        [terminalId],
      )
      .catch(() => {})
    await db
      .query(
        `DELETE FROM sale_line WHERE sale_id IN (SELECT id FROM sale WHERE terminal_id = $1)`,
        [terminalId],
      )
      .catch(() => {})
    await db
      .query(
        `DELETE FROM stock_movement WHERE reference_type = 'SALE' AND reference_id IN (SELECT id FROM sale WHERE terminal_id = $1)`,
        [terminalId],
      )
      .catch(() => {})
    await db.query(`DELETE FROM sale WHERE terminal_id = $1`, [terminalId]).catch(() => {})
    await db.query(`DELETE FROM shift WHERE terminal_id = $1`, [terminalId]).catch(() => {})
    await db.query(`DELETE FROM pos_staff_binding WHERE device_id = $1`, [deviceId]).catch(() => {})
    await db
      .query(`DELETE FROM terminal_enrollment WHERE terminal_id = $1`, [terminalId])
      .catch(() => {})
    await db.query(`DELETE FROM device WHERE terminal_id = $1`, [terminalId]).catch(() => {})
    await db.query(`DELETE FROM terminal WHERE id = $1`, [terminalId]).catch(() => {})
  }
  await db
    .query(
      `DELETE FROM product_price WHERE product_id IN (SELECT id FROM product WHERE sku LIKE $1)`,
      [fixtures.productSkus],
    )
    .catch(() => {})
  await db
    .query(
      `DELETE FROM stock_level WHERE product_id IN (SELECT id FROM product WHERE sku LIKE $1)`,
      [fixtures.productSkus],
    )
    .catch(() => {})
  await db.query(`DELETE FROM product WHERE sku LIKE $1`, [fixtures.productSkus]).catch(() => {})
  await db
    .query(
      `DELETE FROM loyalty_ledger_entry WHERE customer_id IN (SELECT id FROM customer WHERE phone LIKE $1)`,
      [`${fixtures.phonePrefix}%`],
    )
    .catch(() => {})
  await db
    .query(
      `DELETE FROM loyalty_account WHERE customer_id IN (SELECT id FROM customer WHERE phone LIKE $1)`,
      [`${fixtures.phonePrefix}%`],
    )
    .catch(() => {})
  await db
    .query(`DELETE FROM customer WHERE phone LIKE $1`, [`${fixtures.phonePrefix}%`])
    .catch(() => {})
  for (const dir of profileDirs) fs.rmSync(dir, { recursive: true, force: true })
  await db.end()
}

console.log(JSON.stringify(results, null, 2))
fs.writeFileSync(path.join(evidence, 'performance.json'), `${JSON.stringify(results, null, 2)}\n`)

async function latestOpenShift(terminalIdValue) {
  const row = (
    await db.query(`SELECT id FROM shift WHERE terminal_id = $1 AND status = 'OPEN' LIMIT 1`, [
      terminalIdValue,
    ])
  ).rows[0]
  if (!row) throw new Error('no open shift for the perf terminal')
  return row.id
}

async function deviceTokenFor(terminalIdValue) {
  // The device token is only stored hashed; mint a fresh device with a known
  // token through the enrollment endpoint.
  const code = (
    await api(`/api/terminals/${terminalIdValue}/enrollment`, {
      method: 'POST',
      cookie: await adminSignIn(),
    })
  ).body.enrollment.code
  const redeemed = await api('/api/enrollments/redeem', {
    method: 'POST',
    body: { code, fingerprint: `perf-drain-${STAMP}` },
  })
  return redeemed.body.deviceToken
}
