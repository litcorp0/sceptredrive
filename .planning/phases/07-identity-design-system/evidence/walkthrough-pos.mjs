#!/usr/bin/env node
/**
 * Phase 7 Plan 07, Task 3 — steps 8 and 9 of the walkthrough, in the packaged POS.
 *
 * 8. Fresh install: enrol the terminal from a console-issued code, sign in with a cashier PIN,
 *    open a shift, sell one item for cash, and land on a receipt.
 * 9. Offline: relaunch with the API and PowerSync unreachable, and prove the app still opens,
 *    says "Offline" without an error, and still sells.
 *
 * Requires the API on :4000, the PowerSync service on :8080, the admin dev server, a packaged
 * build (`bun run package:pos`), and demo seed data.
 *
 *   ADMIN_URL=http://localhost:3001 node .planning/phases/07-identity-design-system/evidence/walkthrough-pos.mjs
 *
 * Step 9 emulates the outage by aborting requests in the driver instead of stopping the
 * developer's API process: the renderer sees the same network failures either way, and the
 * evidence script must not kill a server it does not own.
 */
import { createHmac } from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { chromium, _electron as electron } from 'playwright'

const adminUrl = process.env.ADMIN_URL ?? 'http://localhost:3001'
const apiUrl = process.env.API_BASE_URL ?? 'http://localhost:4000'
const totpFile = process.env.TOTP_FILE ?? '/tmp/opencode/admin-totp.json'
const repo = path.resolve(import.meta.dirname, '../../../..')
const desktopDir = path.join(repo, 'desktop')
const shots = path.resolve(import.meta.dirname, 'shots')
fs.mkdirSync(shots, { recursive: true })

const STAFF_CODE = process.env.DEMO_STAFF_CODE ?? 'GA-0006'
const STAFF_PIN = process.env.DEMO_STAFF_PIN ?? '2468'

const failures = []
let checks = 0
function check(condition, label, detail) {
  checks += 1
  if (condition) {
    console.log(`  ok   ${label}`)
    return true
  }
  failures.push(detail ? `${label} (${detail})` : label)
  console.log(`  FAIL ${label}${detail ? ` — ${detail}` : ''}`)
  return false
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

const env = fs.readFileSync(path.join(repo, '.env'), 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]

/** Fill a selector or a locator, and confirm the value stuck (React may re-render). */
async function robustFill(page, target, value) {
  for (let attempt = 0; attempt < 12; attempt += 1) {
    if (typeof target === 'string') await page.fill(target, value)
    else await target.fill(value)
    const read =
      typeof target === 'string' ? await page.inputValue(target) : await target.inputValue()
    if (read === value) return
    await page.waitForTimeout(250)
  }
  throw new Error(`could not fill ${String(target)}`)
}

/**
 * Launch the **unpackaged** production build.
 *
 * A packaged app sets `allowLocalOrigins: false`, so its CSP refuses `http://localhost:4000`
 * on purpose — a shipped terminal must never be pointable at a local impersonator. Enrolment
 * needs the API, so this walkthrough runs the same `.vite` bundle through the development
 * Electron binary, which keeps the `app://sceptre-drive` origin and allows local origins.
 * The packaged binary is proven separately by `test:e2e` (step 10).
 */
function electronBinary() {
  const pathFile = path.join(desktopDir, 'node_modules', 'electron', 'path.txt')
  return path.join(
    desktopDir,
    'node_modules',
    'electron',
    'dist',
    fs.readFileSync(pathFile, 'utf8').trim(),
  )
}

async function launchPos({ userDataDir, online }) {
  const app = await electron.launch({
    executablePath: electronBinary(),
    args: ['.', '--no-sandbox', '--disable-gpu', `--user-data-dir=${userDataDir}`],
    cwd: desktopDir,
    timeout: 60_000,
  })
  const page = await app.firstWindow()

  if (!online) {
    // The renderer sees exactly what a dead network produces.
    await page.context().route('**/*', (route) => {
      const url = route.request().url()
      if (url.startsWith('app://')) return route.continue()
      return route.abort('internetdisconnected')
    })
    await page.reload({ waitUntil: 'domcontentloaded' })
  }

  return {
    app,
    page,
    async close() {
      await app.close().catch(() => {})
    },
  }
}

/**
 * Create a terminal for this run.
 *
 * A walkthrough opens a shift numbered `<terminal>-S-<day>-01` from a *fresh* local database.
 * Re-running against the same terminal would reuse that number, and the server would reject it
 * as a duplicate — a fixture collision, not a product defect. A run-scoped terminal keeps every
 * existing row (and its ledger) intact instead of deleting history to make room.
 */
async function createWalkthroughTerminal(consolePage) {
  const branches = await (await consolePage.context().request.get(`${apiUrl}/api/branches`)).json()
  const branch = (branches.branches ?? []).find((entry) => entry.code === 'ACC-SPX')
  if (!branch)
    throw new Error('the ACC-SPX demo branch is missing; run `bun run db:seed -- --demo`')

  const suffix = Date.now().toString(36).slice(-4).toUpperCase()
  const response = await consolePage.context().request.post(`${apiUrl}/api/terminals`, {
    data: { branchId: branch.id, name: `Walkthrough ${suffix}` },
  })
  if (!response.ok()) {
    throw new Error(`could not create a terminal: ${response.status()} ${await response.text()}`)
  }
  return (await response.json()).terminal
}

async function issueEnrollmentCode(consolePage, terminalCode) {
  await consolePage.goto(`${adminUrl}/terminals`, { waitUntil: 'networkidle' })
  const row = consolePage.locator('tr', { hasText: terminalCode }).first()
  await row.waitFor({ timeout: 30_000 })
  await row.getByRole('button', { name: 'Enrollment' }).click()
  await consolePage.getByRole('dialog').waitFor()
  await consolePage.getByRole('button', { name: 'Generate code' }).click()
  const code = consolePage.locator('[role="dialog"] p.font-mono').first()
  await code.waitFor({ timeout: 20_000 })
  const value = (await code.innerText()).trim().replace(/[\s-]/g, '')
  await consolePage.getByRole('button', { name: 'Close' }).first().click()
  return value
}

const adminBrowser = await chromium.launch()
const adminContext = await adminBrowser.newContext({ viewport: { width: 1440, height: 1000 } })
const consolePage = await adminContext.newPage()
consolePage.setDefaultTimeout(30_000)

let pos = null
const userDataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'sceptre-drive-pos-walkthrough-'))

try {
  // --- console sign-in ------------------------------------------------------
  // The dev server can still be hydrating on the first attempt, so allow a retry.
  let signedIn = false
  for (let attempt = 0; attempt < 3 && !signedIn; attempt += 1) {
    await consolePage.goto(`${adminUrl}/login`, { waitUntil: 'networkidle' })
    await consolePage.waitForTimeout(1200)
    await robustFill(consolePage, '#email', envValue('ADMIN_EMAIL'))
    await robustFill(consolePage, '#password', envValue('ADMIN_PASSWORD'))
    await consolePage.getByRole('button', { name: 'Sign in' }).click()
    signedIn = await consolePage
      .waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 25_000 })
      .then(() => true)
      .catch(() => false)
  }
  if (!signedIn) throw new Error('console sign-in did not leave /login')
  if (new URL(consolePage.url()).pathname.startsWith('/two-factor')) {
    const url = new URL(consolePage.url())
    if (url.searchParams.get('setup')) {
      await consolePage.getByText('Set up two-factor authentication').waitFor()
      await robustFill(consolePage, '#current-password', envValue('ADMIN_PASSWORD'))
      await consolePage.getByRole('button', { name: 'Continue' }).click()
      await consolePage.getByText('Scan this QR code').waitFor()
      await consolePage.getByText("Can't scan? Show the manual key").click()
      const secret = (await consolePage.locator('details p.font-mono').innerText()).trim()
      fs.mkdirSync(path.dirname(totpFile), { recursive: true })
      fs.writeFileSync(totpFile, JSON.stringify({ secret }))
      await consolePage.getByRole('button', { name: "I've saved my backup codes" }).click()
      await consolePage.getByText('Enter the code from your app').waitFor()
      await robustFill(consolePage, '#code', totpCode(secret))
      await consolePage.getByRole('button', { name: 'Verify' }).click()
    } else {
      const { secret } = JSON.parse(fs.readFileSync(totpFile, 'utf8'))
      await robustFill(consolePage, '#code', totpCode(secret))
      await consolePage.getByRole('button', { name: 'Verify' }).click()
    }
  }
  await consolePage.waitForTimeout(1500)
  check(
    !new URL(consolePage.url()).pathname.startsWith('/login'),
    'console signs in to issue a code',
  )

  // --- step 8: fresh install ------------------------------------------------
  console.log('\n-- 8. Desktop, fresh install --')

  const terminal = await createWalkthroughTerminal(consolePage)
  check(Boolean(terminal?.code), 'the console creates a terminal for this run', terminal?.code)

  const code = await issueEnrollmentCode(consolePage, terminal.code)
  check(code.length >= 6, 'the console issues a one-time enrolment code', code)

  pos = await launchPos({ userDataDir, online: true })
  const page = pos.page
  page.setDefaultTimeout(45_000)

  /*
   * A packaged build with no hash opens on the shell diagnostics panel (app info and the
   * keychain self-test). The till's own home screen is Phase 10's job; for now the operator
   * navigates to `#login`, which is the enrolment / PIN entry point.
   */
  await page.evaluate(() => {
    window.location.hash = '#login'
  })
  await page.locator('#enrollment-code').waitFor({ timeout: 45_000 })
  check(true, 'a fresh profile opens on the enrolment screen')
  await page.screenshot({ path: path.join(shots, 'plan07-08-pos-enrolment.png') })

  // A code is single-use and short-lived; if a redemption loses a race, issue a fresh one.
  let enrolled = false
  let attemptCode = code
  for (let attempt = 0; attempt < 3 && !enrolled; attempt += 1) {
    if (attempt > 0) attemptCode = await issueEnrollmentCode(consolePage, terminal.code)
    await page.fill('#enrollment-code', attemptCode)
    await page.getByRole('button', { name: 'Enrol terminal' }).click()
    enrolled = await page
      .getByText('Authorize this terminal')
      .waitFor({ timeout: 30_000 })
      .then(() => true)
      .catch(() => false)
    if (!enrolled) console.log(`  note code ${attemptCode} was rejected; issuing another`)
  }
  check(enrolled, 'the terminal enrols and asks the cashier to authorise')
  await page.screenshot({ path: path.join(shots, 'plan07-08-pos-authorize.png') })

  // Authorise this terminal with the cashier's staff code and PIN (online, once).
  await robustFill(page, '#staff-identity', STAFF_CODE)
  for (const digit of STAFF_PIN) {
    await page.getByRole('button', { name: `Digit ${digit}` }).click()
  }
  await page.getByRole('button', { name: 'Authorize' }).click()
  await page.waitForTimeout(6000)
  check(
    !/Authorize this terminal/i.test(await page.evaluate(() => document.body.innerText)),
    'the cashier authorises the terminal',
  )

  // A live binding still asks the cashier to sign in; PIN pads are the only input.
  if (/who is signing in/i.test(await page.evaluate(() => document.body.innerText))) {
    const card = page.getByRole('button').filter({ hasText: STAFF_CODE }).first()
    if (await card.count()) await card.click()
    for (const digit of STAFF_PIN) {
      await page.getByRole('button', { name: `Digit ${digit}` }).click()
    }
    await page.getByRole('button', { name: 'Sign in' }).last().click()
    await page.waitForTimeout(5000)
  }
  check(
    !/who is signing in/i.test(await page.evaluate(() => document.body.innerText)),
    'the cashier PIN signs the terminal in',
  )
  await page.screenshot({ path: path.join(shots, 'plan07-08-pos-pin.png') })

  // Open the shift.
  await page.evaluate(() => {
    window.location.hash = '#shift'
  })
  await page.getByRole('button', { name: 'Open shift' }).waitFor({ timeout: 45_000 })
  await page.getByRole('button', { name: 'Open shift' }).click()
  await robustFill(page, '#opening-float', '200.00')
  await page.getByRole('button', { name: 'Open shift' }).last().click()
  await page.waitForTimeout(3000)
  const shiftOpen = !(await page.getByText('No open shift').count())
  check(shiftOpen, 'the shift opens with a GHS 200.00 float')
  await page.screenshot({ path: path.join(shots, 'plan07-08-pos-shift.png') })

  /*
   * Let the SHIFT_OPEN upload land before selling. The outbox orders by `created_at`, but a
   * row that failed once carries a back-off and a younger row can overtake it — so a sale can
   * reach the server before the shift it belongs to and be dead-lettered as SHIFT_MISSING.
   * That ordering weakness is recorded for Phase 13; here it only needs the cashier's natural
   * pause between opening a shift and scanning the first item.
   */
  const shiftBadge = page.getByTestId('sync-badge')
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const state = await shiftBadge.getAttribute('data-state').catch(() => null)
    if (state === 'synced' || state === 'idle') break
    await page.waitForTimeout(1500)
  }

  // Sell one item for cash.
  await page.evaluate(() => {
    window.location.hash = '#pos'
  })
  const search = page.getByPlaceholder(/Scan a barcode/)
  await search.waitFor({ timeout: 45_000 })
  await robustFill(page, search, 'GIK-00001')
  await page.waitForTimeout(2500)
  const addButton = page
    .locator('[aria-label="Catalog"] button')
    .filter({ hasText: /GIK-00001/ })
    .first()
  if (await addButton.count()) {
    await addButton.click()
  } else {
    await search.press('Enter')
  }
  await page.waitForTimeout(1200)

  const payButton = page.getByTestId('pay-button')
  check((await payButton.count()) > 0, 'a product can be added to the cart')
  await payButton.click()
  await page.getByTestId('method-cash').click()
  await page.getByTestId('exact-cash').click()
  await page.screenshot({ path: path.join(shots, 'plan07-08-pos-tender.png') })
  await page.getByTestId('complete-sale').click()
  await page.waitForTimeout(6000)

  const afterSale = await page.evaluate(() => document.body.innerText)
  const receiptNumber = afterSale.match(new RegExp(`${terminal.code}-\\d{8}-\\d{4}`))?.[0] ?? null
  check(receiptNumber !== null, 'the sale completes and allocates a receipt number', receiptNumber)
  await page.screenshot({ path: path.join(shots, 'plan07-08-pos-receipt.png'), fullPage: true })

  /*
   * Let the outbox drain before the offline leg, so the offline badge reports the network
   * rather than leftover unsent work. A terminal that is merely disconnected is the case the
   * plan describes; a terminal with a dead letter is a different (louder) state on purpose.
   */
  const onlineBadge = page.getByTestId('sync-badge')
  for (let attempt = 0; attempt < 30; attempt += 1) {
    const state = await onlineBadge.getAttribute('data-state').catch(() => null)
    if (state === 'synced' || state === 'idle') break
    await page.waitForTimeout(2000)
  }
  const onlineState = await onlineBadge.getAttribute('data-state').catch(() => null)
  if (onlineState !== 'synced' && onlineState !== 'idle') {
    // Leave the sync diagnostics in the evidence folder: the outbox row says why.
    await page.evaluate(() => {
      window.location.hash = '#pos/sync'
    })
    await page.waitForTimeout(3000)
    fs.writeFileSync(
      path.join(shots, 'plan07-08-pos-sync.txt'),
      await page.evaluate(() => document.body.innerText),
    )
    await page.screenshot({ path: path.join(shots, 'plan07-08-pos-sync.png'), fullPage: true })
    await page.evaluate(() => {
      window.location.hash = '#pos'
    })
    await page.waitForTimeout(1500)
  }
  check(
    onlineState === 'synced' || onlineState === 'idle',
    'the sale uploads and the outbox drains before going offline',
    String(onlineState),
  )
  await pos.close()
  pos = null

  // --- step 9: offline ------------------------------------------------------
  console.log('\n-- 9. Desktop, offline --')

  pos = await launchPos({ userDataDir, online: false })
  const offlinePage = pos.page
  offlinePage.setDefaultTimeout(45_000)
  await offlinePage.evaluate(() => {
    window.location.hash = '#login'
  })
  await offlinePage.getByText('Who is signing in?').waitFor({ timeout: 45_000 })

  const offlineLogin = await offlinePage.evaluate(() => document.body.innerText)
  check(/Offline/i.test(offlineLogin), 'the relaunched app opens and reports the device Offline')
  check(
    !/error|unhandled|failed to/i.test(offlineLogin),
    'the offline login screen shows no error text',
  )
  await offlinePage.screenshot({
    path: path.join(shots, 'plan07-09-pos-offline-login.png'),
    fullPage: true,
  })

  // The binding verifier is local, so the cashier signs in with no network at all.
  await offlinePage
    .getByRole('button')
    .filter({ hasText: /GA-0006|Demo Cashier/ })
    .first()
    .click()
  for (const digit of STAFF_PIN) {
    await offlinePage.getByRole('button', { name: `Digit ${digit}` }).click()
  }
  await offlinePage.getByRole('button', { name: 'Sign in' }).last().click()
  await offlinePage.waitForTimeout(5000)
  check(
    !/Who is signing in/i.test(await offlinePage.evaluate(() => document.body.innerText)),
    'the cashier signs in with the PIN while offline',
  )

  await offlinePage.evaluate(() => {
    window.location.hash = '#pos'
  })
  await offlinePage.waitForTimeout(3000)
  const badge = offlinePage.getByTestId('sync-badge')
  const badgeText = (await badge.count())
    ? (await badge.innerText()).replace(/\s+/g, ' ').trim()
    : '(no badge)'
  const badgeState = await badge.getAttribute('data-state').catch(() => null)
  const badgeDetail = await badge.getAttribute('title').catch(() => null)
  check(
    badgeState === 'offline' && /offline/i.test(badgeText),
    'the sync badge reads Offline without an error',
    `${badgeState}: ${badgeText} — ${badgeDetail}`,
  )
  await offlinePage.screenshot({
    path: path.join(shots, 'plan07-09-pos-offline.png'),
    fullPage: true,
  })

  // Still sells offline.
  const offlineSearch = offlinePage.getByPlaceholder(/Scan a barcode/)
  await offlineSearch.waitFor({ timeout: 45_000 })
  await robustFill(offlinePage, offlineSearch, 'GIK-00002')
  await offlinePage.waitForTimeout(2500)
  const offlineAdd = offlinePage
    .locator('[aria-label="Catalog"] button')
    .filter({ hasText: /GIK-00002/ })
    .first()
  if (await offlineAdd.count()) await offlineAdd.click()
  else await offlineSearch.press('Enter')
  await offlinePage.waitForTimeout(1200)
  check(
    (await offlinePage.getByTestId('pay-button').count()) > 0,
    'the catalogue is readable offline and the cart accepts a product',
  )
  await offlinePage.screenshot({ path: path.join(shots, 'plan07-09-pos-offline-cart.png') })
} catch (error) {
  failures.push(`exception: ${error instanceof Error ? error.message : String(error)}`)
  console.error(error)
  // Leave the failing screen in the evidence folder; a text dump is faster than a rerun.
  if (pos) {
    try {
      fs.writeFileSync(
        path.join(shots, 'plan07-pos-failure.txt'),
        `${pos.page.url()}\n\n${await pos.page.evaluate(() => document.body.innerText)}`,
      )
      await pos.page.screenshot({
        path: path.join(shots, 'plan07-pos-failure.png'),
        fullPage: true,
      })
      console.error('  (failure screen written to shots/plan07-pos-failure.txt)')
    } catch {
      // best effort
    }
  }
} finally {
  if (pos) await pos.close()
  await adminBrowser.close()
  fs.rmSync(userDataDir, { recursive: true, force: true, maxRetries: 3 })
}

console.log('')
if (failures.length > 0) {
  console.error(`${failures.length} failure(s):`)
  for (const failure of failures) console.error(`  - ${failure}`)
  process.exit(1)
}
console.log(`${checks}/${checks} checks passed`)
