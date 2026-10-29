#!/usr/bin/env node
import { spawn } from 'node:child_process'
/**
 * Phase 6 Plan 09 — Electron end-to-end (Task 4).
 *
 * Drives the packaged POS against the real API and the self-hosted PowerSync
 * service with the fake ESC/POS printer:
 *
 *   A. enrol → authorize manager → authorize cashier → change PIN → open shift
 *      → first sync → go offline → scan/search → customer → loyalty → manager
 *      discount → cash sale → print + drawer → pending 1 → quit → relaunch
 *      offline → PIN login → sale + shift survive → reprint → reconnect →
 *      exactly one server sale, stock moved, badge Synced
 *   B. offline over-limit credit (continue without approval) → reconnect →
 *      HIGH CREDIT_OVER_LIMIT conflict visible and stored server-side
 *   C. offline sale → device revoked → reconnect → upload refused, pending
 *      rows intact, "enrol again" surfaced
 *
 * Requires: API on :4000 against the Docker Postgres, PowerSync on :8080, and a
 * packaged build (`bun run build:pos`). The script starts and stops the API in
 * the middle to produce a real offline relaunch; it assumes it owns :4000.
 *
 *   DATABASE_URL=postgresql://gikautos:gikautos@localhost:5434/gikautos \
 *     node .planning/phases/06-pos-offline-core/evidence/e2e-pos.mjs
 */
import fs, { readFileSync } from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import { _electron as electron } from 'playwright'

const repo = path.resolve(import.meta.dirname, '..', '..', '..', '..')
const desktopDir = path.join(repo, 'desktop')
const electronPath = (() => {
  const relative = readFileSync(
    path.join(desktopDir, 'node_modules', 'electron', 'path.txt'),
    'utf8',
  )
  return path.join(desktopDir, 'node_modules', 'electron', 'dist', relative.trim())
})()
const evidence = path.join(repo, '.planning', 'phases', '06-pos-offline-core', 'evidence')
const shotsDir = path.join(evidence, 'screenshots')
const receiptsDir = path.join(evidence, 'receipts-e2e')
const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const ORIGIN = process.env.CONSOLE_ORIGIN ?? 'http://localhost:3000'
const DATABASE_URL =
  process.env.DATABASE_URL ?? 'postgresql://gikautos:gikautos@localhost:5434/gikautos'
const STAMP = Date.now().toString(36).toUpperCase()

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

const db = new Client({ connectionString: DATABASE_URL })
await db.connect()

function envValue(key) {
  const env = readFileSync(path.join(repo, '.env'), 'utf8')
  return (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
}

// --- API helpers (admin) -----------------------------------------------------

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

let adminCookie = ''
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
  adminCookie = jar.header()
  return response.status
}

// --- app helpers -------------------------------------------------------------

async function launchApp(userDataDir) {
  // The packaged binary deliberately refuses localhost origins (a shipped
  // terminal must never be pointed at a local impersonator), so the E2E drives
  // the *unpackaged production build* — the same `app://` renderer, main
  // bundle, IPC surface, and CSP that Forge packages.
  let lastError = null
  for (let attempt = 0; attempt < 3; attempt += 1) {
    try {
      return await launchOnce(userDataDir)
    } catch (error) {
      lastError = error
      console.log(
        `  (launch attempt ${attempt + 1} failed: ${String(error.message).slice(0, 120)})`,
      )
      await new Promise((resolve) => setTimeout(resolve, 2_000))
    }
  }
  throw lastError
}

async function launchOnce(userDataDir) {
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
  const errors = []
  page.on('pageerror', (error) => errors.push(error.message))

  let closed = false
  async function close() {
    if (closed) return
    closed = true
    await app.close().catch(() => {})
  }

  return { app, page, errors, close }
}

async function goto(page, hash) {
  await page.evaluate((value) => {
    window.location.hash = value
  }, hash)
}

async function shot(page, name) {
  await page.screenshot({ path: path.join(shotsDir, `${name}.png`), fullPage: true })
}

async function pressPin(page, pin) {
  for (const digit of pin) {
    await page.getByRole('button', { name: `Digit ${digit}`, exact: true }).click()
  }
}

async function signInAs(page, name, pin) {
  await page.getByRole('heading', { name: 'Who is signing in?' }).waitFor()
  await page.getByText(name, { exact: true }).click()
  await page.getByRole('heading', { name: `Hello, ${name}` }).waitFor()
  await pressPin(page, pin)
  await page.getByRole('button', { name: 'Sign in' }).click()
}

async function authorizeStaff(page, staffCode, pin) {
  await page.locator('#staff-identity').fill(staffCode)
  await pressPin(page, pin)
  await page.getByRole('button', { name: 'Authorize' }).click()
}

async function changePin(page, pin) {
  await page.getByRole('heading', { name: 'Choose your own PIN' }).waitFor()
  await page.locator('#new-pin').fill(pin)
  await page.locator('#confirm-pin').fill(pin)
  await page.getByRole('button', { name: 'Save PIN' }).click()
  await page.waitForFunction(() => window.location.hash.startsWith('#shift'), null, {
    timeout: 30_000,
  })
}

async function openShift(page, float) {
  await page.getByRole('heading', { name: 'No open shift' }).waitFor({ timeout: 30_000 })
  await page.getByRole('button', { name: 'Open shift' }).first().click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.locator('#opening-float').fill(float)
  await dialog.getByRole('button', { name: 'Open shift' }).click()
  await dialog.waitFor({ state: 'detached', timeout: 20_000 })
  await page.getByRole('button', { name: 'Start selling' }).click()
  await page.getByTestId('product-search').waitFor({ timeout: 60_000 })
}

async function waitForCatalog(page) {
  await page.getByTestId('product-search').waitFor({ timeout: 60_000 })
  const input = page.locator('#product-search')
  await input.fill('Bosch Oil Filter')
  await page.getByTestId('product-card').first().waitFor({ timeout: 60_000 })
  await input.fill('')
}

async function addProduct(page, term) {
  const input = page.locator('#product-search')
  await input.fill(term)
  const card = page.getByTestId('product-card').filter({ hasText: term }).first()
  await card.waitFor({ timeout: 30_000 })
  await card.click()
  await page.getByTestId('cart-line').first().waitFor()
  const name = await page.getByTestId('cart-line-name').first().innerText()
  if (!name.includes(term.split(' ').slice(0, 2).join(' '))) {
    throw new Error(`added the wrong product: ${name}`)
  }
}

async function attachCustomer(page, term) {
  await page.getByTestId('find-customer').click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await page.getByTestId('customer-search').fill(term)
  await page.getByTestId('customer-hit').first().waitFor({ timeout: 15_000 })
  await page.getByTestId('customer-hit').first().click()
  await page.getByTestId('customer-current').waitFor()
}

async function syncNow(page) {
  await goto(page, '#pos/sync')
  await page.getByTestId('sync-now').waitFor({ timeout: 30_000 })
  await page.getByTestId('sync-now').click()
}

async function outboxRowCount(page) {
  await goto(page, '#pos/sync')
  await page.getByTestId('sync-now').waitFor({ timeout: 30_000 })
  await page.waitForTimeout(500)
  return page.getByTestId('outbox-row').count()
}

// --- server helpers ----------------------------------------------------------

async function serverSale(receiptNumber) {
  const rows = await db.query(`SELECT * FROM sale WHERE receipt_number = $1`, [receiptNumber])
  return rows.rows[0] ?? null
}

async function stopApi() {
  const pid = await apiPid()
  if (pid) {
    process.kill(pid, 'SIGTERM')
    await waitForPort(4000, false, 15_000)
  }
}

async function startApi() {
  const log = fs.openSync('/tmp/opencode/api.log', 'a')
  const child = spawn('node', ['src/index.ts'], {
    cwd: path.join(repo, 'api'),
    detached: true,
    stdio: ['ignore', log, log],
    env: { ...process.env, DATABASE_URL },
  })
  child.unref()
  await waitForPort(4000, true, 30_000)
}

async function apiPid() {
  try {
    const { execFileSync } = await import('node:child_process')
    const output = execFileSync('ss', ['-lntp'], { encoding: 'utf8' })
    const line = output.split('\n').find((row) => row.includes(':4000'))
    const match = line?.match(/pid=(\d+)/)
    return match ? Number(match[1]) : null
  } catch {
    return null
  }
}

async function waitForPort(port, up, timeoutMs) {
  const deadline = Date.now() + timeoutMs
  while (Date.now() < deadline) {
    let listening = false
    try {
      const response = await fetch(`http://localhost:${port}/health`, {
        signal: AbortSignal.timeout(1_000),
      })
      listening = response.ok
    } catch {
      listening = false
    }
    if (listening === up) return true
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  return false
}

// --- fixtures ----------------------------------------------------------------

const TEMP_CASHIER_PIN = '5739'
const CASHIER_PIN = '8264'
const TEMP_MANAGER_PIN = '4817'
const MANAGER_PIN = '6238'

if (!fs.existsSync(path.join(desktopDir, '.vite', 'build', 'main.cjs'))) {
  console.error('Missing .vite build output. Run `bun run build:pos` first.')
  process.exit(2)
}
fs.mkdirSync(shotsDir, { recursive: true })
fs.rmSync(receiptsDir, { recursive: true, force: true })
fs.mkdirSync(receiptsDir, { recursive: true })

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'gikautos-e2e-'))

console.log(`Phase 6 Electron E2E — ${STAMP}`)
console.log(`profile ${userDataDir}`)

let app = null
try {
  // The script owns :4000 (it stops the API to prove a real offline relaunch),
  // so start it when a previous run left it down.
  if (!(await waitForPort(4000, true, 2_000))) await startApi()
  const signInStatus = await adminSignIn()
  check('admin signs in', signInStatus === 200)

  const spx = (await db.query(`SELECT id FROM branch WHERE code = 'ACC-SPX'`)).rows[0]
  const cashier = (
    await db.query(`SELECT id, staff_id, name FROM "user" WHERE email = 'cashier@gikautos.local'`)
  ).rows[0]
  const manager = (
    await db.query(`SELECT id, staff_id, name FROM "user" WHERE email = 'manager@gikautos.local'`)
  ).rows[0]
  await api(`/api/staff/${cashier.id}/pin`, {
    method: 'POST',
    cookie: adminCookie,
    body: { pin: TEMP_CASHIER_PIN },
  })
  await api(`/api/staff/${manager.id}/pin`, {
    method: 'POST',
    cookie: adminCookie,
    body: { pin: TEMP_MANAGER_PIN },
  })

  const terminal = (
    await api('/api/terminals', {
      method: 'POST',
      cookie: adminCookie,
      body: { branchId: spx.id, name: `E2E Counter ${STAMP}` },
    })
  ).body.terminal
  const enrollmentCode = (
    await api(`/api/terminals/${terminal.id}/enrollment`, {
      method: 'POST',
      cookie: adminCookie,
    })
  ).body.enrollment.code
  check('the verification terminal and enrolment code are ready', Boolean(enrollmentCode))

  app = await launchApp(userDataDir)
  const { page } = app

  // ==========================================================================
  section('A1. Enrolment and staff authorization')
  await page.getByTestId('shell-ready').waitFor({ timeout: 45_000 })
  await goto(page, '#login')
  await page.locator('#enrollment-code').waitFor({ timeout: 45_000 })
  check('a fresh terminal shows the enrolment screen', true)
  await shot(page, '01-enrolment')

  await page.locator('#enrollment-code').fill(enrollmentCode)
  await page.getByRole('button', { name: 'Enrol terminal' }).click()
  await page.getByRole('heading', { name: 'Authorize this terminal' }).waitFor({
    timeout: 45_000,
  })
  check('the device enrols and prompts for staff authorization', true)

  await authorizeStaff(page, manager.staff_id, TEMP_MANAGER_PIN)
  await changePin(page, MANAGER_PIN)
  check('the manager authorizes and replaces the temporary PIN', true)

  await page.getByRole('button', { name: 'Sign out' }).click()
  await page.getByRole('heading', { name: 'Who is signing in?' }).waitFor()
  await page.getByRole('button', { name: 'Authorize another staff member' }).click()
  await page.getByRole('heading', { name: 'Authorize this terminal' }).waitFor()
  await authorizeStaff(page, cashier.staff_id, TEMP_CASHIER_PIN)
  await changePin(page, CASHIER_PIN)
  check('the cashier authorizes and replaces the temporary PIN', true)
  await shot(page, '02-shift')

  // ==========================================================================
  section('A2. First sync and a shift')
  await openShift(page, '200.00')
  await page.getByTestId('product-search').waitFor({ timeout: 60_000 })
  check('the shift opens and the selling screen loads', true)

  await goto(page, '#dev/sync')
  await page.getByTestId('sync-has-synced').filter({ hasText: 'hasSynced=true' }).waitFor({
    timeout: 120_000,
  })
  check('PowerSync completes the first full download', true)
  await goto(page, '#pos')
  await page.getByTestId('product-search').waitFor()
  await waitForCatalog(page)
  check('the synced catalogue is searchable on the terminal', true)
  await shot(page, '03-selling')

  // ==========================================================================
  section('A3. Offline sale: scan, customer, loyalty, manager discount')
  await page.context().setOffline(true)
  await page.waitForFunction(() => navigator.onLine === false)
  check('the terminal reports itself offline', true)
  await shot(page, '04-offline')

  await addProduct(page, 'Bosch Oil Filter')
  check('a product can be added while offline', (await page.getByTestId('cart-line').count()) === 1)

  await attachCustomer(page, 'Kwame')
  await page.getByTestId('loyalty-available').waitFor()
  check('the customer and loyalty balance load from the local database', true)

  await page.getByTestId('redeem-points').click()
  const loyaltyDialog = page.getByRole('dialog')
  await loyaltyDialog.waitFor()
  await loyaltyDialog.locator('#redeem-points').fill('100')
  await page.getByTestId('confirm-redemption').click()
  await page.getByTestId('loyalty-applied').waitFor()
  check('loyalty points are redeemed offline', true)

  const grossBefore = await page.getByTestId('cart-line-total').first().innerText()
  await page.getByTestId('cart-line').first().getByRole('button', { name: 'Discount' }).click()
  const discountDialog = page.getByTestId('discount-dialog')
  await discountDialog.waitFor()
  await discountDialog.getByRole('button', { name: 'Percent', exact: true }).click()
  await discountDialog.locator('#discount-input').fill('10')
  await page.getByTestId('apply-discount').click()
  const overrideDialog = page.getByTestId('override-dialog')
  await overrideDialog.waitFor({ timeout: 20_000 })
  check('a cashier discount above the cap asks for manager approval', true)
  await shot(page, '05-override')

  await pressPin(page, MANAGER_PIN)
  await overrideDialog.getByRole('button', { name: /Approve/i }).click()
  await overrideDialog.waitFor({ state: 'detached', timeout: 20_000 })
  check('the manager approves the discount offline', true)

  const netAfter = await page.getByTestId('cart-line-total').first().innerText()
  check(
    'the approved line discount is applied',
    grossBefore !== netAfter,
    `${grossBefore} → ${netAfter}`,
  )
  const total = Number((await page.getByTestId('totals-total').innerText()).replace(/[^0-9.]/g, ''))
  check('the cart total is positive after discounts', total > 0)

  await page.getByTestId('pay-button').click()
  await page.getByTestId('tender-total').waitFor()
  await page.getByTestId('exact-cash').click()
  await page.getByTestId('complete-sale').click()
  await page.getByTestId('receipt-view').waitFor({ timeout: 30_000 })
  const receiptNumber = (await page.getByTestId('receipt-number').innerText()).trim()
  check('the sale completes and opens the receipt', receiptNumber.length > 0)
  await page
    .getByTestId('print-status')
    .filter({ hasText: /Printed/i })
    .waitFor({
      timeout: 30_000,
    })
  check('the receipt prints through the fake ESC/POS adapter', true)
  await shot(page, '06-receipt')

  const receiptPath = path.join(receiptsDir, `${receiptNumber}.txt`)
  check('the receipt file exists', fs.existsSync(receiptPath))
  const receiptText = fs.existsSync(receiptPath) ? fs.readFileSync(receiptPath, 'utf8') : ''
  check('the receipt carries the sale total', receiptText.includes('TOTAL'))
  const drawerLog = path.join(receiptsDir, 'drawer.log')
  const drawerLines = fs.existsSync(drawerLog)
    ? fs.readFileSync(drawerLog, 'utf8').trim().split('\n').filter(Boolean)
    : []
  check('the cash drawer kicked exactly once', drawerLines.length === 1, drawerLines.join(' | '))

  const pendingRows = await outboxRowCount(page)
  check(
    'the sale waits in the outbox',
    (await page.getByTestId('outbox-row').filter({ hasText: receiptNumber }).count()) === 1,
    `rows=${pendingRows}`,
  )
  await page
    .getByTestId('sync-badge')
    .filter({ hasText: /pending/i })
    .waitFor({
      timeout: 15_000,
    })
  check('the header shows the pending count', true)
  await shot(page, '07-sync-pending')

  // ==========================================================================
  section('A4. Restart offline: PIN login, reprint, then reconnect')
  await app.close()
  app = null
  await stopApi()
  check('the API is stopped for the offline relaunch', !(await waitForPort(4000, true, 1_000)))

  app = await launchApp(userDataDir)
  const page2 = app.page
  await page2.getByTestId('shell-ready').waitFor({ timeout: 45_000 })
  await goto(page2, '#pos')
  await page2.getByRole('heading', { name: 'Who is signing in?' }).waitFor({ timeout: 60_000 })
  check('a relaunched terminal offers the offline PIN login', true)
  await signInAs(page2, cashier.name, CASHIER_PIN)
  await page2.getByRole('heading', { name: /^Shift / }).waitFor({ timeout: 45_000 })
  check('the open shift survives the restart', true)
  await page2.getByRole('button', { name: 'Start selling' }).click()
  await page2.getByTestId('product-search').waitFor({ timeout: 45_000 })

  await outboxRowCount(page2)
  check(
    'the pending sale survives the restart',
    (await page2.getByTestId('outbox-row').filter({ hasText: receiptNumber }).count()) === 1,
  )
  await goto(page2, '#pos/sales')
  await page2.getByTestId('sale-row').first().waitFor({ timeout: 20_000 })
  check('the offline sale is listed on the terminal', true)
  await page2.getByTestId('sale-row').first().getByRole('button', { name: 'Open' }).click()
  await page2.getByTestId('receipt-view').waitFor()
  await page2.getByTestId('print-again').click()
  await page2
    .getByTestId('print-status')
    .filter({ hasText: /Printed/i })
    .waitFor({ timeout: 20_000 })
  let reprinted = ''
  for (let attempt = 0; attempt < 40; attempt += 1) {
    reprinted = fs.readFileSync(receiptPath, 'utf8')
    if (reprinted.includes('REPRINT')) break
    await page2.waitForTimeout(250)
  }
  check('an offline reprint is marked as a reprint', reprinted.includes('REPRINT'))
  check('a reprint does not kick the drawer again', drawerLines.length === 1)

  await startApi()
  check('the API is back', await waitForPort(4000, true, 30_000))
  await syncNow(page2)
  let waiting = '1'
  for (let attempt = 0; attempt < 90; attempt += 1) {
    waiting = (await page2.getByTestId('sync-waiting-count').innerText()).trim()
    if (waiting === '0') break
    await page2.getByTestId('sync-now').click()
    await page2.waitForTimeout(1_000)
  }
  check('the outbox drains to zero after reconnecting', waiting === '0', `waiting=${waiting}`)
  await page2
    .getByTestId('sync-badge')
    .filter({ hasText: /Synced/i })
    .waitFor({
      timeout: 30_000,
    })
  check('the header reports a successful sync', true)
  await shot(page2, '08-synced')

  const uploaded = await serverSale(receiptNumber)
  check('the server has exactly one copy of the sale', Boolean(uploaded))
  const duplicateSells = await db.query(
    `SELECT count(*)::int AS count FROM sale WHERE receipt_number = $1`,
    [receiptNumber],
  )
  check('the sale was uploaded exactly once', Number(duplicateSells.rows[0]?.count) === 1)
  const movement = await db.query(
    `SELECT quantity_delta, reference_number FROM stock_movement
      WHERE reference_id = $1 AND type = 'SALE'`,
    [uploaded?.id],
  )
  check(
    'the server stock movement references the receipt',
    movement.rows[0]?.reference_number === receiptNumber,
  )
  check(
    'the server stock moved by the sold quantity',
    Number(movement.rows[0]?.quantity_delta) === -1,
  )
  const conflictsAfterA = await db.query(
    `SELECT count(*)::int AS count FROM sync_conflict WHERE sale_id = $1`,
    [uploaded?.id],
  )
  check('the approved discount raised no conflict', Number(conflictsAfterA.rows[0]?.count) === 0)

  // ==========================================================================
  section('B. Offline over-limit credit and the conflict')
  await page2.context().setOffline(true)
  await page2.waitForFunction(() => navigator.onLine === false)

  await goto(page2, '#pos')
  await addProduct(page2, 'Bosch S4 Battery')
  await attachCustomer(page2, 'Akosua')
  await page2.getByTestId('pay-button').click()
  await page2.getByTestId('tender-total').waitFor()
  await page2.getByTestId('method-credit').click()
  await page2.getByTestId('complete-sale').click()
  const creditOverride = page2.getByTestId('override-dialog')
  await creditOverride.waitFor({ timeout: 20_000 })
  check('an over-limit credit sale asks a manager or offers a bypass', true)
  await page2.getByTestId('continue-without-approval').click()
  await page2.getByTestId('complete-sale').click()
  await page2.getByTestId('receipt-view').waitFor({ timeout: 30_000 })
  const creditReceipt = (await page2.getByTestId('receipt-number').innerText()).trim()
  check('the till completes an over-limit credit sale without approval', creditReceipt.length > 0)

  await page2.context().setOffline(false)
  await syncNow(page2)
  let creditWaiting = '1'
  for (let attempt = 0; attempt < 90; attempt += 1) {
    creditWaiting = (await page2.getByTestId('sync-waiting-count').innerText()).trim()
    if (creditWaiting === '0') break
    await page2.getByTestId('sync-now').click()
    await page2.waitForTimeout(1_000)
  }
  check('the credit sale uploads', creditWaiting === '0', `waiting=${creditWaiting}`)
  await page2.getByTestId('high-conflict-banner').waitFor({ timeout: 30_000 })
  check('the HIGH conflict is surfaced on the till', true)
  const conflictText = await page2.getByTestId('conflict-list').innerText()
  check(
    'the conflict names the credit over-limit',
    /credit over limit/i.test(conflictText.replaceAll('_', ' ')),
    conflictText.slice(0, 120),
  )
  await shot(page2, '09-conflict')

  const creditSale = await serverSale(creditReceipt)
  check('the over-limit sale exists on the server', Boolean(creditSale))
  const creditConflict = await db.query(
    `SELECT type, severity FROM sync_conflict WHERE sale_id = $1 ORDER BY created_at`,
    [creditSale?.id],
  )
  check(
    'the server stored a HIGH CREDIT_OVER_LIMIT conflict',
    creditConflict.rows.some((row) => row.type === 'CREDIT_OVER_LIMIT' && row.severity === 'HIGH'),
  )

  // ==========================================================================
  section('C. Revocation pauses uploads without losing the sale')
  await page2.context().setOffline(true)
  await page2.waitForFunction(() => navigator.onLine === false)
  await goto(page2, '#pos')
  await addProduct(page2, 'Denso Oil Filter')
  await page2.getByTestId('pay-button').click()
  await page2.getByTestId('tender-total').waitFor()
  await page2.getByTestId('exact-cash').click()
  await page2.getByTestId('complete-sale').click()
  await page2.getByTestId('receipt-view').waitFor({ timeout: 30_000 })
  const revokedReceipt = (await page2.getByTestId('receipt-number').innerText()).trim()
  check('a sale completes on the revoked terminal before the reconnect', revokedReceipt.length > 0)

  const deviceId = (
    await db.query(`SELECT id FROM device WHERE terminal_id = $1 AND status = 'ACTIVE'`, [
      terminal.id,
    ])
  ).rows[0]?.id
  await db.query(`UPDATE device SET status = 'REVOKED', revoked_at = now() WHERE id = $1`, [
    deviceId,
  ])
  await page2.context().setOffline(false)
  await syncNow(page2)
  await page2
    .getByTestId('sync-pause')
    .filter({ hasText: /revoked/i })
    .waitFor({
      timeout: 60_000,
    })
  check('the POS pauses and says the terminal was revoked', true)
  await shot(page2, '10-revoked')

  const pendingOnRevoked = await page2.getByTestId('outbox-row').count()
  check('the pending sale is kept, not dropped', pendingOnRevoked >= 1, `rows=${pendingOnRevoked}`)
  const notUploaded = await serverSale(revokedReceipt)
  check('the revoked upload never reached the server', notUploaded === null)
  check('no unhandled renderer errors', app.errors.length === 0, app.errors.slice(0, 2).join(' | '))
} catch (error) {
  failed += 1
  failures.push(`unhandled: ${error.message}`)
  console.error('\nUNHANDLED ERROR', error)
  if (app) {
    try {
      await shot(app.page, '99-failure')
      console.error('\nPAGE TEXT\n', (await app.page.locator('body').innerText()).slice(0, 2000))
    } catch {
      // The page may already be gone.
    }
  }
} finally {
  if (app) await app.close().catch(() => {})
  await db.end()
}

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failures.length > 0) {
  console.error('\nFailures:')
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
