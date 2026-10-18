import { createHmac } from 'node:crypto'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { chromium } from 'playwright'

const BASE = 'http://localhost:3000'
const SECRET_FILE = '/tmp/opencode/admin-totp.json'
const SHOTS = process.env.SHOTS_DIR ?? new URL('./', import.meta.url).pathname
mkdirSync(SHOTS, { recursive: true })

const env = readFileSync('/home/litcorp/Projects/Fullstack/gikautos/.env', 'utf8')
const envValue = (key) => (env.match(new RegExp(`^${key}="?([^"\\n]*)`, 'm')) ?? [])[1]
const ADMIN_EMAIL = envValue('ADMIN_EMAIL')
const ADMIN_PASSWORD = envValue('ADMIN_PASSWORD')

let passed = 0
let failed = 0

function check(label, condition, detail = '') {
  if (condition) {
    passed += 1
    console.log(`  PASS  ${label}`)
  } else {
    failed += 1
    console.log(`  FAIL  ${label}${detail ? ` — ${detail}` : ''}`)
  }
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

async function robustFill(page, selector, value) {
  for (let attempt = 0; attempt < 10; attempt += 1) {
    await page.fill(selector, value)
    if ((await page.inputValue(selector)) === value) return
    await page.waitForTimeout(250)
  }
  throw new Error(`could not fill ${selector}`)
}

const browser = await chromium.launch({ channel: 'chromium' })
const context = await browser.newContext({ viewport: { width: 1440, height: 940 } })
const page = await context.newPage()
page.setDefaultTimeout(20_000)

async function shot(name) {
  await page.screenshot({ path: `${SHOTS}${name}.png`, fullPage: true })
}

async function loginAsAdmin() {
  await page.goto(`${BASE}/login`)
  await page.waitForLoadState('networkidle')
  await robustFill(page, '#email', ADMIN_EMAIL)
  await robustFill(page, '#password', ADMIN_PASSWORD)
  await page.getByRole('button', { name: 'Sign in' }).click()
  await page.waitForURL((url) => !new URL(url).pathname.startsWith('/login'), { timeout: 20_000 })
  if (!new URL(page.url()).pathname.startsWith('/two-factor')) return
  await page.waitForFunction(
    () =>
      document.querySelector('#current-password') !== null ||
      document.querySelector('#code') !== null,
  )
  const setupMode = (await page.locator('#current-password').count()) > 0
  if (setupMode) {
    await page.fill('#current-password', ADMIN_PASSWORD)
    await page.getByRole('button', { name: 'Continue' }).click()
    const secretEl = page.locator('details p.font-mono').first()
    await secretEl.waitFor({ state: 'attached' })
    const secret = ((await secretEl.textContent()) ?? '').trim()
    writeFileSync(SECRET_FILE, JSON.stringify({ secret }))
    await page.getByRole('button', { name: "I've saved my backup codes" }).click()
    await page.fill('#code', totpCode(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
  } else {
    if (!existsSync(SECRET_FILE)) throw new Error('TOTP enabled but no secret stored')
    const { secret } = JSON.parse(readFileSync(SECRET_FILE, 'utf8'))
    await page.fill('#code', totpCode(secret))
    await page.getByRole('button', { name: 'Verify' }).click()
  }
  await page.waitForURL((url) => new URL(url).pathname === '/')
}

async function chooseProduct(scope, name) {
  await scope.getByPlaceholder('Search products by name or SKU…').click()
  await scope.getByPlaceholder('Search products by name or SKU…').fill(name)
  await page
    .getByRole('button', { name: new RegExp(name) })
    .first()
    .click()
}

console.log('== Phase 3 console smoke (transfers + counts) ==\n')

try {
  await loginAsAdmin()

  await page.getByRole('combobox', { name: 'Active branch' }).click()
  await page.getByRole('option', { name: /ACC-SPX/ }).click()

  await page.getByRole('link', { name: 'Inventory' }).click()
  await page.waitForURL('**/inventory/stock')
  await page.getByRole('tab', { name: 'Transfers' }).click()
  await page.waitForURL('**/inventory/transfers')

  await page.getByRole('button', { name: 'New transfer' }).click()
  await page.waitForURL('**/inventory/transfers/new')
  await page.locator('#from-branch').click()
  await page.getByRole('option', { name: /ACC-WH1/ }).click()
  await page.locator('#to-branch').click()
  await page.getByRole('option', { name: /ACC-SPX/ }).click()

  await chooseProduct(page, 'Bosch Oil Filter')
  await page.getByLabel('Requested quantity for line 1').fill('2')
  await shot('07-transfer-new')
  await page.getByRole('button', { name: 'Save draft' }).click()
  await page.waitForURL(/\/inventory\/transfers\/[0-9a-f-]+$/)
  await page.getByRole('heading', { name: /Transfer TRF-/ }).waitFor()
  const transferUrl = page.url()
  check(
    'draft transfer created from warehouse to branch',
    (await page.getByText('Draft').count()) >= 1,
  )

  await page.getByRole('button', { name: 'Dispatch' }).click()
  const dispatchDialog = page.getByRole('dialog')
  await dispatchDialog.getByRole('button', { name: 'Dispatch' }).click()
  await page.getByText('Dispatched', { exact: true }).first().waitFor()
  check('transfer dispatched', true)

  await page.getByRole('button', { name: 'Receive' }).click()
  const receiveDialog = page.getByRole('dialog')
  await receiveDialog.getByRole('button', { name: 'Receive' }).click()
  await page.getByText('Received', { exact: true }).first().waitFor()
  check('transfer received in full', true)
  await shot('07-transfer-detail')

  await page.getByRole('tab', { name: 'Counts' }).click()
  await page.waitForURL('**/inventory/counts')
  await page.getByRole('button', { name: 'New count' }).click()
  await page.waitForURL('**/inventory/counts/new')
  await page.locator('#count-branch').click()
  await page.getByRole('option', { name: /ACC-SPX/ }).click()
  await page.getByRole('button', { name: 'Open count' }).click()
  await page.waitForURL(/\/inventory\/counts\/[0-9a-f-]+$/)
  await page.getByRole('heading', { name: /Count CNT-/ }).waitFor()

  const firstRow = page.locator('table tbody tr').first()
  const snapshotText = await firstRow.locator('td').nth(2).innerText()
  const snapshot = Number(snapshotText)
  await firstRow.getByRole('textbox').fill(String(Math.max(0, snapshot - 1)))
  await shot('07-count-entry')
  await page.getByRole('button', { name: 'Post count' }).click()
  const postDialog = page.getByRole('alertdialog')
  await postDialog.getByRole('button', { name: 'Post count' }).click()
  await page.getByText('Posted', { exact: true }).first().waitFor()
  check('count posted with a variance', (await page.getByText(/Variance -1 units/).count()) === 1)
  await shot('07-count-posted')

  await page.goto(`${BASE}/inventory/counts`)
  await page
    .getByText(/CNT-\d{5}/)
    .first()
    .waitFor()
  const listText = await page.locator('table tbody').innerText()
  await shot('07-counts-list')
  check(
    'counts list shows the posted count',
    listText.includes('Posted'),
    JSON.stringify(listText.slice(0, 120)),
  )

  await page.getByRole('tab', { name: 'Transfers' }).click()
  await page.waitForURL('**/inventory/transfers')
  await page
    .getByText(/TRF-\d{5}/)
    .first()
    .waitFor()
  const transferList = await page.locator('table tbody').innerText()
  check('transfers list shows the completed transfer', /TRF-\d{5}/.test(transferList))
  console.log(`  INFO  transfer detail: ${transferUrl}`)
} catch (error) {
  failed += 1
  console.log(`  FAIL  unexpected error — ${error.message}`)
  await shot('07-failure')
} finally {
  await browser.close()
}

console.log(`\n${passed} passed, ${failed} failed`)
process.exit(failed === 0 ? 0 : 1)
