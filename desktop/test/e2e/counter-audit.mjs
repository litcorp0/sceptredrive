#!/usr/bin/env node
/**
 * Phase 10 Plan 09 — the counter audit.
 *
 * Proves, against a real terminal driving real sales, the four things this phase promised and
 * could not assert from a unit test:
 *
 *   1. a fresh install opens enrolment, and a cashier can sell from it;
 *   2. the home figures are correct — including offline and after a relaunch — against
 *      arithmetic this script owns, not against the screen itself;
 *   3. every screen fits and is operable at the smallest supported counter size (1024 × 768),
 *      nothing is hover-only, and every target is reachable with a glove on;
 *   4. a sale completes without a pointer.
 *
 * It is a gate, not a transcript: `bun run --filter desktop test:counter` from the repo root.
 *
 * **Why the unpackaged production build.** The packaged binary sets `allowLocalOrigins: false`
 * on purpose — a shipped terminal must never be pointed at a local impersonator — so it cannot
 * enrol against a localhost API. This drives the same `.vite` bundle, `app://` origin, main
 * process, preload bridge, and CSP that Forge packages. `security-smoke.mjs` proves the packaged
 * binary separately.
 *
 * Prerequisites (the script exits 2 and names the missing one):
 *   - API on :4000, PowerSync on :8080, Postgres on :5434 with the demo seed;
 *   - `bun run --filter desktop package` (or any build that produces `.vite`);
 *   - `.env` with ADMIN_EMAIL / ADMIN_PASSWORD / DATABASE_URL.
 *
 * It creates its own terminal and its own customer per run: never delete a shipped row to make
 * room for a fixture.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { Client } from 'pg'
import { _electron as electron } from 'playwright'
import { averageBasketMinor } from '@sceptre/shared'

const repo = path.resolve(import.meta.dirname, '..', '..', '..')
const desktopDir = path.join(repo, 'desktop')
const rendererDir = path.join(desktopDir, 'src', 'renderer')
const evidenceDir = path.join(repo, '.planning', 'phases', '10-desktop-pos-redesign', 'evidence')
const shotsDir = path.join(evidenceDir, 'shots')
const API = process.env.API_BASE_URL ?? 'http://localhost:4000'
const POWERSYNC = process.env.POWERSYNC_URL ?? 'http://localhost:8080'
const ORIGIN = process.env.ADMIN_URL ?? 'http://localhost:3000'
const env = fs.readFileSync(path.join(repo, '.env'), 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
const DATABASE_URL = process.env.DATABASE_URL ?? envValue('DATABASE_URL')

/** The smallest supported counter screen (D13), and two larger ones. */
const VIEWPORTS = [
  { width: 1024, height: 768 },
  { width: 1366, height: 768 },
  { width: 1920, height: 1080 },
]
/** The plan's ceiling under `prefers-reduced-motion: reduce`. */
const REDUCED_MOTION_CEILING_MS = 1
const MIN_TARGET_PX = 44

const STAMP = Date.now().toString(36).toUpperCase()
const MANAGER_TEMP_PIN = '1379'
const MANAGER_PIN = '2468'
const OPENING_FLOAT_MINOR = 20_000

// --------------------------------------------------------------------------- harness

let passed = 0
let failed = 0
const failures = []

/**
 * `check(condition, label, detail)` — condition first.
 *
 * Written this way round because the call sites read as the sentence they assert. The ten
 * `check(true, …)` cases that follow a `waitFor` are deliberate: reaching the line *is* the
 * proof, because `waitFor` throws when the element never appears.
 */
function check(condition, label, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
    return true
  }
  failed += 1
  failures.push(label)
  console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  return false
}

function section(title) {
  console.log(`\n-- ${title} --`)
}

function fatal(message) {
  console.error(`\nPREREQUISITE: ${message}`)
  console.error('The audit did not run; no assertion was reached.')
  process.exit(2)
}

/** Integer pesewas → `123.45`. No floats, same algorithm as the renderer's helper. */
function plain(minor) {
  const sign = minor < 0 ? '-' : ''
  const absolute = Math.abs(minor)
  return `${sign}${Math.trunc(absolute / 100)}.${String(absolute % 100).padStart(2, '0')}`
}

/** A rendered money string → its digits, so the comparison never parses a float. */
function digits(text) {
  return (text ?? '').replace(/[^0-9.-]/g, '')
}

/** A rendered money string → integer pesewas, split on the point rather than multiplied. */
function toMinor(text) {
  const value = digits(text)
  const negative = value.startsWith('-')
  const [whole = '0', fraction = ''] = value.replace('-', '').split('.')
  const minor = Number(whole) * 100 + Number(fraction.padEnd(2, '0').slice(0, 2))
  return negative ? -minor : minor
}

async function status(url) {
  try {
    const response = await fetch(url)
    return response.status
  } catch {
    return 0
  }
}

// --------------------------------------------------------------------------- prerequisites

section('Prerequisites')

if (!DATABASE_URL) fatal('DATABASE_URL is not set in .env')
if ((await status(`${API}/health`)) !== 200) fatal(`the API is not answering on ${API}/health`)
if ((await status(`${POWERSYNC}/probes/liveness`)) !== 200) {
  fatal(`PowerSync is not answering on ${POWERSYNC}/probes/liveness (bun run sync:up)`)
}
if (!fs.existsSync(path.join(desktopDir, '.vite', 'build', 'main.cjs'))) {
  fatal('no .vite build — run `bun run --filter desktop package` first')
}
const electronPath = path.join(
  desktopDir,
  'node_modules',
  'electron',
  'dist',
  fs.readFileSync(path.join(desktopDir, 'node_modules', 'electron', 'path.txt'), 'utf8').trim(),
)

const db = new Client({ connectionString: DATABASE_URL })
await db.connect().catch((error) => fatal(`Postgres: ${error.message}`))

const branchRow = (await db.query(`SELECT id, code FROM branch WHERE code = 'ACC-SPX'`)).rows[0]
if (!branchRow) fatal('the ACC-SPX demo branch is missing — run `bun run db:seed -- --demo`')
const managerRow = (
  await db.query(`SELECT id, staff_id, name FROM "user" WHERE email = 'manager@sceptre.local'`)
).rows[0]
if (!managerRow) fatal('the demo manager is missing — run `bun run db:seed -- --demo`')

console.log(`  PASS  API, PowerSync, Postgres, and a .vite build are all up`)
passed += 1

// --------------------------------------------------------------------------- admin API

const jar = new Map()
async function api(pathname, { method = 'GET', body } = {}) {
  const headers = {
    origin: ORIGIN,
    cookie: [...jar].map(([name, value]) => `${name}=${value}`).join('; '),
  }
  if (body !== undefined) headers['content-type'] = 'application/json'
  const response = await fetch(`${API}${pathname}`, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  })
  for (const raw of response.headers.getSetCookie()) {
    const [pair] = raw.split(';')
    const index = pair.indexOf('=')
    if (index > 0) jar.set(pair.slice(0, index).trim(), pair.slice(index + 1).trim())
  }
  const text = await response.text()
  let parsed = null
  try {
    parsed = text ? JSON.parse(text) : null
  } catch {
    parsed = { raw: text.slice(0, 200) }
  }
  return { status: response.status, body: parsed }
}

const signIn = await api('/api/auth/sign-in/email', {
  method: 'POST',
  body: { email: envValue('ADMIN_EMAIL'), password: envValue('ADMIN_PASSWORD') },
})
if (signIn.status !== 200) fatal(`admin sign-in returned ${signIn.status}`)

const terminal = (
  await api('/api/terminals', {
    method: 'POST',
    body: { branchId: branchRow.id, name: `Counter Audit ${STAMP}` },
  })
).body?.terminal
if (!terminal) fatal('the API did not create a terminal')

const enrollmentCode = (
  await api(`/api/terminals/${terminal.id}/enrollment`, { method: 'POST' })
).body?.enrollment?.code
if (!enrollmentCode) fatal('the API did not issue an enrolment code')

await api(`/api/staff/${managerRow.id}/pin`, {
  method: 'POST',
  body: { pin: MANAGER_TEMP_PIN },
})

// A credit customer with real headroom: the seeded one is already over its limit from the
// Phase 9 demo month, and a fixture that starts over-limit would test the override, not the sale.
const creditCustomer = (
  await api('/api/customers', {
    method: 'POST',
    body: {
      name: `Audit Customer ${STAMP}`,
      phone: `+2332${Date.now().toString().slice(-8)}`,
      branchId: branchRow.id,
    },
  })
).body?.customer
if (!creditCustomer) fatal('the API did not create the credit customer')
await api(`/api/credit/profiles/${creditCustomer.id}`, {
  method: 'PUT',
  body: { branchId: branchRow.id, limitMinor: 500_000 },
})

console.log(`  PASS  fixture: terminal ${terminal.code}, customer ${creditCustomer.name}`)
passed += 1

// --------------------------------------------------------------------------- app

const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-counter-audit-'))
const receiptsDir = path.join(userDataDir, 'receipts')
fs.mkdirSync(receiptsDir, { recursive: true })

let app = null
let page = null

async function launch() {
  app = await electron.launch({
    executablePath: electronPath,
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    timeout: 90_000,
    env: { ...process.env, POS_PRINTER_DRIVER: 'fake', RECEIPTS_DIR: receiptsDir },
  })
  page = await app.firstWindow()
  page.setDefaultTimeout(45_000)
  return page
}

async function goto(hash) {
  await page.evaluate((value) => {
    window.location.hash = value
  }, hash)
}

async function setViewport(width, height) {
  await app.evaluate(({ BrowserWindow }, size) => {
    BrowserWindow.getAllWindows()[0]?.setContentSize(size.width, size.height)
  }, { width, height })
  await page.waitForTimeout(250)
}

async function pressDigits(pin) {
  for (const digit of pin) {
    await page.getByRole('button', { name: `Digit ${digit}`, exact: true }).click()
  }
}

async function text(testId) {
  return (await page.getByTestId(testId).innerText()).trim()
}

async function addProduct(sku) {
  const search = page.locator('#product-search')
  await search.fill(sku)
  const card = page.getByTestId('product-card').filter({ hasText: sku }).first()
  await card.waitFor({ timeout: 30_000 })
  await card.click()
  await page.getByTestId('cart-line').first().waitFor()
}

async function waitForReceiptPrinted() {
  await page.getByTestId('receipt-view').waitFor({ timeout: 45_000 })
  await page
    .locator('[data-testid="print-status"][data-status="PRINTED"]')
    .waitFor({ timeout: 45_000 })
}

/** The sale just completed, as the local database knows it. */
async function lastSaleId() {
  const hash = await page.evaluate(() => window.location.hash)
  return hash.startsWith('#pos/receipt/') ? hash.slice('#pos/receipt/'.length) : null
}

// --------------------------------------------------------------------------- 1. boot & enrol

section('1. Boot, enrolment, and the PIN pad')

await launch()
await page.waitForLoadState('domcontentloaded')

await page.locator('#enrollment-code').waitFor({ timeout: 60_000 })
check(
  true,
  'a fresh install opens the enrolment form, not the diagnostics shell',
  page.url(),
)
check(
  !(await page.getByTestId('shell-ready').count()),
  'the diagnostics shell is not on the first screen',
)

await page.locator('#enrollment-code').fill(enrollmentCode)
await page.getByRole('button', { name: 'Enrol terminal' }).click()
await page.getByRole('heading', { name: 'Authorize this terminal' }).waitFor({ timeout: 60_000 })
check(true, 'the enrolment code redeems and the terminal asks for a staff authorization')

// The activation screen's first field is the staff code — Plan 08's autofocus fix.
check(
  (await page.evaluate(() => document.activeElement?.id)) !== 'pin-input',
  'the PIN field does not steal focus from the staff code on the activation screen',
)

const pinKeyBox = await page.getByRole('button', { name: 'Digit 1', exact: true }).boundingBox()
check(
  Boolean(pinKeyBox && pinKeyBox.width >= 64 && pinKeyBox.height >= 64),
  'every PIN key is at least 64 × 64 px',
  pinKeyBox ? `${pinKeyBox.width}×${pinKeyBox.height}` : 'no box',
)

await page.locator('#staff-identity').fill(managerRow.staff_id)
// Typed on the number row, not clicked: a till has a keyboard as well as a screen.
await page.locator('[data-testid="pin-input"]').focus()
await page.keyboard.type(MANAGER_TEMP_PIN)
const pinProgress =
  (await page.locator('[data-testid="pin-progress"]').textContent())?.trim() ?? ''
const pinType = await page.locator('[data-testid="pin-input"]').getAttribute('type')
check(
  pinProgress.startsWith(`${MANAGER_TEMP_PIN.length} of`) && pinType === 'password',
  'the PIN pad accepts the number row and announces the count, never the digits',
  `${pinProgress} / type=${pinType}`,
)
await page.getByRole('button', { name: 'Authorize' }).click()

await page.getByRole('heading', { name: 'Choose your own PIN' }).waitFor({ timeout: 60_000 })
check(true, 'a temporary PIN forces a change before the till opens')

await page.locator('#new-pin').fill(MANAGER_PIN)
await page.locator('#confirm-pin').fill(MANAGER_PIN)
await page.getByRole('button', { name: 'Save PIN' }).click()
await page.waitForFunction(() => window.location.hash.startsWith('#shift'), null, {
  timeout: 45_000,
})
check(
  (await page.evaluate(() => window.location.hash)) === '#shift',
  'the new PIN signs in and the till asks for a shift',
)

// --------------------------------------------------------------------------- 2. shift & sell

section('2. Open a shift and sell three baskets')

const BASKETS = {
  cashWithChange: { sku: 'GIK-00001', quantity: 1, unitMinor: 7_500, tenderedMinor: 9_500 },
  exactCash: { sku: 'GIK-00002', quantity: 2, unitMinor: 8_000, tenderedMinor: 16_000 },
  credit: { sku: 'GIK-00005', quantity: 1, unitMinor: 28_000, tenderedMinor: 28_000 },
}
for (const basket of Object.values(BASKETS)) {
  basket.totalMinor = basket.unitMinor * basket.quantity
}

await page.getByRole('heading', { name: 'No open shift' }).waitFor({ timeout: 30_000 })
check(true, 'the shift screen offers to open a shift')

await page.getByRole('button', { name: 'Open shift' }).first().click()
const openDialog = page.getByRole('dialog')
await openDialog.waitFor()
await openDialog.locator('#opening-float').fill(plain(OPENING_FLOAT_MINOR))
await openDialog.getByRole('button', { name: 'Open shift' }).click()
await openDialog.waitFor({ state: 'detached', timeout: 30_000 })
await page.waitForFunction(() => window.location.hash === '#home', null, { timeout: 30_000 })
check(
  (await page.evaluate(() => window.location.hash)) === '#home',
  'opening a shift lands on the shift home (P10-D6)',
)

await page.getByTestId('start-selling').click()
await page.locator('#product-search').waitFor({ timeout: 60_000 })
check(
  (await page.evaluate(() => document.activeElement?.id)) === 'product-search',
  'Start selling lands with the search field focused',
)

// -- basket 1: cash with change --------------------------------------------
await addProduct(BASKETS.cashWithChange.sku)
check(
  digits(await text('totals-total')) === plain(BASKETS.cashWithChange.totalMinor),
  'the cart total is the catalogue price, to the pesewa',
  `${digits(await text('totals-total'))} vs ${plain(BASKETS.cashWithChange.totalMinor)}`,
)
await page.getByTestId('pay-button').click()
await page.getByTestId('tender-total').waitFor({ timeout: 30_000 })
check(
  digits(await text('tender-total')) === plain(BASKETS.cashWithChange.totalMinor),
  'the tender screen carries the same total the cart showed',
)
// Exact, then one +2 000 note: the drawer takes GH₵95.00 for a GH₵75.00 sale.
await page.getByTestId('exact-cash').click()
await page
  .locator('[data-testid="cash-keypad"] button')
  .filter({ hasText: /^\+/ })
  .nth(0)
  .click()
check(
  digits(await text('change-due')) === plain(2_000) &&
    (await page.getByTestId('change-due').getAttribute('data-state')) === 'change',
  'over-tendering shows the change, not a shortfall',
  await text('change-due'),
)
await page.getByTestId('complete-sale').click()
await waitForReceiptPrinted()
check(true, 'a cash sale completes and prints')

// -- basket 2: exact cash ---------------------------------------------------
await goto('#pos')
await addProduct(BASKETS.exactCash.sku)
await page.getByTestId('cart-line-qty').first().waitFor()
await page.getByRole('button', { name: 'Increase quantity' }).first().click()
await page.getByTestId('pay-button').click()
await page.getByTestId('tender-total').waitFor({ timeout: 30_000 })
await page.getByTestId('exact-cash').click()
await page.getByTestId('complete-sale').click()
await waitForReceiptPrinted()
check(true, 'an exact-cash sale completes with no change')

// -- basket 3: credit -------------------------------------------------------
await goto('#pos')
await addProduct(BASKETS.credit.sku)
await page.getByTestId('find-customer').click()
await page.getByTestId('customer-dialog').waitFor()
await page.getByTestId('customer-search').fill(creditCustomer.phone)
await page.getByTestId('customer-hit').first().waitFor({ timeout: 20_000 })
await page.getByTestId('customer-hit').first().click()
await page.getByTestId('customer-current').waitFor()
// The credit profile is a synced row: wait for it rather than racing the download. A terminal
// that cannot see a limit must not invent one, so this is the moment the till is ready to sell
// on credit — and if it never arrives, that is the finding.
await page.getByTestId('credit-headroom').waitFor({ timeout: 45_000 })
check(true, 'a customer is attached and their credit profile has synced')
await page.getByTestId('pay-button').click()
await page.getByTestId('tender-total').waitFor({ timeout: 30_000 })
await page.getByTestId('method-credit').click()
await page.getByTestId('credit-tender-decision').waitFor({ timeout: 20_000 })
let decision = null
for (let attempt = 0; attempt < 40 && !decision; attempt += 1) {
  decision = await page
    .getByTestId('credit-tender-decision')
    .getAttribute('data-decision')
    .catch(() => null)
  if (!decision) await page.waitForTimeout(250)
}
check(decision === 'OK', 'the credit sale fits the limit, so no manager is needed', decision)
await page.getByTestId('complete-sale').click()
await waitForReceiptPrinted()
const receiptSaleId = await lastSaleId()
check(Boolean(receiptSaleId), 'a credit sale completes and prints')
check(
  (await page.evaluate(() => window.location.hash)).startsWith('#pos/receipt/'),
  'completing a sale lands on its receipt',
)

// --------------------------------------------------------------------------- 3. home correctness

section('3. Home figures against the script’s own arithmetic')

const expectedTake =
  BASKETS.cashWithChange.totalMinor + BASKETS.exactCash.totalMinor + BASKETS.credit.totalMinor
const expectedItems =
  BASKETS.cashWithChange.quantity + BASKETS.exactCash.quantity + BASKETS.credit.quantity
const expectedCashTendered = BASKETS.cashWithChange.tenderedMinor + BASKETS.exactCash.tenderedMinor
const expectedChange = BASKETS.cashWithChange.tenderedMinor - BASKETS.cashWithChange.totalMinor
const expectedCash =
  OPENING_FLOAT_MINOR + expectedCashTendered - expectedChange
const expectedBasket = averageBasketMinor(expectedTake, 3)

await goto('#home')
await page.getByTestId('home-take').waitFor({ timeout: 30_000 })
await page.waitForTimeout(1500)

check(
  digits(await text('home-take')) === plain(expectedTake),
  'take is the sum of the three sales',
  `${digits(await text('home-take'))} vs ${plain(expectedTake)}`,
)
check(
  digits(await text('home-credit')) === plain(BASKETS.credit.totalMinor),
  'credit given is the credit sale’s total',
  `${digits(await text('home-credit'))} vs ${plain(BASKETS.credit.totalMinor)}`,
)

const subline = await text('home-take-subline')
check(
  subline.includes('3 sales') && subline.includes(`${expectedItems} items`),
  'the sub-line counts the sales and the units',
  subline,
)
const basketSegment = subline.split('·').pop() ?? ''
check(
  digits(basketSegment) === plain(expectedBasket),
  'the average basket is the shared helper’s figure',
  `${digits(basketSegment)} vs ${plain(expectedBasket)}`,
)

const taxMinor = toMinor(await text('home-tax'))
check(
  taxMinor > 0 && taxMinor < expectedTake,
  'tax included is non-zero and less than the take',
  String(taxMinor),
)
check(
  digits(await text('home-drawer')) === plain(expectedCash),
  'expected cash is float + cash tendered − change',
  `${digits(await text('home-drawer'))} vs ${plain(expectedCash)}`,
)

const peak = await text('home-hour-summary')
check(
  /Busiest at \d{2}:00 with /.test(peak),
  'the chart summary names the busiest hour without a hover',
  peak,
)

const currentHourFill = await page.evaluate(() => {
  const chart = document.querySelector('[data-testid="home-hour-chart"]')
  const bars = chart?.querySelectorAll('.recharts-bar-rectangle') ?? []
  const brand = Array.from(bars).filter((group) => {
    const shape = group.querySelector('path, rect')
    if (!shape) return false
    return getComputedStyle(shape).fill === 'rgb(242, 106, 27)'
  })
  return { total: bars.length, brand: brand.length }
})
check(
  currentHourFill.brand === 1,
  'exactly one bar is brand orange — the current hour',
  `${currentHourFill.brand} of ${currentHourFill.total} rendered bars`,
)

const topSeller = await page
  .getByTestId('home-top-seller-row')
  .first()
  .innerText()
  .catch(() => '')
check(
  topSeller.includes('Denso Oil Filter'),
  'the top seller is the product sold most, first',
  topSeller.replace(/\n/g, ' '),
)

const unprinted = await page.getByTestId('attention-unprinted').count()
check(
  unprinted === 0,
  'no receipt is left unprinted, so the attention strip does not claim one',
  String(unprinted),
)

// --------------------------------------------------------------------------- 4. the matrix

section('4. Width, target, and reduced-motion matrix')

const SCREENS = [
  { name: 'home', hash: '#home', primary: '[data-testid="start-selling"]' },
  { name: 'sell', hash: '#pos', primary: '[data-testid="pay-button"]' },
  { name: 'tender', hash: '#pos/tender', primary: '[data-testid="complete-sale"]' },
  {
    name: 'receipt',
    hash: `#pos/receipt/${receiptSaleId}`,
    primary: '[data-testid="new-sale"]',
  },
  { name: 'sales', hash: '#pos/sales', primary: '[data-testid="back-to-selling"]' },
  { name: 'shift', hash: '#shift', primary: '[data-testid="shift-to-home"]' },
  { name: 'sync', hash: '#pos/sync', primary: '[data-testid="sync-now"]' },
  { name: 'settings', hash: '#pos/settings', primary: '[data-testid="back-to-selling"]' },
  { name: 'login', hash: '#login', primary: `button:has-text("${managerRow.name}")` },
]

// A cart line so the tender screen has something to tender.
await goto('#pos')
await page.locator('#product-search').waitFor({ timeout: 30_000 })
if ((await page.getByTestId('cart-line').count()) === 0) await addProduct('GIK-00003')

await page.emulateMedia({ reducedMotion: 'reduce' })

/** Everything the browser would hit-test, minus the visually hidden. */
const MEASURE = (ceiling) => {
  const selectors =
    'button, a[href], input, select, textarea, summary, [role="button"], [tabindex]:not([tabindex="-1"])'
  const targets = []
  for (const node of document.querySelectorAll(selectors)) {
    const rect = node.getBoundingClientRect()
    if (rect.width === 0 && rect.height === 0) continue
    if (!node.checkVisibility?.({ checkOpacity: true, checkVisibilityCSS: true })) continue
    const style = getComputedStyle(node)
    // `sr-only` is a 1 × 1 clipped field with a real accessible name, not a touch target.
    const clipped = style.position === 'absolute' && style.clip !== 'auto'
    if (clipped) continue
    if (rect.width < 44 - 0.5 || rect.height < 44 - 0.5) {
      targets.push({
        tag: node.tagName.toLowerCase(),
        label: (node.getAttribute('aria-label') ?? node.textContent ?? '')
          .trim()
          .replace(/\s+/g, ' ')
          .slice(0, 40),
        width: Math.round(rect.width),
        height: Math.round(rect.height),
      })
    }
  }

  const ms = (value) => {
    const trimmed = (value ?? '').trim()
    if (trimmed.endsWith('ms')) return Number.parseFloat(trimmed)
    if (trimmed.endsWith('s')) return Number.parseFloat(trimmed) * 1000
    return 0
  }
  const animating = Array.from(document.querySelectorAll('*')).filter((node) => {
    const style = getComputedStyle(node)
    const animation = ms(style.animationDuration)
    const transition = ms(style.transitionDuration)
    return (
      (style.animationName !== 'none' && animation > ceiling) ||
      transition > ceiling
    )
  }).length

  return {
    scrollWidth: document.documentElement.scrollWidth,
    clientWidth: document.documentElement.clientWidth,
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    targets: targets.slice(0, 4),
    targetCount: targets.length,
    animating,
  }
}

for (const screen of SCREENS) {
  for (const viewport of VIEWPORTS) {
    await setViewport(viewport.width, viewport.height)
    await goto(screen.hash)
    await page.locator(screen.primary).first().waitFor({ timeout: 30_000 })
    await page.waitForTimeout(600)

    const geo = await page.evaluate(MEASURE, REDUCED_MOTION_CEILING_MS)
    const tag = `${screen.name} @ ${viewport.width}×${viewport.height}`

    check(
      geo.scrollWidth <= geo.clientWidth + 1,
      `${tag}: no horizontal scroll`,
      `${geo.scrollWidth} > ${geo.clientWidth}`,
    )
    check(
      geo.targetCount === 0,
      `${tag}: every target is at least ${MIN_TARGET_PX}×${MIN_TARGET_PX}`,
      JSON.stringify(geo.targets),
    )
    check(
      geo.animating === 0,
      `${tag}: no motion above ${REDUCED_MOTION_CEILING_MS} ms under reduced motion`,
      `${geo.animating} nodes`,
    )

    if (viewport.width === 1024) {
      const box = await page.locator(screen.primary).first().boundingBox()
      check(
        Boolean(box) &&
          box.y >= 0 &&
          box.y + box.height <= geo.viewportHeight + 1 &&
          box.x >= 0 &&
          box.x + box.width <= geo.viewportWidth + 1,
        `${tag}: the primary action is on screen without scrolling`,
        box ? `y=${Math.round(box.y)} h=${Math.round(box.height)}` : 'no box',
      )
      fs.mkdirSync(shotsDir, { recursive: true })
      await page.screenshot({ path: path.join(shotsDir, `counter-${screen.name}-1024.png`) })
    }
  }
}

await page.emulateMedia({ reducedMotion: 'no-preference' })
await setViewport(1024, 768)

// --------------------------------------------------------------------------- 5. keyboard

section('5. A sale with no pointer')

await goto('#home')
await page.getByTestId('start-selling').waitFor({ timeout: 30_000 })

// Clear any cart left by the matrix so the keyboard sale starts clean.
await goto('#pos')
await page.locator('#product-search').waitFor({ timeout: 30_000 })
const clear = page.getByRole('button', { name: 'Clear', exact: true }).first()
if (await clear.count()) {
  await clear.click()
  const dialog = page.getByRole('dialog')
  await dialog.waitFor()
  await dialog.getByRole('button', { name: 'Clear sale' }).click()
  await dialog.waitFor({ state: 'detached' })
}
await goto('#home')
await page.getByTestId('start-selling').waitFor({ timeout: 30_000 })

const focusRing = () =>
  page.evaluate(() => {
    const node = document.activeElement
    if (!node) return null
    const style = getComputedStyle(node)
    return { outline: `${style.outlineStyle} ${style.outlineWidth}`, color: style.outlineColor }
  })

// Tab until the primary action owns focus — a real keyboard path, not a programmatic focus.
let hops = 0
let onStart = false
while (hops < 40 && !onStart) {
  await page.keyboard.press('Tab')
  hops += 1
  onStart = await page.evaluate(
    () => document.activeElement?.getAttribute('data-testid') === 'start-selling',
  )
}
check(onStart, 'Tab reaches Start selling', `${hops} presses`)
const startRing = await focusRing()
check(
  startRing !== null && startRing.outline.startsWith('solid') && !startRing.outline.includes('0px'),
  'the focused action shows a visible ring',
  JSON.stringify(startRing),
)

await page.keyboard.press('Enter')
await page.locator('#product-search').waitFor({ timeout: 30_000 })
check(
  (await page.evaluate(() => document.activeElement?.id)) === 'product-search',
  'Enter opens the sell screen with the search field focused',
)

await page.keyboard.type('GIK-00004')
await page.keyboard.press('Enter')
await page.getByTestId('cart-line').first().waitFor({ timeout: 30_000 })
check(true, 'typing a SKU and pressing Enter adds the line')

await page.keyboard.press('F9')
await page.getByTestId('tender-total').waitFor({ timeout: 30_000 })
check(
  (await page.evaluate(() => window.location.hash)) === '#pos/tender',
  'F9 moves to tender',
)

// The number row types the amount: 12 000 for the GIK-00004 line.
await page.keyboard.type('12000')
await page.waitForTimeout(200)
check(
  digits(await text('tendered')) === plain(12_000),
  'the number row types the amount on the tender keypad',
  digits(await text('tendered')),
)
check(
  (await page.getByTestId('change-due').getAttribute('data-state')) === 'change',
  'the change figure reads as change, not a shortfall',
)

await page.keyboard.press('F9')
await waitForReceiptPrinted()
check(true, 'F9 completes the sale and the receipt prints, with no pointer used')

const keyboardSaleId = await lastSaleId()
check(Boolean(keyboardSaleId), 'the keyboard sale has a receipt')

// --------------------------------------------------------------------------- 6. chart a11y

section('6. Chart accessibility')

await goto('#home')
await page.getByTestId('home-hour-chart').waitFor({ timeout: 30_000 })
await page.waitForTimeout(800)

const chartStops = await page.evaluate(
  () => document.querySelectorAll('[data-testid="home-hour-chart"] [tabindex="0"]').length,
)
check(chartStops === 1, 'the chart is one tab stop', String(chartStops))

// recharts#7905: park the pointer off-chart or the arrow key is swallowed by the hover state.
await page.mouse.move(0, 0)
await page.locator('[data-testid="home-hour-chart"] [tabindex="0"]').first().focus()
await page.keyboard.press('ArrowRight')
await page.waitForTimeout(300)
const keyboardTooltip = await page.evaluate(() => {
  const wrapper = document.querySelector(
    '[data-testid="home-hour-chart"] .recharts-tooltip-wrapper',
  )
  return wrapper ? (wrapper.textContent ?? '').trim() : ''
})
check(keyboardTooltip.length > 0, 'arrow keys reach a data point', keyboardTooltip.slice(0, 40))

check(
  (await page.getByTestId('home-hour-summary').innerText()).length > 10,
  'the chart carries a summary sentence',
)
await page.getByTestId('home-hour-details').locator('summary').click()
await page.waitForTimeout(200)
const hourRows = await page.getByTestId('home-hour-row').count()
check(hourRows === 24, 'the data-table alternative has 24 rows', String(hourRows))
await page.getByTestId('home-hour-details').locator('summary').click()

// --------------------------------------------------------------------------- 7. offline

section('7. Offline, and a relaunch')

await page.context().setOffline(true)
await page.waitForTimeout(4000)
const offlineState = await page.getByTestId('sync-badge').getAttribute('data-state')
check(offlineState === 'offline', 'the sync badge reports Offline', String(offlineState))
check(
  !(await page.getByTestId('sync-badge').getAttribute('class'))?.includes('text-danger'),
  'offline is not styled as an error',
)

const takeBefore = digits(await text('home-take'))
await page.getByTestId('start-selling').click()
await page.locator('#product-search').waitFor({ timeout: 30_000 })
await addProduct('GIK-00012')
await page.getByTestId('pay-button').click()
await page.getByTestId('tender-total').waitFor({ timeout: 30_000 })
await page.getByTestId('exact-cash').click()
await page.getByTestId('complete-sale').click()
await waitForReceiptPrinted()
check(true, 'a sale completes with the network down')

await goto('#home')
await page.getByTestId('home-take').waitFor({ timeout: 30_000 })
await page.waitForTimeout(1500)
const takeAfter = digits(await text('home-take'))
check(
  takeAfter !== takeBefore,
  'the home take moves after an offline sale',
  `${takeBefore} → ${takeAfter}`,
)

await goto('#pos/sync')
await page.getByTestId('sync-waiting-count').waitFor({ timeout: 30_000 })
await page.waitForTimeout(1000)
const waitingCount = Number(await text('sync-waiting-count'))
check(waitingCount > 0, 'the outbox shows the waiting count', String(waitingCount))

await goto('#home')
await page.getByTestId('home-attention').waitFor({ timeout: 30_000 })
check(
  (await page.getByTestId('attention-uploads').count()) === 1,
  'the attention strip names the uploads waiting',
)

// -- relaunch, still offline ------------------------------------------------
await app.close()
await launch()
await page.waitForLoadState('domcontentloaded')
await page.context().setOffline(true)

await page.getByRole('heading', { name: 'Who is signing in?' }).waitFor({ timeout: 60_000 })
check(true, 'a relaunched offline terminal asks for a PIN, not for enrolment')
await page.getByText(managerRow.name, { exact: true }).click()
await page.getByRole('heading', { name: `Hello, ${managerRow.name}` }).waitFor()
await page.locator('[data-testid="pin-input"]').focus()
await page.keyboard.type(MANAGER_PIN)
await page.getByRole('button', { name: 'Sign in' }).click()

await page.waitForFunction(() => window.location.hash === '#home', null, { timeout: 45_000 })
check(
  (await page.evaluate(() => window.location.hash)) === '#home',
  'the offline relaunch lands on the shift home',
)
await page.getByTestId('home-take').waitFor({ timeout: 30_000 })
await page.waitForTimeout(1500)
check(
  digits(await text('home-take')) === takeAfter,
  'the figures survive a relaunch with no network',
  `${digits(await text('home-take'))} vs ${takeAfter}`,
)

await page.context().setOffline(false)

// --------------------------------------------------------------------------- 8. static

section('8. Static checks')

const PALETTE =
  /\b(?:bg|text|border|ring|outline|from|to|via|fill|stroke|divide|shadow|decoration|accent|caret)-(?:amber|emerald|sky|red|zinc|neutral|stone|slate|gray|green|blue|yellow|orange|purple|pink|teal|indigo|violet|lime|cyan|fuchsia|rose)-[0-9]{2,3}\b/
const DIAGNOSTIC_SURFACES = new Set([
  'routes/_pos/dev-print.tsx',
  'routes/_pos/dev-sync.tsx',
  'SpikePanel.tsx',
  'App.tsx',
])

function walk(dir) {
  if (!fs.existsSync(dir)) return []
  const out = []
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name)
    if (entry.isDirectory()) out.push(...walk(full))
    else out.push(full)
  }
  return out
}

const sourceFiles = [
  ...walk(path.join(rendererDir, 'modules')),
  ...walk(path.join(rendererDir, 'components', 'layout')),
  ...walk(path.join(rendererDir, 'components', 'common')),
].filter((file) => /\.tsx?$/.test(file))

const paletteHits = sourceFiles.filter((file) => PALETTE.test(fs.readFileSync(file, 'utf8')))
check(
  paletteHits.length === 0,
  'zero raw Tailwind palette classes outside the diagnostic surfaces',
  paletteHits.map((file) => path.relative(rendererDir, file)).join(', '),
)

const allRenderer = walk(rendererDir).filter((file) => /\.tsx?$/.test(file))
const diagnosticPalette = allRenderer.filter(
  (file) =>
    PALETTE.test(fs.readFileSync(file, 'utf8')) &&
    !DIAGNOSTIC_SURFACES.has(path.relative(rendererDir, file)),
)
check(
  diagnosticPalette.length === 0,
  'the whole renderer is clean, with only the four diagnostics files allowed to differ',
  diagnosticPalette.map((file) => path.relative(rendererDir, file)).join(', '),
)

const uiFiles = sourceFiles.filter((file) => file.includes(`${path.sep}ui${path.sep}`))
check(
  uiFiles.every((file) => !fs.readFileSync(file, 'utf8').includes('@powersync/react')),
  `no module ui/ file imports @powersync/react (${uiFiles.length} ui files)`,
)

const toFixedHits = allRenderer
  .filter((file) => !file.endsWith('.test.ts'))
  .filter((file) => fs.readFileSync(file, 'utf8').includes('toFixed('))
check(
  toFixedHits.length === 0,
  'no toFixed( in the renderer’s non-test sources',
  toFixedHits.map((file) => path.relative(rendererDir, file)).join(', '),
)

const assetsDir = path.join(desktopDir, '.vite', 'renderer', 'main_window', 'assets')
const js = fs
  .readdirSync(assetsDir)
  .filter((name) => name.endsWith('.js'))
  .map((name) => ({ name, bytes: fs.statSync(path.join(assetsDir, name)).size }))
  .sort((a, b) => b.bytes - a.bytes)
const main = js[0]
const totalBytes = js.reduce((sum, file) => sum + file.bytes, 0)
console.log(`  BUNDLE ${main.name} ${main.bytes} bytes · ${js.length} chunks · ${totalBytes} total`)
fs.mkdirSync(evidenceDir, { recursive: true })
fs.writeFileSync(
  path.join(evidenceDir, 'bundle.json'),
  JSON.stringify({ recordedAt: new Date().toISOString(), main, chunks: js.length, totalBytes }, null, 2),
)
passed += 1
check(main.bytes > 0, 'the renderer bundle size is recorded for Plan 10')

// --------------------------------------------------------------------------- teardown

await app.close().catch(() => {})
await db.end().catch(() => {})
fs.rmSync(userDataDir, { recursive: true, force: true })

console.log(`\n${passed}/${passed + failed} checks passed`)
if (failed > 0) {
  console.error(`\nFailures:\n${failures.map((label) => `  - ${label}`).join('\n')}`)
  process.exit(1)
}
console.log(`Screenshots: ${path.relative(repo, shotsDir)}`)
